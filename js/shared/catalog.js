// Base produits et recherche tolérante (fautes de frappe, synonymes, accents).
// Les produits de data.js sont indexés une seule fois au chargement.

export const FLUX = { E: "EcoDDS", H: "Hors EcoDDS", C: "Refusé", I: "Refusé" };
export const NON_ID = "Produits non ID ou Laboratoire";

// Bac Hors EcoDDS à utiliser quand un produit EcoDDS dépasse le seuil.
const HORS_BAC = {
  "autres dds liquides": "Solvants", acides: "Acides", bases: "Bases", "pâteux": "Pâteux", pateux: "Pâteux",
  "aérosols": "Aérosols", aerosols: "Aérosols", comburants: "Comburants", "phytos et biocides": "Phytosanitaires", filtres: "Filtres"
};
export const horsBacFor = cat => (cat ? HORS_BAC[cat.toLowerCase().trim()] || cat : "Solvants");

export function norm(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function fromRow(p) {
  return { n: p[0], q: p[1], f: p[2], x: p[3] || "", c: p[4] || "", s: p[5] || "", a: p[6] || "", i: p[7] || "", y: p[8] || [] };
}

let products = [];
let index = [];
const catFluxes = {};

function buildIndex() {
  index = products.map(p => {
    const targets = [norm(p.q || p.n)].concat((p.y || []).map(norm)).filter(Boolean);
    const words = new Set();
    targets.forEach(t => t.split(" ").forEach(w => { if (w.length > 1) words.add(w); }));
    return { p, nq: targets[0] || "", targets, words: Array.from(words) };
  });
  Object.keys(catFluxes).forEach(k => delete catFluxes[k]);
  products.forEach(p => { if (p.x) (catFluxes[p.x] = catFluxes[p.x] || new Set()).add(p.f); });
}

export function loadBase(extra = []) {
  const base = (window.TRIDDS_DB || []).map(fromRow);
  const custom = (extra || []).map(p => ({ n: p.n, q: (p.q || p.n || "").toLowerCase(), f: p.f || "H", x: p.x || "", c: p.c || "", s: p.s || "", a: "", i: "", y: Array.isArray(p.y) ? p.y : [], custom: true }));
  const names = new Set(custom.map(p => p.n.toLowerCase()));
  products = base.filter(p => !names.has(p.n.toLowerCase())).concat(custom);
  buildIndex();
  return products;
}

export const allProducts = () => products;
export const productCount = () => products.length;
export const findByName = name => products.find(p => p.n === name) || products.find(p => p.n.toLowerCase() === String(name || "").toLowerCase()) || null;

// Si une catégorie n'existe que dans un seul flux, ce flux fait foi.
export function fluxForCategory(cat) {
  const s = catFluxes[cat];
  return s && s.size === 1 ? Array.from(s)[0] : null;
}

function lev(a, b) {
  const la = a.length, lb = b.length;
  if (!la) return lb;
  if (!lb) return la;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    for (let j = 1; j <= lb; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[lb];
}
function simil(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  if (b.includes(a)) return (a.length / b.length) * 1.1;
  if (a.includes(b)) return (b.length / a.length) * 1.1;
  if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.5) return 0;
  return 1 - lev(a, b) / Math.max(a.length, b.length);
}

// Mots du terrain ramenés au vocabulaire de la base.
const WORD_SYN = { bombe: "aerosol", bombes: "aerosol", spray: "aerosol", sprays: "aerosol", aerosols: "aerosol", peintures: "peinture", glycero: "peinture", acrylique: "peinture", galet: "galets", pastilles: "galets", desherbant: "herbicide", antimousse: "mousse", deboucheur: "deboucheur", wd40: "degrippant" };
const STOP = new Set(["de", "du", "la", "le", "les", "des", "en", "pour", "un", "une", "et", "au", "aux"]);

export function search(query, limit = 20) {
  const q = norm(query);
  if (!q) return [];
  const qWords = q.split(" ").filter(w => w.length > 1 && !STOP.has(w)).map(w => WORD_SYN[w] || w);
  const out = [];
  for (const it of index) {
    let sc = 0;
    if (it.nq === q) sc = 100;
    else if (it.targets.some(t => t === q)) sc = 96;
    else if (it.nq.startsWith(q)) sc = Math.round(80 + 15 * q.length / it.nq.length);
    else if (it.targets.some(t => t.includes(q))) {
      const t = it.targets.find(x => x.includes(q));
      sc = Math.round(85 * q.length / t.length + 15);
    } else {
      let best = 0;
      for (const t of it.targets) best = Math.max(best, simil(q, t));
      if (qWords.length) {
        let matched = 0, acc = 0;
        for (const w of qWords) {
          let bw = 0;
          for (const tw of it.words) {
            const v = tw === w ? 1 : (w.length >= 3 && tw.startsWith(w)) ? 0.92 : simil(w, tw);
            if (v > bw) bw = v;
            if (bw >= 1) break;
          }
          if (bw > 0.72) { matched++; acc += bw; }
        }
        // Tous les mots trouvés : bon score ; une partie seulement : résultat affiché plus bas.
        if (matched) sc = Math.round(matched === qWords.length ? 45 + 30 * acc / qWords.length : 20 + 30 * acc / qWords.length);
      }
      if (best > 0.65) sc = Math.max(sc, Math.round(best * 70));
    }
    if (sc > 0) out.push(Object.assign({}, it.p, { score: sc }));
  }
  out.sort((a, b) => b.score - a.score || a.n.length - b.n.length);
  return out.slice(0, limit);
}

export function isClearHit(res) {
  return res.length === 1 || (res[0] && res[0].score >= 95 && (res.length < 2 || res[1].score < 80));
}

export function searchMany(terms) {
  const seen = new Map();
  for (const term of terms) {
    if (!term || term.length < 2) continue;
    const variants = [term];
    const first = term.split(/\s+/)[0];
    if (first.length >= 3 && first !== term) variants.push(first);
    for (const v of variants) for (const r of search(v)) {
      const prev = seen.get(r.n);
      if (!prev || prev.score < r.score) seen.set(r.n, r);
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.score - a.score);
}

// Où va le produit : couleur, libellé et bac, en tenant compte du dépassement de seuil.
export function destination(r) {
  if (!r) return null;
  if (r.f === "C" || r.f === "I") {
    const isolate = /isol/i.test(r.x || "");
    return { tone: "int", kicker: isolate ? "À isoler" : "Refusé en déchèterie", bac: isolate ? "Isoler le produit" : "Ne pas accepter", action: isolate ? "Isoler" : "Refuser", fluxLabel: "Refusé" };
  }
  if (r.f === "E" && !r.overSeuil) {
    return { tone: "eco", kicker: "EcoDDS", bac: r.x || NON_ID, action: "Bac", fluxLabel: "EcoDDS" };
  }
  const bac = r.overSeuil ? horsBacFor(r.x) : (r.x || NON_ID);
  const kicker = r.seuilUnknown ? "Hors EcoDDS, contenance non vérifiée" : r.overSeuil ? "Hors EcoDDS, seuil dépassé" : "Hors EcoDDS";
  return { tone: "hors", kicker, bac, action: "Bac", fluxLabel: "Hors EcoDDS" };
}

export function seuilText(s) {
  return String(s || "").replace(/[≤≥<>]/g, "").replace(/\blitres\b/, "L").replace(/\blitre\b/, "L").trim();
}
