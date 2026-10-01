// Photos de référence des produits (R2 via le Worker).
// Mises en cache localement pour un affichage immédiat et hors ligne.

import { get, API_BASE } from "../shared/api.js";
import { cache } from "./store.js";

let byName = {};
let byCat = {};
let loaded = false;
let loading = null;
const listeners = new Set();

function fixUrl(img) {
  if (img.r2Key && API_BASE) img.url = API_BASE + "/img/" + img.r2Key;
  else if (img.url && img.url.includes("/api/img/") && API_BASE) img.url = API_BASE + "/img/" + img.url.split("/api/img/")[1];
  return img;
}
const isPictogram = i => i.source === "auto-catégorie" || /^__CAT__/.test(i.productName || "");

function ingest(items, cats) {
  const next = {};
  (items || []).forEach(raw => {
    const img = fixUrl(Object.assign({}, raw));
    const key = (img.productName || "").toLowerCase().trim();
    if (!key || !img.url || key.startsWith("__cat__")) return;
    const arr = next[key] || (next[key] = []);
    if (!arr.some(e => e.url === img.url)) arr.push(img);
  });
  Object.values(next).forEach(arr => arr.sort((a, b) =>
    (isPictogram(a) - isPictogram(b)) || ((b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0)) || ((a.order || 0) - (b.order || 0))));
  byName = next;
  if (cats) {
    byCat = {};
    Object.entries(cats).forEach(([k, v]) => { const img = fixUrl(Object.assign({}, v)); if (img.url) byCat[k.toLowerCase().trim()] = img.url; });
  }
}

// Démarre depuis le cache local, puis rafraîchit depuis le serveur.
export function initImages() {
  const c = cache.images;
  if (c && c.items) { ingest(c.items, c.cats); loaded = true; }
  return refreshImages();
}

export function refreshImages() {
  if (!API_BASE) return Promise.resolve();
  if (loading) return loading;
  loading = Promise.all([
    get("public-images", { timeout: 15000 }).catch(() => null),
    get("cat-images", { timeout: 15000 }).catch(() => null)
  ]).then(([imgs, cats]) => {
    if (imgs && imgs.items) {
      const slim = imgs.items.map(i => ({ productName: i.productName, url: i.url, r2Key: i.r2Key, isPrimary: !!i.isPrimary, order: i.order || 0, imageFlux: i.imageFlux || "", source: i.source || "" }));
      const catMap = cats && cats.categories ? cats.categories : (cache.images && cache.images.cats) || {};
      ingest(slim, catMap);
      cache.images = { items: slim, cats: catMap, at: Date.now() };
      loaded = true;
      listeners.forEach(fn => fn());
    }
  }).finally(() => { loading = null; });
  return loading;
}

export const onImages = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const imagesLoaded = () => loaded;

// Photos réelles d'un produit pour un flux donné (pictogrammes exclus si de vraies photos existent).
export function photosFor(name, flux) {
  const all = byName[(name || "").toLowerCase().trim()] || [];
  const real = all.filter(i => !isPictogram(i));
  const pool = real.length ? real : [];
  if (!flux || !pool.length) return pool;
  const tagged = pool.filter(i => i.imageFlux === flux);
  if (tagged.length) return tagged;
  const generic = pool.filter(i => !i.imageFlux || i.imageFlux === "all");
  return generic.length ? generic : pool;
}

// Vignette : vraie photo, sinon pictogramme de catégorie, sinon rien.
export function thumbFor(name, flux, category) {
  const p = photosFor(name, flux);
  if (p.length) return p[0].url;
  const all = byName[(name || "").toLowerCase().trim()] || [];
  if (all.length) return all[0].url;
  if (category && byCat[category.toLowerCase().trim()]) return byCat[category.toLowerCase().trim()];
  return null;
}

export function addLocalPhoto(item) {
  fixUrl(item);
  const key = (item.productName || "").toLowerCase().trim();
  (byName[key] = byName[key] || []).push(item);
  listeners.forEach(fn => fn());
}
