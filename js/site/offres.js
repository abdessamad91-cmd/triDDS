// Page Offres : démo de recherche en direct, grille de prix, formulaire de demande d'accès.

import { PLANS, PLAN_ORDER, formatPrice } from "../shared/plans.js";
import { loadBase, search, destination, seuilText, productCount } from "../shared/catalog.js";
import { post } from "../shared/api.js";
import { html, icon, debounce, esc } from "../shared/ui.js";

const $ = s => document.querySelector(s);

// ---------- démo ----------
loadBase([]);
const n = productCount();
if (n) $("[data-count]").textContent = `${n} produits classés selon le référentiel EcoDDS, et la mémoire de votre équipe en plus.`;

// Une photo de plusieurs produits en vrac : chaque produit ressort avec son bac.
const PHOTO = {
  label: "Photo d'une caisse en vrac",
  src: "./assets/demo-caisse.jpg",
  // Résultat réel de l'analyse de cette photo dans l'appli.
  products: [
    { q: "Peinture loisir, art : gouache aquarelle", label: "Lu : peinture laque émail miniature Revell" },
    { q: "brou de noix", label: "Lu : brou de noix" },
    { q: "Produit non identifié, sans étiquette", label: "Pot rouillé, étiquette illisible" }
  ]
};
// Un cas par couleur : EcoDDS, hors EcoDDS, refusé.
const SAMPLES = [PHOTO, "White spirit", "huile moteur", "Acide picrique"];
const sampleKey = s => typeof s === "string" ? s : "__photo";
$("[data-chips]").innerHTML = SAMPLES.map(s => typeof s === "string"
  ? `<button type="button" data-sample="${esc(s)}">${esc(s)}</button>`
  : `<button type="button" class="chip-photo" data-sample="__photo">${icon("camera")}${esc(s.label)}</button>`).join("");

const input = $("#demo-q");
const out = $("[data-demo-out]");
const foot = $("[data-demo-foot]");

// Simulation d'un scan : la photo « s'analyse », puis chaque produit reconnu s'affiche avec son bac.
let photoRun = 0;
async function showPhotoDemo() {
  const run = ++photoRun;
  input.value = "Photo : " + PHOTO.products.length + " produits en vrac";
  foot.textContent = "";
  out.innerHTML = `<div class="demo-photo" aria-label="Photo d'une caisse de produits, analyse en cours">
    <img src="${PHOTO.src}" alt="Pots de peinture et brou de noix posés sur une caisse rouge, en déchèterie" width="960" height="909">
    <div class="demo-photo-scan"></div>
    <div class="demo-photo-tag">${icon("camera")}<span>Analyse de la photo…</span></div>
  </div>`;
  await new Promise(r => setTimeout(r, 1500));
  if (run !== photoRun) return;
  const rows = PHOTO.products.map(({ q, label }) => {
    const r = search(q, 1)[0];
    const d = r && destination(r);
    if (!d) return "";
    return html`<li class="${d.tone}">
      <span class="dm-k">${d.tone === "int" ? icon("alert") : html`<img src="./assets/${d.tone === "eco" ? "eco-dds-96" : "hors-eco-dds-96"}.png" alt="" width="28" height="28">`}</span>
      <span class="dm-t"><b>${d.bac}</b><small>${label} · ${d.kicker}</small></span>
    </li>`;
  });
  out.innerHTML = html`<div class="demo-multi"><div class="dm-head">${PHOTO.products.length} produits sur la photo, à valider</div><ul>${rows}</ul></div>`.toString();
  foot.textContent = "Une seule photo, chaque produit avec son bac, même sans étiquette lisible. L'agent touche un produit pour vérifier le seuil et valider.";
}

function showDemo() {
  photoRun++;
  const q = input.value.trim();
  if (q.length < 2) {
    out.innerHTML = `<div class="demo-empty">Le bac s'affiche ici, comme sur le téléphone des agents.</div>`;
    foot.textContent = "";
    return;
  }
  const res = search(q, 3);
  if (!res.length) {
    out.innerHTML = `<div class="demo-empty">Aucun produit pour « ${esc(q)} ». Sur le terrain, l'agent prendrait le produit en photo.</div>`;
    foot.textContent = "";
    return;
  }
  const r = res[0];
  const d = destination(r);
  out.innerHTML = html`<section class="placard ${d.tone}">
    <div class="placard-kicker">${d.tone === "int" ? icon("alert") : html`<img src="./assets/${d.tone === "eco" ? "eco-dds-96" : "hors-eco-dds-96"}.png" alt="" width="36" height="36">`}<span>${d.kicker}</span></div>
    <div class="placard-label">${d.tone === "int" ? "Consigne" : "Mettre dans le bac"}</div>
    <div class="placard-bac">${d.bac}</div>
    <div class="placard-prod">${r.n}</div>
  </section>`.toString();
  const extra = [];
  if (r.f === "E" && r.s) extra.push(`Seuil EcoDDS : ${seuilText(r.s)} par contenant, au-delà il passe en hors EcoDDS.`);
  if (r.c) extra.push(r.c + ".");
  if (res.length > 1) extra.push(`Aussi trouvé : ${res.slice(1).map(x => x.n).join(", ")}.`);
  foot.textContent = extra.join(" ");
}
input.addEventListener("input", debounce(showDemo, 80));
$("[data-chips]").addEventListener("click", e => {
  const b = e.target.closest("[data-sample]");
  if (!b) return;
  stopAutoDemo();
  markChip(b.dataset.sample);
  if (b.dataset.sample === "__photo") { showPhotoDemo(); return; }
  input.value = b.dataset.sample;
  showDemo();
});

// La démo joue toute seule tant que le visiteur n'y touche pas : le nom se tape dans
// le champ, le bac s'affiche, puis produit suivant. Le premier geste du visiteur l'arrête.
function markChip(name) {
  document.querySelectorAll("[data-sample]").forEach(b => b.classList.toggle("is-on", b.dataset.sample === name));
}
let autoTimer = null;
let autoOn = false;
function stopAutoDemo() {
  if (!autoOn) return;
  autoOn = false;
  clearTimeout(autoTimer);
  $(".demo").classList.remove("is-auto");
}
function startAutoDemo() {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { markChip("__photo"); showPhotoDemo(); return; }
  autoOn = true;
  $(".demo").classList.add("is-auto");
  let i = 0;
  const wait = ms => new Promise(r => { autoTimer = setTimeout(r, ms); });
  (async () => {
    await wait(900);
    while (autoOn) {
      const s = SAMPLES[i % SAMPLES.length];
      markChip(sampleKey(s));
      if (typeof s !== "string") {
        showPhotoDemo();
        await wait(5200);
      } else {
        input.value = "";
        for (const ch of s) {
          if (!autoOn) return;
          input.value += ch;
          await wait(55 + Math.random() * 45);
        }
        showDemo();
        await wait(3000);
      }
      i++;
    }
  })();
}
["pointerdown", "keydown", "focus"].forEach(ev => input.addEventListener(ev, stopAutoDemo));
$("[data-chips]").addEventListener("pointerdown", stopAutoDemo);
// Ne démarre que lorsque la démo est visible (sur mobile elle est sous le titre).
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) { io.disconnect(); startAutoDemo(); }
  }, { threshold: 0.4 });
  io.observe($(".demo"));
} else startAutoDemo();

// ---------- offres ----------
let yearly = false;
const PUBLIC = PLAN_ORDER.filter(k => PLANS[k].public);

function renderPlans() {
  $("[data-plans]").innerHTML = PUBLIC.map(k => {
    const p = PLANS[k];
    const price = formatPrice(p, { yearly });
    const unit = p.price ? (yearly ? "HT / an" : "HT / mois") : "";
    const note = p.price ? (yearly ? `par déchèterie, soit ${(p.price * 10 / 12).toFixed(2).replace(".", ",")} € par mois` : "par déchèterie") : "à partir de 3 déchèteries";
    return html`<article class="plan ${p.featured ? "featured" : ""}">
      ${p.featured ? html`<span class="flag">Le plus choisi</span>` : ""}
      <h3>${p.label}</h3>
      <p class="pitch">${p.pitch}</p>
      <div class="price"><b>${price}</b><span>${unit}</span></div>
      <p class="price-note">${note}</p>
      <ul>${p.features.map(f => html`<li>${icon("check")}${f}</li>`)}</ul>
      <a class="btn ${p.featured ? "btn-primary" : "btn-ghost"} btn-block" href="#demande" data-pick="${k}">${p.price == null ? "Demander un devis" : "Demander un accès"}</a>
    </article>`.toString();
  }).join("");
}
renderPlans();

document.querySelectorAll("[data-billing]").forEach(b => b.addEventListener("click", () => {
  yearly = b.dataset.billing === "year";
  document.querySelectorAll("[data-billing]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  renderPlans();
}));

// ---------- demande ----------
const form = $("[data-request]");
const select = $("[data-plan-select]");
select.innerHTML = `<option value="essai">Un mois d'essai gratuit sur une déchèterie</option>` + PUBLIC.map(k => `<option value="${k}">${esc(PLANS[k].label)}${PLANS[k].price ? ` (${PLANS[k].price} € HT par mois et par site)` : " (devis, dès 3 sites)"}</option>`).join("") + `<option value="">Je ne sais pas encore</option>`;

document.addEventListener("click", e => {
  const b = e.target.closest("[data-pick]");
  if (!b) return;
  select.value = b.dataset.pick;
  if (b.dataset.pick === "enterprise") form.sites.value = Math.max(3, +form.sites.value || 3);
});

const params = new URLSearchParams(location.search);
if (params.get("plan") && (PLANS[params.get("plan")] || params.get("plan") === "essai")) select.value = params.get("plan");

form.addEventListener("submit", async e => {
  e.preventDefault();
  const msg = form.querySelector("[data-msg]");
  msg.innerHTML = "";
  const data = Object.fromEntries(new FormData(form).entries());
  const missing = [];
  if (!data.name.trim()) missing.push("votre nom");
  if (!data.organisation.trim()) missing.push("la structure");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email.trim())) missing.push("un email valide");
  if (missing.length) {
    msg.innerHTML = `<p class="note int">Il manque ${esc(missing.join(", "))}.</p>`;
    return;
  }
  const btn = form.querySelector("[type=submit]");
  btn.disabled = true;
  btn.textContent = "Envoi…";
  try {
    const trial = data.plan === "essai";
    await post("request-access", Object.assign(data, { plan: trial ? "pro" : data.plan, trial, source: "page-offres" }));
    form.innerHTML = html`<div class="done">${icon("check")}<h3>Demande envoyée</h3>
      <p>Merci ${data.name.split(" ")[0]}. Je reviens vers vous sous 48 h ouvrées, par email ou par téléphone, pour préparer l'accès.</p>
      <a class="btn btn-ghost" href="./">Essayer la recherche en attendant</a></div>`.toString();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Envoyer la demande";
    const contact = (window.APP_CONFIG || {}).CONTACT_EMAIL;
    msg.innerHTML = `<p class="note int">La demande n'a pas pu partir (${esc(err.message)}).${contact ? ` Écrivez directement à <a href="mailto:${esc(contact)}">${esc(contact)}</a>.` : " Réessayez dans un instant."}</p>`;
  }
});
