// Service worker TriDDS : l'appli s'ouvre et la recherche fonctionne sans réseau.
// Tous les fichiers de l'appli viennent du cache de la version installée (jamais un mélange
// d'anciens et de nouveaux fichiers). Une nouvelle version s'installe en arrière-plan et
// s'active quand l'agent touche « Mettre à jour » (ou au prochain lancement).
// Changer VERSION à chaque mise en ligne.

const VERSION = "tridds-v2.2.1";
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
const scope = new URL(self.registration.scope);
const SHELL_URLS = new Set(SHELL.map(p => new URL(p, scope).pathname));

self.addEventListener("install", e => {
  // cache: "reload" : on contourne le cache HTTP du navigateur pour ne pas figer d'anciens fichiers.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(p => new Request(p, { cache: "reload" })))));
});

// Filet de sécurité si VERSION n'a pas été changée lors d'une mise en ligne :
// l'appli demande « check », on compare les fichiers texte avec le serveur ; si l'un a changé,
// « refresh » recharge tous les fichiers d'un coup (jamais de mélange) puis l'appli se recharge.
const TEXT = /\.(js|css|html|json)$|\/$/;
async function shellIsStale() {
  const c = await caches.open(VERSION);
  for (const p of SHELL.filter(x => TEXT.test(x))) {
    const [cached, fresh] = await Promise.all([c.match(p, { ignoreSearch: true }), fetch(p, { cache: "no-cache" })]);
    if (!cached || !fresh.ok) continue;
    if ((await cached.text()) !== (await fresh.text())) return true;
  }
  return false;
}
async function refreshShell() {
  const responses = await Promise.all(SHELL.map(p => fetch(new Request(p, { cache: "reload" }))));
  if (responses.some(r => !r.ok)) throw new Error("incomplet");
  const c = await caches.open(VERSION);
  await Promise.all(SHELL.map((p, i) => c.put(p, responses[i])));
}

self.addEventListener("message", e => {
  if (e.data === "skipWaiting") self.skipWaiting();
  if (e.data === "check") e.waitUntil(shellIsStale().then(stale => { if (stale && e.source) e.source.postMessage("stale"); }).catch(() => {}));
  if (e.data === "refresh") e.waitUntil(refreshShell().then(() => e.source && e.source.postMessage("refreshed")).catch(() => {}));
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

  // Photos produits (immuables) : cache d'abord. Requête CORS pour pouvoir les garder hors ligne.
  if (url.pathname.includes("/api/img/")) {
    e.respondWith(caches.open(IMG_CACHE).then(async c => {
      const hit = await c.match(req.url);
      if (hit) return hit;
      try {
        const res = await fetch(req.url, { mode: "cors", credentials: "omit" });
        if (res.ok) { c.put(req.url, res.clone()); trimCache(IMG_CACHE, 600); }
        return res;
      } catch (err) {
        return fetch(req);
      }
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Page de l'appli : la version installée.
  const isAppPage = req.mode === "navigate" && (url.pathname === scope.pathname || url.pathname === scope.pathname + "index.html");
  if (isAppPage) {
    e.respondWith(caches.open(VERSION).then(async c => (await c.match("./index.html", { ignoreSearch: true })) || fetch(req)));
    return;
  }
  // Fichiers de l'appli, demandés par l'appli : uniquement ceux de la version installée.
  // (Les pages Offres et Admin partagent certains fichiers mais passent par le réseau.)
  if (SHELL_URLS.has(url.pathname)) {
    e.respondWith((async () => {
      const client = e.clientId ? await self.clients.get(e.clientId) : null;
      const fromApp = client ? isAppUrl(new URL(client.url)) : req.destination === "document";
      if (!fromApp) return fetch(req);
      const c = await caches.open(VERSION);
      return (await c.match(req, { ignoreSearch: true })) || fetch(req);
    })());
  }
  // Tout le reste (admin, offres, API) : réseau normal.
});

function isAppUrl(u) {
  return u.origin === self.location.origin && (u.pathname === scope.pathname || u.pathname === scope.pathname + "index.html");
}
