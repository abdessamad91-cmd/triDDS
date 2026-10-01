// TriDDS API — Worker Cloudflare (v2)
// Accès créés uniquement par l'administrateur, demandes d'accès, quotas par offre,
// écritures (images, mémoire, analyse IA) liées à une session agent valide.

import { PLANS, planOf, planLabel } from "./plans.js";
import { SYSTEM_PROMPT } from "./prompt.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json"
};

const SESSION_TIMEOUT_MINUTES = 30;
const MAX_IMAGE_B64 = 7 * 1024 * 1024; // ~5 Mo d'image
const GLOBAL_CODE = "_GLOBAL";

// ---------- utilitaires ----------
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: Object.assign({}, CORS, extra) });
}
const normalizeCode = c => (c || "").trim().toUpperCase();
const normalizeBrand = b => (b || "").toLowerCase().trim();
const normalizeEmail = e => (e || "").trim().toLowerCase();
const nowIso = () => new Date().toISOString();
const currentMonth = () => new Date().toISOString().slice(0, 7);
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const escHtml = v => String(v == null ? "" : v).replace(/[&<>"']/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]));

async function readJsonKV(kv, key) {
  if (!kv) return null;
  const raw = await kv.get(key);
  return raw ? JSON.parse(raw) : null;
}
async function writeJsonKV(kv, key, data, opts) {
  await kv.put(key, JSON.stringify(data), opts);
}
function randomString(len, alphabet) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}
const generateSessionId = () => randomString(24, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
// Préfixe tiré du nom de la commune plutôt que de « Déchèterie de… ».
const CODE_SKIP = new Set(["dechetterie", "decheterie", "decheteries", "site", "centre", "ecopoint", "de", "du", "des", "la", "le", "les", "d", "l", "sur", "en"]);
function codePrefix(siteName) {
  const words = (siteName || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z]+/).filter(w => w && !CODE_SKIP.has(w));
  return (words[0] || "tri").slice(0, 4).toUpperCase();
}
function generateAccessCode(siteName) {
  const pfx = codePrefix(siteName);
  return pfx + "-" + randomString(6, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
}
function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function isAdminRequest(request, env) {
  const provided = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return !!env.TRIDDS_ADMIN_KEY && safeEqual(provided, env.TRIDDS_ADMIN_KEY);
}
async function readIndex(env) {
  return await readJsonKV(env.AUTH_STORE, "_index") || { codes: [] };
}
async function addToIndex(env, code) {
  const index = await readIndex(env);
  if (!index.codes.includes(code)) {
    index.codes.push(code);
    await writeJsonKV(env.AUTH_STORE, "_index", index);
  }
}

// ---------- sessions ----------
const sessionTimeoutMs = () => SESSION_TIMEOUT_MINUTES * 60 * 1000;
function ensureAgents(site) {
  if (!site.agents) site.agents = [];
  site.agents.forEach(a => { if (!a.role) a.role = "agent"; });
  return site.agents;
}
const normalizeRole = r => (["responsable", "agent"].includes((r || "").trim().toLowerCase()) ? r.trim().toLowerCase() : "agent");
function normalizeRoles(site) {
  ensureAgents(site);
  let seen = false;
  site.agents.forEach(a => {
    a.role = normalizeRole(a.role);
    if (a.role === "responsable") { if (seen) a.role = "agent"; seen = true; }
  });
  if (!seen && site.agents[0]) site.agents[0].role = "responsable";
  return site;
}
function sessionView(agent) {
  if (!agent || !agent.activeSession) return null;
  const s = agent.activeSession;
  return { sessionId: s.sessionId, deviceName: s.deviceName || "Appareil inconnu", startedAt: s.startedAt || null, lastSeenAt: s.lastSeenAt || null, expiresAt: s.expiresAt || null };
}
function isSessionExpired(s) {
  if (!s || !s.lastSeenAt) return true;
  return Date.now() - new Date(s.lastSeenAt).getTime() > sessionTimeoutMs();
}
function cleanupAgentSessions(site) {
  ensureAgents(site).forEach(a => { if (a.activeSession && isSessionExpired(a.activeSession)) delete a.activeSession; });
  return site;
}
function invalidateAllSessions(site) {
  ensureAgents(site).forEach(a => { delete a.activeSession; });
  return site;
}
function touchSession(agent, sessionId, deviceName) {
  const ts = nowIso();
  agent.lastSeen = ts;
  agent.activeSession = {
    sessionId,
    deviceName: deviceName || "Navigateur web",
    startedAt: agent.activeSession && agent.activeSession.sessionId === sessionId ? (agent.activeSession.startedAt || ts) : ts,
    lastSeenAt: ts,
    expiresAt: new Date(Date.now() + sessionTimeoutMs()).toISOString()
  };
}

// Vérifie code + agent + sessionId. Renvoie { site, agent } ou { error, status }.
async function verifySession(env, body) {
  const code = normalizeCode(body.code);
  const agentName = clip(body.agent, 80);
  const sessionId = clip(body.sessionId, 64);
  if (!code || !agentName || !sessionId) return { error: "Session requise. Reconnectez-vous.", status: 401 };
  const raw = await readJsonKV(env.AUTH_STORE, code);
  if (!raw) return { error: "Code invalide", status: 401 };
  if (raw.active === false) return { error: "Accès désactivé. Contactez TriDDS.", status: 403 };
  const site = cleanupAgentSessions(ensureUsageState(raw));
  const agent = ensureAgents(site).find(a => a.name === agentName);
  if (!agent || !agent.activeSession || agent.activeSession.sessionId !== sessionId) {
    return { error: "SESSION_INVALID", status: 401 };
  }
  return { code, site, agent };
}

// ---------- offres & quotas ----------
function maxAgentsFor(site) {
  if (site.agentsOverride != null && site.agentsOverride !== "") return Number(site.agentsOverride) || null;
  return planOf(site.plan).agents;
}
// Sites créés par la v1 : on préserve ce qu'ils avaient (quotas Réseau/Groupe, mémoire et fiches
// pour tous, pas de scans d'essai en plus sur les offres payantes). Marqués une seule fois.
function migrateLegacy(site) {
  if (site.schema >= 2) return site;
  site.schema = 2;
  site.legacyFeatures = true;
  if (site.teamLocked === undefined) site.teamLocked = true;
  if (site.scansOverride == null) {
    if (site.plan === "multisite") site.scansOverride = 750;
    if (site.plan === "enterprise") site.scansOverride = 999999;
  }
  if (site.plan && site.plan !== "free") site.trialTotal = Math.min(site.trialTotal || 0, site.trialUsed || 0);
  return site;
}
const isTeamLocked = site => site.teamLocked !== false;
const hasPro = site => !!site.legacyFeatures || !["free", "essentiel"].includes(site.plan);

function ensureUsageState(site) {
  migrateLegacy(site);
  if (!PLANS[site.plan]) site.plan = "free";
  if (site.trialTotal === undefined) site.trialTotal = 0;
  if (site.trialUsed === undefined) site.trialUsed = 0;
  if (!site.usageMonth) site.usageMonth = currentMonth();
  if (site.monthlyUsed === undefined) site.monthlyUsed = 0;
  const override = site.scansOverride != null && site.scansOverride !== "" ? Number(site.scansOverride) : null;
  site.monthlyLimit = override != null && !isNaN(override) ? override : planOf(site.plan).scans;
  if (site.usageMonth !== currentMonth()) { site.usageMonth = currentMonth(); site.monthlyUsed = 0; }
  return site;
}
function usageView(site) {
  const trialRemaining = Math.max(0, (site.trialTotal || 0) - (site.trialUsed || 0));
  const monthlyLimit = site.monthlyLimit || 0;
  const monthlyRemaining = monthlyLimit > 0 ? Math.max(0, monthlyLimit - (site.monthlyUsed || 0)) : 0;
  return { trialTotal: site.trialTotal || 0, trialUsed: site.trialUsed || 0, trialRemaining, monthlyLimit, monthlyUsed: site.monthlyUsed || 0, monthlyRemaining, aiEnabled: monthlyRemaining > 0 || trialRemaining > 0 };
}
function buildAccessPayload(site, code, agentName) {
  const agent = agentName ? (site.agents || []).find(a => a.name === agentName) : null;
  const agentRole = agent ? normalizeRole(agent.role) : null;
  const isResp = agentRole === "responsable";
  return Object.assign({
    ok: true,
    site: site.site,
    clientName: site.clientName || "",
    plan: site.plan,
    planName: planLabel(site.plan, site.trialTotal),
    code,
    agents: (site.agents || []).map(a => a.name),
    memoryEnabled: hasPro(site),
    agentRole,
    maxAgents: maxAgentsFor(site),
    teamLocked: isTeamLocked(site),
    canManageUsers: isResp && !isTeamLocked(site),
    canManageCatalog: isResp && hasPro(site)
  }, usageView(site));
}

// ---------- emails ----------
async function sendEmail(env, { to, subject, html, text, replyTo }) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM || !to) return { sent: false, skipped: true };
  const payload = { from: env.RESEND_FROM, to: Array.isArray(to) ? to : [to], subject, html, text };
  if (replyTo) payload.reply_to = replyTo;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { sent: false, error: data?.message || data?.error || "Erreur email (" + res.status + ")" };
  return { sent: true, id: data?.id || null };
}

function emailShell(title, inner) {
  return `<div style="margin:0;padding:0;background:#eceee9;font-family:Arial,Helvetica,sans-serif;color:#1b2420">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px">
    <div style="background:#1b2420;border-radius:14px 14px 0 0;padding:22px 24px;color:#fff">
      <div style="font-size:14px;font-weight:700;opacity:.8">TriDDS</div>
      <div style="font-size:24px;font-weight:800;margin-top:6px;line-height:1.2">${title}</div>
    </div>
    <div style="background:#fff;border-radius:0 0 14px 14px;padding:24px;border:1px solid #dfe3dc;border-top:none">${inner}</div>
    <div style="font-size:12px;color:#6b736e;padding:14px 4px;line-height:1.5">TriDDS — assistant de tri des déchets dangereux en déchèterie.</div>
  </div></div>`;
}

async function sendAccessEmail(env, p) {
  const base = (env.SITE_BASE_URL || "https://tridds.com").replace(/\/+$/, "");
  const appUrl = base + "/";
  const inner = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6">Bonjour ${escHtml(p.adminName || "")},</p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6">Votre accès TriDDS pour <strong>${escHtml(p.site)}</strong> est ouvert (offre ${escHtml(p.planName)}).</p>
    <div style="padding:16px;border-radius:12px;background:#eef6ee;border:1px solid #cfe3cf;text-align:center">
      <div style="font-size:13px;color:#4a5a4f">Code du site</div>
      <div style="font-size:30px;font-weight:800;letter-spacing:2px;margin-top:6px">${escHtml(p.code)}</div>
    </div>
    <p style="margin:18px 0 8px;font-size:14px;line-height:1.6">Pour vous connecter : ouvrez l'application, saisissez ce code puis choisissez votre nom.${p.agents && p.agents.length ? " Profils créés : " + p.agents.map(escHtml).join(", ") + "." : ""}</p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#4a5a4f">Ajoutez TriDDS à l'écran d'accueil du téléphone pour l'ouvrir comme une application. Ce code donne accès au site : ne le diffusez qu'à votre équipe.</p>
    <a href="${appUrl}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#2f7d32;color:#fff;text-decoration:none;font-weight:700">Ouvrir TriDDS</a>`;
  return sendEmail(env, {
    to: p.adminEmail,
    subject: "Votre accès TriDDS — " + p.site,
    html: emailShell("Votre accès est prêt", inner),
    text: `Votre accès TriDDS est prêt.\n\nSite : ${p.site}\nOffre : ${p.planName}\nCode du site : ${p.code}\nApplication : ${appUrl}\n`,
    replyTo: env.NOTIFY_EMAIL || undefined
  });
}

// ---------- demandes d'accès ----------
async function handleRequestAccess(request, env) {
  if (request.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  const body = await request.json().catch(() => ({}));
  if (body.website) return json({ ok: true }); // champ piège anti-robot

  const req = {
    id: "REQ-" + randomString(8, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"),
    createdAt: nowIso(),
    status: "nouvelle",
    name: clip(body.name, 80),
    email: normalizeEmail(clip(body.email, 120)),
    phone: clip(body.phone, 30),
    organisation: clip(body.organisation, 120),
    siteName: clip(body.siteName, 120),
    sites: Math.max(1, Math.min(500, parseInt(body.sites, 10) || 1)),
    plan: PLANS[body.plan] ? body.plan : "",
    message: clip(body.message, 1500),
    source: clip(body.source, 40) || "site"
  };
  if (!req.name || !req.email || !req.email.includes("@") || !req.organisation) {
    return json({ error: "Nom, email et structure sont requis." }, 400);
  }

  // Limite : 5 demandes par heure et par adresse IP.
  const ip = request.headers.get("CF-Connecting-IP") || "inconnue";
  const rlKey = "_rl_req_" + ip;
  const count = parseInt(await env.AUTH_STORE.get(rlKey) || "0", 10);
  if (count >= 5) return json({ error: "Trop de demandes envoyées. Réessayez dans une heure ou écrivez-nous directement." }, 429);
  await env.AUTH_STORE.put(rlKey, String(count + 1), { expirationTtl: 3600 });

  const store = await readJsonKV(env.AUTH_STORE, "_requests") || { items: [] };
  store.items.unshift(req);
  store.items = store.items.slice(0, 300);
  await writeJsonKV(env.AUTH_STORE, "_requests", store);

  const notify = env.NOTIFY_EMAIL;
  if (notify) {
    const rows = [["Nom", req.name], ["Email", req.email], ["Téléphone", req.phone], ["Structure", req.organisation], ["Site", req.siteName], ["Nombre de sites", req.sites], ["Offre visée", req.plan ? PLANS[req.plan].label : "—"], ["Message", req.message]]
      .map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#6b736e;vertical-align:top">${k}</td><td style="padding:6px 0;font-weight:600">${escHtml(v || "—")}</td></tr>`).join("");
    const base = (env.SITE_BASE_URL || "https://tridds.com").replace(/\/+$/, "");
    await sendEmail(env, {
      to: notify,
      replyTo: req.email,
      subject: "Demande d'accès TriDDS — " + req.organisation,
      html: emailShell("Nouvelle demande d'accès", `<table style="font-size:14px;border-collapse:collapse">${rows}</table><p style="margin-top:18px"><a href="${base}/admin.html#demandes" style="color:#2f7d32;font-weight:700">Traiter la demande dans l'admin</a></p>`),
      text: `Nouvelle demande d'accès\n${req.name} — ${req.email} — ${req.phone}\n${req.organisation} / ${req.siteName} (${req.sites} site(s))\nOffre : ${req.plan}\n\n${req.message}`
    }).catch(() => null);
  }
  return json({ ok: true, id: req.id });
}

// ---------- authentification agents ----------
async function handleAuth(request, env) {
  const body = await request.json().catch(() => ({}));
  const action = body.action || "login";
  const code = normalizeCode(body.code);
  const deviceName = clip(body.deviceName, 60) || "Navigateur web";
  const sessionId = clip(body.sessionId, 64);
  if (!code) return json({ error: "Code requis" }, 400);

  // Essais de codes au hasard : 20 codes inconnus par quart d'heure et par adresse IP.
  const ip = request.headers.get("CF-Connecting-IP") || "inconnue";
  const rlKey = "_rl_auth_" + ip;
  const fails = parseInt(await env.AUTH_STORE.get(rlKey) || "0", 10);
  if (fails >= 20) return json({ error: "Trop d'essais. Patientez un quart d'heure." }, 429);
  let site = await readJsonKV(env.AUTH_STORE, code);
  if (!site) {
    await env.AUTH_STORE.put(rlKey, String(fails + 1), { expirationTtl: 900 });
    return json({ error: "Code inconnu. Vérifiez la saisie ou contactez votre responsable." }, 401);
  }
  if (site.active === false) return json({ error: "Accès suspendu. Contactez TriDDS." }, 403);
  site = cleanupAgentSessions(ensureUsageState(site));

  if (action === "login") {
    return json(buildAccessPayload(site, code));
  }

  const agentName = clip(body.agent, 80);
  const agent = site.agents.find(a => a.name === agentName);

  if (action === "start-session") {
    if (!agentName) return json({ error: "Choisissez votre nom" }, 400);
    if (!agent) return json({ error: "Profil introuvable sur ce site" }, 404);
    if (agent.activeSession && !isSessionExpired(agent.activeSession) && agent.activeSession.sessionId !== sessionId && !body.force) {
      return json({ error: "SESSION_ACTIVE", message: "Ce profil est déjà connecté sur un autre appareil.", activeSession: sessionView(agent) }, 409);
    }
    const next = sessionId || generateSessionId();
    touchSession(agent, next, deviceName);
    await writeJsonKV(env.AUTH_STORE, code, site);
    return json(Object.assign(buildAccessPayload(site, code, agentName), { sessionId: next, activeSession: sessionView(agent) }));
  }

  if (action === "resume-session" || action === "heartbeat") {
    if (!agent || !agent.activeSession || isSessionExpired(agent.activeSession) || agent.activeSession.sessionId !== sessionId) {
      return json({ error: "SESSION_INVALID", message: "Session fermée ou reprise sur un autre appareil." }, 401);
    }
    touchSession(agent, sessionId, agent.activeSession.deviceName || deviceName);
    await writeJsonKV(env.AUTH_STORE, code, site);
    return json(Object.assign(buildAccessPayload(site, code, agentName), { ok: true, sessionId, activeSession: sessionView(agent) }));
  }

  if (action === "logout-session") {
    if (agent && agent.activeSession && (!sessionId || agent.activeSession.sessionId === sessionId)) {
      delete agent.activeSession;
      agent.lastSeen = nowIso();
      await writeJsonKV(env.AUTH_STORE, code, site);
    }
    return json({ ok: true });
  }

  return json({ error: "Action inconnue" }, 400);
}

// ---------- mémoire partagée ----------
async function handleMemoryGet(request, env) {
  const body = await request.json().catch(() => ({}));
  const code = normalizeCode(body.code);
  if (!code) return json({ error: "Code requis" }, 400);
  const data = await readJsonKV(env.MEMORY_STORE, "mem-" + code);
  return json(data || { brands: {}, version: 0, stats: { total: 0, corrected: 0 } });
}

async function handleMemorySet(request, env) {
  const body = await request.json().catch(() => ({}));
  const v = await verifySession(env, body);
  if (v.error) return json({ error: v.error }, v.status);
  const key = "mem-" + v.code;
  const action = body.action || "learn";
  const brand = normalizeBrand(clip(body.brand, 80));
  if (!brand || brand.length < 2) return json({ error: "Marque trop courte" }, 400);

  const data = await readJsonKV(env.MEMORY_STORE, key) || { brands: {}, version: 0, stats: { total: 0, corrected: 0 } };
  if (!data.brands) data.brands = {};
  if (!data.stats) data.stats = { total: 0, corrected: 0 };

  if (action === "delete") {
    if (normalizeRole(v.agent.role) !== "responsable") return json({ error: "Seul le responsable peut supprimer une marque." }, 403);
    delete data.brands[brand];
  } else {
    const e = data.brands[brand] || { p: "", f: "", c: "", n: 0, d: "", by: [] };
    e.p = clip(body.product, 120) || e.p;
    e.f = clip(body.flux, 2) || e.f;
    e.c = clip(body.category, 120) || e.c;
    e.n = (e.n || 0) + 1;
    e.d = nowIso().split("T")[0];
    e.by = Array.isArray(e.by) ? e.by : [];
    if (!e.by.includes(v.agent.name)) e.by.push(v.agent.name);
    e.by = e.by.slice(-10);
    data.brands[brand] = e;
    data.stats.total++;
    if (action === "correct") data.stats.corrected++;
  }
  data.version = (data.version || 0) + 1;
  data.lastUpdate = nowIso();
  await writeJsonKV(env.MEMORY_STORE, key, data);
  return json({ ok: true, version: data.version, count: Object.keys(data.brands).length });
}

// ---------- administration (clé admin) ----------
function siteSummary(code, raw) {
  const data = cleanupAgentSessions(ensureUsageState(raw));
  const lastSeen = (data.agents || []).map(a => a.lastSeen).filter(Boolean).sort().pop() || null;
  return Object.assign({
    code,
    client: data.clientName || "",
    principal: data.principalName || "",
    principalEmail: data.principalEmail || data.adminEmail || "",
    site: data.site,
    responsable: ((data.agents || []).find(a => normalizeRole(a.role) === "responsable") || {}).name || "",
    plan: data.plan,
    planName: planLabel(data.plan, data.trialTotal),
    active: data.active !== false,
    created: data.created,
    agents: (data.agents || []).length,
    agentsList: (data.agents || []).map(a => ({ name: a.name, role: normalizeRole(a.role), lastSeen: a.lastSeen || null, activeSession: sessionView(a) })),
    maxAgents: maxAgentsFor(data),
    agentsOverride: data.agentsOverride ?? null,
    scansOverride: data.scansOverride ?? null,
    teamLocked: isTeamLocked(data),
    contact: data.contact || "",
    notes: data.notes || "",
    billing: data.billing || "",
    paidUntil: data.paidUntil || "",
    lastSeen
  }, usageView(data));
}

async function collectSites(env) {
  const index = await readIndex(env);
  const out = [];
  for (const code of index.codes) {
    const raw = await readJsonKV(env.AUTH_STORE, code);
    if (raw) out.push(siteSummary(code, raw));
  }
  return out;
}

async function handleAdmin(request, env) {
  if (!env.TRIDDS_ADMIN_KEY) return json({ error: "TRIDDS_ADMIN_KEY non configurée" }, 500);
  if (!isAdminRequest(request, env)) return json({ error: "Clé admin invalide" }, 401);
  const body = await request.json().catch(() => ({}));
  const action = body.action;

  if (action === "dashboard" || action === "list" || action === "stats") {
    const sites = await collectSites(env);
    const sessions = [];
    let totalBrands = 0;
    for (const s of sites) {
      const mem = await readJsonKV(env.MEMORY_STORE, "mem-" + s.code);
      if (mem && mem.brands) totalBrands += Object.keys(mem.brands).length;
      s.agentsList.forEach(a => { if (a.activeSession) sessions.push({ code: s.code, site: s.site, agent: a.name, deviceName: a.activeSession.deviceName, lastSeenAt: a.activeSession.lastSeenAt, startedAt: a.activeSession.startedAt }); });
    }
    const requests = (await readJsonKV(env.AUTH_STORE, "_requests") || { items: [] }).items;
    const paying = sites.filter(s => s.active && planOf(s.plan).price > 0);
    const stats = {
      totalSites: sites.length,
      activeSites: sites.filter(s => s.active).length,
      payingSites: paying.length,
      mrr: paying.reduce((sum, s) => sum + (planOf(s.plan).price || 0) / (s.plan === "multisite" ? (planOf("multisite").sites || 1) : 1), 0),
      scansThisMonth: sites.reduce((sum, s) => sum + (s.monthlyUsed || 0), 0),
      totalBrands,
      activeSessions: sessions.length,
      openRequests: requests.filter(r => r.status === "nouvelle" || r.status === "en cours").length
    };
    return json({ ok: true, stats, sites, sessions, requests: requests.slice(0, 50) });
  }

  if (action === "requests-list") {
    return json({ ok: true, items: (await readJsonKV(env.AUTH_STORE, "_requests") || { items: [] }).items });
  }
  if (action === "request-update" || action === "request-delete") {
    const store = await readJsonKV(env.AUTH_STORE, "_requests") || { items: [] };
    const r = store.items.find(x => x.id === body.id);
    if (!r) return json({ error: "Demande introuvable" }, 404);
    if (action === "request-delete") store.items = store.items.filter(x => x.id !== body.id);
    else {
      if (body.status) r.status = clip(body.status, 20);
      if (body.note !== undefined) r.note = clip(body.note, 1000);
      r.updatedAt = nowIso();
    }
    await writeJsonKV(env.AUTH_STORE, "_requests", store);
    return json({ ok: true });
  }

  if (action === "create") {
    const siteName = clip(body.site, 120) || "Nouveau site";
    const plan = PLANS[body.plan] ? body.plan : "free";
    let code = normalizeCode(body.code);
    if (code) {
      if (!/^[A-Z0-9-]{4,24}$/.test(code)) return json({ error: "Code : 4 à 24 caractères, lettres, chiffres et tirets." }, 400);
      if (await readJsonKV(env.AUTH_STORE, code)) return json({ error: "Ce code existe déjà" }, 400);
    } else {
      for (let i = 0; i < 10 && !code; i++) {
        const c = generateAccessCode(siteName);
        if (!(await readJsonKV(env.AUTH_STORE, c))) code = c;
      }
      if (!code) return json({ error: "Impossible de générer un code unique" }, 500);
    }
    const responsable = clip(body.responsable || body.principal, 80);
    const agents = [];
    if (responsable) agents.push({ name: responsable, role: "responsable", joined: nowIso(), lastSeen: null });
    (Array.isArray(body.agents) ? body.agents : String(body.agents || "").split(/[,\n]/))
      .map(n => clip(n, 80)).filter(Boolean)
      .forEach(n => { if (!agents.find(a => a.name.toLowerCase() === n.toLowerCase())) agents.push({ name: n, role: "agent", joined: nowIso(), lastSeen: null }); });

    const site = ensureUsageState({
      clientName: clip(body.client, 120) || siteName,
      principalName: responsable,
      principalEmail: normalizeEmail(body.principalEmail),
      site: siteName,
      plan,
      active: true,
      created: nowIso(),
      contact: clip(body.contact, 200),
      notes: clip(body.notes, 2000),
      billing: clip(body.billing, 40),
      paidUntil: clip(body.paidUntil, 10),
      trialTotal: Math.max(0, parseInt(body.trialTotal, 10) || 0),
      trialUsed: 0,
      monthlyUsed: 0,
      usageMonth: currentMonth(),
      teamLocked: body.teamLocked !== false,
      agentsOverride: body.agentsOverride === "" || body.agentsOverride == null ? null : Number(body.agentsOverride),
      scansOverride: body.scansOverride === "" || body.scansOverride == null ? null : Number(body.scansOverride),
      requestId: clip(body.requestId, 20),
      schema: 2,
      agents
    });
    normalizeRoles(site);
    await writeJsonKV(env.AUTH_STORE, code, site);
    await addToIndex(env, code);

    if (site.requestId) {
      const store = await readJsonKV(env.AUTH_STORE, "_requests") || { items: [] };
      const r = store.items.find(x => x.id === site.requestId);
      if (r) { r.status = "convertie"; r.code = code; r.updatedAt = nowIso(); await writeJsonKV(env.AUTH_STORE, "_requests", store); }
    }

    let email = { sent: false, skipped: true };
    if (body.sendEmail && site.principalEmail) {
      email = await sendAccessEmail(env, { code, site: siteName, adminName: responsable, adminEmail: site.principalEmail, planName: planLabel(plan, site.trialTotal), agents: agents.map(a => a.name) });
    }
    return json({ ok: true, code, site: siteName, email });
  }

  if (action === "send-access-email") {
    const code = normalizeCode(body.code);
    const data = await readJsonKV(env.AUTH_STORE, code);
    if (!data) return json({ error: "Code introuvable" }, 404);
    const to = normalizeEmail(body.email) || data.principalEmail || data.adminEmail;
    if (!to) return json({ error: "Aucun email pour ce site" }, 400);
    const email = await sendAccessEmail(env, { code, site: data.site, adminName: data.principalName, adminEmail: to, planName: planLabel(data.plan, data.trialTotal), agents: (data.agents || []).map(a => a.name) });
    if (!email.sent) return json({ error: email.error || "Envoi impossible (Resend non configuré ?)" }, 500);
    return json({ ok: true });
  }

  if (action === "update") {
    const code = normalizeCode(body.code);
    const data = await readJsonKV(env.AUTH_STORE, code);
    if (!data) return json({ error: "Code introuvable" }, 404);
    const prevPlan = data.plan, prevActive = data.active;
    const fields = { client: "clientName", principal: "principalName", principalEmail: "principalEmail", site: "site", contact: "contact", notes: "notes", billing: "billing", paidUntil: "paidUntil" };
    Object.entries(fields).forEach(([k, f]) => { if (body[k] !== undefined) data[f] = clip(body[k], k === "notes" ? 2000 : 200); });
    if (body.plan !== undefined && PLANS[body.plan]) data.plan = body.plan;
    if (body.active !== undefined) data.active = !!body.active;
    if (body.teamLocked !== undefined) data.teamLocked = !!body.teamLocked;
    if (body.trialTotal !== undefined) data.trialTotal = Math.max(0, parseInt(body.trialTotal, 10) || 0);
    if (body.agentsOverride !== undefined) data.agentsOverride = body.agentsOverride === "" || body.agentsOverride == null ? null : Number(body.agentsOverride);
    if (body.scansOverride !== undefined) data.scansOverride = body.scansOverride === "" || body.scansOverride == null ? null : Number(body.scansOverride);
    if (body.resetUsage) { data.monthlyUsed = 0; data.trialUsed = 0; }
    ensureUsageState(data);
    normalizeRoles(data);
    if ((body.plan !== undefined && body.plan !== prevPlan) || (body.active !== undefined && !!body.active !== (prevActive !== false))) invalidateAllSessions(data);
    cleanupAgentSessions(data);
    await writeJsonKV(env.AUTH_STORE, code, data);
    return json({ ok: true, site: siteSummary(code, data) });
  }

  if (action === "regenerate-code") {
    // Change le code d'un site (code diffusé hors de l'équipe) : sessions fermées, mémoire, catalogue et images déplacés.
    const code = normalizeCode(body.code);
    const data = await readJsonKV(env.AUTH_STORE, code);
    if (!data) return json({ error: "Code introuvable" }, 404);
    let next = "";
    for (let i = 0; i < 10 && !next; i++) { const c = generateAccessCode(data.site); if (!(await readJsonKV(env.AUTH_STORE, c))) next = c; }
    invalidateAllSessions(data);
    await writeJsonKV(env.AUTH_STORE, next, data);
    for (const prefix of ["mem-", "catalog-", "images-"]) {
      const v = await env.MEMORY_STORE.get(prefix + code);
      if (v) { await env.MEMORY_STORE.put(prefix + next, v); await env.MEMORY_STORE.delete(prefix + code); }
    }
    await env.AUTH_STORE.delete(code);
    const index = await readIndex(env);
    index.codes = index.codes.map(c => (c === code ? next : c));
    await writeJsonKV(env.AUTH_STORE, "_index", index);
    return json({ ok: true, code: next });
  }

  if (action === "delete") {
    const code = normalizeCode(body.code);
    await env.AUTH_STORE.delete(code);
    const index = await readIndex(env);
    index.codes = index.codes.filter(c => c !== code);
    await writeJsonKV(env.AUTH_STORE, "_index", index);
    await env.MEMORY_STORE.delete("mem-" + code);
    await env.MEMORY_STORE.delete("catalog-" + code);
    return json({ ok: true });
  }

  if (action === "add-agent" || action === "remove-agent" || action === "set-agent-role" || action === "rename-agent" || action === "kick-session") {
    const code = normalizeCode(body.code);
    const data = await readJsonKV(env.AUTH_STORE, code);
    if (!data) return json({ error: "Code introuvable" }, 404);
    ensureAgents(data);
    const name = clip(body.agent, 80);
    const target = data.agents.find(a => a.name === name);
    if (action === "add-agent") {
      if (!name) return json({ error: "Nom requis" }, 400);
      if (data.agents.find(a => a.name.toLowerCase() === name.toLowerCase())) return json({ error: "Ce profil existe déjà" }, 400);
      const role = normalizeRole(body.role);
      if (role === "responsable") data.agents.forEach(a => { a.role = "agent"; });
      data.agents.push({ name, role, joined: nowIso(), lastSeen: null });
    } else if (!target) {
      return json({ error: "Profil introuvable" }, 404);
    } else if (action === "remove-agent") {
      data.agents = data.agents.filter(a => a.name !== name);
    } else if (action === "set-agent-role") {
      const role = normalizeRole(body.role);
      if (role === "responsable") data.agents.forEach(a => { if (a.name !== name) a.role = "agent"; });
      target.role = role;
    } else if (action === "rename-agent") {
      const next = clip(body.newName, 80);
      if (!next) return json({ error: "Nouveau nom requis" }, 400);
      if (data.agents.find(a => a !== target && a.name.toLowerCase() === next.toLowerCase())) return json({ error: "Ce nom existe déjà" }, 400);
      target.name = next;
      delete target.activeSession;
    } else if (action === "kick-session") {
      delete target.activeSession;
    }
    normalizeRoles(data);
    await writeJsonKV(env.AUTH_STORE, code, data);
    return json({ ok: true, site: siteSummary(code, data) });
  }

  if (action === "images-all") {
    // Toutes les photos (globales et par site) avec leur code, pour l'écran Produits de l'admin.
    const origin = new URL(request.url).origin;
    const index = await readIndex(env);
    const out = [];
    for (const code of [GLOBAL_CODE].concat(index.codes)) {
      const store = await readJsonKV(env.MEMORY_STORE, "images-" + code) || { items: [] };
      (store.items || []).filter(i => i.status !== "deleted").forEach(i => out.push(Object.assign({}, i, { code, url: i.r2Key ? origin + "/api/img/" + i.r2Key : i.url })));
    }
    return json({ ok: true, items: out });
  }

  if (action === "catalog-admin-list" || action === "knowledge-admin-list") {
    const sites = await collectSites(env);
    const items = [];
    for (const s of sites) {
      if (action === "catalog-admin-list") {
        const cat = await readJsonKV(env.MEMORY_STORE, "catalog-" + s.code) || { items: [] };
        (cat.items || []).forEach(it => items.push(Object.assign({ code: s.code, site: s.site, client: s.client }, it)));
      } else {
        const mem = await readJsonKV(env.MEMORY_STORE, "mem-" + s.code) || { brands: {} };
        Object.entries(mem.brands || {}).forEach(([brand, e]) => items.push({ code: s.code, site: s.site, client: s.client, brand, p: e.p || "", f: e.f || "", c: e.c || "", n: e.n || 0, d: e.d || "", by: Array.isArray(e.by) ? e.by : [], lastUpdate: mem.lastUpdate || "" }));
      }
    }
    items.sort((a, b) => String(b.updatedAt || b.d || "").localeCompare(String(a.updatedAt || a.d || "")));
    return json({ ok: true, sites: sites.map(s => ({ code: s.code, site: s.site, client: s.client })), items });
  }

  if (action === "catalog-admin-save") {
    const code = normalizeCode(body.code);
    if (!(await readJsonKV(env.AUTH_STORE, code))) return json({ error: "Code introuvable" }, 404);
    const entry = catalogEntry(body.item || {}, "superadmin");
    if (!entry.n || !entry.x) return json({ error: "Nom et catégorie requis" }, 400);
    const key = "catalog-" + code;
    const cat = await readJsonKV(env.MEMORY_STORE, key) || { items: [] };
    cat.items = (cat.items || []).filter(x => x.id !== entry.id);
    cat.items.unshift(entry);
    await writeJsonKV(env.MEMORY_STORE, key, cat);
    return json({ ok: true, item: Object.assign({ code }, entry) });
  }
  if (action === "catalog-admin-delete") {
    const code = normalizeCode(body.code), id = clip(body.id, 64);
    const key = "catalog-" + code;
    const cat = await readJsonKV(env.MEMORY_STORE, key) || { items: [] };
    cat.items = (cat.items || []).filter(x => x.id !== id);
    await writeJsonKV(env.MEMORY_STORE, key, cat);
    return json({ ok: true });
  }

  if (action === "knowledge-admin-save") {
    const code = normalizeCode(body.code);
    if (!(await readJsonKV(env.AUTH_STORE, code))) return json({ error: "Code introuvable" }, 404);
    const item = body.item || {};
    const original = normalizeBrand(body.originalBrand || "");
    const next = normalizeBrand(item.brand || body.brand || "");
    if (!next || next.length < 2) return json({ error: "Marque trop courte" }, 400);
    const key = "mem-" + code;
    const mem = await readJsonKV(env.MEMORY_STORE, key) || { brands: {}, version: 0, stats: { total: 0, corrected: 0 } };
    if (!mem.brands) mem.brands = {};
    const prev = mem.brands[original] || mem.brands[next] || { n: 0, by: [] };
    if (original && original !== next) delete mem.brands[original];
    mem.brands[next] = { p: clip(item.product, 120) || prev.p || "", f: clip(item.flux, 2) || prev.f || "", c: clip(item.category, 120) || prev.c || "", n: Number(prev.n || 0), d: nowIso().split("T")[0], by: Array.isArray(prev.by) ? prev.by : [] };
    mem.version = (mem.version || 0) + 1;
    mem.lastUpdate = nowIso();
    await writeJsonKV(env.MEMORY_STORE, key, mem);
    return json({ ok: true });
  }
  if (action === "knowledge-admin-delete") {
    const code = normalizeCode(body.code), brand = normalizeBrand(body.brand);
    const key = "mem-" + code;
    const mem = await readJsonKV(env.MEMORY_STORE, key);
    if (mem && mem.brands) { delete mem.brands[brand]; mem.version = (mem.version || 0) + 1; mem.lastUpdate = nowIso(); await writeJsonKV(env.MEMORY_STORE, key, mem); }
    return json({ ok: true });
  }
  if (action === "knowledge-admin-promote") {
    const code = normalizeCode(body.code), brand = normalizeBrand(body.brand);
    const mem = await readJsonKV(env.MEMORY_STORE, "mem-" + code) || { brands: {} };
    const e = (mem.brands || {})[brand];
    if (!e) return json({ error: "Entrée introuvable" }, 404);
    const entry = catalogEntry({ n: e.p || brand, f: e.f || "H", x: e.c || "", y: [brand] }, "superadmin");
    if (!entry.n || !entry.x) return json({ error: "Produit ou catégorie manquant pour créer la fiche." }, 400);
    const key = "catalog-" + code;
    const cat = await readJsonKV(env.MEMORY_STORE, key) || { items: [] };
    cat.items = cat.items || [];
    cat.items.unshift(entry);
    await writeJsonKV(env.MEMORY_STORE, key, cat);
    return json({ ok: true, item: entry });
  }

  return json({ error: "Action inconnue" }, 400);
}

function catalogEntry(item, by) {
  return {
    id: clip(item.id, 64) || generateSessionId(),
    n: clip(item.n, 120),
    q: clip(item.q || item.n, 120).toLowerCase(),
    f: ["E", "H", "C", "I"].includes(item.f) ? item.f : "H",
    x: clip(item.x, 120),
    c: clip(item.c, 400),
    s: clip(item.s, 60),
    y: (Array.isArray(item.y) ? item.y : String(item.y || "").split(",")).map(v => clip(v, 80)).filter(Boolean).slice(0, 20),
    updatedAt: nowIso(),
    updatedBy: by,
    status: "active"
  };
}

// ---------- espace responsable (dans l'appli) ----------
async function handleSiteAdmin(request, env) {
  const body = await request.json().catch(() => ({}));
  const v = await verifySession(env, body);
  if (v.error) return json({ error: v.error }, v.status);
  const { code, site, agent } = v;
  const action = body.action || "status";
  const isResp = normalizeRole(agent.role) === "responsable";
  const payload = buildAccessPayload(site, code, agent.name);

  if (action === "status") return json(payload);
  if (!isResp) return json({ error: "Réservé au responsable du site" }, 403);

  if (action === "team") {
    return json({ ok: true, teamLocked: isTeamLocked(site), maxAgents: maxAgentsFor(site), team: site.agents.map(a => ({ name: a.name, role: normalizeRole(a.role), lastSeen: a.lastSeen || null, activeSession: sessionView(a) })) });
  }
  if (action === "add-user" || action === "remove-user" || action === "set-user-role") {
    if (isTeamLocked(site)) return json({ error: "L'équipe de ce site est gérée par TriDDS. Envoyez-nous le nom à ajouter ou retirer." }, 403);
    const name = clip(body.name, 80);
    if (action === "add-user") {
      if (!name) return json({ error: "Nom requis" }, 400);
      if (site.agents.find(a => a.name.toLowerCase() === name.toLowerCase())) return json({ error: "Ce profil existe déjà" }, 400);
      const max = maxAgentsFor(site);
      if (max != null && site.agents.length >= max) return json({ error: `Votre offre comprend ${max} profils. Contactez TriDDS pour en ajouter.` }, 403);
      site.agents.push({ name, role: "agent", joined: nowIso(), lastSeen: null });
    } else {
      const target = site.agents.find(a => a.name === name);
      if (!target) return json({ error: "Profil introuvable" }, 404);
      if (action === "remove-user") {
        if (normalizeRole(target.role) === "responsable") return json({ error: "Le responsable ne peut pas être retiré ici." }, 400);
        site.agents = site.agents.filter(a => a.name !== name);
      } else {
        return json({ error: "Le changement de responsable se fait avec TriDDS." }, 403);
      }
    }
    normalizeRoles(site);
    await writeJsonKV(env.AUTH_STORE, code, site);
    return json({ ok: true });
  }

  const catKey = "catalog-" + code;
  const cat = await readJsonKV(env.MEMORY_STORE, catKey) || { items: [] };
  if (action === "catalog-list") return json({ ok: true, items: cat.items || [] });
  if (!payload.canManageCatalog) return json({ error: "La base produits du site est incluse à partir de l'offre Pro." }, 403);
  if (action === "catalog-save") {
    const entry = catalogEntry(body.item || {}, agent.name);
    if (!entry.n || !entry.x) return json({ error: "Nom et catégorie requis" }, 400);
    cat.items = (cat.items || []).filter(x => x.id !== entry.id);
    cat.items.unshift(entry);
    await writeJsonKV(env.MEMORY_STORE, catKey, cat);
    return json({ ok: true, item: entry });
  }
  if (action === "catalog-delete") {
    cat.items = (cat.items || []).filter(x => x.id !== clip(body.id, 64));
    await writeJsonKV(env.MEMORY_STORE, catKey, cat);
    return json({ ok: true });
  }
  return json({ error: "Action inconnue" }, 400);
}

// Le catalogue du site est lisible par tous les agents connectés (recherche).
async function handleSiteCatalog(request, env) {
  const body = await request.json().catch(() => ({}));
  const v = await verifySession(env, body);
  if (v.error) return json({ error: v.error }, v.status);
  const cat = await readJsonKV(env.MEMORY_STORE, "catalog-" + v.code) || { items: [] };
  return json({ ok: true, items: cat.items || [] });
}

// ---------- analyse IA ----------
// Consignes de lecture : fixées côté serveur, le client n'envoie que l'image et la mémoire du site.
const USER_PROMPT = `Analyse cette photo prise en déchèterie (local DDS). Pour CHAQUE produit distinct visible :
1) lis le texte exact de l'étiquette ; 2) déduis le type si l'emballage est reconnaissable ; 3) estime le volume ou la masse du contenant ;
4) classe-le dans le référentiel (nom_referentiel, categorie, filiere) en traduisant les noms commerciaux ; 5) donne sa position bbox={x,y,w,h} en % de l'image ; 6) donne une confiance de 0 à 100.
Réponds UNIQUEMENT en JSON : {"produits":[{"texte_lu":"","nom":"","marque":"","nom_referentiel":"","categorie":"","filiere":"EcoDDS|Hors EcoDDS|Cas spécial","volume_estime":"","confiance":0,"consigne":"","bbox":{"x":0,"y":0,"w":0,"h":0}}]}`;

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function handleAnalyze(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Analyse IA indisponible (clé API manquante)" }, 500);
  const body = await request.json().catch(() => ({}));
  const v = await verifySession(env, body);
  if (v.error) return json({ error: v.error === "SESSION_INVALID" ? "Session expirée. Reconnectez-vous." : v.error }, v.status);
  const { code } = v;
  const image = body.image;
  const mime = ["image/jpeg", "image/png", "image/webp"].includes(body.mime) ? body.mime : "image/jpeg";
  // final = scan compté ; retry = seconde lecture (modèle plus fort) de la MÊME photo, non comptée, une seule fois.
  const mode = body.mode === "retry" ? "retry" : "final";
  if (!image || typeof image !== "string") return json({ error: "Image manquante" }, 400);
  if (image.length > MAX_IMAGE_B64) return json({ error: "Image trop lourde" }, 413);
  const imageHash = await sha256(image);

  // On réserve le scan avant l'appel IA (plus de dépassement par appels simultanés), remboursé en cas d'échec.
  let site = ensureUsageState(await readJsonKV(env.AUTH_STORE, code));
  let agent = ensureAgents(site).find(x => x.name === v.agent.name);
  let charged = null;
  if (mode === "retry") {
    if (!agent.retryLeft || agent.lastScanHash !== imageHash || !agent.lastScanAt || Date.now() - new Date(agent.lastScanAt).getTime() > 180000) {
      return json({ error: "Seconde analyse indisponible. Relancez un scan." }, 409);
    }
    agent.retryLeft = 0;
  } else {
    const u = usageView(site);
    if (!u.aiEnabled) {
      const msg = u.monthlyLimit > 0
        ? "Quota de scans du mois atteint. Il repart le 1er du mois, ou contactez TriDDS pour l'augmenter."
        : "Le scan photo n'est pas inclus dans cet accès. Contactez TriDDS pour l'activer.";
      return json({ error: msg, usage: buildAccessPayload(site, code, agent.name) }, 403);
    }
    if (u.monthlyRemaining > 0) { site.monthlyUsed = (site.monthlyUsed || 0) + 1; charged = "monthly"; }
    else { site.trialUsed = (site.trialUsed || 0) + 1; charged = "trial"; }
    agent.lastScanAt = nowIso();
    agent.lastScanHash = imageHash;
    agent.retryLeft = 1;
  }
  await writeJsonKV(env.AUTH_STORE, code, site);

  const model = mode === "retry" ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";
  const context = clip(body.context, 6000);
  const reqBody = {
    model,
    max_tokens: 2500,
    // Consignes métier identiques à chaque appel : mises en cache côté Anthropic (plus rapide, moins cher).
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mime, data: image } }, { type: "text", text: USER_PROMPT + (context ? "\n\n" + context : "") }] }]
  };

  let response, data;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(reqBody)
    });
    data = await response.json().catch(() => ({}));
  } catch (e) {
    response = { ok: false };
    data = {};
  }

  site = ensureUsageState(await readJsonKV(env.AUTH_STORE, code) || site);
  agent = ensureAgents(site).find(x => x.name === v.agent.name) || agent;
  if (!response.ok) {
    if (charged === "monthly") site.monthlyUsed = Math.max(0, (site.monthlyUsed || 0) - 1);
    if (charged === "trial") site.trialUsed = Math.max(0, (site.trialUsed || 0) - 1);
    if (mode === "retry" && agent) agent.retryLeft = 1;
    await writeJsonKV(env.AUTH_STORE, code, site);
    return json({ error: (data && data.error && data.error.message) || "Le service d'analyse ne répond pas. Le scan n'a pas été décompté.", usage: buildAccessPayload(site, code, v.agent.name) }, 502);
  }
  return json({ content: data.content || [], model: data.model, usage: buildAccessPayload(site, code, v.agent.name) });
}

// ---------- images ----------
const mimeToExt = m => ({ "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp" }[(m || "").toLowerCase()] || "jpg");

async function handleImageServe(env, r2Key) {
  if (!env.IMAGES_BUCKET) return new Response("R2 non configuré", { status: 500 });
  const object = await env.IMAGES_BUCKET.get(r2Key);
  if (!object) return new Response("Image introuvable", { status: 404 });
  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "image/jpeg");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(object.body, { headers });
}

async function handleProductImages(request, env, { admin = false } = {}) {
  const body = await request.json().catch(() => ({}));
  const code = normalizeCode(body.code);
  const action = body.action || "list";
  if (!code) return json({ error: "Code requis" }, 400);
  const key = "images-" + code;
  const store = await readJsonKV(env.MEMORY_STORE, key) || { items: [] };
  store.items = store.items || [];

  if (action === "list" || action === "list-all") {
    const name = clip(body.productName, 120).toLowerCase();
    let items = store.items.filter(i => i.status !== "deleted");
    if (action === "list" && name) items = items.filter(i => (i.productName || "").toLowerCase() === name);
    return json({ ok: true, items: items.sort((a, b) => (a.order || 0) - (b.order || 0)) });
  }

  // Écritures : clé admin, ou session agent valide sur son propre site.
  let by = "admin";
  if (!admin && !isAdminRequest(request, env)) {
    if (code === GLOBAL_CODE) return json({ error: "Réservé à l'administration" }, 403);
    const v = await verifySession(env, body);
    if (v.error) return json({ error: v.error }, v.status);
    by = v.agent.name;
    if (action !== "save") return json({ error: "Réservé à l'administration" }, 403);
    // Un agent envoie une vraie photo (pas d'URL externe ni de clé R2 existante), 40 par jour et par site au plus.
    if (!body.imageData) return json({ error: "Photo requise" }, 400);
    body.item = Object.assign({}, body.item, { url: "", r2Key: "", id: "" });
    const dayKey = "_rl_img_" + code + "_" + nowIso().slice(0, 10);
    const used = parseInt(await env.AUTH_STORE.get(dayKey) || "0", 10);
    if (used >= 40) return json({ error: "Limite de photos atteinte pour aujourd'hui." }, 429);
    await env.AUTH_STORE.put(dayKey, String(used + 1), { expirationTtl: 172800 });
  }

  if (action === "save") {
    const item = body.item || {};
    const id = clip(item.id, 64) || generateSessionId();
    let url = clip(item.url, 500);
    let r2Key = clip(item.r2Key, 200);
    if (body.imageData) {
      if (!env.IMAGES_BUCKET) return json({ error: "Stockage d'images non configuré" }, 500);
      if (String(body.imageData).length > MAX_IMAGE_B64) return json({ error: "Image trop lourde (5 Mo max)" }, 413);
      const ext = mimeToExt(body.imageMime);
      r2Key = `${code}/${id}.${ext}`;
      const raw = Uint8Array.from(atob(body.imageData), c => c.charCodeAt(0));
      await env.IMAGES_BUCKET.put(r2Key, raw, { httpMetadata: { contentType: body.imageMime || "image/jpeg" }, customMetadata: { code, productName: clip(item.productName, 120), uploadedAt: nowIso() } });
      url = new URL(request.url).origin + "/api/img/" + r2Key;
    }
    const entry = {
      id,
      productName: clip(item.productName, 120),
      url,
      alt: clip(item.alt, 160),
      isPrimary: !!item.isPrimary,
      order: Number(item.order) || 0,
      source: clip(item.source, 30) || "admin",
      status: "active",
      imageFlux: ["E", "H", "C", ""].includes(item.imageFlux) ? item.imageFlux : "",
      r2Key,
      updatedAt: nowIso(),
      addedBy: by
    };
    if (!entry.productName) return json({ error: "Nom du produit requis" }, 400);
    if (!entry.url) return json({ error: "Image ou URL requise" }, 400);
    if (entry.isPrimary) store.items.forEach(i => { if (i.productName === entry.productName) i.isPrimary = false; });
    store.items = store.items.filter(i => i.id !== id);
    store.items.push(entry);
    await writeJsonKV(env.MEMORY_STORE, key, store);
    await purgePublicImagesCache(request);
    return json({ ok: true, item: entry });
  }
  if (action === "delete") {
    const id = clip(body.id, 64);
    const item = store.items.find(i => i.id === id);
    // On ne supprime dans R2 que les fichiers rangés sous le code de ce site.
    if (item && item.r2Key && item.r2Key.startsWith(code + "/") && env.IMAGES_BUCKET) { try { await env.IMAGES_BUCKET.delete(item.r2Key); } catch (e) {} }
    store.items = store.items.filter(i => i.id !== id);
    await writeJsonKV(env.MEMORY_STORE, key, store);
    await purgePublicImagesCache(request);
    return json({ ok: true });
  }
  if (action === "set-primary") {
    const target = store.items.find(i => i.id === clip(body.id, 64));
    if (!target) return json({ error: "Image introuvable" }, 404);
    store.items.forEach(i => { if (i.productName === target.productName) i.isPrimary = false; });
    target.isPrimary = true;
    await writeJsonKV(env.MEMORY_STORE, key, store);
    await purgePublicImagesCache(request);
    return json({ ok: true });
  }
  if (action === "set-flux") {
    const target = store.items.find(i => i.id === clip(body.id, 64));
    if (!target) return json({ error: "Image introuvable" }, 404);
    target.imageFlux = ["E", "H", "C", ""].includes(body.imageFlux) ? body.imageFlux : "";
    await writeJsonKV(env.MEMORY_STORE, key, store);
    await purgePublicImagesCache(request);
    return json({ ok: true });
  }
  return json({ error: "Action inconnue" }, 400);
}

async function handleAdminImages(request, env) {
  if (!isAdminRequest(request, env)) return json({ error: "Clé admin invalide" }, 401);
  return handleProductImages(request, env, { admin: true });
}

function publicImagesCacheKey(request) {
  return new Request(new URL(request.url).origin + "/api/public-images", { method: "GET" });
}
async function purgePublicImagesCache(request) {
  try { await caches.default.delete(publicImagesCacheKey(request)); } catch (e) {}
}

// Images de référence de tous les sites actifs, mises en cache 5 minutes en périphérie.
async function handlePublicImages(request, env, ctx) {
  const cacheKey = publicImagesCacheKey(request);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const origin = new URL(request.url).origin;
  const index = await readIndex(env);
  const all = [];
  const push = i => {
    if (i.status === "deleted") return;
    all.push({ id: i.id, productName: i.productName, url: i.r2Key ? origin + "/api/img/" + i.r2Key : i.url, isPrimary: !!i.isPrimary, order: i.order || 0, imageFlux: i.imageFlux || "", source: i.source || "" });
  };
  ((await readJsonKV(env.MEMORY_STORE, "images-" + GLOBAL_CODE)) || { items: [] }).items.forEach(push);
  for (const code of index.codes) {
    const site = await readJsonKV(env.AUTH_STORE, code);
    if (!site || site.active === false) continue;
    ((await readJsonKV(env.MEMORY_STORE, "images-" + code)) || { items: [] }).items.forEach(push);
  }
  all.sort((a, b) => (a.order || 0) - (b.order || 0));
  const res = json({ ok: true, items: all }, 200, { "Cache-Control": "public, max-age=300" });
  ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}

async function handleCatImages(request, env) {
  const data = await readJsonKV(env.MEMORY_STORE, "cat-images") || { categories: {} };
  if (request.method === "GET") {
    const origin = new URL(request.url).origin;
    Object.values(data.categories).forEach(img => { if (img.r2Key) img.url = origin + "/api/img/" + img.r2Key; });
    return json({ ok: true, categories: data.categories }, 200, { "Cache-Control": "public, max-age=300" });
  }
  const body = await request.json().catch(() => ({}));
  if (!isAdminRequest(request, env) && !safeEqual(body.adminKey, env.TRIDDS_ADMIN_KEY)) return json({ error: "Non autorisé" }, 403);
  const category = clip(body.category, 120);
  if (!category) return json({ error: "Catégorie requise" }, 400);
  if ((body.action || "save") === "delete") {
    const c = data.categories[category];
    if (c && c.r2Key && env.IMAGES_BUCKET) { try { await env.IMAGES_BUCKET.delete(c.r2Key); } catch (e) {} }
    delete data.categories[category];
  } else if (body.imageData && env.IMAGES_BUCKET) {
    const r2Key = "_cat/" + category.replace(/[^a-zA-Z0-9àâéèêëïîôùûüç -]/g, "_") + "." + mimeToExt(body.imageMime);
    await env.IMAGES_BUCKET.put(r2Key, Uint8Array.from(atob(body.imageData), c => c.charCodeAt(0)), { httpMetadata: { contentType: body.imageMime || "image/jpeg" } });
    data.categories[category] = { url: new URL(request.url).origin + "/api/img/" + r2Key, r2Key, updatedAt: nowIso() };
  } else if (body.url) {
    data.categories[category] = { url: clip(body.url, 500), updatedAt: nowIso() };
  } else return json({ error: "Image requise" }, 400);
  await writeJsonKV(env.MEMORY_STORE, "cat-images", data);
  return json({ ok: true, category, image: data.categories[category] || null });
}

// ---------- code oublié ----------
async function handleForgotCode(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const generic = { ok: true, message: "Si cet email est celui d'un responsable de site, le code vient d'être envoyé." };
  if (!email || !email.includes("@")) return json({ error: "Email invalide" }, 400);

  const ip = request.headers.get("CF-Connecting-IP") || "inconnue";
  const rlKey = "_rl_forgot_" + ip;
  const count = parseInt(await env.AUTH_STORE.get(rlKey) || "0", 10);
  if (count >= 5) return json(generic);
  await env.AUTH_STORE.put(rlKey, String(count + 1), { expirationTtl: 3600 });

  const index = await readIndex(env);
  for (const code of index.codes) {
    const d = await readJsonKV(env.AUTH_STORE, code);
    if (!d || d.active === false) continue;
    const emails = [d.adminEmail, d.principalEmail, d.stripe && d.stripe.adminEmail].map(normalizeEmail).filter(Boolean);
    if (emails.includes(email)) {
      await sendAccessEmail(env, { code, site: d.site, adminName: d.principalName, adminEmail: email, planName: planLabel(d.plan, d.trialTotal), agents: (d.agents || []).map(a => a.name) }).catch(() => null);
      break;
    }
  }
  return json(generic);
}

const GONE = json.bind(null, { error: "Les accès TriDDS sont créés sur demande. Rendez-vous sur la page Offres pour nous contacter." }, 410);

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response("", { status: 204, headers: CORS });
    const path = new URL(request.url).pathname.replace(/\/+$/, "");

    try {
      if (request.method === "GET" && (path === "" || path === "/")) return new Response("TriDDS API v2 OK", { headers: { "Content-Type": "text/plain;charset=UTF-8" } });
      if (path.startsWith("/api/img/") && request.method === "GET") return handleImageServe(env, decodeURIComponent(path.slice("/api/img/".length)));
      if (path === "/api/public-images" && request.method === "GET") return handlePublicImages(request, env, ctx);
      if (path === "/api/cat-images") return handleCatImages(request, env);
      if (path === "/api/request-access") return handleRequestAccess(request, env);
      if (path === "/api/forgot-code" && request.method === "POST") return handleForgotCode(request, env);
      if (path === "/api/auth") return handleAuth(request, env);
      if (path === "/api/memory-get") return handleMemoryGet(request, env);
      if (path === "/api/memory-set") return handleMemorySet(request, env);
      if (path === "/api/site-catalog") return handleSiteCatalog(request, env);
      if (path === "/api/site-admin") return handleSiteAdmin(request, env);
      if (path === "/api/admin") return handleAdmin(request, env);
      if (path === "/api/admin-images") return handleAdminImages(request, env);
      if (path === "/api/product-images") return handleProductImages(request, env);
      if (path === "/api/analyze") return handleAnalyze(request, env);
      if (["/api/create-trial", "/api/create-checkout", "/api/payment-success", "/api/upload-image"].includes(path)) return GONE();
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: "Erreur serveur : " + (e && e.message ? e.message : "inconnue") }, 500);
    }
  }
};
