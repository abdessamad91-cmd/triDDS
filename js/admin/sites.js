// Sites et accès : liste, création (seul moyen d'ouvrir un accès), fiche détaillée.

import { html, raw, icon, esc, toast, relTime, confirmDialog } from "../shared/ui.js";
import { PLANS, PLAN_ORDER, planLabel, TRIAL_DAYS } from "../shared/plans.js";
import { openDrawer, copy, appUrl } from "./drawer.js";

let filter = "actifs";
let query = "";

function usageCell(s) {
  if (!s.monthlyLimit && !s.trialTotal) return html`<span class="sub">Sans scan</span>`;
  const total = s.monthlyLimit || s.trialTotal;
  const used = s.monthlyLimit ? s.monthlyUsed : s.trialUsed;
  const r = total ? used / total : 0;
  return html`<div class="usage ${r >= 1 ? "full" : r >= 0.8 ? "high" : ""}"><span>${used ?? "?"} / ${total} utilisés${s.monthlyLimit ? "" : " (essai)"}</span><div class="bar"><i style="width:${Math.min(100, Math.round(r * 100))}%"></i></div></div>`;
}

export function sitesView(main, adm) {
  const sites = adm.data.sites || [];
  const q = query.toLowerCase();
  const list = sites.filter(s => (filter === "tous" || (filter === "actifs" ? s.active : !s.active)) &&
    (!q || [s.site, s.client, s.code, s.principal, s.principalEmail, (s.agentsList || []).map(a => a.name).join(" ")].join(" ").toLowerCase().includes(q)));
  main.innerHTML = html`<div class="adm-head"><h1>Sites et accès</h1>
      <input class="input" type="search" data-q placeholder="Site, code, agent, email" value="${query}">
      <button class="btn btn-primary" data-new>${icon("plus")}Créer un accès</button></div>
    <div class="toolbar"><div class="seg">${[["actifs", "Actifs"], ["suspendus", "Suspendus"], ["tous", "Tous"]].map(([k, l]) => html`<button data-f="${k}" aria-pressed="${k === filter}">${l} (${sites.filter(s => k === "tous" || (k === "actifs" ? s.active : !s.active)).length})</button>`)}</div></div>
    <div class="panel tbl-wrap">${list.length ? html`<table class="tbl"><thead><tr><th>Site</th><th>Code</th><th>Offre</th><th>Scans</th><th>Agents</th><th>Activité</th></tr></thead><tbody>
      ${list.map(s => html`<tr class="click" data-code="${s.code}">
        <td><b>${s.site}</b><span class="sub">${s.client && s.client !== s.site ? s.client : s.principal || ""}</span></td>
        <td class="mono">${s.code}</td>
        <td><span class="pill ${!s.active ? "bad" : s.trialExpired ? "bad" : s.billing === "essai" ? "warn" : PLANS[s.plan] && PLANS[s.plan].price ? "ok" : ""}">${s.active ? s.planName || planLabel(s.plan, s.trialTotal) : "Suspendu"}</span></td>
        <td>${usageCell(s)}</td>
        <td><span style="display:inline-flex;align-items:center;gap:6px">${s.agents}${s.maxAgents ? " / " + s.maxAgents : ""}${s.teamLocked ? html`<span title="Profils gérés par TriDDS" aria-label="Profils gérés par TriDDS">${icon("lock")}</span>` : ""}</span></td>
        <td class="sub">${s.lastSeen ? relTime(s.lastSeen) : "jamais"}</td></tr>`)}
    </tbody></table>` : html`<div class="empty-state">${icon("lock")}<b>Aucun site</b><span>Créez un accès pour ouvrir TriDDS à une déchèterie.</span></div>`}</div>`.toString();

  const qi = main.querySelector("[data-q]");
  qi.addEventListener("input", () => { query = qi.value; sitesView(main, adm); main.querySelector("[data-q]").focus(); const v = main.querySelector("[data-q]"); v.setSelectionRange(v.value.length, v.value.length); });
  main.querySelector(".toolbar").addEventListener("click", e => { const f = e.target.closest("[data-f]"); if (f) { filter = f.dataset.f; sitesView(main, adm); } });
  main.querySelector("[data-new]").addEventListener("click", () => openCreate(adm));
  main.querySelector(".panel").addEventListener("click", e => { const r = e.target.closest("[data-code]"); if (r) openSite(adm, r.dataset.code); });
}

function planOptions(selected) {
  // Les anciennes offres n'apparaissent que si le site est encore dessus.
  return PLAN_ORDER.filter(k => PLANS[k].public || k === selected || k === "free").map(k => html`<option value="${k}" ${raw(k === selected ? "selected" : "")}>${PLANS[k].label}${PLANS[k].price ? ` (${PLANS[k].price} € par site)` : PLANS[k].price === 0 ? " (recherche seule)" : " (devis)"}</option>`);
}
const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const plusMonths = n => { const d = new Date(); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };
const frDate = iso => iso ? iso.split("-").reverse().join("/") : "";
// Même règle que le serveur pour le préfixe du code : 4 lettres du nom de la commune.
const CODE_SKIP = ["dechetterie", "decheterie", "decheteries", "site", "centre", "ecopoint", "de", "du", "des", "la", "le", "les", "d", "l", "sur", "en"];
function codePrefix(siteName) {
  const w = (siteName || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z]+/).filter(x => x && !CODE_SKIP.includes(x));
  return (w[0] || "tri").slice(0, 4).toUpperCase();
}

// Formules proposées à la création : chacune remplit offre, facturation, échéance et quotas.
export const FORMULES = [
  { id: "essai", label: "Mois d'essai gratuit", hint: "Recommandé pour commencer : accès complet 30 jours, rien n'est facturé.", plan: "pro", billing: "essai", until: () => plusDays(TRIAL_DAYS) },
  { id: "mensuel", label: "Déchèterie, mensuel", hint: "49 € HT par mois, facture mensuelle.", plan: "pro", billing: "mensuelle", until: () => plusMonths(1) },
  { id: "annuel", label: "Déchèterie, annuel", hint: "490 € HT par an, 2 mois offerts.", plan: "pro", billing: "annuelle", until: () => plusMonths(12) },
  { id: "reseau", label: "Collectivité ou réseau", hint: "Dès 3 déchèteries, sur devis : un accès par site.", plan: "enterprise", billing: "", until: () => "" },
  { id: "decouverte", label: "Découverte (démo)", hint: "Recherche seule, quelques photos offertes. Pour une démonstration.", plan: "free", billing: "offert", until: () => "", trialTotal: 20 }
];
function formuleCards(selected) {
  return html`<div class="formules" role="radiogroup" aria-label="Formule">${FORMULES.map(f => html`<label class="formule ${f.id === selected ? "on" : ""}"><input type="radio" name="formule" value="${f.id}" ${raw(f.id === selected ? "checked" : "")}><b>${f.label}</b><span>${f.hint}</span></label>`)}</div>`;
}
// Résumé en clair de ce que le site obtiendra, mis à jour en direct.
function formuleSummary(f, { site = "", email = "", scansOverride = "", agentsOverride = "" } = {}) {
  const p = PLANS[f.plan];
  const scans = scansOverride !== "" ? Number(scansOverride) : p.scans;
  const agents = agentsOverride !== "" ? Number(agentsOverride) : p.agents;
  const until = f.until();
  const parts = [];
  if (f.billing === "essai") parts.push(`accès complet jusqu'au ${frDate(until)}, puis l'analyse photo s'arrête tant que vous ne passez pas le site en facturation`);
  else if (f.billing === "mensuelle" || f.billing === "annuelle") parts.push(`payé jusqu'au ${frDate(until)} (à mettre à jour à chaque facture)`);
  else if (f.id === "reseau") parts.push("facturation sur devis, échéance à renseigner");
  else parts.push("sans facturation");
  parts.push(scans ? `${scans} photos analysées par mois` : f.trialTotal ? `${f.trialTotal} photos offertes en tout, recherche illimitée` : "recherche seule, pas d'analyse photo");
  parts.push(agents ? `jusqu'à ${agents} profils` : "profils illimités");
  if (f.plan !== "free") parts.push("mémoire d'équipe et journal partagé");
  const code = site ? `Code du site : ${codePrefix(site)}-xxxxxx, généré à la création` : "Le code du site est généré à la création";
  return html`<div class="note eco" data-summary><b>Ce que le site obtient</b><br>${parts.join(" · ")}.<br><span class="hint">${code}${email ? ` et envoyé à ${email}` : ", à transmettre au responsable"}.</span></div>`;
}

export function welcomeText(site, code, agents = [], responsable = "") {
  return `Bonjour${responsable ? " " + responsable : ""},

Votre accès TriDDS pour ${site} est ouvert.

Application : ${appUrl()}
Code du site : ${code}
${agents.length ? "Profils créés : " + agents.join(", ") + "\n" : ""}
Ouvrez l'application sur le téléphone, saisissez le code puis choisissez votre nom. Vous pouvez l'ajouter à l'écran d'accueil pour l'ouvrir comme une application.

Ce code donne accès au site : merci de ne le transmettre qu'à votre équipe.`;
}

// ---------- création ----------
export function openCreate(adm, req = null) {
  const r = req || {};
  const formuleInit = req ? (r.trial ? "essai" : r.plan === "enterprise" ? "reseau" : r.plan === "pro" ? "mensuel" : "essai") : "essai";
  openDrawer({
    title: req ? "Créer l'accès demandé" : "Créer un accès",
    sub: req ? `${r.organisation}, demande du ${new Date(r.createdAt).toLocaleDateString("fr-FR")}` : "Trois étapes : le site, l'équipe, la formule.",
    body: html`<form data-create style="display:grid;gap:16px">
      <div class="section-h">1. Le site</div>
      <div class="grid2">
        <label class="field"><span>Nom du site</span><input class="input" name="site" value="${r.siteName || ""}" required placeholder="Déchèterie de Ludres" autofocus><span class="hint">Tel qu'il s'affichera aux agents.</span></label>
        <label class="field"><span>Structure</span><input class="input" name="client" value="${r.organisation || ""}" placeholder="Commune, syndicat ou exploitant"><span class="hint">Facultatif, pour vos factures.</span></label>
      </div>
      <div class="section-h">2. L'équipe</div>
      <div class="grid2">
        <label class="field"><span>Responsable du site</span><input class="input" name="responsable" value="${r.name || ""}" placeholder="Prénom Nom"><span class="hint">Il gère l'équipe depuis l'appli et reçoit le code.</span></label>
        <label class="field"><span>Email du responsable</span><input class="input" type="email" name="principalEmail" value="${r.email || ""}" placeholder="prenom@collectivite.fr"><span class="hint">Code, « code oublié », confirmations et récapitulatif mensuel.</span></label>
      </div>
      <label class="field"><span>Agents (un par ligne, facultatif)</span><textarea class="textarea" name="agents" placeholder="Prénom Nom&#10;Prénom Nom"></textarea><span class="hint">Le responsable est ajouté automatiquement. L'équipe peut aussi être complétée plus tard, par vous ou par le responsable.</span></label>
      <div class="section-h">3. La formule</div>
      ${formuleCards(formuleInit)}
      <div data-summary-box></div>
      <details><summary class="hint" style="cursor:pointer">Réglages particuliers (rarement utiles)</summary>
        <div style="display:grid;gap:12px;margin-top:12px">
          <div class="grid2">
            <label class="field"><span>Photos analysées par mois</span><input class="input" type="number" name="scansOverride" min="0" placeholder="selon la formule"><span class="hint">Laissez vide pour garder le quota de la formule.</span></label>
            <label class="field"><span>Nombre de profils maximum</span><input class="input" type="number" name="agentsOverride" min="0" placeholder="selon la formule"><span class="hint">Laissez vide pour garder la limite de la formule.</span></label>
          </div>
          <div class="grid2">
            <label class="field"><span>Code du site</span><input class="input mono" name="code" placeholder="généré automatiquement" style="text-transform:uppercase"><span class="hint">Forme NANC-7K2P4F. Laissez vide : le serveur en tire un.</span></label>
            <label class="check" style="align-self:end"><input type="checkbox" name="teamLocked"><span><b>Équipe gérée par TriDDS uniquement</b><br><span class="hint">Coché, le responsable ne peut plus ajouter ni retirer d'agents depuis l'appli.</span></span></label>
          </div>
          <label class="field"><span>Notes internes</span><textarea class="textarea" name="notes">${r.message ? "Demande : " + r.message : ""}</textarea></label>
        </div>
      </details>
      <label class="check"><input type="checkbox" name="sendEmail" ${raw(r.email ? "checked" : "")}><span>Envoyer le code par email au responsable dès la création</span></label>
      <div data-out></div>
    </form>`.toString(),
    foot: `<button class="btn btn-ghost" data-x>Annuler</button><button class="btn btn-primary" data-go style="margin-left:auto">${icon("check")}Créer l'accès</button>`,
    onMount(el, close, setBody) {
      const f = el.querySelector("[data-create]");
      const go = el.querySelector("[data-go]");
      const box = el.querySelector("[data-summary-box]");
      const current = () => FORMULES.find(x => x.id === (f.formule.value || formuleInit)) || FORMULES[0];
      const refreshSummary = () => {
        box.innerHTML = formuleSummary(current(), { site: f.site.value, email: f.principalEmail.value, scansOverride: f.scansOverride.value, agentsOverride: f.agentsOverride.value }).toString();
        el.querySelectorAll(".formule").forEach(c => c.classList.toggle("on", c.querySelector("input").checked));
        // L'envoi du code par email suit l'adresse saisie, tant que l'administrateur n'a pas décidé lui-même.
        f.sendEmail.disabled = !f.principalEmail.value;
        if (!f.sendEmail.dataset.touched) f.sendEmail.checked = !!f.principalEmail.value;
      };
      f.sendEmail.addEventListener("change", () => { f.sendEmail.dataset.touched = "1"; });
      f.addEventListener("input", refreshSummary);
      f.addEventListener("change", refreshSummary);
      refreshSummary();
      go.addEventListener("click", async () => {
        if (!f.reportValidity()) return;
        const fd = Object.fromEntries(new FormData(f).entries());
        const fo = current();
        const agents = (fd.agents || "").split("\n").map(x => x.trim()).filter(Boolean);
        go.disabled = true; go.textContent = "Création…";
        try {
          const d = await adm.call("create", {
            client: fd.client, site: fd.site, responsable: fd.responsable, principal: fd.responsable, principalEmail: fd.principalEmail,
            agents, plan: fo.plan, trialTotal: fo.trialTotal || 0, teamLocked: !!f.teamLocked.checked, code: (fd.code || "").trim().toUpperCase(),
            billing: fo.billing, paidUntil: fo.until(),
            scansOverride: fd.scansOverride, agentsOverride: fd.agentsOverride, notes: fd.notes,
            sendEmail: !!f.sendEmail.checked, requestId: r.id || ""
          });
          await adm.reload();
          adm.render();
          const names = (fd.responsable ? [fd.responsable] : []).concat(agents);
          const text = welcomeText(fd.site, d.code, names, fd.responsable);
          el.querySelector(".drawer-foot").innerHTML = `<button class="btn btn-ghost" data-x>Fermer</button><button class="btn btn-primary" data-open style="margin-left:auto">Ouvrir la fiche du site</button>`;
          setBody(html`<div class="note eco">Accès créé${d.email && d.email.sent ? ", email envoyé à " + fd.principalEmail : d.email && d.email.error ? ". L'email n'est pas parti : " + d.email.error : ""}.</div>
            <div class="codebox"><b>${d.code}</b><button class="btn btn-ghost btn-sm" data-copy-code>${icon("copy")}Copier</button></div>
            <label class="field"><span>Message à envoyer (SMS, email…)</span><textarea class="textarea" style="min-height:240px" readonly data-msg>${text}</textarea></label>
            <button class="btn btn-ghost" data-copy-msg>${icon("copy")}Copier le message</button>`.toString());
          el.querySelector("[data-copy-code]").addEventListener("click", async () => { await copy(d.code); toast("Code copié"); });
          el.querySelector("[data-copy-msg]").addEventListener("click", async () => { await copy(text); toast("Message copié"); });
          el.querySelector("[data-open]").addEventListener("click", () => { close(); openSite(adm, d.code); });
        } catch (e) { go.disabled = false; go.textContent = "Créer l'accès"; adm.fail(e); }
      });
    }
  });
}

// ---------- fiche d'un site ----------
export function openSite(adm, code) {
  const s = (adm.data.sites || []).find(x => x.code === code);
  if (!s) return toast("Site introuvable");
  // Lien direct : #sites/CODE ouvre la fiche, et le bouton Précédent la referme.
  if (location.hash !== "#sites/" + code) history.pushState(null, "", "#sites/" + code);
  const d = openDrawer({
    onClose() { if (location.hash === "#sites/" + code) history.replaceState(null, "", "#sites"); },
    title: s.site, sub: (s.client && s.client !== s.site ? s.client + ", " : "") + "créé " + (s.created ? relTime(s.created) : "?"),
    body: siteBody(s),
    foot: `<button class="btn btn-ghost btn-sm" data-act="email">${icon("mail")}Renvoyer le code par email</button>
      <button class="btn btn-ghost btn-sm" data-act="${s.active ? "suspend" : "resume"}">${s.active ? "Suspendre" : "Réactiver"}</button>
      <button class="btn btn-ghost btn-sm" data-act="regen">Changer le code</button>
      <button class="btn btn-danger btn-sm" data-act="delete" style="margin-left:auto">Supprimer</button>`,
    onMount(el, close) { bindSite(adm, el, s, close); }
  });
  return d;
}

// État du site en une phrase, pour ne pas avoir à lire les champs.
function statusLine(s) {
  const lim = s.monthlyLimit || 0;
  const left = lim ? Math.max(0, lim - (s.monthlyUsed || 0)) : 0;
  if (!s.active) return { tone: "int", text: "Accès suspendu : personne ne peut se connecter." };
  if (s.billing === "essai") return s.trialExpired
    ? { tone: "int", text: `Essai terminé le ${frDate(s.paidUntil)} : l'analyse photo est coupée, la recherche fonctionne. Choisissez une formule ci-dessous pour rouvrir.` }
    : { tone: "eco", text: `Mois d'essai jusqu'au ${frDate(s.paidUntil)} · ${left} photo${left > 1 ? "s" : ""} restante${left > 1 ? "s" : ""} sur ${lim} ce mois.` };
  if (s.billing === "mensuelle" || s.billing === "annuelle") {
    const late = s.paidUntil && s.paidUntil < new Date().toISOString().slice(0, 10);
    return { tone: late ? "hors" : "eco", text: `${planLabel(s.plan)}, facturation ${s.billing} ${s.paidUntil ? (late ? "échue depuis le " : "à jour jusqu'au ") + frDate(s.paidUntil) : "sans échéance renseignée"} · ${left} photo${left > 1 ? "s" : ""} restante${left > 1 ? "s" : ""} sur ${lim} ce mois.` };
  }
  if (s.plan === "free") return { tone: "", text: `Site Découverte : recherche seule, ${s.trialTotal ? `${Math.max(0, s.trialTotal - (s.trialUsed || 0))} photo(s) offerte(s) restante(s)` : "pas d'analyse photo"}.` };
  return { tone: "", text: `${planLabel(s.plan)}, facturation ${s.billing || "à définir"} · ${lim ? `${left} photos restantes sur ${lim} ce mois` : "pas de quota mensuel"}.` };
}

function siteBody(s) {
  const st = statusLine(s);
  const p = PLANS[s.plan] || PLANS.free;
  const monthNow = new Date().toISOString().slice(0, 7);
  return html`<div class="codebox"><b>${s.code}</b><button class="btn btn-ghost btn-sm" data-copy-code>${icon("copy")}Code</button><button class="btn btn-ghost btn-sm" data-copy-msg>${icon("copy")}Message d'accueil</button></div>
    <div class="note ${st.tone}">${st.text}</div>
    <form data-edit style="display:grid;gap:12px">
      <div class="section-h">Formule et facturation</div>
      <div class="grid2">
        <label class="field"><span>Offre</span><select class="select" name="plan">${planOptions(s.plan)}</select><span class="hint" data-plan-hint></span></label>
        <label class="field"><span>Facturation</span><select class="select" name="billing">${[["", "À définir"], ["essai", "Mois d'essai gratuit"], ["mensuelle", "Mensuelle"], ["annuelle", "Annuelle"], ["offert", "Offert"]].map(([v, l]) => html`<option value="${v}" ${raw(s.billing === v ? "selected" : "")}>${l}</option>`)}</select><span class="hint">Changer de facturation propose automatiquement la prochaine échéance.</span></label>
        <label class="field"><span data-until-label>${s.billing === "essai" ? "Essai jusqu'au" : "Payé jusqu'au"}</span><input class="input" type="date" name="paidUntil" value="${s.paidUntil || ""}" lang="fr-FR"><span class="hint">Pour un essai : date de fin. Pour un abonnement : date couverte par la dernière facture.</span></label>
        <label class="field"><span>Photos analysées par mois</span><input class="input" type="number" min="0" name="scansOverride" value="${s.scansOverride ?? ""}" placeholder="${p.scans} (offre)"><span class="hint">Vide = quota de l'offre. Utilisé ce mois : ${s.monthlyUsed ?? 0}.</span></label>
        <label class="field"><span>Nombre de profils maximum</span><input class="input" type="number" min="0" name="agentsOverride" value="${s.agentsOverride ?? ""}" placeholder="${p.agents || "illimité"} (offre)"><span class="hint">Vide = limite de l'offre. Profils actuels : ${s.agents}.</span></label>
        ${s.plan === "free" || s.trialTotal ? html`<label class="field"><span>Photos offertes (site Découverte)</span><input class="input" type="number" min="0" name="trialTotal" value="${s.trialTotal ?? 0}"><span class="hint">Hors quota mensuel. Utilisées : ${s.trialUsed ?? 0}.</span></label>` : html`<input type="hidden" name="trialTotal" value="${s.trialTotal ?? 0}">`}
      </div>
      <div class="section-h">Site et responsable</div>
      <div class="grid2">
        <label class="field"><span>Nom du site</span><input class="input" name="site" value="${s.site}"></label>
        <label class="field"><span>Structure</span><input class="input" name="client" value="${s.client}"></label>
        <label class="field"><span>Responsable</span><input class="input" name="principal" value="${s.principal}"></label>
        <label class="field"><span>Email du responsable</span><input class="input" type="email" name="principalEmail" value="${s.principalEmail}"><span class="hint">Reçoit le code, les confirmations et le récapitulatif mensuel.</span></label>
      </div>
      <label class="check"><input type="checkbox" name="teamLocked" ${raw(s.teamLocked ? "checked" : "")}><span><b>Équipe gérée par TriDDS uniquement</b><br><span class="hint">Coché : le responsable ne peut ni ajouter ni retirer d'agents depuis l'appli.</span></span></label>
      <label class="field"><span>Notes internes</span><textarea class="textarea" name="notes">${s.notes}</textarea></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" type="submit">Enregistrer</button><button class="btn btn-ghost" type="button" data-act="reset">Remettre les compteurs à zéro</button></div>
    </form>
    <div class="section-h">Journal du mois<button class="btn btn-ghost btn-sm" data-act="recap" style="margin-left:10px">${icon("mail")}Envoyer le récapitulatif</button></div>
    <div class="panel" data-journal><p class="hint" style="padding:10px 0">Chargement…</p></div>
    <div class="section-h">Profils (${s.agents}${s.maxAgents ? " sur " + s.maxAgents : ""})</div>
    <div class="panel" style="padding:4px 12px">${(s.agentsList || []).length ? s.agentsList.map(a => html`<div class="agent-row" data-agent="${a.name}">
      <div class="name"><b>${a.name}</b>${a.role === "responsable" ? html` <span class="pill ink" style="display:inline-flex">Responsable</span>` : ""}
        <span>${a.activeSession ? "Connecté sur " + a.activeSession.deviceName : a.lastSeen ? "Vu " + relTime(a.lastSeen) : "Jamais connecté"}</span></div>
      ${a.activeSession ? html`<button class="btn btn-ghost btn-sm" data-ag="kick">Déconnecter</button>` : ""}
      ${a.role !== "responsable" ? html`<button class="btn btn-ghost btn-sm" data-ag="resp">Responsable</button>` : ""}
      <button class="btn btn-ghost btn-sm" data-ag="rename" aria-label="Renommer">${icon("edit")}</button>
      <button class="btn btn-danger btn-sm" data-ag="remove" aria-label="Retirer">${icon("trash")}</button>
    </div>`) : html`<p class="hint" style="padding:10px 0">Aucun profil : personne ne peut se connecter.</p>`}</div>
    <form data-add style="display:flex;gap:8px"><input class="input" name="name" placeholder="Ajouter un profil (Prénom Nom)" required><button class="btn btn-primary" type="submit">${icon("plus")}Ajouter</button></form>`;
}

function journalPanel(d) {
  const st = d && d.stats;
  if (!st || !st.total) return html`<p class="hint" style="padding:10px 0">Aucun produit orienté ce mois-ci.</p>`;
  const agents = Object.entries(st.byAgent || {}).sort((a, b) => b[1] - a[1]);
  return html`<div class="kpis" style="margin:10px 0 6px">
      <div class="kpi"><span>Produits orientés</span><b>${st.total}</b><small>dont ${st.scans} par photo</small></div>
      <div class="kpi"><span>Corrigés</span><b>${st.corrected}</b><small>${st.toReview} à vérifier</small></div>
      <div class="kpi"><span>Refusés ou à isoler</span><b>${st.refused}</b><small>${st.eco} EcoDDS, ${st.hors} hors</small></div>
    </div>
    <p class="hint" style="padding:0 0 8px">${agents.map(([a, n]) => `${a} : ${n}`).join(" · ")}</p>
    ${(st.topCorrections || []).length ? html`<p class="hint" style="padding:0 0 10px"><b>Corrections fréquentes :</b> ${st.topCorrections.slice(0, 5).map(([k, n]) => `${k} (${n})`).join(" · ")}</p>` : ""}`;
}

function bindSite(adm, el, s, close) {
  const refresh = async (code = s.code) => {
    await adm.reload();
    adm.render();
    close();
    openSite(adm, code);
  };
  // Remplissage automatique : l'offre explique son quota, la facturation propose l'échéance.
  const f0 = el.querySelector("[data-edit]");
  const planHint = () => { const p = PLANS[f0.plan.value] || PLANS.free; el.querySelector("[data-plan-hint]").textContent = p.price ? `${p.price} € HT par mois et par site · ${p.scans} photos par mois · ${p.agents} profils` : p.price === 0 ? "Recherche seule, pour les démonstrations" : `Sur devis · ${p.scans} photos par mois · ${p.agents} profils`; f0.scansOverride.placeholder = `${p.scans} (offre)`; f0.agentsOverride.placeholder = `${p.agents || "illimité"} (offre)`; };
  planHint();
  f0.plan.addEventListener("change", planHint);
  f0.billing.addEventListener("change", () => {
    const b = f0.billing.value;
    el.querySelector("[data-until-label]").textContent = b === "essai" ? "Essai jusqu'au" : "Payé jusqu'au";
    const suggested = b === "essai" ? plusDays(TRIAL_DAYS) : b === "mensuelle" ? plusMonths(1) : b === "annuelle" ? plusMonths(12) : "";
    if (suggested && (!f0.paidUntil.value || f0.paidUntil.value < new Date().toISOString().slice(0, 10) || b !== s.billing)) f0.paidUntil.value = suggested;
    if (b === "essai" && f0.plan.value === "free") f0.plan.value = "pro";
    planHint();
  });
  // Journal du mois, chargé à part pour ne pas ralentir l'ouverture.
  adm.call("journal", { code: s.code }).then(d => { const j = el.querySelector("[data-journal]"); if (j) j.innerHTML = journalPanel(d).toString(); }).catch(() => { const j = el.querySelector("[data-journal]"); if (j) j.innerHTML = `<p class="hint" style="padding:10px 0">Journal indisponible.</p>`; });
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); await refresh(); } catch (e) { adm.fail(e); } };
  const names = (s.agentsList || []).map(a => a.name);

  el.addEventListener("click", async e => {
    if (e.target.closest("[data-copy-code]")) { await copy(s.code); return toast("Code copié"); }
    if (e.target.closest("[data-copy-msg]")) { await copy(welcomeText(s.site, s.code, names, s.principal)); return toast("Message d'accueil copié"); }
    const act = e.target.closest("[data-act]");
    if (act) {
      const a = act.dataset.act;
      if (a === "email") return run(() => adm.call("send-access-email", { code: s.code }), "Email envoyé");
      if (a === "suspend") { if (await confirmDialog({ title: "Suspendre l'accès ?", message: "Tous les agents sont déconnectés et ne peuvent plus se connecter.", ok: "Suspendre", danger: true })) run(() => adm.call("update", { code: s.code, active: false }), "Accès suspendu"); return; }
      if (a === "resume") return run(() => adm.call("update", { code: s.code, active: true }), "Accès réactivé");
      if (a === "reset") { if (await confirmDialog({ title: "Remettre les compteurs à zéro ?", message: "Les photos analysées ce mois et les photos offertes repartent de zéro.", ok: "Remettre à zéro" })) return run(() => adm.call("update", { code: s.code, resetUsage: true }), "Compteurs remis à zéro"); return; }
      if (a === "recap") {
        const month = prompt("Mois du récapitulatif (AAAA-MM)", new Date().toISOString().slice(0, 7));
        if (!month) return;
        try { const d = await adm.call("send-recaps", { month }); toast(d.sent ? `Récapitulatif envoyé (${d.sent} site${d.sent > 1 ? "s" : ""})` : "Rien à envoyer : aucune activité ce mois-là ou pas d'email de responsable", { ms: 5000 }); } catch (err) { adm.fail(err); }
        return;
      }
      if (a === "regen") {
        if (!(await confirmDialog({ title: "Changer le code du site ?", message: "L'ancien code ne fonctionnera plus. Les agents sont déconnectés ; il faudra leur transmettre le nouveau code.", ok: "Changer le code", danger: true }))) return;
        try { const d = await adm.call("regenerate-code", { code: s.code }); toast("Nouveau code : " + d.code); await refresh(d.code); } catch (err) { adm.fail(err); }
        return;
      }
      if (a === "delete") {
        if (!(await confirmDialog({ title: `Supprimer ${s.site} ?`, message: "Le site, sa mémoire et ses fiches sont effacés définitivement.", ok: "Supprimer", danger: true }))) return;
        try { await adm.call("delete", { code: s.code }); await adm.reload(); adm.render(); close(); toast("Site supprimé"); } catch (err) { adm.fail(err); }
        return;
      }
    }
    const ag = e.target.closest("[data-ag]");
    if (ag) {
      const name = ag.closest("[data-agent]").dataset.agent;
      const k = ag.dataset.ag;
      if (k === "kick") return run(() => adm.call("kick-session", { code: s.code, agent: name }), name + " déconnecté");
      if (k === "resp") return run(() => adm.call("set-agent-role", { code: s.code, agent: name, role: "responsable" }), name + " est responsable");
      if (k === "rename") {
        const nn = prompt("Nouveau nom", name);
        if (!nn || nn.trim() === name) return;
        return run(() => adm.call("rename-agent", { code: s.code, agent: name, newName: nn.trim() }), "Profil renommé");
      }
      if (k === "remove") {
        if (!(await confirmDialog({ title: `Retirer ${name} ?`, message: "Ce profil ne pourra plus se connecter.", ok: "Retirer", danger: true }))) return;
        return run(() => adm.call("remove-agent", { code: s.code, agent: name }), name + " retiré");
      }
    }
  });

  el.querySelector("[data-edit]").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target;
    const fd = Object.fromEntries(new FormData(f).entries());
    if (fd.plan !== s.plan && !confirm("Changer d'offre déconnecte les agents de ce site. Continuer ?")) return;
    if (fd.billing === "essai" && !fd.paidUntil) return toast("Indiquez la date de fin de l'essai.", { error: true });
    run(() => adm.call("update", Object.assign(fd, { code: s.code, teamLocked: !!f.teamLocked.checked })), "Modifications enregistrées");
  });
  el.querySelector("[data-add]").addEventListener("submit", e => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (name) run(() => adm.call("add-agent", { code: s.code, agent: name, role: "agent" }), name + " ajouté");
  });
}
