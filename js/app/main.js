// Point d'entrée de l'appli agent : routage par écrans (avec bouton retour du téléphone),
// barre d'onglets, reprise de session et battement de cœur.

import { esc, icon, toast, raw, closeTopOverlay, clearToast } from "../shared/ui.js";
import { post, ApiError } from "../shared/api.js";
import { loadBase } from "../shared/catalog.js";
import { sess, isLoggedIn, isDemo, applyAccess, clearSess, saveSess, toReview, cache, deviceName } from "./store.js";
import { initImages, onImages } from "./images.js";
import { syncMemory } from "./memory.js";
import { quotaChip } from "./common.js";
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
  access: profile.accessView,
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
  // Mise à jour en arrière-plan : jamais pendant une saisie (le clavier se fermerait).
  softRefresh() {
    const a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
    if (document.querySelector(".sheet-backdrop, .lightbox, .analyzing")) return;
    app.refresh();
  },
  updateQuota() {
    const chip = root.querySelector(".quota-chip");
    if (chip) chip.outerHTML = String(quotaChip());
  },
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
  if (name !== current) clearToast();
  current = name;
  currentView = VIEWS[name];
  const y = window.scrollY;
  root.innerHTML = `<div class="screen ${currentView.tabs === false ? "no-tabs" : ""}" data-screen="${name}">${currentView.render(app)}</div>`;
  if (currentView.mount) currentView.mount(root.firstElementChild, app);
  root.querySelectorAll("[data-back]").forEach(b => b.addEventListener("click", () => app.back()));
  root.querySelectorAll("[data-tab-go]").forEach(b => b.addEventListener("click", () => app.go(b.dataset.tabGo, { replace: true })));
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
  // Bouton retour du téléphone avec une fenêtre ouverte : on ferme la fenêtre et on reste sur l'écran.
  if (closeTopOverlay()) {
    history.pushState({ s: current }, "", "#" + current);
    return;
  }
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
  if (document.querySelector(".analyzing")) return; // pas pendant un scan
  if (!force && Date.now() - lastBeat < 60000) return;
  lastBeat = Date.now();
  try {
    const d = await post("auth", { action: "heartbeat", code: sess.code, agent: sess.agent, sessionId: sess.sessionId, deviceName: sess.deviceName || deviceName() }, { timeout: 12000 });
    applyAccess(d);
    app.updateQuota();
    if (current === "profile") app.softRefresh();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) app.sessionLost(e.status === 403 ? e.message : "Session fermée ou reprise sur un autre appareil.");
  }
}

["click", "keydown", "touchstart"].forEach(ev => document.addEventListener(ev, () => heartbeat(false), { passive: true }));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") heartbeat(true); });

// Photo introuvable : on masque l'icône d'image cassée.
document.addEventListener("error", e => {
  const img = e.target;
  if (!img || img.tagName !== "IMG") return;
  if (img.classList.contains("thumb")) { img.outerHTML = `<span class="thumb empty">${icon("box")}</span>`; return; }
  const holder = img.closest(".gallery > button, .compare figure, .person .av");
  if (holder) holder.hidden = true; else img.classList.add("broken");
}, true);

// ---------- démarrage ----------
loadBase([]);
initImages();
onImages(() => { if (["home", "result", "multi"].includes(current)) app.softRefresh(); });
updateOnline();

if (isLoggedIn()) {
  loadSiteCatalog();
  syncMemory();
  if (!isDemo()) {
    post("auth", { action: "resume-session", code: sess.code, agent: sess.agent, sessionId: sess.sessionId, deviceName: sess.deviceName || deviceName() }, { timeout: 12000 })
      .then(d => { applyAccess(d); app.updateQuota(); })
      .catch(e => { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) app.sessionLost(e.status === 403 ? e.message : "Session fermée ou reprise sur un autre appareil."); });
  }
  app.go("home", { replace: true });
} else {
  app.go("login", { replace: true });
}

// Hors ligne et mises à jour : la nouvelle version s'installe en arrière-plan, l'agent choisit le moment.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  // Rechargement seulement lors d'une mise à jour, jamais à la toute première installation.
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
  navigator.serviceWorker.addEventListener("message", e => {
    if (e.data === "stale") offer(navigator.serviceWorker.controller, "refresh");
    if (e.data === "refreshed") location.reload();
  });
  let lastCheck = 0;
  const check = () => {
    if (!navigator.serviceWorker.controller || !navigator.onLine || Date.now() - lastCheck < 30 * 60000) return;
    lastCheck = Date.now();
    navigator.serviceWorker.controller.postMessage("check");
  };
  function offer(w, msg = "skipWaiting") {
    if (!w || !navigator.serviceWorker.controller || document.querySelector(".update-bar")) return;
    const bar = document.createElement("div");
    bar.className = "update-bar";
    bar.setAttribute("role", "status");
    bar.innerHTML = `<span>Nouvelle version de TriDDS disponible.</span><button class="btn btn-eco btn-sm">Mettre à jour</button>`;
    bar.querySelector("button").addEventListener("click", () => { bar.querySelector("button").disabled = true; w.postMessage(msg); });
    document.body.appendChild(bar);
  }
  setTimeout(check, 8000);
  navigator.serviceWorker.register("./sw.js").then(reg => {
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (w) w.addEventListener("statechange", () => { if (w.state === "installed") offer(w); });
    });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { reg.update().catch(() => {}); check(); } });
  }).catch(() => {});
}

window.TriDDS = app; // aide au débogage
