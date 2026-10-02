// Accueil : recherche instantanée, dictée, scan photo, derniers produits.

import { html, raw, icon, debounce, toast } from "../shared/ui.js";
import { search, isClearHit, findByName, NON_ID } from "../shared/catalog.js";
import { siteHistory, clearHistory, hasAi, isDemo, sess } from "./store.js";
import { homeBar, productRow } from "./common.js";

let results = [];

function listHtml(app) {
  const q = app.state.query.trim();
  if (q.length >= 2) {
    results = search(q, 12);
    if (!results.length) {
      return html`<div class="empty-state">${icon("search")}<b>Aucun produit trouvé pour « ${q} »</b>
        <span>Vérifiez l'orthographe, essayez la marque, ou prenez le produit en photo.</span>
        <div class="actions">
          <button class="btn btn-primary btn-lg" data-scan>${icon("camera")}Prendre en photo</button>
          <button class="btn btn-quiet" data-nonid>Classer en « produit non identifié »</button>
        </div></div>`;
    }
    return html`<div class="section-title"><h2>${results.length === 12 ? "Meilleurs résultats" : results.length + " résultat" + (results.length > 1 ? "s" : "")}</h2></div>
      <div class="rows">${results.map((r, i) => productRow(r, `data-r="${i}"`))}</div>`;
  }
  const history = siteHistory();
  if (!history.length) {
    return html`<div class="empty-state">${icon("search")}<b>Que tenez-vous en main ?</b>
      <span>Tapez le nom du produit ou de la marque, dictez-le, ou prenez-le en photo. Un produit, ou plusieurs à la fois.</span></div>`;
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
          <button class="mini" data-voice aria-label="Maintenir pour dicter">${icon("mic")}</button>
        </label>
        <button class="scan-btn" data-scan aria-label="Prendre en photo">${icon("camera")}</button>
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
    bindVoice(el.querySelector("[data-voice]"), input, app, redraw);

    el.addEventListener("click", e => {
      const t = e.target;
      if (t.closest("[data-scan]")) return startScan(app);
      if (t.closest("[data-clear]")) { clearHistory(); return redraw(); }
      if (t.closest("[data-nonid]")) {
        return openProduct(app, { n: "Produit non identifié", label: app.state.query.trim(), f: "H", x: NON_ID, c: "Isolez le produit, ne le mélangez pas, portez les EPI.", s: "" });
      }
      const r = t.closest("[data-r]");
      if (r) return openProduct(app, results[+r.dataset.r]);
      const h = t.closest("[data-h]");
      if (h) {
        const item = siteHistory()[+h.dataset.h];
        const base = findByName(item.nm) || { n: item.nm, x: item.x, s: item.s, c: "" };
        // f reste le flux du produit ; overSeuil indique un contenant au-delà du seuil EcoDDS.
        app.state.result = Object.assign({}, base, { f: item.f || base.f, overSeuil: item.overSeuil, vol: item.vol, source: "search", fromHistory: true, validated: true, _recorded: true, seuilAnswered: true });
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
  if (isDemo()) return toast("L'analyse photo est disponible avec un code d'accès.", { ms: 3600 });
  if (!hasAi()) {
    return toast(sess.trialExpired ? "Mois d'essai terminé. La recherche reste disponible ; contactez TriDDS pour continuer avec l'analyse photo." : sess.monthlyLimit > 0 ? "Quota de photos du mois atteint. Il repart le 1er du mois." : "L'analyse photo n'est pas incluse dans cet accès.", { error: true, ms: 4500 });
  }
  app.go("scan");
}

// Dictée « appuyer pour parler » : on maintient le bouton enfoncé le temps de parler, on relâche pour chercher.
// Un appui bref (moins de 0,4 s) laisse l'écoute ouverte jusqu'à la fin de la phrase.
let rec = null;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const MSGS = {
  "not-allowed": "Autorisez le micro pour dicter (réglages du navigateur).",
  "service-not-allowed": "Autorisez le micro pour dicter (réglages du navigateur).",
  "audio-capture": "Aucun micro détecté.",
  network: "La dictée a besoin du réseau.",
  "no-speech": "Rien entendu. Maintenez le bouton et parlez près du téléphone."
};
if (SR) document.addEventListener("visibilitychange", () => { if (document.hidden && rec && rec.requestStop) rec.requestStop(); });

// Sur Android, Chrome ne déclenche pas toujours « onend » après stop(), et refuse un start()
// lancé juste après l'abandon de l'écoute précédente : on sécurise chaque étape par un délai
// de garde, et on repart systématiquement d'une nouvelle écoute à chaque appui.
function bindVoice(btn, input, app, redraw) {
  if (!SR) {
    btn.addEventListener("click", () => toast("La dictée n'est pas disponible sur ce navigateur. Sur iPhone, utilisez le micro du clavier.", { ms: 4500 }));
    return;
  }
  let pressedAt = 0;
  const setListening = on => {
    btn.classList.toggle("listening", on);
    btn.setAttribute("aria-label", on ? "Écoute en cours" : "Maintenir pour dicter");
  };
  const begin = () => {
    if (navigator.onLine === false) return toast("La dictée a besoin du réseau.", { error: true });
    const r = new SR();
    rec = r;
    r.lang = "fr-FR";
    r.continuous = false; // le mode continu est instable sur Android : une phrase par appui
    r.interimResults = true;
    r.maxAlternatives = 1;
    let finalText = "";
    let heard = false;
    let finished = false;
    let stopGuard = null;
    const guard = setTimeout(() => r.requestStop(), 12000);
    const apply = text => { input.value = text; app.state.query = text; redraw(); };
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      clearTimeout(stopGuard);
      if (rec === r) rec = null;
      setListening(false);
      if (!heard) return;
      const q = (finalText || input.value).trim();
      if (!q) return;
      apply(q);
      const res = search(q, 12);
      if (res.length && isClearHit(res)) openProduct(app, res[0]);
    };
    // Demande l'arrêt ; si le navigateur ne confirme pas la fin, on conclut nous-mêmes.
    r.requestStop = () => {
      if (finished) return;
      try { r.stop(); } catch (e) { /* ignore */ }
      clearTimeout(stopGuard);
      stopGuard = setTimeout(() => { finish(); try { r.abort(); } catch (e) { /* ignore */ } }, 1500);
    };
    // Détache cette écoute (remplacée par une nouvelle) sans toucher à l'affichage.
    r.detach = () => { finished = true; clearTimeout(guard); clearTimeout(stopGuard); r.onresult = null; };
    setListening(true);
    input.blur();
    r.onresult = e => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += (finalText ? " " : "") + t.trim(); else interim += t;
      }
      heard = true;
      apply((finalText + " " + interim).trim());
    };
    r.onerror = ev => {
      const wasHeard = heard;
      if (ev.error === "aborted") { finish(); return; }
      if (ev.error === "no-speech" && wasHeard) { finish(); return; }
      heard = false;
      finish();
      toast(MSGS[ev.error] || "Dictée interrompue (" + ev.error + ").", { error: ev.error !== "no-speech", ms: 4000 });
    };
    r.onend = finish;
    const launch = attempt => {
      try { r.start(); } catch (e) {
        // Le navigateur n'a pas encore libéré le micro : on réessaie une fois, puis on abandonne.
        if (attempt < 2) return setTimeout(() => { if (!finished) launch(attempt + 1); }, 350);
        heard = false; finish(); toast("Impossible de démarrer la dictée. Réessayez.", { error: true });
      }
    };
    launch(0);
  };
  const start = () => {
    const old = rec;
    rec = null;
    if (!old) return begin();
    // On attend la fin réelle de l'écoute précédente avant d'en ouvrir une autre.
    let started = false;
    const go = () => { if (started) return; started = true; begin(); };
    old.detach();
    old.onerror = go;
    old.onend = go;
    try { old.abort(); } catch (e) { /* ignore */ }
    setTimeout(go, 300);
  };
  const release = () => {
    if (!rec) return;
    if (Date.now() - pressedAt < 400) return; // appui bref : on laisse la phrase se terminer seule
    rec.requestStop();
  };
  btn.addEventListener("pointerdown", e => {
    e.preventDefault();
    pressedAt = Date.now();
    if (navigator.vibrate) navigator.vibrate(15);
    start();
  });
  ["pointerup", "pointercancel"].forEach(ev => btn.addEventListener(ev, release));
  btn.addEventListener("contextmenu", e => e.preventDefault());
  btn.addEventListener("click", e => e.preventDefault());
}
