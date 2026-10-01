// Service worker TriDDS : l'appli s'ouvre et la recherche fonctionne sans réseau.
// Changer VERSION à chaque mise en ligne pour renouveler le cache.

const VERSION = "tridds-v2.0.0";
const SHELL = [
  "./", "./index.html", "./config.js", "./data.js", "./manifest.json",
  "./css/fonts.css", "./css/base.css", "./css/app.css",
  "./fonts/barlow-latin-400-normal.woff2", "./fonts/barlow-latin-500-normal.woff2", "./fonts/barlow-latin-600-normal.woff2", "./fonts/barlow-latin-700-normal.woff2",
  "./fonts/barlow-condensed-latin-600-normal.woff2", "./fonts/barlow-condensed-latin-700-normal.woff2",
  "./js/shared/ui.js", "./js/shared/api.js", "./js/shared/catalog.js", "./js/shared/plans.js",
  "./js/app/main.js", "./js/app/session.js", "./js/app/store.js", "./js/app/images.js", "./js/app/memory.js", "./js/app/ai.js", "./js/app/common.js",
  "./js/app/view-login.js", "./js/app/view-home.js", "./js/app/view-result.js", "./js/app/view-scan.js",
  "./js/app/view-journal.js", "./js/app/view-guide.js", "./js/app/view-profile.js",
  "./assets/symbol-128.png", "./assets/eco-dds-96.png", "./assets/hors-eco-dds-96.png", "./assets/favicon-32x32.png"
];
const IMG_CACHE = "tridds-images";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("tridds-v") && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Photos produits : immuables, servies depuis le cache.
  if (url.pathname.includes("/api/img/")) {
    e.respondWith(caches.open(IMG_CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { c.put(req, res.clone()); trimCache(IMG_CACHE, 600); }
      return res;
    }));
    return;
  }
  // Autres appels API : toujours le réseau.
  if (url.pathname.includes("/api/")) return;

  if (url.origin !== self.location.origin) return;
  // Pages de l'admin et pages publiques : réseau d'abord.
  if (/admin|pricing|offres|success/.test(url.pathname)) return;

  // Page de l'appli : réseau d'abord (3 s max), sinon la version en cache.
  if (req.mode === "navigate") {
    e.respondWith(caches.open(VERSION).then(async c => {
      const cached = await c.match("./index.html");
      const net = fetch(req).then(res => { if (res.ok) c.put("./index.html", res.clone()); return res; });
      if (!cached) return net;
      const timeout = new Promise(r => setTimeout(() => r(cached), 3000));
      return Promise.race([net.catch(() => cached), timeout]);
    }));
    return;
  }

  // Fichiers de l'appli : réponse immédiate depuis le cache, mise à jour en arrière-plan.
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
