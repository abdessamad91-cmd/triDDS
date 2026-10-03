// Actions de session partagées par plusieurs écrans (sans dépendre de main.js).

import { post } from "../shared/api.js";
import { loadBase } from "../shared/catalog.js";
import { sess, isLoggedIn, isDemo, saveSess, cache } from "./store.js";
import { syncMemory } from "./memory.js";
import { syncJournal } from "./journal-sync.js";

// Catalogue propre au site (fiches ajoutées par le responsable ou TriDDS).
export async function loadSiteCatalog() {
  const cached = cache.catalog;
  if (cached && cached.code === sess.code) loadBase(cached.items);
  if (!isLoggedIn() || isDemo()) return;
  try {
    let d;
    try { d = await post("site-catalog", { code: sess.code, agent: sess.agent, sessionId: sess.sessionId }, { timeout: 12000 }); }
    catch (e) {
      // Worker précédent : seul le responsable peut lire le catalogue.
      if (e.status === 404 && sess.canManageCatalog) d = await post("site-admin", { action: "catalog-list", code: sess.code, agent: sess.agent, sessionId: sess.sessionId });
      else throw e;
    }
    if (d && d.items) { loadBase(d.items); cache.catalog = { code: sess.code, items: d.items }; }
  } catch (e) { /* le catalogue de base reste disponible */ }
}

export function afterLogin() {
  saveSess();
  loadSiteCatalog();
  syncMemory();
  syncJournal();
}

