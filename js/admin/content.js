// Contenus : photos de référence des produits, fiches propres aux sites, mémoire IA des marques.

import { html, raw, icon, esc, toast, confirmDialog, debounce } from "../shared/ui.js";
import { get } from "../shared/api.js";
import { allProducts, destination, search } from "../shared/catalog.js";
import { openDrawer } from "./drawer.js";

const FLUX_LABEL = { E: "EcoDDS", H: "Hors EcoDDS", C: "Refusé", "": "Tous flux" };
const isPicto = i => i.source === "auto-catégorie" || /^__CAT__/.test(i.productName || "");

// ---------- photos ----------
let images = null; // [{ id, code, productName, url, imageFlux, isPrimary, source }]
let pFilter = "sans";
let pCat = "";
let pQuery = "";
let selected = null;

async function loadImages(adm) {
  try { images = (await adm.call("images-all")).items || []; }
  catch (e) {
    const d = await get("public-images").catch(() => ({ items: [] }));
    images = (d.items || []).map(i => Object.assign({ code: "" }, i));
  }
}
const photosOf = name => (images || []).filter(i => (i.productName || "").toLowerCase().trim() === name.toLowerCase().trim());
const realPhotosOf = name => photosOf(name).filter(i => !isPicto(i));

function compress(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("Image illisible"));
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

export async function productsView(main, adm) {
  if (!images) { main.innerHTML = `<div class="empty-state"><span class="spinner"></span></div>`; await loadImages(adm); }
  const prods = allProducts();
  const cats = Array.from(new Set(prods.map(p => p.x).filter(Boolean))).sort();
  const withPhoto = prods.filter(p => realPhotosOf(p.n).length).length;
  const q = pQuery.trim();
  let list = q.length >= 2 ? search(q, 200) : prods.slice().sort((a, b) => a.n.localeCompare(b.n, "fr"));
  list = list.filter(p => (!pCat || p.x === pCat) && (pFilter === "tous" || (pFilter === "sans" ? !realPhotosOf(p.n).length : realPhotosOf(p.n).length)));
  if (!selected || !prods.find(p => p.n === selected)) selected = list[0] ? list[0].n : null;
  const pct = prods.length ? Math.round(withPhoto / prods.length * 100) : 0;

  main.innerHTML = html`<div class="adm-head"><h1>Produits et photos</h1><span class="pill ${pct > 70 ? "ok" : "warn"}">${withPhoto} sur ${prods.length} avec une vraie photo (${pct} %)</span></div>
    <div class="toolbar">
      <input class="input" type="search" data-q placeholder="Rechercher un produit" value="${pQuery}">
      <select class="select" data-cat style="flex:0 1 240px"><option value="">Toutes catégories</option>${cats.map(c => html`<option ${raw(c === pCat ? "selected" : "")}>${c}</option>`)}</select>
      <div class="seg">${[["sans", "Sans photo"], ["avec", "Avec photo"], ["tous", "Tous"]].map(([k, l]) => html`<button data-f="${k}" aria-pressed="${k === pFilter}">${l}</button>`)}</div>
    </div>
    <div class="prod-grid">
      <div class="prod-list" data-list>${list.length ? list.slice(0, 300).map(p => {
        const ph = realPhotosOf(p.n)[0] || photosOf(p.n)[0];
        const d = destination(p);
        return html`<button class="prod-item" data-p="${p.n}" aria-current="${p.n === selected}">${ph ? html`<img src="${ph.url}" alt="" loading="lazy">` : html`<span class="ph">${icon("image")}</span>`}
          <span class="t"><b>${p.n}</b><span>${p.x}, ${realPhotosOf(p.n).length} photo${realPhotosOf(p.n).length > 1 ? "s" : ""}</span></span><span class="flux-tag ${d.tone}">${p.f === "E" ? "E" : p.f === "H" ? "H" : "!"}</span></button>`;
      }) : html`<p class="hint">Aucun produit.</p>`}</div>
      <div data-detail></div>
    </div>`.toString();

  const rerender = () => productsView(main, adm);
  const qi = main.querySelector("[data-q]");
  qi.addEventListener("input", debounce(() => { pQuery = qi.value; rerender().then(() => { const v = main.querySelector("[data-q]"); v.focus(); v.setSelectionRange(v.value.length, v.value.length); }); }, 200));
  main.querySelector("[data-cat]").addEventListener("change", e => { pCat = e.target.value; rerender(); });
  main.querySelector(".seg").addEventListener("click", e => { const b = e.target.closest("[data-f]"); if (b) { pFilter = b.dataset.f; rerender(); } });
  main.querySelector("[data-list]").addEventListener("click", e => {
    const b = e.target.closest("[data-p]");
    if (!b) return;
    selected = b.dataset.p;
    main.querySelectorAll("[data-p]").forEach(x => x.setAttribute("aria-current", String(x === b)));
    detail(main, adm, list, rerender);
  });
  detail(main, adm, list, rerender);
}

function detail(main, adm, list, rerender) {
  const box = main.querySelector("[data-detail]");
  const p = allProducts().find(x => x.n === selected);
  if (!p) { box.innerHTML = `<div class="panel hint">Sélectionnez un produit.</div>`; return; }
  const photos = photosOf(p.n);
  const d = destination(p);
  const gq = encodeURIComponent(p.n + " produit étiquette");
  box.innerHTML = html`<div class="panel" style="display:grid;gap:14px;position:sticky;top:12px">
    <div><b style="font-size:19px">${p.n}</b><div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><span class="flux-tag ${d.tone}">${d.fluxLabel}</span><span class="pill">${p.x}</span>${p.s ? html`<span class="pill">${p.s}</span>` : ""}</div></div>
    ${photos.length ? html`<div class="photo-grid">${photos.map(i => html`<div class="photo ${i.isPrimary ? "primary" : ""}" data-id="${i.id || ""}" data-code="${i.code || ""}">
      <img src="${i.url}" alt="" loading="lazy">
      <div class="meta"><span>${FLUX_LABEL[i.imageFlux || ""] || i.imageFlux}</span><span>${isPicto(i) ? "picto" : i.code === "_GLOBAL" ? "global" : i.code || ""}</span></div>
      ${i.id && i.code ? html`<div class="ops"><button data-op="primary" title="Photo principale">${i.isPrimary ? "★" : "☆"}</button><button data-op="flux" title="Changer le flux">Flux</button><button data-op="del" title="Supprimer">✕</button></div>` : ""}
    </div>`)}</div>` : html`<p class="hint">Aucune photo pour ce produit.</p>`}
    <div class="field"><span>Ajouter une photo pour</span><div class="seg" data-flux>${[["", "Tous flux"], ["E", "EcoDDS"], ["H", "Hors EcoDDS"]].map(([k, l], i) => html`<button type="button" data-v="${k}" aria-pressed="${i === 0}">${l}</button>`)}</div></div>
    <label class="dropzone" data-drop>${icon("upload")}<b>Déposer ou choisir une image</b><span class="hint">JPG, PNG ou WebP. Elle est réduite à 1280 px avant l'envoi.</span><input type="file" accept="image/*" hidden data-file></label>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.google.com/search?tbm=isch&q=${gq}">${icon("search")}Chercher sur Google Images</a>
      <button class="btn btn-ghost btn-sm" data-next>Produit suivant sans photo</button>
    </div>
  </div>`.toString();

  let flux = "";
  box.querySelector("[data-flux]").addEventListener("click", e => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    flux = b.dataset.v;
    box.querySelectorAll("[data-flux] [data-v]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  });
  const upload = async file => {
    if (!file || !/^image\//.test(file.type)) return toast("Choisissez une image", { error: true });
    const drop = box.querySelector("[data-drop] b");
    drop.textContent = "Envoi…";
    try {
      const data = await compress(file);
      const res = await adm.images("save", { code: "_GLOBAL", agent: "admin", imageData: data.split(",")[1], imageMime: "image/jpeg", item: { productName: p.n, alt: p.n, source: "admin", isPrimary: !realPhotosOf(p.n).length, order: photos.length, imageFlux: flux } });
      if (res.item) images.push(Object.assign({ code: "_GLOBAL" }, res.item));
      toast("Photo ajoutée");
      rerender();
    } catch (e) { drop.textContent = "Déposer ou choisir une image"; adm.fail(e); }
  };
  const dz = box.querySelector("[data-drop]");
  box.querySelector("[data-file]").addEventListener("change", e => upload(e.target.files[0]));
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("over"); upload(e.dataTransfer.files[0]); });

  box.querySelector("[data-next]").addEventListener("click", () => {
    const idx = list.findIndex(x => x.n === p.n);
    const next = list.slice(idx + 1).find(x => !realPhotosOf(x.n).length) || list.find(x => !realPhotosOf(x.n).length && x.n !== p.n);
    if (!next) return toast("Tous les produits de la liste ont une photo");
    selected = next.n;
    rerender();
  });

  box.querySelector(".photo-grid")?.addEventListener("click", async e => {
    const op = e.target.closest("[data-op]");
    if (!op) return;
    const card = op.closest("[data-id]");
    const { id, code } = card.dataset;
    const img = images.find(i => i.id === id && i.code === code);
    try {
      if (op.dataset.op === "del") {
        if (!(await confirmDialog({ title: "Supprimer cette photo ?", ok: "Supprimer", danger: true }))) return;
        await adm.images("delete", { code, id });
        images = images.filter(i => !(i.id === id && i.code === code));
      } else if (op.dataset.op === "primary") {
        await adm.images("set-primary", { code, id });
        images.forEach(i => { if (i.productName === img.productName && i.code === code) i.isPrimary = i.id === id; });
      } else if (op.dataset.op === "flux") {
        const next = { "": "E", E: "H", H: "" }[img.imageFlux || ""];
        await adm.images("set-flux", { code, id, imageFlux: next });
        img.imageFlux = next;
      }
      rerender();
    } catch (err) { adm.fail(err); }
  });
}

// ---------- fiches propres aux sites ----------
let catData = null;
export async function catalogView(main, adm) {
  if (!catData) { main.innerHTML = `<div class="empty-state"><span class="spinner"></span></div>`; catData = await adm.call("catalog-admin-list"); }
  const { sites = [], items = [] } = catData;
  main.innerHTML = html`<div class="adm-head"><h1>Fiches des sites</h1><button class="btn btn-primary" data-new>${icon("plus")}Nouvelle fiche</button></div>
    <p class="hint" style="margin:-8px 0 14px">Produits ajoutés pour un site précis (par son responsable ou par vous). Ils complètent la base commune dans la recherche de ce site.</p>
    <div class="panel tbl-wrap">${items.length ? html`<table class="tbl"><thead><tr><th>Produit</th><th>Site</th><th>Flux</th><th>Bac</th><th>Seuil</th><th>Par</th><th></th></tr></thead><tbody>
      ${items.map((it, i) => html`<tr class="click" data-i="${i}"><td><b>${it.n}</b>${it.y && it.y.length ? html`<span class="sub">${it.y.join(", ")}</span>` : ""}</td><td>${it.site}</td><td><span class="flux-tag ${destination(it).tone}">${destination(it).fluxLabel}</span></td><td>${it.x}</td><td>${it.s || ""}</td><td class="sub">${it.updatedBy || ""}</td><td><button class="btn btn-ghost btn-sm">Modifier</button></td></tr>`)}
    </tbody></table>` : html`<div class="empty-state">${icon("box")}<b>Aucune fiche propre à un site</b><span>Les fiches complètent la base commune pour une déchèterie précise.</span><button class="btn btn-primary" data-new>${icon("plus")}Nouvelle fiche</button></div>`}</div>`.toString();
  main.querySelectorAll("[data-new]").forEach(b => b.addEventListener("click", () => editCatalog(main, adm, null, sites)));
  main.querySelector(".panel").addEventListener("click", e => { const r = e.target.closest("[data-i]"); if (r) editCatalog(main, adm, items[+r.dataset.i], sites); });
}

function editCatalog(main, adm, it, sites) {
  const v = it || { code: sites[0] ? sites[0].code : "", n: "", f: "E", x: "", s: "", c: "", y: [] };
  openDrawer({
    title: it ? "Modifier la fiche" : "Nouvelle fiche",
    body: html`<form data-f style="display:grid;gap:12px">
      <label class="field"><span>Site</span><select class="select" name="code" ${raw(it ? "disabled" : "")}>${sites.map(s => html`<option value="${s.code}" ${raw(s.code === v.code ? "selected" : "")}>${s.site} (${s.code})</option>`)}</select></label>
      <label class="field"><span>Nom du produit</span><input class="input" name="n" value="${v.n}" required></label>
      <div class="grid2"><label class="field"><span>Flux</span><select class="select" name="f">${[["E", "EcoDDS"], ["H", "Hors EcoDDS"], ["C", "Refusé / à isoler"]].map(([k, l]) => html`<option value="${k}" ${raw(v.f === k ? "selected" : "")}>${l}</option>`)}</select></label>
      <label class="field"><span>Bac (catégorie)</span><input class="input" name="x" value="${v.x}" required></label></div>
      <div class="grid2"><label class="field"><span>Seuil</span><input class="input" name="s" value="${v.s}" placeholder="≤ 5 litres"></label>
      <label class="field"><span>Autres noms (virgules)</span><input class="input" name="y" value="${(v.y || []).join(", ")}"></label></div>
      <label class="field"><span>Consigne</span><input class="input" name="c" value="${v.c}"></label>
    </form>`.toString(),
    foot: `${it ? '<button class="btn btn-danger" data-del>Supprimer</button>' : ""}<button class="btn btn-primary" data-save style="margin-left:auto">Enregistrer</button>`,
    onMount(el, close) {
      const f = el.querySelector("[data-f]");
      el.querySelector("[data-save]").addEventListener("click", async () => {
        if (!f.reportValidity()) return;
        const fd = Object.fromEntries(new FormData(f).entries());
        try { await adm.call("catalog-admin-save", { code: it ? it.code : fd.code, item: Object.assign(fd, { id: it ? it.id : "" }) }); catData = null; close(); toast("Fiche enregistrée"); catalogView(main, adm); } catch (e) { adm.fail(e); }
      });
      el.querySelector("[data-del]")?.addEventListener("click", async () => {
        if (!(await confirmDialog({ title: "Supprimer la fiche ?", ok: "Supprimer", danger: true }))) return;
        try { await adm.call("catalog-admin-delete", { code: it.code, id: it.id }); catData = null; close(); toast("Fiche supprimée"); catalogView(main, adm); } catch (e) { adm.fail(e); }
      });
    }
  });
}

// ---------- mémoire IA ----------
let memData = null;
let mQuery = "";
export async function memoryView(main, adm) {
  if (!memData) { main.innerHTML = `<div class="empty-state"><span class="spinner"></span></div>`; memData = await adm.call("knowledge-admin-list"); }
  const q = mQuery.toLowerCase();
  const items = (memData.items || []).filter(i => !q || [i.brand, i.p, i.c, i.site].join(" ").toLowerCase().includes(q));
  main.innerHTML = html`<div class="adm-head"><h1>Mémoire des équipes</h1><input class="input" type="search" data-q placeholder="Marque, produit, site" value="${mQuery}"></div>
    <p class="hint" style="margin:-8px 0 14px">Associations marque → produit apprises quand les agents valident ou corrigent une photo. Ouvrez une ligne pour corriger, supprimer, ou créer une fiche du site.</p>
    <div class="panel tbl-wrap">${items.length ? html`<table class="tbl"><thead><tr><th>Marque lue</th><th>Produit associé</th><th>Bac</th><th>Site</th><th>Vu</th><th>Par</th><th></th></tr></thead><tbody>
      ${items.map((it, i) => html`<tr class="click" data-i="${i}"><td><b>${it.brand}</b></td><td>${it.p || "?"}</td><td><span class="flux-tag ${destination({ f: it.f, x: it.c }).tone}">${it.c || "?"}</span></td><td>${it.site}</td><td>${it.n}×</td><td class="sub">${(it.by || []).join(", ")}</td><td><button class="btn btn-ghost btn-sm">Modifier</button></td></tr>`)}
    </tbody></table>` : html`<div class="empty-state">${icon("brain")}<b>Aucune marque apprise</b></div>`}</div>`.toString();
  const qi = main.querySelector("[data-q]");
  qi.addEventListener("input", debounce(() => { mQuery = qi.value; memoryView(main, adm).then(() => { const v = main.querySelector("[data-q]"); v.focus(); v.setSelectionRange(v.value.length, v.value.length); }); }, 200));
  main.querySelector(".panel").addEventListener("click", e => { const r = e.target.closest("[data-i]"); if (r) editMemory(main, adm, items[+r.dataset.i]); });
}

function editMemory(main, adm, it) {
  openDrawer({
    title: "Marque « " + it.brand + " »", sub: it.site,
    body: html`<form data-f style="display:grid;gap:12px">
      <label class="field"><span>Marque lue sur l'étiquette</span><input class="input" name="brand" value="${it.brand}" required></label>
      <label class="field"><span>Produit de la base</span><input class="input" name="product" value="${it.p}" list="prods"></label>
      <datalist id="prods">${allProducts().slice(0, 600).map(p => html`<option value="${p.n}">`)}</datalist>
      <div class="grid2"><label class="field"><span>Flux</span><select class="select" name="flux">${[["E", "EcoDDS"], ["H", "Hors EcoDDS"], ["C", "Refusé"]].map(([k, l]) => html`<option value="${k}" ${raw(it.f === k ? "selected" : "")}>${l}</option>`)}</select></label>
      <label class="field"><span>Bac</span><input class="input" name="category" value="${it.c}"></label></div>
    </form>`.toString(),
    foot: `<button class="btn btn-danger" data-del>Supprimer</button><button class="btn btn-ghost" data-promote>Créer une fiche du site</button><button class="btn btn-primary" data-save style="margin-left:auto">Enregistrer</button>`,
    onMount(el, close) {
      const f = el.querySelector("[data-f]");
      const done = msg => { memData = null; close(); toast(msg); memoryView(main, adm); };
      el.querySelector("[data-save]").addEventListener("click", async () => {
        const fd = Object.fromEntries(new FormData(f).entries());
        try { await adm.call("knowledge-admin-save", { code: it.code, originalBrand: it.brand, item: fd }); done("Association mise à jour"); } catch (e) { adm.fail(e); }
      });
      el.querySelector("[data-del]").addEventListener("click", async () => {
        if (!(await confirmDialog({ title: "Supprimer l'association ?", ok: "Supprimer", danger: true }))) return;
        try { await adm.call("knowledge-admin-delete", { code: it.code, brand: it.brand }); done("Association supprimée"); } catch (e) { adm.fail(e); }
      });
      el.querySelector("[data-promote]").addEventListener("click", async () => {
        try { await adm.call("knowledge-admin-promote", { code: it.code, brand: it.brand }); toast("Fiche créée pour " + it.site); } catch (e) { adm.fail(e); }
      });
    }
  });
}
