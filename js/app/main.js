// Point d'entrée de l'appli agent : routage par écrans (avec bouton retour du téléphone),
// barre d'onglets, reprise de session et battement de cœur.

import { esc, icon, toast, raw } from "../shared/ui.js";
import { post, ApiError } from "../shared/api.js";
import { loadBase } from "../shared/catalog.js";
import { sess, isLoggedIn, isDemo, applyAccess, clearSess, saveSess, toReview, cache, deviceName } from "./store.js";
import { initImages, onImages } from "./images.js";
import { syncMemory } from "./memory.js";
import { loadSiteCatalog } from "./session.js";

import * as login from "./view-login.js";
import * as home from "./view-home.js";
import * as result from "./view-result.js";
import * as scan from "./view-scan.js";
import * as journal from "./view-journal.js";
import * as guide from "./view-guide.js";
import * as profile from "./view-profile.js";

const VIEWS = {
  login: login.loginView,
  home: home.homeView,
  result: result.resultView,
  multi: result.multiView,
  scan: scan.scanView,
  journal: journal.journalView,
  guide: guide.guideView,
  profile: profile.profileView,
  team: profile.teamView,
  catalog: profile.catalogView,
  memory: profile.memoryView
};
const TABS = [
  { id: "home", label: "Rechercher", icon: "search" },
  { id: "journal", label: "Journal", icon: "list" },
  { id: "guide", label: "Guide", icon: "book" },
  { id: "profile", label: "Profil", icon: "user" }
];

const root = document.getElementById("app");
let current = null;
let currentView = null;

export const app = {
  state: { query: "", result: null, multi: null, photo: null, jrnFilter: "all" },
  get screen() { return current; },

  go(name, { replace = false } = {}) {
    if (!VIEWS[name]) name = "home";
    if (!isLoggedIn() && name !== "login") name = "login";
    const st = { s: name };
    if (replace || !history.state) history.replaceState(st, "", "#" + name);
    else history.pushState(st, "", "#" + name);
    show(name);
  },
  back() {
    if (history.state && history.length > 1 && current !== "home") history.back();
    else app.go("home", { replace: true });
  },
  refresh() { if (current) show(current, { keepScroll: true }); },
  updateTabs: () => renderTabs(),

  async logout() {
    if (sess.code && !isDemo() && sess.sessionId) post("auth", { action: "logout-session", code: sess.code, agent: sess.agent, sessionId: sess.sessionId }).catch(() => {});
    clearSess();
    app.state.result = app.state.multi = null;
    app.go("login", { replace: true });
  },

  // Session expirée ou reprise ailleurs : retour propre à la connexion.
  sessionLost(msg) {
    clearSess();
    toast(msg || "Session fermée. Reconnectez-vous.", { error: true, ms: 4000 });
    app.go("login", { replace: true });
  },

  handleError(e, fallback = "Une erreur est survenue.") {
    if (e instanceof ApiError && e.status === 401 && /SESSION|Session/.test(e.message)) return app.sessionLost();
    toast(e && e.message ? e.message : fallback, { error: true, ms: 4200 });
  }
};

function show(name, { keepScroll = false } = {}) {
  if (currentView && currentView.unmount) currentView.unmount();
  current = name;
  currentView = VIEWS[name];
  const y = window.scrollY;
  root.innerHTML = `<div class="screen ${currentView.tabs === false ? "no-tabs" : ""}" data-screen="${name}">${currentView.render(app)}</div>`;
  if (currentView.mount) currentView.mount(root.firstElementChild, app);
  root.querySelectorAll("[data-back]").forEach(b => b.addEventListener("click", () => app.back()));
  renderTabs();
  window.scrollTo(0, keepScroll ? y : 0);
  const h = root.querySelector("h1");
  document.title = (h && name !== "home" ? h.textContent + " — " : "") + "TriDDS";
}

let tabbar;
function renderTabs() {
  if (!tabbar) {
    tabbar = document.createElement("nav");
    tabbar.className = "tabbar";
    tabbar.setAttribute("aria-label", "Navigation principale");
    document.body.appendChild(tabbar);
    tabbar.addEventListener("click", e => {
      const b = e.target.closest("[data-tab]");
      if (!b) return;
      if (b.dataset.tab === current) { window.scrollTo({ top: 0, behavior: "smooth" }); if (current === "home") root.querySelector("input[type=search]")?.focus(); return; }
      app.go(b.dataset.tab, { replace: true });
    });
  }
  const view = VIEWS[current];
  const visible = isLoggedIn() && view && view.tabs !== false;
  tabbar.hidden = !visible;
  if (!visible) return;
  const active = view.tab || current;
  const n = toReview();
  tabbar.innerHTML = `<div class="tabbar-in">${TABS.map(t => `<button class="tab" data-tab="${t.id}" ${t.id === active ? 'aria-current="page"' : ""}>${icon(t.icon)}${esc(t.label)}${t.id === "journal" && n ? `<span class="badge" aria-label="${n} à vérifier">${n}</span>` : ""}</button>`).join("")}</div>`;
}

window.addEventListener("popstate", e => {
  const name = (e.state && e.state.s) || "home";
  show(isLoggedIn() ? name : "login");
});

// ---------- réseau ----------
function updateOnline() {
  let bar = document.querySelector(".offline-bar");
  if (navigator.onLine) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "offline-bar";
    bar.setAttribute("role", "status");
    bar.innerHTML = `${icon("wifiOff")} Hors ligne. La recherche reste disponible.`;
    document.body.prepend(bar);
  }
}
window.addEventListener("online", () => { updateOnline(); heartbeat(true); });
window.addEventListener("offline", updateOnline);

// ---------- session ----------
let lastBeat = 0;
export async function heartbeat(force = false) {
  if (!isLoggedIn() || isDemo() || !sess.sessionId || !navigator.onLine) return;
  if (!force && Date.now() - lastBeat < 60000) return;
  lastBeat = Date.now();
  try {
    const d = await post("auth", { action: "heartbeat", code: sess.code, agent: sess.agent, sessionId: sess.sessionId, deviceName: sess.deviceName || deviceName() }, { timeout: 12000 });
    applyAccess(d);
    if (current === "home" || current === "profile") app.refresh();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) app.sessionLost(e.status === 403 ? e.message : "Session fermée ou reprise sur un autre appareil.");
  }
}

["click", "keydown", "touchstart"].forEach(ev => document.addEventListener(ev, () => heartbeat(false), { passive: true }));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") heartbeat(true); });

// Photo introuvable : on masque l'icône d'image cassée.
document.addEventListener("error", e => { if (e.target && e.target.tagName === "IMG") e.target.classList.add("broken"); }, true);

// ---------- démarrage ----------
loadBase([]);
initImages();
onImages(() => { if (["home", "result", "multi"].includes(current)) app.refresh(); });
updateOnline();

if (isLoggedIn()) {
  loadSiteCatalog();
  syncMemory();
  if (!isDemo()) {
    post("auth", { action: "resume-session", code: sess.code, agent: sess.agent, sessionId: sess.sessionId, deviceName: sess.deviceName || deviceName() }, { timeout: 12000 })
      .then(d => { applyAccess(d); if (current === "home") app.refresh(); })
      .catch(e => { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) app.sessionLost(e.status === 403 ? e.message : "Session fermée ou reprise sur un autre appareil."); });
  }
  app.go("home", { replace: true });
} else {
  app.go("login", { replace: true });
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

window.TriDDS = app; // aide au débogage
