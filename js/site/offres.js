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

const SAMPLES = ["White spirit", "pH moins", "bombe de peinture", "Acide fluorhydrique", "huile moteur", "Désherbant"];
$("[data-chips]").innerHTML = SAMPLES.map(s => `<button type="button" data-sample="${esc(s)}">${esc(s)}</button>`).join("");

const input = $("#demo-q");
const out = $("[data-demo-out]");
const foot = $("[data-demo-foot]");

function showDemo() {
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
  input.value = b.dataset.sample;
  showDemo();
});

// ---------- offres ----------
let yearly = false;
const PUBLIC = PLAN_ORDER.filter(k => PLANS[k].public);

function renderPlans() {
  $("[data-plans]").innerHTML = PUBLIC.map(k => {
    const p = PLANS[k];
    const price = formatPrice(p, { yearly });
    const unit = p.price ? (yearly ? "HT / an" : "HT / mois") : "";
    const note = p.price ? (yearly ? `soit ${(p.price * 10 / 12).toFixed(2).replace(".", ",")} € par mois` : k === "multisite" ? "pour l'ensemble des sites" : "par déchèterie") : "à partir de 6 sites";
    return html`<article class="plan ${p.featured ? "featured" : ""}">
      ${p.featured ? html`<span class="flag">Le plus choisi</span>` : ""}
      <h3>${p.label}</h3>
      <p class="pitch">${p.pitch}</p>
      <div class="price"><b>${price}</b><span>${unit}</span></div>
      <p class="price-note">${note}</p>
      <ul>${p.features.map(f => html`<li>${icon("check")}${f}</li>`)}</ul>
      <a class="btn ${p.featured ? "btn-primary" : "btn-ghost"} btn-block" href="#demande" data-pick="${k}">${p.price == null ? "Demander un devis" : "Demander cet accès"}</a>
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
select.innerHTML = `<option value="">Je ne sais pas encore</option>` + PUBLIC.map(k => `<option value="${k}">${esc(PLANS[k].label)}${PLANS[k].price ? ` (${PLANS[k].price} € HT / mois)` : " (sur devis)"}</option>`).join("");

document.addEventListener("click", e => {
  const b = e.target.closest("[data-pick]");
  if (!b) return;
  select.value = b.dataset.pick;
  if (b.dataset.pick === "multisite") form.sites.value = Math.max(2, +form.sites.value || 2);
  if (b.dataset.pick === "enterprise") form.sites.value = Math.max(6, +form.sites.value || 6);
});

const params = new URLSearchParams(location.search);
if (params.get("plan") && PLANS[params.get("plan")]) select.value = params.get("plan");

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
    await post("request-access", Object.assign(data, { source: "page-offres" }));
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
