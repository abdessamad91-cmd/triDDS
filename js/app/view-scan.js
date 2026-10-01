// Scan : caméra arrière plein écran, cadrage, import de photo, puis analyse.

import { html, icon, toast, esc } from "../shared/ui.js";
import { addJournal, applyAccess } from "./store.js";

let stream = null;
let shot = null;

function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}

export const scanView = {
  tabs: false,
  render() {
    return html`<div class="camera" role="dialog" aria-label="Scanner une étiquette">
      <div class="camera-top">
        <button class="btn btn-sm" data-back>${icon("back")}Retour</button>
        <p data-tip>Cadrez l'étiquette, de près et sans reflet</p>
        <span style="width:84px"></span>
      </div>
      <div class="camera-view" data-view>
        <video playsinline muted autoplay data-video></video>
        <div class="camera-frame" aria-hidden="true"></div>
        <div class="camera-msg" data-msg hidden></div>
      </div>
      <div class="camera-bar" data-bar>
        <label class="side" aria-label="Importer une photo">${icon("image")}<input type="file" accept="image/*" data-file hidden></label>
        <button class="shutter" data-shoot aria-label="Prendre la photo"></button>
        <span class="side" style="visibility:hidden"></span>
      </div>
    </div>`.toString();
  },

  mount(el, app) {
    shot = null;
    const video = el.querySelector("[data-video]");
    const msg = el.querySelector("[data-msg]");
    const view = el.querySelector("[data-view]");
    const bar = el.querySelector("[data-bar]");

    const showMsg = text => { msg.hidden = false; msg.textContent = text; };
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
        .then(s => {
          if (app.screen !== "scan") { s.getTracks().forEach(t => t.stop()); return; }
          stream = s; video.srcObject = s;
        })
        .catch(() => showMsg("Caméra indisponible. Autorisez l'accès à la caméra, ou importez une photo avec le bouton de gauche."));
    } else showMsg("Caméra indisponible sur ce navigateur. Importez une photo avec le bouton de gauche.");

    const review = dataUrl => {
      shot = dataUrl;
      stopCamera();
      view.innerHTML = `<img src="${esc(dataUrl)}" alt="Photo prise">`;
      el.querySelector("[data-tip]").textContent = "L'étiquette est-elle lisible ?";
      bar.className = "camera-bar review";
      bar.innerHTML = `<button class="btn btn-ghost btn-lg" data-retake>${icon("refresh")}Reprendre</button><button class="btn btn-eco btn-lg" data-analyze>${icon("search")}Analyser</button>`;
    };

    el.addEventListener("click", e => {
      if (e.target.closest("[data-shoot]")) {
        if (!video.videoWidth) return toast("La caméra démarre…");
        const c = document.createElement("canvas");
        c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext("2d").drawImage(video, 0, 0);
        if (navigator.vibrate) navigator.vibrate(30);
        return review(c.toDataURL("image/jpeg", 0.9));
      }
      if (e.target.closest("[data-retake]")) return app.refresh();
      if (e.target.closest("[data-analyze]")) return runAnalysis(el, app, shot);
    });
    el.querySelector("[data-file]").addEventListener("change", ev => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) return toast("Choisissez une image.", { error: true });
      const fr = new FileReader();
      fr.onload = () => review(fr.result);
      fr.readAsDataURL(f);
    });
  },

  unmount() { stopCamera(); }
};

const STEPS = ["Préparation de la photo", "Lecture des étiquettes", "Analyse approfondie", "Recherche dans la base"];

async function runAnalysis(el, app, dataUrl) {
  if (!dataUrl) return;
  const overlay = document.createElement("div");
  overlay.className = "analyzing";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  let seen = [];
  const draw = step => {
    if (!seen.includes(step)) seen.push(step);
    const steps = STEPS.filter(s => s !== "Analyse approfondie" || seen.includes(s));
    overlay.innerHTML = `<div class="analyzing-in"><img src="${esc(dataUrl)}" alt=""><div class="spinner"></div><b>${esc(step)}…</b>
      <ol>${steps.map(s => `<li class="${s === step ? "on" : seen.includes(s) ? "done" : ""}">${esc(s)}</li>`).join("")}</ol></div>`;
  };
  draw(STEPS[0]);
  document.body.appendChild(overlay);
  try {
    const { analyzePhoto } = await import("./ai.js");
    const res = await analyzePhoto(dataUrl, s => draw(s === "Découpe des produits" ? "Recherche dans la base" : s));
    if (res.usage) applyAccess(res.usage);
    overlay.remove();
    app.state.photo = res.photo;
    const matches = res.matches;
    if (!matches.length) {
      app.state.result = { n: "Produit non identifié", f: "H", x: "Produits non ID ou Laboratoire", c: "Aucune étiquette lisible. Isolez le produit, ne le mélangez pas, portez les EPI.", conf: 0, source: "scan", cropImage: null };
      app.state.result.jrnId = addJournal({ name: "Produit non identifié", flux: "H", category: app.state.result.x, confidence: 0, validationType: "auto", model: res.model }).id;
      return app.go("result", { replace: true });
    }
    matches.forEach(m => {
      m.source = "scan";
      m.jrnId = addJournal({ name: m.n, flux: m.f, category: m.x, confidence: m.conf, validationType: "auto", model: res.model, brand: m.aiData && (m.aiData.marque || m.aiData.nom) }).id;
    });
    if (matches.length === 1) {
      app.state.multi = null;
      app.state.result = matches[0];
      app.go("result", { replace: true });
    } else {
      app.state.multi = matches;
      app.go("multi", { replace: true });
    }
  } catch (e) {
    overlay.remove();
    app.handleError(e, "Analyse impossible.");
    if (e && e.data && e.data.usage) applyAccess(e.data.usage);
  }
}
