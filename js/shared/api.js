// Appels au Worker TriDDS : délai maximal, erreurs lisibles, détection hors ligne.

const CFG = window.APP_CONFIG || {};
export const API_BASE = String(CFG.API_BASE || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function apiUrl(path) {
  return API_BASE + "/" + String(path).replace(/^\//, "");
}

export async function request(path, { method = "POST", body, headers = {}, timeout = 20000 } = {}) {
  if (!API_BASE) throw new ApiError("Serveur non configuré (config.js).");
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ApiError("Pas de réseau. La recherche fonctionne hors ligne, pas le reste.", 0);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers: Object.assign(body !== undefined ? { "Content-Type": "application/json" } : {}, headers),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new ApiError("Le serveur met trop de temps à répondre. Réessayez.", 0);
    throw new ApiError("Connexion impossible. Vérifiez le réseau.", 0);
  }
  clearTimeout(timer);
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: text || "HTTP " + res.status }; }
  if (!res.ok || data.error) {
    throw new ApiError(data.message && data.error === "SESSION_ACTIVE" ? data.message : (data.error || "Erreur " + res.status), res.status, data);
  }
  return data;
}

export const post = (path, body, opts = {}) => request(path, Object.assign({ body }, opts));
export const get = (path, opts = {}) => request(path, Object.assign({ method: "GET" }, opts));
