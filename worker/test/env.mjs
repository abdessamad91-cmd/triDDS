// Environnement simulé du Worker : KV, R2 et cache en mémoire, Anthropic et Resend interceptés.

class KV {
  constructor() { this.m = new Map(); }
  async get(k) { const v = this.m.get(k); if (!v) return null; if (v.exp && v.exp < Date.now()) { this.m.delete(k); return null; } return v.v; }
  async put(k, v, o = {}) { this.m.set(k, { v: String(v), exp: o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 }); }
  async delete(k) { this.m.delete(k); }
}
class R2 {
  constructor() { this.m = new Map(); }
  async put(k, body, o = {}) { this.m.set(k, { body, httpMetadata: o.httpMetadata || {} }); }
  async get(k) { return this.m.get(k) || null; }
  async delete(k) { this.m.delete(k); }
}
const cacheStore = new Map();
globalThis.caches = { default: {
  async match(req) { const r = cacheStore.get(req.url); return r ? r.clone() : undefined; },
  async put(req, res) { cacheStore.set(req.url, res.clone()); },
  async delete(req) { return cacheStore.delete(req.url); }
} };

export const sent = [];
export const anthropicCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("https://api.resend.com")) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "mail_" + sent.length }), { status: 200 }); }
  if (u.startsWith("https://api.anthropic.com")) {
    const body = JSON.parse(init.body);
    anthropicCalls.push(body);
    const text = JSON.stringify({ produits: [{ texte_lu: "White Spirit", nom: "White spirit", marque: "Onyx", nom_referentiel: "White spirit", categorie: "Autres DDS liquides", filiere: "EcoDDS", volume_estime: "1 L", confiance: 91, bbox: { x: 10, y: 10, w: 60, h: 80 } }] });
    return new Response(JSON.stringify({ content: [{ type: "text", text }], model: body.model, system_cached: Array.isArray(body.system) }), { status: 200 });
  }
  return realFetch(url, init);
};

// Durable Object simulé : stockage en mémoire, exécution sérialisée par objet (comme la plateforme).
class FakeDOStorage { constructor() { this.m = new Map(); } async get(k) { return this.m.get(k); } async put(k, v) { this.m.set(k, JSON.parse(JSON.stringify(v))); } }
export function makeDONamespace(Cls) {
  const objects = new Map();
  return {
    idFromName: name => ({ name }),
    get(id) {
      if (!objects.has(id.name)) {
        const inst = new Cls({ storage: new FakeDOStorage() }, {});
        objects.set(id.name, { inst, queue: Promise.resolve() });
      }
      const o = objects.get(id.name);
      return { fetch: (url, init) => { const run = () => o.inst.fetch(new Request(url, init)); const p = o.queue.then(run, run); o.queue = p.catch(() => {}); return p; } };
    }
  };
}

export async function makeEnv() {
  const AUTH = new KV(), MEM = new KV();
  const { SiteUsage } = await import("../src/usage.js");
  const env = { AUTH_STORE: AUTH, MEMORY_STORE: MEM, IMAGES_BUCKET: new R2(), SITE_USAGE: makeDONamespace(SiteUsage), TRIDDS_ADMIN_KEY: "cle-test", ANTHROPIC_API_KEY: "x", RESEND_API_KEY: "x", RESEND_FROM: "TriDDS <bonjour@tridds.com>", NOTIFY_EMAIL: "admin@exemple.fr", SITE_BASE_URL: "https://tridds.com" };
  
  // Données de départ : un site au format v1 (comme en production aujourd'hui) et une demande.
  const legacy = { clientName: "Métropole du Grand Nancy", principalName: "Yvan Aref", principalEmail: "yvan@exemple.fr", site: "Déchèterie de Ludres", plan: "pro", active: true, created: "2026-04-10T08:00:00Z", contact: "", notes: "", trialTotal: 5, trialUsed: 2, monthlyUsed: 168, usageMonth: new Date().toISOString().slice(0, 7), monthlyLimit: 200,
    agents: [{ name: "Yvan Aref", role: "responsable", lastSeen: "2026-09-30T09:00:00Z" }, { name: "Cyril Guilbert", role: "agent", lastSeen: "2026-09-29T15:00:00Z" }, { name: "Jura Beldor", role: "agent", lastSeen: null }] };
  await AUTH.put("LUDR-2026-ABC", JSON.stringify(legacy));
  await AUTH.put("TRY-OLDTRIAL", JSON.stringify({ site: "Essai Faulquemont", plan: "free", active: true, created: "2026-05-01T08:00:00Z", trialTotal: 2, trialUsed: 2, agents: [{ name: "Marc", role: "responsable" }], adminEmail: "marc@exemple.fr" }));
  await AUTH.put("TRI-RESEAU01", JSON.stringify({ site: "Réseau Est", plan: "multisite", active: true, created: "2026-06-01T08:00:00Z", trialTotal: 0, trialUsed: 0, monthlyUsed: 400, usageMonth: new Date().toISOString().slice(0, 7), agents: [{ name: "Paul", role: "responsable" }] }));
  await AUTH.put("_index", JSON.stringify({ codes: ["LUDR-2026-ABC", "TRY-OLDTRIAL", "TRI-RESEAU01"] }));
  await AUTH.put("_requests", JSON.stringify({ items: [{ id: "REQ-TEST0001", createdAt: new Date(Date.now() - 3600e3).toISOString(), status: "nouvelle", name: "Claire Martin", email: "c.martin@sivom.fr", phone: "06 12 34 56 78", organisation: "SIVOM du Saulnois", siteName: "Déchèterie de Château-Salins", sites: 3, plan: "multisite", message: "Nous avons 3 déchèteries et 9 agents. Démarrage souhaité en novembre.", source: "page-offres" }] }));
  await MEM.put("mem-LUDR-2026-ABC", JSON.stringify({ brands: { onyx: { p: "White spirit", f: "E", c: "Autres DDS liquides", n: 6, d: "2026-09-20", by: ["Cyril Guilbert"] } } }));
  await MEM.put("images-_GLOBAL", JSON.stringify({ items: [{ id: "img1", productName: "White spirit", url: "", r2Key: "_GLOBAL/img1.jpg", isPrimary: true, order: 0, source: "admin", status: "active", imageFlux: "" }] }));
  
    return env;
}
