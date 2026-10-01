// État local de l'appli agent : session, historique, journal, préférences.
// localStorage peut être indisponible (navigation privée) : tout est protégé.

const K = { sess: "tridds_sess", hist: "tridds_h", jrn: "tridds_jrn", last: "tridds_last", mem: "tridds_mem_local", cat: "tridds_cat_cache", imgs: "tridds_imgs_cache" };

export function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
}
export function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
}
export function drop(key) { try { localStorage.removeItem(key); } catch (e) {} }

const EMPTY_SESS = { code: "", site: "", clientName: "", agent: "", agentRole: "agent", canManageUsers: false, canManageCatalog: false, teamLocked: true, maxAgents: null, plan: "free", planName: "", memoryEnabled: false, aiEnabled: false, trialTotal: 0, trialUsed: 0, trialRemaining: 0, monthlyLimit: 0, monthlyUsed: 0, monthlyRemaining: 0, sessionId: "", deviceName: "" };

export const sess = Object.assign({}, EMPTY_SESS, load(K.sess, {}));
export const isDemo = () => sess.code === "DEMO";
export const isLoggedIn = () => !!sess.code;
export function saveSess() { save(K.sess, sess); }
export function clearSess() {
  const last = sess.code && !isDemo() ? { code: sess.code, site: sess.site, agent: sess.agent } : null;
  Object.keys(sess).forEach(k => delete sess[k]);
  Object.assign(sess, EMPTY_SESS);
  drop(K.sess);
  drop(K.cat);
  if (last) save(K.last, last);
}
export const lastLogin = () => load(K.last, null);

export function applyAccess(d) {
  if (!d) return;
  const fields = ["site", "clientName", "plan", "planName", "agentRole", "memoryEnabled", "aiEnabled", "trialTotal", "trialUsed", "trialRemaining", "monthlyLimit", "monthlyUsed", "monthlyRemaining", "maxAgents", "trialExpired"];
  fields.forEach(f => { if (d[f] !== undefined && d[f] !== null) sess[f] = d[f]; });
  if (d.maxAgents === null) sess.maxAgents = null;
  // Une réponse sans profil (ancien Worker, analyse) ne doit pas retirer les droits du responsable.
  if (d.agentRole) {
    sess.canManageUsers = !!d.canManageUsers;
    sess.canManageCatalog = !!d.canManageCatalog;
  }
  sess.teamLocked = d.teamLocked === undefined ? sess.teamLocked : !!d.teamLocked;
  saveSess();
}

export function quota() {
  if (sess.monthlyLimit > 0) return { total: sess.monthlyLimit, left: sess.monthlyRemaining || 0, kind: "mois" };
  return { total: sess.trialTotal || 0, left: sess.trialRemaining || 0, kind: "essai" };
}
export const hasAi = () => quota().left > 0;

export function deviceName() {
  const ua = navigator.userAgent || "";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "PC Windows";
  if (/Macintosh/i.test(ua)) return "Mac";
  return "Navigateur web";
}

// ---------- historique (15 derniers produits orientés) ----------
export let history = load(K.hist, []);
if (!Array.isArray(history)) history = [];
// Historique propre au site connecté (un téléphone peut servir à plusieurs codes).
export const siteHistory = () => history.filter(h => (h.code || "") === sess.code);
export function addHistory(r) {
  const entry = { nm: r.n, f: r.f, x: r.x || "", s: r.s || "", vol: r.vol || "", overSeuil: !!r.overSeuil, at: Date.now(), code: sess.code };
  history = [entry].concat(history.filter(h => !(h.nm === entry.nm && h.overSeuil === entry.overSeuil))).slice(0, 15);
  save(K.hist, history);
}
export function clearHistory() { history = history.filter(h => (h.code || "") !== sess.code); save(K.hist, history); }

// ---------- journal (200 dernières décisions) ----------
export let journal = load(K.jrn, []);
if (!Array.isArray(journal)) journal = [];
const saveJournal = () => save(K.jrn, journal.slice(0, 200));
export const siteJournal = () => journal.filter(e => (e.code || "") === sess.code);
export function addJournal(e) {
  e.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  e.timestamp = Date.now();
  e.agent = sess.agent;
  e.code = sess.code;
  e.reviewed = e.validationType !== "auto" || (e.confidence || 0) >= 70;
  journal.unshift(e);
  journal = journal.slice(0, 200);
  saveJournal();
  return e;
}
export function updateJournal(id, patch) {
  const e = journal.find(x => x.id === id);
  if (e) { Object.assign(e, patch); saveJournal(); }
  return e;
}
export const toReview = () => siteJournal().filter(e => !e.reviewed).length;

export const cache = {
  get catalog() { return load(K.cat, null); },
  set catalog(v) { save(K.cat, v); },
  get images() { return load(K.imgs, null); },
  set images(v) { save(K.imgs, v); },
  get localMemory() { return load(K.mem, { brands: {} }); },
  set localMemory(v) { save(K.mem, v); }
};
