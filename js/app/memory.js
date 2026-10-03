// Mémoire des marques : partagée entre agents du site (offres Pro et plus),
// sinon conservée sur l'appareil.

import { post } from "../shared/api.js";
import { sess, isDemo, cache } from "./store.js";

export const memory = { brands: {} };

function setBrands(b) {
  Object.keys(memory.brands).forEach(k => delete memory.brands[k]);
  Object.assign(memory.brands, b || {});
}

export async function syncMemory() {
  if (isDemo()) return;
  if (!sess.memoryEnabled) { setBrands(cache.localMemory.brands); return; }
  try {
    const d = await post("memory-get", { code: sess.code, agent: sess.agent, sessionId: sess.sessionId }, { timeout: 12000 });
    if (d && d.brands) setBrands(d.brands);
  } catch (e) { /* hors ligne : on garde l'état courant */ }
}

export function learn(brand, product, flux, category, action = "learn") {
  const k = String(brand || "").toLowerCase().trim();
  if (k.length < 2 || !product) return;
  const prev = memory.brands[k] || { n: 0 };
  memory.brands[k] = { p: product, f: flux, c: category, n: (prev.n || 0) + 1, d: new Date().toISOString().slice(0, 10) };
  if (isDemo()) return;
  if (!sess.memoryEnabled) { cache.localMemory = { brands: memory.brands }; return; }
  post("memory-set", { code: sess.code, agent: sess.agent, sessionId: sess.sessionId, brand: k, product, flux, category, action }).catch(() => {});
}

export async function forget(brand) {
  const k = String(brand || "").toLowerCase().trim();
  delete memory.brands[k];
  if (!sess.memoryEnabled) { cache.localMemory = { brands: memory.brands }; return; }
  await post("memory-set", { code: sess.code, agent: sess.agent, sessionId: sess.sessionId, brand: k, action: "delete" });
}

export const memoryCount = () => Object.keys(memory.brands).length;
