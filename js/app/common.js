// Éléments d'interface communs aux écrans de l'appli agent.

import { html, raw, icon, esc, openSheet, debounce } from "../shared/ui.js";
import { destination, search, NON_ID, allProducts, seuilText, norm } from "../shared/catalog.js";
import { thumbFor } from "./images.js";
import { sess, quota, isDemo } from "./store.js";

export function topbar({ title, back = false, right = "" } = {}) {
  return html`<header class="topbar"><div class="topbar-in wrap">
    ${back ? html`<button class="btn btn-quiet btn-icon back" data-back aria-label="Retour">${icon("back")}</button>` : ""}
    <h1>${title}</h1>${raw(right)}
  </div></header>`;
}

export function quotaChip() {
  if (isDemo()) return html`<span class="quota-chip none">Démo</span>`;
  const q = quota();
  if (!q.total) return html`<span class="quota-chip none" title="Scan photo non inclus">Sans scan</span>`;
  const low = q.left <= Math.max(3, Math.round(q.total * 0.1));
  return html`<span class="quota-chip ${low ? "low" : ""}" title="Scans photo restants ${q.kind === "mois" ? "ce mois-ci" : "dans l'essai"}">${icon("camera")}${q.left}</span>`;
}

export function homeBar() {
  return html`<header class="topbar"><div class="topbar-in wrap">
    <div class="site-id"><img src="./assets/symbol-128.png" alt="" width="34" height="34">
      <div style="min-width:0"><b>${sess.site || "TriDDS"}</b><span>${sess.agent || ""}</span></div></div>
    ${quotaChip()}
  </div></header>`;
}

export const toneOf = r => (destination(r) || { tone: "hors" }).tone;

export function thumb(r) {
  const flux = r.overSeuil ? "H" : r.f;
  const url = r.cropImage || thumbFor(r.n || r.nm, flux, r.x);
  return url
    ? html`<img class="thumb" src="${url}" alt="" loading="lazy" decoding="async">`
    : html`<span class="thumb empty">${icon("box")}</span>`;
}

// Ligne produit : nom à gauche, bac en gros à droite, bande de couleur du flux.
export function productRow(r, attrs = "") {
  const d = destination(r);
  const read = r.label && !norm(r.label).includes(norm(r.n)) ? "lu : " + r.label : "";
  const parts = [];
  if (r.source === "scan") {
    if (r.validated) parts.push("Validé");
    else if ((r.conf || 0) < 70) parts.push("À vérifier");
    if (read) parts.push(read);
  } else {
    if (r.overSeuil) parts.push("Au-delà du seuil EcoDDS");
    else if (r.s && r.f === "E") parts.push("EcoDDS jusqu'à " + seuilText(r.s));
  }
  let sub = parts.join(", ");
  sub = sub.charAt(0).toUpperCase() + sub.slice(1);
  const warn = r.source === "scan" && !r.validated && (r.conf || 0) < 70;
  return html`<button class="row ${d.tone}" ${raw(attrs)}>
    ${thumb(r)}
    <span class="row-main"><b>${r.n}</b>${sub ? html`<span ${raw(warn ? 'style="color:var(--hors-text);font-weight:600"' : "")}>${sub}</span>` : ""}</span>
    <span class="row-dest"><b>${d.bac}</b><span>${d.fluxLabel}</span></span>
  </button>`;
}

// Feuille « Corriger » : chercher le bon produit dans la base.
export function pickProduct({ title = "Corriger le produit", sub = "", initial = "" } = {}) {
  return new Promise(resolve => {
    let picked = null;
    let results = [];
    openSheet({
      title, sub,
      body: html`<label class="search-field" style="border-radius:14px">${icon("search")}
        <input type="search" data-q placeholder="Nom du bon produit" autocomplete="off" enterkeyhint="search" value="${initial}"></label>
        <div class="rows" data-list></div>
        <button class="btn btn-ghost" data-nonid>Classer en « Produit non identifié »</button>`.toString(),
      onMount(el, close) {
        const input = el.querySelector("[data-q]");
        const list = el.querySelector("[data-list]");
        const draw = () => {
          const q = input.value.trim();
          results = q.length >= 2 ? search(q, 12) : [];
          list.innerHTML = q.length < 2
            ? `<p class="hint">Tapez au moins 2 lettres.</p>`
            : results.length
              ? results.map((r, i) => productRow(r, `data-i="${i}"`)).join("")
              : `<p class="hint">Aucun produit ne correspond à « ${esc(q)} ».</p>`;
        };
        input.addEventListener("input", debounce(draw, 120));
        list.addEventListener("click", e => {
          const b = e.target.closest("[data-i]");
          if (!b) return;
          picked = results[+b.dataset.i];
          close();
        });
        el.querySelector("[data-nonid]").addEventListener("click", () => {
          picked = { n: "Produit non identifié", f: "H", x: NON_ID, c: "Porter les EPI. Ne pas mélanger.", s: "" };
          close();
        });
        if (initial) draw();
        setTimeout(() => input.focus(), 50);
      },
      onClose() { resolve(picked); }
    });
  });
}

export function lightbox(urls, start = 0) {
  let i = start;
  const el = document.createElement("div");
  el.className = "lightbox";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Photo agrandie");
  const draw = () => {
    el.innerHTML = `<img src="${esc(urls[i])}" alt="">
      <div class="row-btns">${urls.length > 1 ? `<button class="btn" data-p>Précédente</button><button class="btn" data-n>Suivante</button>` : ""}<button class="btn" data-x>Fermer</button></div>`;
  };
  const close = () => { el.remove(); document.removeEventListener("keydown", key); };
  const key = e => { if (e.key === "Escape") close(); if (e.key === "ArrowRight") { i = (i + 1) % urls.length; draw(); } if (e.key === "ArrowLeft") { i = (i - 1 + urls.length) % urls.length; draw(); } };
  el.addEventListener("click", e => {
    if (e.target.closest("[data-x]") || e.target === el) return close();
    if (e.target.closest("[data-n]")) { i = (i + 1) % urls.length; draw(); }
    if (e.target.closest("[data-p]")) { i = (i - 1 + urls.length) % urls.length; draw(); }
  });
  document.addEventListener("keydown", key);
  draw();
  document.body.appendChild(el);
}

export const productTotal = () => allProducts().length;
