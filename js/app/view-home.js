// Accueil : recherche instantanée, dictée, scan photo, derniers produits.

import { html, raw, icon, debounce, toast } from "../shared/ui.js";
import { search, isClearHit, findByName, NON_ID } from "../shared/catalog.js";
import { history, clearHistory, hasAi, isDemo, sess } from "./store.js";
import { homeBar, productRow } from "./common.js";

let results = [];

function listHtml(app) {
  const q = app.state.query.trim();
  if (q.length >= 2) {
    results = search(q, 12);
    if (!results.length) {
      return html`<div class="empty-state">${icon("search")}<b>Aucun produit trouvé pour « ${q} »</b>
        <span>Vérifiez l'orthographe, essayez la marque, ou photographiez l'étiquette.</span>
        <div class="actions">
          <button class="btn btn-primary btn-lg" data-scan>${icon("camera")}Scanner l'étiquette</button>
          <button class="btn btn-ghost" data-nonid>Classer en produit non identifié</button>
        </div></div>`;
    }
    return html`<div class="section-title"><h2>${results.length === 12 ? "Meilleurs résultats" : results.length + " résultat" + (results.length > 1 ? "s" : "")}</h2></div>
      <div class="rows">${results.map((r, i) => productRow(r, `data-r="${i}"`))}</div>`;
  }
  if (!history.length) {
    return html`<div class="empty-state">${icon("search")}<b>Que tenez-vous en main ?</b>
      <span>Tapez le nom du produit ou de la marque, dictez-le, ou scannez l'étiquette.</span></div>`;
  }
  return html`<div class="section-title"><h2>Derniers produits</h2><button class="btn btn-quiet" data-clear>Effacer</button></div>
    <div class="rows">${history.map((h, i) => productRow({ n: h.nm, f: h.f, x: h.x, s: h.s, vol: h.vol, overSeuil: h.overSeuil }, `data-h="${i}"`))}</div>`;
}

export const homeView = {
  tab: "home",
  render(app) {
    return html`${homeBar()}
      <div class="searchbox"><div class="search-row wrap">
        <label class="search-field"><span class="sr-only">Rechercher un produit</span>${icon("search")}
          <input type="search" data-q placeholder="Produit ou marque" value="${app.state.query}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
          <button class="mini" data-voice aria-label="Dicter le nom">${icon("mic")}</button>
        </label>
        <button class="scan-btn" data-scan aria-label="Scanner l'étiquette">${icon("camera")}</button>
      </div></div>
      <main class="wrap pad" data-list>${listHtml(app)}</main>`.toString();
  },

  mount(el, app) {
    const input = el.querySelector("[data-q]");
    const list = el.querySelector("[data-list]");
    const redraw = () => { list.innerHTML = listHtml(app).toString(); };
    input.addEventListener("input", debounce(() => { app.state.query = input.value; redraw(); }, 90));
    input.addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      app.state.query = input.value;
      const res = search(input.value, 12);
      if (res.length && isClearHit(res)) openProduct(app, res[0]);
      else { redraw(); input.blur(); }
    });
    if (app.state.query && !matchMedia("(pointer:coarse)").matches) input.focus();

    el.addEventListener("click", e => {
      const t = e.target;
      if (t.closest("[data-scan]")) return startScan(app);
      if (t.closest("[data-voice]")) return dictate(t.closest("[data-voice]"), input, app, redraw);
      if (t.closest("[data-clear]")) { clearHistory(); return redraw(); }
      if (t.closest("[data-nonid]")) {
        return openProduct(app, { n: app.state.query.trim() || "Produit non identifié", f: "H", x: NON_ID, c: "Porter les EPI. Ne pas mélanger.", s: "" });
      }
      const r = t.closest("[data-r]");
      if (r) return openProduct(app, results[+r.dataset.r]);
      const h = t.closest("[data-h]");
      if (h) {
        const item = history[+h.dataset.h];
        const base = findByName(item.nm) || { n: item.nm, x: item.x, s: item.s, c: "" };
        // f reste le flux du produit ; overSeuil indique un contenant au-delà du seuil EcoDDS.
        app.state.result = Object.assign({}, base, { f: item.f || base.f, overSeuil: item.overSeuil, vol: item.vol, fromHistory: true, validated: true, seuilAnswered: true });
        app.go("result");
      }
    });
  }
};

export function openProduct(app, p) {
  app.state.result = Object.assign({}, p, { source: "search", conf: 100 });
  app.go("result");
}

export function startScan(app) {
  if (isDemo()) return toast("Le scan photo est disponible avec un code d'accès.", { ms: 3600 });
  if (!hasAi()) {
    return toast(sess.monthlyLimit > 0 ? "Quota de scans du mois atteint. Il repart le 1er du mois." : "Le scan photo n'est pas inclus dans cet accès.", { error: true, ms: 4200 });
  }
  app.go("scan");
}

function dictate(btn, input, app, redraw) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast("La dictée n'est pas disponible sur ce navigateur.");
  const r = new SR();
  r.lang = "fr-FR";
  r.interimResults = true;
  r.maxAlternatives = 1;
  btn.classList.add("listening");
  btn.setAttribute("aria-label", "Écoute en cours");
  r.onresult = e => {
    const t = Array.from(e.results).map(x => x[0].transcript).join(" ");
    input.value = t;
    app.state.query = t;
    redraw();
  };
  r.onerror = ev => { if (ev.error === "not-allowed") toast("Autorisez le micro pour dicter."); };
  r.onend = () => { btn.classList.remove("listening"); btn.setAttribute("aria-label", "Dicter le nom"); };
  r.start();
}
