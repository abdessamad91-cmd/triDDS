// Analyse photo : une passe rapide (Haiku), puis une seconde passe (Sonnet) seulement
// si la scène est chargée ou si la lecture est incertaine. Rapproche ensuite chaque
// produit lu de la base TriDDS et de la mémoire de l'équipe.

import { post } from "../shared/api.js";
import { searchMany, search, fluxForCategory, NON_ID } from "../shared/catalog.js";
import { sess } from "./store.js";
import { memory } from "./memory.js";

const SYS = window.TRIDDS_PROMPT || "";

export function toJpeg(dataUrl, max = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(max / img.width, max / img.height, 1);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Image illisible"));
    img.src = dataUrl;
  });
}

export function crop(src, bb) {
  return new Promise(resolve => {
    if (!bb || !bb.w || !bb.h) return resolve(null);
    const img = new Image();
    img.onload = () => {
      const pct = v => Math.max(0, Math.min(100, Number(v) || 0)) / 100;
      let sx = Math.round(img.width * pct(bb.x - 2)), sy = Math.round(img.height * pct(bb.y - 2));
      let sw = Math.round(img.width * pct(bb.w + 4)), sh = Math.round(img.height * pct(bb.h + 4));
      sw = Math.min(sw, img.width - sx); sh = Math.min(sh, img.height - sy);
      if (sw < 16 || sh < 16) return resolve(null);
      const c = document.createElement("canvas");
      const s = Math.min(1, 480 / Math.max(sw, sh));
      c.width = Math.round(sw * s); c.height = Math.round(sh * s);
      c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function memoryContext() {
  const entries = Object.entries(memory.brands || {}).sort((a, b) => (b[1].n || 0) - (a[1].n || 0)).slice(0, 60);
  if (!entries.length) return "";
  return "\n\nMarques déjà identifiées par l'équipe de ce site :\n" + entries.map(([b, e]) => `- "${b}" → ${e.p} [${e.c} / ${e.f === "E" ? "EcoDDS" : "Hors EcoDDS"}] (vu ${e.n} fois)`).join("\n");
}

const PROMPT = `Analyse cette photo prise en déchèterie (local DDS). Pour CHAQUE produit distinct visible :
1) lis le texte exact de l'étiquette ; 2) déduis le type si l'emballage est reconnaissable ; 3) estime le volume ou la masse du contenant ;
4) classe-le dans le référentiel (nom_referentiel, categorie, filiere) en traduisant les noms commerciaux ; 5) donne sa position bbox={x,y,w,h} en % de l'image ; 6) donne une confiance de 0 à 100.
Réponds UNIQUEMENT en JSON : {"produits":[{"texte_lu":"","nom":"","marque":"","nom_referentiel":"","categorie":"","filiere":"EcoDDS|Hors EcoDDS|Cas spécial","volume_estime":"","confiance":0,"consigne":"","bbox":{"x":0,"y":0,"w":0,"h":0}}]}`;

function parseProducts(text) {
  const m = (text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]);
    if (Array.isArray(p.produits)) return p.produits;
    if (p.nom || p.texte_lu) return [p];
  } catch (e) { /* JSON incomplet */ }
  return null;
}

function dedupe(prods) {
  const seen = new Set();
  return (prods || []).filter(p => {
    const k = (p.nom || p.texte_lu || "").toLowerCase().trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function callModel(b64, model, mode) {
  const d = await post("analyze", {
    // Worker v2 : consignes côté serveur, seule la mémoire du site est envoyée (context).
    // Worker v1 : utilise system et prompt.
    image: b64, mime: "image/jpeg", system: SYS, prompt: PROMPT + memoryContext(), context: memoryContext().trim(),
    model, mode, code: sess.code, agent: sess.agent, sessionId: sess.sessionId
  }, { timeout: model === "sonnet" ? 60000 : 40000 });
  const text = d.content && d.content[0] ? d.content[0].text : "";
  return { prods: dedupe(parseProducts(text)), usage: d.usage || null };
}

// onStep(texte) informe l'écran d'attente.
export async function analyzePhoto(dataUrl, onStep = () => {}) {
  onStep("Préparation de la photo");
  const jpeg = await toJpeg(dataUrl);
  const b64 = jpeg.split(",")[1];

  onStep("Lecture des étiquettes");
  let res = await callModel(b64, "haiku", "final");
  let model = "haiku";
  let usage = res.usage;
  const unsure = !res.prods || !res.prods.length || res.prods.length > 2 || res.prods.some(p => (Number(p.confiance) || 0) < 60);
  if (unsure) {
    onStep("Analyse approfondie");
    try {
      const second = await callModel(b64, "sonnet", "retry");
      if (second.prods && second.prods.length) { res = second; model = "sonnet"; }
      if (second.usage) usage = second.usage;
    } catch (e) { /* on garde la première lecture */ }
  }
  const prods = res.prods || [];
  onStep(prods.length > 1 ? "Découpe des produits" : "Recherche dans la base");
  const matches = prods.map(matchOne);
  const crops = await Promise.all(prods.map(p => crop(jpeg, p.bbox || p.position)));
  matches.forEach((m, i) => { if (crops[i]) m.cropImage = crops[i]; m.model = model; });
  return { matches, model, usage, photo: jpeg };
}

const FILIERE = f => (f === "EcoDDS" ? "E" : /cas sp|interdit|refus/i.test(f || "") ? "C" : "H");

export function matchOne(ai) {
  const name = (ai.nom || ai.texte_lu || "").trim();
  const brand = (ai.marque || "").trim();
  const ref = (ai.nom_referentiel || ai.nom || "").trim();
  const cat = (ai.categorie || "").trim();
  const display = name + (brand && brand.toLowerCase() !== name.toLowerCase() ? " (" + brand + ")" : "");
  const conf = Math.max(0, Math.min(100, Number(ai.confiance) || 0));
  const vol = ai.volume_estime || ai.volume || "";

  // 1. La mémoire de l'équipe connaît déjà cette marque.
  const memKey = (brand || name).toLowerCase();
  const mem = memory.brands && memory.brands[memKey];
  if (mem && mem.p) {
    const db = search(mem.p)[0];
    return { n: db && db.score >= 60 ? db.n : mem.p, f: mem.f || (db && db.f) || "H", x: mem.c || (db && db.x) || "", c: db ? db.c : "", s: db ? db.s : "", conf: Math.max(conf, 80), vol, aiData: ai, fromMemory: true, label: display };
  }

  // 2. Rapprochement avec la base à partir de la lecture IA.
  if (name.length < 2 && brand.length < 2) return { n: "Produit non identifié", f: "H", x: NON_ID, c: "Isolez le produit, ne le mélangez pas, portez les EPI.", conf: 0, vol, aiData: ai };
  const aiFlux = ai.filiere ? FILIERE(ai.filiere) : null;
  const results = searchMany([ref, name, brand, cat && ref ? ref + " " + cat : ""].filter(Boolean));
  const sameCat = cat ? results.filter(r => r.x === cat) : [];
  const db = sameCat.length && sameCat[0].score >= 35 ? sameCat[0] : results.length && results[0].score >= 55 ? results[0] : null;

  if (db) {
    const c = Math.min(Math.max(conf, 50), db.score >= 90 ? 100 : 92);
    return Object.assign({}, db, { conf: c, vol, aiData: ai, label: display, fluxCorrected: aiFlux && aiFlux !== db.f });
  }
  if (cat && aiFlux) {
    const fixed = fluxForCategory(cat);
    return { n: display || ref, f: fixed || aiFlux, x: cat, c: ai.consigne || "", s: "", conf: Math.min(conf, 65), vol, aiData: ai, notInBase: true };
  }
  return { n: "Produit non identifié", label: display, f: "H", x: NON_ID, c: "Isolez le produit, ne le mélangez pas, portez les EPI.", conf: 0, vol, aiData: ai };
}
