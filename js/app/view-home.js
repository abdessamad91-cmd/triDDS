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
          <button class="mini clear" data-clear-q aria-label="Effacer la recherche" ${app.state.query ? "" : "hidden"}>${icon("close")}</button>
          <button class="mini" data-voice aria-label="Maintenir pour dicter">${icon("mic")}</button>
        </label>
        <button class="scan-btn" data-scan aria-label="Prendre en photo">${icon("camera")}</button>
      </div></div>
      <main class="wrap pad" data-list>${listHtml(app)}</main>`.toString();
  },

  mount(el, app) {
    const input = el.querySelector("[data-q]");
    const list = el.querySelector("[data-list]");
    const clearBtn = el.querySelector("[data-clear-q]");
    const redraw = () => { clearBtn.hidden = !input.value; list.innerHTML = listHtml(app).toString(); };
    clearBtn.addEventListener("click", () => { input.value = ""; app.state.query = ""; redraw(); input.focus(); });
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
// Un appui bref (moins de 0,4 s) laisse la phrase se terminer seule.
//
// Chrome Android est capricieux : il ne signale pas toujours la fin de l'écoute, libère lentement le micro
// entre deux écoutes (la suivante se termine alors aussitôt, sans erreur), et refuse un start() trop tôt.
// On réutilise donc un seul moteur, on borne chaque étape par un délai de garde, et on relance
// automatiquement une écoute qui s'est terminée sans rien entendre juste après son démarrage.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let engine = null;   // moteur unique, réutilisé d'un appui à l'autre
let session = null;  // écoute en cours
const MSGS = {
  "not-allowed": "Autorisez le micro pour dicter (réglages du navigateur).",
  "service-not-allowed": "Autorisez le micro pour dicter (réglages du navigateur).",
  "audio-capture": "Aucun micro détecté.",
  network: "La dictée a besoin du réseau.",
  "no-speech": "Rien entendu. Maintenez le bouton et parlez près du téléphone."
};
if (SR) document.addEventListener("visibilitychange", () => { if (document.hidden && session) session.requestStop(); });

function getEngine() {
  if (engine) return engine;
  engine = new SR();
  engine.lang = "fr-FR";
  engine.continuous = false; // une phrase par appui : le mode continu est instable sur Android
  engine.interimResults = true;
  engine.maxAlternatives = 1;
  return engine;
}

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
  const apply = text => { input.value = text; app.state.query = text; redraw(); };

  const open = attempt => {
    if (navigator.onLine === false) { setListening(false); return toast("La dictée a besoin du réseau.", { error: true }); }
    const r = getEngine();
    const s = { finalText: "", heard: false, finished: false, stopAsked: false, startedAt: Date.now(), attempt, timers: [] };
    session = s;
    const later = (fn, ms) => s.timers.push(setTimeout(fn, ms));
    const finish = () => {
      if (s.finished) return;
      s.finished = true;
      s.timers.forEach(clearTimeout);
      if (session === s) session = null;
      setListening(false);
      if (!s.heard) return;
      const q = (s.finalText || input.value).trim();
      if (!q) return;
      apply(q);
      const res = search(q, 12);
      if (res.length && isClearHit(res)) openProduct(app, res[0]);
    };
    // Nouvel essai (micro pas encore libéré) : on repart proprement, au besoin avec un moteur neuf.
    const retry = () => {
      s.finished = true;
      s.timers.forEach(clearTimeout);
      try { r.abort(); } catch (e) { /* ignore */ }
      if (attempt >= 1) engine = null;
      later(() => { if (session === s) open(attempt + 1); }, 450);
    };
    const fail = msg => { s.heard = false; finish(); toast(msg, { error: true, ms: 4000 }); };
    s.requestStop = () => {
      if (s.finished || s.stopAsked) return;
      s.stopAsked = true;
      try { r.stop(); } catch (e) { /* ignore */ }
      // Si le navigateur ne confirme pas la fin, on conclut nous-mêmes.
      later(() => { finish(); try { r.abort(); } catch (e) { /* ignore */ } }, 1500);
    };
    s.detach = () => { s.finished = true; s.timers.forEach(clearTimeout); };
    later(() => s.requestStop(), 12000);

    r.onresult = e => {
      if (session !== s) return;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) s.finalText += (s.finalText ? " " : "") + t.trim(); else interim += t;
      }
      s.heard = true;
      apply((s.finalText + " " + interim).trim());
    };
    r.onstart = () => { if (session === s) s.started = true; };
    r.onerror = ev => {
      if (session !== s || s.finished) return;
      if (ev.error === "aborted") return finish();
      if (ev.error === "no-speech" && s.heard) return finish();
      if (ev.error === "no-speech" && !s.stopAsked && Date.now() - s.startedAt < 800 && attempt < 2) return retry();
      fail(MSGS[ev.error] || "Dictée interrompue (" + ev.error + ").");
    };
    r.onend = () => {
      if (session !== s || s.finished) return;
      // Fin immédiate sans rien entendre ni erreur : le micro n'était pas prêt, on relance.
      if (!s.heard && !s.stopAsked && Date.now() - s.startedAt < 800) {
        if (attempt < 2) return retry();
        return fail("Le micro n'a pas répondu. Réessayez dans une seconde.");
      }
      finish();
    };
    setListening(true);
    input.blur();
    try { r.start(); } catch (e) {
      if (attempt < 2) return retry();
      fail("Impossible de démarrer la dictée. Réessayez.");
    }
  };

  const start = () => {
    const old = session;
    if (!old) return open(0);
    // On attend la fin réelle de l'écoute précédente avant d'en ouvrir une autre.
    old.detach();
    session = null;
    const r = getEngine();
    let started = false;
    const go = () => { if (started) return; started = true; setTimeout(() => open(0), 0); };
    r.onresult = null;
    r.onerror = null;
    r.onend = go;
    try { r.abort(); } catch (e) { /* ignore */ }
    setTimeout(go, 300);
  };
  const release = () => {
    if (!session) return;
    if (Date.now() - pressedAt < 400) return; // appui bref : on laisse la phrase se terminer seule
    session.requestStop();
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
