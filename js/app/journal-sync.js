// Journal partagé : envoie les décisions de cet appareil au site et récupère celles de l'équipe.
// Tout passe par l'API /api/journal avec la session ; hors ligne, la file d'attente attend.

import { post } from "../shared/api.js";
import { sess, isDemo, isLoggedIn, takeOutbox, dropOutbox, setRemoteJournal } from "./store.js";

let busy = false;
export async function flushJournal() {
  if (busy || isDemo() || !isLoggedIn() || !sess.sessionId || navigator.onLine === false) return false;
  const items = takeOutbox();
  if (!items.length) return false;
  busy = true;
  try {
    const d = await post("journal", { code: sess.code, agent: sess.agent, sessionId: sess.sessionId, action: "sync", items: items.map(({ code, ...op }) => op) }, { timeout: 15000 });
    if (d && d.ok) { dropOutbox(items); return true; }
  } catch (e) { /* réessayé au prochain battement */ }
  finally { busy = false; }
  return false;
}

export async function pullJournal({ days = 30 } = {}) {
  if (isDemo() || !isLoggedIn() || !sess.sessionId || navigator.onLine === false) return false;
  try {
    const d = await post("journal", { code: sess.code, agent: sess.agent, sessionId: sess.sessionId, action: "list", days, limit: 600 }, { timeout: 15000 });
    if (d && d.ok) { setRemoteJournal(d.items); return true; }
  } catch (e) { /* hors ligne : on garde la copie locale */ }
  return false;
}

export async function syncJournal() {
  const sent = await flushJournal();
  await pullJournal();
  return sent;
}

export async function journalStats(month) {
  const d = await post("journal", { code: sess.code, agent: sess.agent, sessionId: sess.sessionId, action: "stats", month }, { timeout: 15000 });
  return d && d.stats;
}
