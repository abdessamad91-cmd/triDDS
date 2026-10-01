// Sites et accès : liste, création (seul moyen d'ouvrir un accès), fiche détaillée.

import { html, raw, icon, esc, toast, relTime, confirmDialog } from "../shared/ui.js";
import { PLANS, PLAN_ORDER, planLabel } from "../shared/plans.js";
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
        <td><span class="pill ${s.active ? (PLANS[s.plan] && PLANS[s.plan].price ? "ok" : "") : "bad"}">${s.active ? planLabel(s.plan, s.trialTotal) : "Suspendu"}</span></td>
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
  return PLAN_ORDER.map(k => html`<option value="${k}" ${raw(k === selected ? "selected" : "")}>${PLANS[k].label}${PLANS[k].price ? ` (${PLANS[k].price} €)` : PLANS[k].price === 0 ? " (gratuit, essai possible)" : " (devis)"}</option>`);
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
  const plan = r.plan && PLANS[r.plan] ? r.plan : "free";
  openDrawer({
    title: req ? "Créer l'accès demandé" : "Créer un accès",
    sub: req ? `${r.organisation}, demande du ${new Date(r.createdAt).toLocaleDateString("fr-FR")}` : "Seule façon d'ouvrir TriDDS à un site",
    body: html`<form data-create style="display:grid;gap:14px">
      <div class="grid2">
        <label class="field"><span>Structure</span><input class="input" name="client" value="${r.organisation || ""}" placeholder="Commune, syndicat, exploitant"></label>
        <label class="field"><span>Nom du site</span><input class="input" name="site" value="${r.siteName || ""}" required placeholder="Déchèterie de…"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Responsable du site</span><input class="input" name="responsable" value="${r.name || ""}" placeholder="Prénom Nom"></label>
        <label class="field"><span>Email du responsable</span><input class="input" type="email" name="principalEmail" value="${r.email || ""}"></label>
      </div>
      <label class="field"><span>Agents (un par ligne)</span><textarea class="textarea" name="agents" placeholder="Prénom Nom"></textarea><span class="hint">Les noms affichés à la connexion. Le responsable est ajouté automatiquement.</span></label>
      <div class="grid2">
        <label class="field"><span>Offre</span><select class="select" name="plan">${planOptions(plan)}</select></label>
        <label class="field"><span>Scans d'essai offerts</span><input class="input" type="number" name="trialTotal" min="0" value="${plan === "free" ? 20 : 0}"><span class="hint">Utilisés quand l'offre n'inclut pas (ou plus) de scans.</span></label>
      </div>
      <label class="check"><input type="checkbox" name="teamLocked" checked><span><b>Profils gérés par TriDDS</b><br><span class="hint">Le responsable du site ne peut ni ajouter ni retirer d'agents depuis l'appli. Décoché : il le peut, dans la limite de l'offre.</span></span></label>
      <details><summary class="hint" style="cursor:pointer">Options avancées</summary>
        <div style="display:grid;gap:12px;margin-top:12px">
          <div class="grid2">
            <label class="field"><span>Code personnalisé (facultatif)</span><input class="input mono" name="code" placeholder="généré automatiquement" style="text-transform:uppercase"></label>
            <label class="field"><span>Facturation</span><select class="select" name="billing"><option value="">À définir</option><option value="mensuelle">Mensuelle</option><option value="annuelle">Annuelle</option><option value="offert">Offert</option></select></label>
          </div>
          <div class="grid2">
            <label class="field"><span>Quota de scans mensuel (si différent de l'offre)</span><input class="input" type="number" name="scansOverride" min="0"></label>
            <label class="field"><span>Nombre d'agents max (si différent)</span><input class="input" type="number" name="agentsOverride" min="1"></label>
          </div>
          <label class="field"><span>Notes internes</span><textarea class="textarea" name="notes">${r.message ? "Demande : " + r.message : ""}</textarea></label>
        </div>
      </details>
      <label class="check"><input type="checkbox" name="sendEmail" ${raw(r.email ? "checked" : "")}><span>Envoyer le code par email au responsable</span></label>
      <div data-out></div>
    </form>`.toString(),
    foot: `<button class="btn btn-ghost" data-x>Annuler</button><button class="btn btn-primary" data-go style="margin-left:auto">${icon("check")}Créer l'accès</button>`,
    onMount(el, close, setBody) {
      const f = el.querySelector("[data-create]");
      const go = el.querySelector("[data-go]");
      f.plan.addEventListener("change", () => { if (f.plan.value !== "free" && f.trialTotal.value === "20") f.trialTotal.value = 0; });
      go.addEventListener("click", async () => {
        if (!f.reportValidity()) return;
        const fd = Object.fromEntries(new FormData(f).entries());
        const agents = (fd.agents || "").split("\n").map(s => s.trim()).filter(Boolean);
        if (!fd.code && !adm.v2) {
          // Le Worker précédent exige un code fourni.
          const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
          const skip = ["dechetterie", "decheterie", "site", "centre", "de", "du", "des", "la", "le", "les", "d", "l", "sur", "en"];
          const w = (fd.site || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z]+/).filter(x => x && !skip.includes(x));
          fd.code = (w[0] || "tri").slice(0, 4).toUpperCase() + "-" + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => a[b % a.length]).join("");
        }
        go.disabled = true; go.textContent = "Création…";
        try {
          const d = await adm.call("create", {
            client: fd.client, site: fd.site, responsable: fd.responsable, principal: fd.responsable, principalEmail: fd.principalEmail,
            agents, plan: fd.plan, trialTotal: fd.trialTotal, teamLocked: !!f.teamLocked.checked, code: fd.code,
            billing: fd.billing, scansOverride: fd.scansOverride, agentsOverride: fd.agentsOverride, notes: fd.notes,
            sendEmail: !!f.sendEmail.checked, requestId: r.id || ""
          });
          if (!adm.v2 && agents.length) {
            // Worker précédent : ajout des profils un par un.
            const all = (fd.responsable ? [fd.responsable] : []).concat(agents);
            for (const [i, name] of all.entries()) await adm.call("add-agent", { code: d.code, agent: name, role: i === 0 && fd.responsable ? "responsable" : "agent" }).catch(() => {});
          }
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
  const d = openDrawer({
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

function siteBody(s) {
  const lim = s.monthlyLimit || 0;
  return html`<div class="codebox"><b>${s.code}</b><button class="btn btn-ghost btn-sm" data-copy-code>${icon("copy")}Code</button><button class="btn btn-ghost btn-sm" data-copy-msg>${icon("copy")}Message</button></div>
    ${!s.active ? html`<div class="note int">Accès suspendu : plus personne ne peut se connecter.</div>` : ""}
    <div class="kpis" style="margin:0">
      <div class="kpi"><span>Photos analysées ce mois</span><b>${s.monthlyUsed ?? "?"}${lim ? " / " + lim : ""}</b><small>${lim ? "utilisées sur le quota" : "pas de quota mensuel"}</small></div>
      ${s.trialTotal ? html`<div class="kpi"><span>Scans d'essai</span><b>${s.trialUsed ?? 0} / ${s.trialTotal}</b><small>utilisés</small></div>` : ""}
    </div>
    <form data-edit style="display:grid;gap:12px">
      <div class="section-h">Informations et offre</div>
      <div class="grid2">
        <label class="field"><span>Nom du site</span><input class="input" name="site" value="${s.site}"></label>
        <label class="field"><span>Structure</span><input class="input" name="client" value="${s.client}"></label>
        <label class="field"><span>Responsable</span><input class="input" name="principal" value="${s.principal}"></label>
        <label class="field"><span>Email du responsable</span><input class="input" type="email" name="principalEmail" value="${s.principalEmail}"></label>
        <label class="field"><span>Offre</span><select class="select" name="plan">${planOptions(s.plan)}</select></label>
        <label class="field"><span>Scans d'essai</span><input class="input" type="number" min="0" name="trialTotal" value="${s.trialTotal ?? 0}"></label>
        <label class="field"><span>Quota mensuel spécifique</span><input class="input" type="number" min="0" name="scansOverride" value="${s.scansOverride ?? ""}" placeholder="selon l'offre"></label>
        <label class="field"><span>Agents max spécifique</span><input class="input" type="number" min="1" name="agentsOverride" value="${s.agentsOverride ?? ""}" placeholder="selon l'offre"></label>
        <label class="field"><span>Facturation</span><select class="select" name="billing">${["", "mensuelle", "annuelle", "offert"].map(v => html`<option value="${v}" ${raw(s.billing === v ? "selected" : "")}>${v || "À définir"}</option>`)}</select></label>
        <label class="field"><span>Payé jusqu'au</span><input class="input" type="date" name="paidUntil" value="${s.paidUntil || ""}" lang="fr-FR"></label>
      </div>
      <label class="check"><input type="checkbox" name="teamLocked" ${raw(s.teamLocked ? "checked" : "")}><span><b>Profils gérés par TriDDS</b><br><span class="hint">Décoché : le responsable du site ajoute ou retire ses agents dans la limite de l'offre.</span></span></label>
      <label class="field"><span>Notes internes</span><textarea class="textarea" name="notes">${s.notes}</textarea></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" type="submit">Enregistrer</button><button class="btn btn-ghost" type="button" data-act="reset">Remettre les compteurs à zéro</button></div>
    </form>
    <div class="section-h">Profils (${s.agents}${s.maxAgents ? " sur " + s.maxAgents : ""})</div>
    <div class="panel" style="padding:4px 12px">${(s.agentsList || []).length ? s.agentsList.map(a => html`<div class="agent-row" data-agent="${a.name}">
      <div class="name"><b>${a.name}</b>${a.role === "responsable" ? html` <span class="pill ink" style="display:inline-flex">Responsable</span>` : ""}
        <span>${a.activeSession ? "Connecté sur " + a.activeSession.deviceName : a.lastSeen ? "Vu " + relTime(a.lastSeen) : "Jamais connecté"}</span></div>
      ${a.activeSession ? html`<button class="btn btn-ghost btn-sm" data-ag="kick">Déconnecter</button>` : ""}
      ${a.role !== "responsable" ? html`<button class="btn btn-ghost btn-sm" data-ag="resp">Responsable</button>` : ""}
      <button class="btn btn-ghost btn-sm" data-ag="rename" aria-label="Renommer">${icon("edit")}</button>
      <button class="btn btn-danger btn-sm" data-ag="remove" aria-label="Retirer">${icon("trash")}</button>
    </div>`) : html`<p class="hint" style="padding:10px 0">Aucun profil : personne ne peut se connecter.</p>`}</div>
    <form data-add style="display:flex;gap:8px"><input class="input" name="name" placeholder="Ajouter un profil (Prénom Nom)" required><button class="btn btn-primary" type="submit">${icon("plus")}Ajouter</button></form>`.toString();
}

function bindSite(adm, el, s, close) {
  const refresh = async (code = s.code) => {
    await adm.reload();
    adm.render();
    close();
    openSite(adm, code);
  };
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
      if (a === "reset") return run(() => adm.call("update", { code: s.code, resetUsage: true }), "Compteurs remis à zéro");
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
    run(() => adm.call("update", Object.assign(fd, { code: s.code, teamLocked: !!f.teamLocked.checked })), "Modifications enregistrées");
  });
  el.querySelector("[data-add]").addEventListener("submit", e => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (name) run(() => adm.call("add-agent", { code: s.code, agent: name, role: "agent" }), name + " ajouté");
  });
}
