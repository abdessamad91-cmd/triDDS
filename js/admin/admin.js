// Administration TriDDS : connexion par clé, navigation, tableau de bord, demandes d'accès.

import { html, raw, icon, esc, toast, relTime, confirmDialog } from "../shared/ui.js";
import { request, ApiError } from "../shared/api.js";
import { planLabel } from "../shared/plans.js";
import { loadBase } from "../shared/catalog.js";
import { sitesView, openCreate, openSite } from "./sites.js";
import { productsView, catalogView, memoryView } from "./content.js";

const KEY_STORE = "tridds_admin_key";
const root = document.getElementById("root");

export const adm = {
  key: (() => { try { return sessionStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; } })(),
  data: { stats: {}, sites: [], sessions: [], requests: [] },
  v2: true,
  view: "dashboard",

  async call(action, body = {}) {
    return request("admin", { body: Object.assign({ action }, body), headers: { Authorization: "Bearer " + adm.key }, timeout: 30000 });
  },
  async images(action, body = {}) {
    return request("admin-images", { body: Object.assign({ action }, body), headers: { Authorization: "Bearer " + adm.key }, timeout: 60000 });
  },
  async reload() {
    const d = await adm.call("dashboard");
    adm.data = Object.assign({ stats: {}, sites: [], sessions: [], requests: [] }, d);
    adm.v2 = Array.isArray(d.requests);
    if (!adm.v2) {
      // Worker précédent : pas de demandes, champs d'usage absents.
      adm.data.requests = [];
    }
  },
  go(view) {
    adm.view = view;
    history.replaceState(null, "", "#" + view);
    render();
  },
  render: () => render(),
  fail(e) {
    if (e instanceof ApiError && e.status === 401) { logout("Clé refusée. Reconnectez-vous."); return; }
    toast(e.message || "Erreur", { error: true, ms: 4500 });
  }
};

const VIEWS = {
  dashboard: { label: "Tableau de bord", icon: "flash", render: dashboard },
  demandes: { label: "Demandes", icon: "mail", render: requests },
  sites: { label: "Sites et accès", icon: "lock", render: sitesView },
  produits: { label: "Produits et photos", icon: "image", render: productsView },
  fiches: { label: "Fiches des sites", icon: "box", render: catalogView },
  memoire: { label: "Mémoire des équipes", icon: "brain", render: memoryView }
};

function logout(msg) {
  adm.key = "";
  try { sessionStorage.removeItem(KEY_STORE); } catch (e) {}
  renderLogin(msg);
}

function renderLogin(msg = "") {
  root.innerHTML = html`<div class="login-admin"><form data-login>
    <div style="display:flex;align-items:center;gap:10px"><img src="./assets/symbol-128.png" alt="" width="40" height="40"><h1>Administration</h1></div>
    <label class="field"><span>Clé administrateur</span><input class="input" type="password" name="key" autocomplete="current-password" required></label>
    ${msg ? html`<p class="note int">${msg}</p>` : ""}
    <button class="btn btn-primary btn-lg" type="submit">Ouvrir</button>
    <p class="hint">La clé reste en mémoire jusqu'à la fermeture de l'onglet.</p>
  </form></div>`.toString();
  const f = root.querySelector("[data-login]");
  f.key.focus();
  f.addEventListener("submit", async e => {
    e.preventDefault();
    adm.key = f.key.value.trim();
    const btn = f.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = "Connexion…";
    try {
      await adm.reload();
      try { sessionStorage.setItem(KEY_STORE, adm.key); } catch (err) {}
      start();
    } catch (err) {
      renderLogin(err.status === 401 ? "Clé incorrecte." : err.message);
    }
  });
}

function start() {
  const h = location.hash.slice(1);
  if (VIEWS[h]) adm.view = h;
  render();
}

async function render() {
  const v = VIEWS[adm.view] || VIEWS.dashboard;
  const open = (adm.data.requests || []).filter(r => r.status === "nouvelle").length;
  root.innerHTML = html`<div class="adm">
    <nav class="adm-side" aria-label="Sections">
      <div class="adm-brand"><img src="./assets/symbol-128.png" alt="" width="34" height="34"><div><b>TriDDS</b><span>Administration</span></div></div>
      ${Object.entries(VIEWS).map(([k, x]) => html`<button class="adm-nav" data-view="${k}" ${raw(k === adm.view ? 'aria-current="page"' : "")}>${icon(x.icon)}${x.label}${k === "demandes" && open ? html`<span class="count">${open}</span>` : ""}</button>`)}
      <div class="grow"></div>
      ${!adm.v2 ? html`<p class="small">Worker v1 détecté : déployez le Worker v2 pour les demandes et les limites d'équipe.</p>` : ""}
      <button class="adm-nav" data-refresh>${icon("refresh")}Actualiser</button>
      <button class="adm-nav" data-logout>${icon("logout")}Quitter</button>
    </nav>
    <main class="adm-main" data-main><div class="empty-state"><span class="spinner"></span></div></main>
  </div>`.toString();
  root.querySelector(".adm-side").addEventListener("click", async e => {
    const b = e.target.closest("[data-view]");
    if (b) return adm.go(b.dataset.view);
    if (e.target.closest("[data-logout]")) return logout();
    if (e.target.closest("[data-refresh]")) {
      try { await adm.reload(); render(); toast("Données à jour"); } catch (err) { adm.fail(err); }
    }
  });
  const main = root.querySelector("[data-main]");
  try { await v.render(main, adm); } catch (e) { main.innerHTML = `<p class="note int">${esc(e.message)}</p>`; adm.fail(e); }
  document.title = v.label + " — TriDDS admin";
}

// ---------- tableau de bord ----------
function dashboard(main) {
  const { stats = {}, sites = [], sessions = [], requests = [] } = adm.data;
  const euro = v => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v || 0);
  const nearQuota = sites.filter(s => s.active && s.monthlyLimit > 0 && s.monthlyUsed / s.monthlyLimit >= 0.8);
  const fresh = requests.filter(r => r.status === "nouvelle");
  const idle = sites.filter(s => s.active && s.lastSeen && Date.now() - new Date(s.lastSeen).getTime() > 21 * 864e5);
  const soon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const trials = sites.filter(s => s.active && s.billing === "essai" && (s.trialExpired || (s.paidUntil && s.paidUntil <= soon)));
  main.innerHTML = html`<div class="adm-head"><h1>Tableau de bord</h1><button class="btn btn-primary" data-new>${icon("plus")}Créer un accès</button></div>
    <div class="kpis">
      <div class="kpi ${fresh.length ? "alert" : ""}"><span>Demandes à traiter</span><b>${fresh.length}</b><small>${requests.length} au total</small></div>
      <div class="kpi"><span>Sites actifs</span><b>${stats.activeSites ?? sites.filter(s => s.active).length}</b><small>${stats.payingSites ?? "?"} payants</small></div>
      <div class="kpi"><span>Revenu mensuel estimé</span><b>${euro(stats.mrr)}</b><small>HT, d'après les offres actives</small></div>
      <div class="kpi"><span>Scans ce mois</span><b>${stats.scansThisMonth ?? "?"}</b><small>tous sites confondus</small></div>
      <div class="kpi"><span>Agents connectés</span><b>${sessions.length}</b><small>en ce moment</small></div>
    </div>
    <div class="cols">
      <section class="panel"><h2>Demandes récentes<button class="btn btn-ghost btn-sm" data-goto="demandes">Tout voir</button></h2>
        ${fresh.length ? html`<div class="tbl-wrap"><table class="tbl"><tbody>${fresh.slice(0, 6).map(r => html`<tr class="click" data-goto="demandes"><td><b>${r.organisation}</b><span class="sub">${r.name}, ${r.sites} site${r.sites > 1 ? "s" : ""}</span></td><td>${r.trial ? "Essai" : r.plan ? planLabel(r.plan) : "—"}</td><td class="sub">${relTime(r.createdAt)}</td></tr>`)}</tbody></table></div>`
          : html`<p class="hint">${adm.v2 ? "Aucune demande en attente." : "Disponible avec le Worker v2."}</p>`}
      </section>
      <section class="panel"><h2>À surveiller</h2>
        ${nearQuota.length || idle.length || trials.length ? html`<div class="tbl-wrap"><table class="tbl"><tbody>
          ${trials.map(s => html`<tr class="click" data-site="${s.code}"><td><b>${s.site}</b><span class="sub">${s.client}</span></td><td><span class="pill ${s.trialExpired ? "bad" : "warn"}">${s.trialExpired ? "Essai terminé" : "Essai jusqu'au " + s.paidUntil.split("-").reverse().join("/")}</span></td><td class="sub">${s.trialExpired ? "relancer ou suspendre" : "proposer la suite"}</td></tr>`)}
          ${nearQuota.map(s => html`<tr class="click" data-site="${s.code}"><td><b>${s.site}</b><span class="sub">${s.client}</span></td><td><span class="pill warn">Quota ${s.monthlyUsed}/${s.monthlyLimit}</span></td><td class="sub">proposer l'offre supérieure</td></tr>`)}
          ${idle.map(s => html`<tr class="click" data-site="${s.code}"><td><b>${s.site}</b><span class="sub">${s.client}</span></td><td><span class="pill">Inactif</span></td><td class="sub">dernière connexion ${relTime(s.lastSeen)}</td></tr>`)}
        </tbody></table></div>` : html`<p class="hint">Rien à signaler : aucun essai en fin de course, aucun site proche de son quota ni inactif depuis 3 semaines.</p>`}
      </section>
    </div>
    <section class="panel"><h2>Agents connectés</h2>
      ${sessions.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Agent</th><th>Site</th><th>Appareil</th><th>Activité</th></tr></thead><tbody>
        ${sessions.map(s => html`<tr><td><b>${s.agent}</b></td><td>${s.site}</td><td>${s.deviceName}</td><td class="sub">${relTime(s.lastSeenAt)}</td></tr>`)}</tbody></table></div>` : html`<p class="hint">Personne n'est connecté en ce moment.</p>`}
    </section>`.toString();
  main.addEventListener("click", e => {
    if (e.target.closest("[data-new]")) return openCreate(adm);
    const g = e.target.closest("[data-goto]");
    if (g) return adm.go(g.dataset.goto);
    const s = e.target.closest("[data-site]");
    if (s) openSite(adm, s.dataset.site);
  });
}

// ---------- demandes ----------
let reqFilter = "ouvertes";
const STATUS = { nouvelle: "warn", "en cours": "ink", convertie: "ok", refusée: "bad", "sans suite": "" };

function requests(main) {
  if (!adm.v2) {
    main.innerHTML = html`<div class="adm-head"><h1>Demandes</h1></div><p class="note hors">Les demandes d'accès arrivent avec le Worker v2. Voir worker/README.md pour le déploiement.</p>`.toString();
    return;
  }
  const all = adm.data.requests || [];
  const list = all.filter(r => reqFilter === "toutes" || (reqFilter === "ouvertes" ? ["nouvelle", "en cours"].includes(r.status) : r.status === reqFilter));
  main.innerHTML = html`<div class="adm-head"><h1>Demandes d'accès</h1></div>
    <div class="toolbar"><div class="seg">${["ouvertes", "convertie", "refusée", "toutes"].map(f => html`<button data-f="${f}" aria-pressed="${f === reqFilter}">${f === "ouvertes" ? "À traiter" : f === "convertie" ? "Converties" : f === "refusée" ? "Refusées" : "Toutes"}</button>`)}</div></div>
    ${list.length ? list.map(r => html`<article class="req" data-id="${r.id}">
      <div class="req-head"><b>${r.organisation}</b><span class="pill ${STATUS[r.status] || ""}">${r.status}</span>${r.trial ? html`<span class="pill ok">Essai 1 mois</span>` : r.plan ? html`<span class="pill">${planLabel(r.plan)}</span>` : ""}<span class="when">${relTime(r.createdAt)}</span></div>
      <dl><dt>Contact</dt><dd>${r.name}, <a href="mailto:${r.email}">${r.email}</a>${r.phone ? html`, <a href="tel:${r.phone}">${r.phone}</a>` : ""}</dd>
        <dt>Déchèteries</dt><dd>${r.sites}${r.siteName ? ", dont " + r.siteName : ""}</dd>
        ${r.code ? html`<dt>Accès créé</dt><dd class="mono">${r.code}</dd>` : ""}</dl>
      ${r.message ? html`<div class="msg">${r.message}</div>` : ""}
      ${r.note ? html`<div class="hint">Note : ${r.note}</div>` : ""}
      <div class="actions">
        ${r.status !== "convertie" ? html`<button class="btn btn-primary btn-sm" data-convert>${icon("plus")}Créer l'accès</button>` : ""}
        ${r.status === "nouvelle" ? html`<button class="btn btn-ghost btn-sm" data-status="en cours">Marquer en cours</button>` : ""}
        <button class="btn btn-ghost btn-sm" data-note>Ajouter une note</button>
        ${!["convertie", "refusée"].includes(r.status) ? html`<button class="btn btn-ghost btn-sm" data-status="refusée">Refuser</button>` : ""}
        <button class="btn btn-quiet btn-sm" data-del>Supprimer</button>
      </div></article>`) : html`<div class="empty-state">${icon("mail")}<b>Aucune demande ici</b><span>Les demandes envoyées depuis la page Offres arrivent dans cette liste et par email.</span></div>`}`.toString();

  main.addEventListener("click", async e => {
    const f = e.target.closest("[data-f]");
    if (f) { reqFilter = f.dataset.f; return render(); }
    const card = e.target.closest("[data-id]");
    if (!card) return;
    const r = all.find(x => x.id === card.dataset.id);
    try {
      if (e.target.closest("[data-convert]")) return openCreate(adm, r);
      const st = e.target.closest("[data-status]");
      if (st) { await adm.call("request-update", { id: r.id, status: st.dataset.status }); }
      else if (e.target.closest("[data-note]")) {
        const note = prompt("Note interne", r.note || "");
        if (note === null) return;
        await adm.call("request-update", { id: r.id, note });
      } else if (e.target.closest("[data-del]")) {
        if (!(await confirmDialog({ title: "Supprimer la demande ?", message: r.organisation, ok: "Supprimer", danger: true }))) return;
        await adm.call("request-delete", { id: r.id });
      } else return;
      await adm.reload();
      render();
    } catch (err) { adm.fail(err); }
  });
}

document.addEventListener("error", e => { if (e.target && e.target.tagName === "IMG") e.target.classList.add("broken"); }, true);

// ---------- démarrage ----------
loadBase([]);
if (adm.key) adm.reload().then(start).catch(e => renderLogin(e.status === 401 ? "Clé expirée." : e.message));
else renderLogin();
