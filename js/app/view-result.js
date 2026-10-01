// Résultat : le panneau du bac, la question du seuil, les consignes, les photos
// et la validation (qui nourrit la mémoire de l'équipe et le journal).

import { html, raw, icon, esc, toast, openSheet } from "../shared/ui.js";
import { post } from "../shared/api.js";
import { destination, seuilText, findByName } from "../shared/catalog.js";
import { sess, isDemo, addHistory, addJournal, updateJournal } from "./store.js";
import { photosFor, addLocalPhoto, refreshImages } from "./images.js";
import { learn } from "./memory.js";
import { topbar, productRow, pickProduct, lightbox, thumb } from "./common.js";

const needsThreshold = r => r.f === "E" && r.s && !r.seuilAnswered;

function placard(r, flip) {
  const d = destination(r);
  const logo = d.tone === "eco" ? "./assets/eco-dds-96.png" : "./assets/hors-eco-dds-96.png";
  return html`<section class="placard ${d.tone} ${flip ? "flip" : ""}" aria-live="polite">
    <div class="placard-kicker">${d.tone !== "int" ? html`<img src="${logo}" alt="" width="36" height="36">` : icon("alert")}<span>${d.kicker}</span></div>
    <div class="placard-label">${d.tone === "int" ? "Consigne" : needsThreshold(r) ? "Bac, si le seuil est respecté" : "Mettre dans le bac"}</div>
    <div class="placard-bac">${d.bac}</div>
    <div class="placard-prod">${r.n}${r.label && r.label !== r.n ? html`<small>Lu sur l'étiquette : ${r.label}</small>` : ""}</div>
  </section>`;
}

function thresholdBlock(r) {
  if (!(r.f === "E" && r.s)) return "";
  const v = seuilText(r.s);
  if (!r.seuilAnswered) {
    return html`<div class="threshold" role="group" aria-label="Seuil EcoDDS">
      <p>EcoDDS accepte ce produit jusqu'à <b>${v}</b> par contenant.${r.vol ? html` Volume estimé : ${r.vol}.` : ""} Le contenant respecte-t-il ce seuil ?</p>
      <div class="two"><button class="btn btn-eco btn-lg" data-seuil="ok">Oui, ${v} ou moins</button><button class="btn btn-hors btn-lg" data-seuil="over">Non, il dépasse</button></div>
      <button class="btn btn-quiet" data-seuil="unknown">Je ne sais pas</button>
    </div>`;
  }
  return r.overSeuil
    ? html`<div class="note hors">Contenant au-delà de ${v} : il ne va pas en EcoDDS. <button class="btn btn-quiet" data-seuil="reset">Modifier</button></div>`
    : html`<div class="note eco">Accepté en EcoDDS jusqu'à ${v} par contenant. <button class="btn btn-quiet" data-seuil="reset">Modifier</button></div>`;
}

function confidenceBlock(r) {
  if (r.source !== "scan") return "";
  const v = Math.round(r.conf || 0);
  const color = v >= 80 ? "var(--eco)" : v >= 60 ? "var(--hors)" : "var(--int)";
  const why = r.fromMemory ? "Marque déjà validée par votre équipe." : r.notInBase ? "Produit absent de la base : classement proposé par l'IA, à vérifier." : r.fluxCorrected ? "Le flux a été corrigé d'après la base TriDDS." : "";
  return html`<div class="card confidence">
    <div style="display:flex;justify-content:space-between;gap:10px"><span>Fiabilité de la lecture</span><b style="color:${raw(color)}">${v} %</b></div>
    <div class="bar"><i style="width:${v}%;background:${raw(color)}"></i></div>
    ${v < 70 ? html`<span style="color:var(--hors-text);font-weight:600">À vérifier : comparez avec l'étiquette avant de valider.</span>` : ""}
    ${why ? html`<span>${why}</span>` : ""}
  </div>`;
}

function photosBlock(r) {
  const flux = r.overSeuil ? "H" : r.f;
  const refs = photosFor(r.n, flux);
  if (r.cropImage && refs.length) {
    return html`<div class="compare">
      <figure><button data-zoom="crop"><img src="${r.cropImage}" alt="Produit photographié"></button><figcaption>Votre photo</figcaption></figure>
      <figure><button data-zoom="0"><img src="${refs[0].url}" alt="Photo de référence"></button><figcaption>Référence TriDDS</figcaption></figure>
    </div>`;
  }
  if (r.cropImage) return html`<div class="compare" style="grid-template-columns:1fr"><figure><button data-zoom="crop"><img src="${r.cropImage}" alt="Produit photographié"></button><figcaption>Votre photo (pas encore de référence pour ce produit)</figcaption></figure></div>`;
  if (!refs.length) return "";
  return html`<div class="gallery" aria-label="Photos de référence">${refs.slice(0, 8).map((p, i) => html`<button data-zoom="${i}"><img src="${p.url}" alt="Photo de référence ${i + 1}" loading="lazy"></button>`)}</div>`;
}

function factsBlock(r) {
  const d = destination(r);
  const items = [];
  if (r.c) items.push(html`<div class="note int fact">${icon("alert")}<span>${r.c}</span></div>`);
  if (r.i && r.i !== r.c) items.push(html`<div class="note fact">${icon("book")}<span>${r.i}</span></div>`);
  if (d.tone === "hors" && /non id/i.test(r.x || "")) items.push(html`<div class="note hors">Produit sans étiquette lisible : isolez-le, ne le mélangez pas, portez les EPI.</div>`);
  return items.length ? html`<div class="facts">${items}</div>` : "";
}

function actionsBlock(r) {
  if (needsThreshold(r)) return "";
  if (r.validated) {
    return html`<div class="result-actions"><button class="btn btn-ghost btn-icon btn-lg" data-photo aria-label="Ajouter une photo de référence">${icon("image")}</button><button class="btn btn-primary btn-lg" data-new>${icon("search")}Produit suivant</button></div>`;
  }
  if (r.source === "scan") {
    return html`<div class="result-actions"><button class="btn btn-ghost btn-lg" data-fix>${icon("edit")}Corriger</button><button class="btn btn-primary btn-lg" data-ok>${icon("check")}C'est le bon produit</button></div>`;
  }
  return html`<div class="result-actions"><button class="btn btn-ghost btn-lg" data-fix>${icon("edit")}Autre produit</button><button class="btn btn-primary btn-lg" data-new>${icon("search")}Produit suivant</button></div>`;
}

let flipNext = false;

export const resultView = {
  tab: "home",
  render(app) {
    const r = app.state.result;
    if (!r) return html`${topbar({ title: "Résultat", back: true })}<div class="empty-state"><b>Aucun produit sélectionné.</b></div>`.toString();
    const flip = flipNext; flipNext = false;
    return html`${topbar({ title: r.multiIndex != null ? "Produit " + (r.multiIndex + 1) + " sur " + app.state.multi.length : "Où le mettre ?", back: true })}
      <div class="wrap">${placard(r, flip)}
      <div class="result-body">
        ${thresholdBlock(r)}
        ${factsBlock(r)}
        ${confidenceBlock(r)}
        ${photosBlock(r)}
        ${r.validated && r.source === "scan" ? html`<div class="validated">${icon("check")}Validé, l'équipe s'en souviendra</div>` : ""}
      </div></div>
      ${actionsBlock(r)}`.toString();
  },

  mount(el, app) {
    const r = app.state.result;
    if (!r) return;
    // Recherche manuelle sans question de seuil : on note directement le tri.
    if (r.source === "search" && !r.validated && !needsThreshold(r)) record(r, "confirmed");

    el.addEventListener("click", async e => {
      const t = e.target;
      const s = t.closest("[data-seuil]");
      if (s) {
        const v = s.dataset.seuil;
        if (v === "reset") { r.seuilAnswered = false; r.overSeuil = false; r.validated = false; }
        else {
          r.seuilAnswered = true;
          r.overSeuil = v === "over";
          if (v === "over") flipNext = true;
          if (r.source === "search") record(r, "confirmed");
        }
        return app.refresh();
      }
      if (t.closest("[data-ok]")) {
        r.validated = true;
        r.conf = Math.max(r.conf || 0, 80);
        const brand = r.aiData ? (r.aiData.marque || r.aiData.nom || r.n) : r.n;
        learn(brand, r.n, r.f, r.x, "learn");
        if (r.jrnId) updateJournal(r.jrnId, { reviewed: true, validationType: "confirmed", confidence: r.conf });
        addHistory(r);
        saveCropAsReference(r);
        syncMulti(app, r);
        toast("Validé");
        return app.refresh();
      }
      if (t.closest("[data-fix]")) {
        const p = await pickProduct({ sub: "Lu : " + (r.label || r.n), initial: r.aiData ? (r.aiData.nom_referentiel || r.aiData.nom || "") : "" });
        if (!p) return;
        const next = Object.assign({}, p, { source: r.source, conf: 100, cropImage: r.cropImage, aiData: r.aiData, label: r.label, vol: r.vol, jrnId: r.jrnId, multiIndex: r.multiIndex, validated: r.source === "scan", seuilAnswered: false });
        if (r.aiData) learn(r.aiData.marque || r.aiData.nom || r.n, p.n, p.f, p.x, "correct");
        if (r.jrnId) updateJournal(r.jrnId, { correctedTo: p.n, correctedFlux: p.f, correctedCategory: p.x, validationType: "corrected", reviewed: true });
        app.state.result = next;
        if (r.source === "scan") { addHistory(next); saveCropAsReference(next); syncMulti(app, next); }
        else next._recorded = false;
        toast("Corrigé");
        return app.refresh();
      }
      if (t.closest("[data-new]")) {
        app.state.query = "";
        if (r.multiIndex != null) return app.back();
        return app.go("home", { replace: true });
      }
      if (t.closest("[data-photo]")) return addPhotoSheet(app, r);
      const z = t.closest("[data-zoom]");
      if (z) {
        const refs = photosFor(r.n, r.overSeuil ? "H" : r.f).map(p => p.url);
        if (z.dataset.zoom === "crop") return lightbox([r.cropImage].concat(refs), 0);
        return lightbox(refs, +z.dataset.zoom);
      }
    });
  }
};

function record(r, type) {
  if (r._recorded) return;
  r._recorded = true;
  addHistory(r);
  addJournal({ name: r.n, flux: r.f, overSeuil: !!r.overSeuil, category: r.x, confidence: 100, validationType: type, source: r.source || "search" });
  r.validated = true;
}

function syncMulti(app, r) {
  if (r.multiIndex != null && app.state.multi) app.state.multi[r.multiIndex] = r;
}

// Première photo validée d'un produit : elle devient une référence pour tous.
function saveCropAsReference(r) {
  if (!r.cropImage || isDemo() || r._cropSaved) return;
  const flux = r.overSeuil ? "H" : r.f;
  if (photosFor(r.n, flux).length) return;
  r._cropSaved = true;
  post("product-images", {
    code: sess.code, agent: sess.agent, sessionId: sess.sessionId, action: "save",
    imageData: r.cropImage.split(",")[1], imageMime: "image/jpeg",
    item: { productName: r.n, alt: "Photo terrain : " + r.n, source: "ia-scan", isPrimary: false, order: 99, imageFlux: flux }
  }).then(d => { if (d && d.item) addLocalPhoto(d.item); }).catch(() => {});
}

function addPhotoSheet(app, r) {
  if (isDemo()) return toast("Connectez-vous avec un code pour ajouter des photos.");
  let file = null;
  openSheet({
    title: "Ajouter une photo de référence",
    sub: r.n,
    body: html`<p class="hint">Une photo nette de l'étiquette aide toute l'équipe à reconnaître ce produit.</p>
      <label class="btn btn-ghost btn-lg" style="cursor:pointer">${icon("camera")}Prendre ou choisir une photo
        <input type="file" accept="image/*" capture="environment" data-file hidden></label>
      <img data-prev alt="" style="display:none;max-height:240px;object-fit:contain;border-radius:12px;background:var(--paper-2)">`.toString(),
    foot: `<button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-primary" data-save disabled>Enregistrer</button>`,
    onMount(el, close) {
      const prev = el.querySelector("[data-prev]");
      const save = el.querySelector("[data-save]");
      el.querySelector("[data-file]").addEventListener("change", async ev => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        const { toJpeg } = await import("./ai.js");
        const url = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); });
        file = await toJpeg(url, 1024, 0.82);
        prev.src = file; prev.style.display = "block"; save.disabled = false;
      });
      save.addEventListener("click", async () => {
        save.disabled = true; save.textContent = "Envoi…";
        try {
          const flux = r.overSeuil ? "H" : r.f;
          const d = await post("product-images", {
            code: sess.code, agent: sess.agent, sessionId: sess.sessionId, action: "save",
            imageData: file.split(",")[1], imageMime: "image/jpeg",
            item: { productName: r.n, alt: r.n, source: "terrain", isPrimary: !photosFor(r.n).length, order: photosFor(r.n).length, imageFlux: flux }
          });
          if (d.item) addLocalPhoto(d.item);
          close();
          toast("Photo ajoutée");
          setTimeout(refreshImages, 1500);
          app.refresh();
        } catch (e) { save.disabled = false; save.textContent = "Enregistrer"; app.handleError(e); }
      });
    }
  });
}

// ---------- plusieurs produits sur la même photo ----------
export const multiView = {
  tab: "home",
  render(app) {
    const list = app.state.multi || [];
    const todo = list.filter(r => !r.validated).length;
    return html`${topbar({ title: list.length + " produits sur la photo", back: true })}
      <div class="wrap">
        ${app.state.photo ? html`<div class="scan-photo"><img src="${app.state.photo}" alt="Photo analysée"></div>` : ""}
        <div class="pad">
          <div class="section-title"><h2>${todo ? todo + " à valider" : "Tout est validé"}</h2></div>
          <div class="rows">${list.map((r, i) => productRow(r, `data-i="${i}"`))}</div>
          <p class="hint" style="margin:14px 0">Touchez un produit pour voir son bac, vérifier le seuil et valider.</p>
        </div>
      </div>`.toString();
  },
  mount(el, app) {
    el.addEventListener("click", e => {
      const b = e.target.closest("[data-i]");
      if (!b) return;
      const i = +b.dataset.i;
      app.state.result = Object.assign(app.state.multi[i], { multiIndex: i });
      app.go("result");
    });
  }
};
