// Profil : site, offre, quota de scans, outils du responsable (équipe, base produits, mémoire).

import { html, raw, icon, toast, confirmDialog, openSheet, relTime, esc } from "../shared/ui.js";
import { post } from "../shared/api.js";
import { planLabel } from "../shared/plans.js";
import { loadBase, destination } from "../shared/catalog.js";
import { sess, quota, isDemo, cache, clearSess } from "./store.js";
import { memory, forget, syncMemory, memoryCount } from "./memory.js";
import { topbar, productRow } from "./common.js";

const siteCall = (action, data = {}) => post("site-admin", Object.assign({ action, code: sess.code, agent: sess.agent, sessionId: sess.sessionId }, data));

export const profileView = {
  tab: "profile",
  render() {
    const q = quota();
    const pct = q.total ? Math.round((q.left / q.total) * 100) : 0;
    const resp = sess.agentRole === "responsable";
    const offer = isDemo() ? "Démonstration" : (sess.planName || planLabel(sess.plan, sess.trialTotal));
    return html`${topbar({ title: "Profil" })}
      <div class="profile wrap">
        <section class="card">
          <dl class="kv">
            <dt>Agent</dt><dd>${sess.agent}${resp ? " (responsable)" : ""}</dd>
            <dt>Site</dt><dd>${sess.site}</dd>
            ${sess.clientName && sess.clientName !== sess.site ? html`<dt>Structure</dt><dd>${sess.clientName}</dd>` : ""}
            <dt>Accès</dt><dd>${offer}</dd>
          </dl>
          ${sess.trialExpired ? html`<p class="note hors" style="margin-top:12px">Votre mois d'essai est terminé. La recherche reste disponible ; pour continuer avec l'analyse photo, contactez TriDDS.</p>` : ""}
          ${isDemo() ? html`<p class="hint" style="margin-top:12px">Mode démonstration : recherche et guide complets, sans analyse photo, mémoire d'équipe ni journal partagé.</p>`
            : q.total ? html`<div class="meter ${pct <= 10 ? "low" : ""}"><div style="display:flex;justify-content:space-between"><b>Photos analysées</b><b>${q.left} restantes sur ${q.total}</b></div>
                <div class="bar"><i style="width:${pct}%"></i></div><p>${q.kind === "mois" ? "Le compteur repart le 1er du mois." : "Essai offert par TriDDS."}</p></div>`
            : html`<p class="hint" style="margin-top:12px">L'analyse photo n'est pas incluse dans cet accès. La recherche reste illimitée.</p>`}
        </section>

        ${resp && !isDemo() ? html`<nav class="menu" aria-label="Outils du responsable">
          <button class="menu-item" data-go="access">${icon("lock")}<div><b>Accès du site</b><span>Code du site, email de récupération</span></div>${icon("chevron")}</button>
          ${!sess.teamLocked ? html`<button class="menu-item" data-go="team">${icon("team")}<div><b>Mon équipe</b><span>Ajouter ou retirer un agent, désigner le responsable</span></div>${icon("chevron")}</button>` : ""}
          <button class="menu-item" data-go="catalog">${icon("box")}<div><b>Produits du site</b><span>${sess.canManageCatalog ? "Fiches propres à votre déchèterie" : "Inclus à partir de l'offre Déchèterie"}</span></div>${icon("chevron")}</button>
          <button class="menu-item" data-go="memory">${icon("brain")}<div><b>Mémoire de l'équipe</b><span>${memoryCount()} marque${memoryCount() > 1 ? "s" : ""} reconnue${memoryCount() > 1 ? "s" : ""} par les photos</span></div>${icon("chevron")}</button>
        </nav>` : ""}

        <nav class="menu">
          ${isDemo() || resp ? html`<a class="menu-item" href="./pricing.html">${icon("flash")}<div><b>${isDemo() ? "Obtenir un accès" : "Changer d'offre"}</b><span>Voir les offres et nous écrire</span></div>${icon("chevron")}</a>` : ""}
          <button class="menu-item" data-go="micdiag">${icon("mic")}<div><b>Diagnostic du micro</b><span>Si la dictée ne répond pas sur ce téléphone</span></div>${icon("chevron")}</button>
          <button class="menu-item" data-install hidden>${icon("download")}<div><b>Installer sur ce téléphone</b><span>Ouvrir TriDDS comme une application</span></div>${icon("chevron")}</button>
          <button class="menu-item" data-logout>${icon("logout")}<div><b>${isDemo() ? "Quitter la démonstration" : "Se déconnecter"}</b><span>${isDemo() ? "Retour à l'écran de connexion" : "Libère votre profil pour un autre téléphone"}</span></div></button>
        </nav>
        <p class="hint" style="text-align:center">TriDDS ${esc((window.APP_CONFIG || {}).VERSION || "")}</p>
      </div>`.toString();
  },
  mount(el, app) {
    el.addEventListener("click", async e => {
      const g = e.target.closest("[data-go]");
      if (g) { team = null; items = null; access = null; return app.go(g.dataset.go); }
      if (e.target.closest("[data-logout]")) {
        if (isDemo() || await confirmDialog({ title: "Se déconnecter ?", message: "Votre profil est libéré pour un autre appareil. Vous pourrez le reprendre en un geste depuis l'écran de connexion.", ok: "Se déconnecter" })) app.logout();
      }
      if (e.target.closest("[data-install]") && window.__installPrompt) {
        window.__installPrompt.prompt();
        window.__installPrompt = null;
        app.refresh();
      }
    });
    if (window.__installPrompt) el.querySelector("[data-install]").hidden = false;
  }
};

window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); window.__installPrompt = e; });

// ---------- équipe ----------
let team = null;
export const teamView = {
  tab: "profile",
  render() {
    const locked = sess.teamLocked;
    const max = sess.maxAgents;
    return html`${topbar({ title: "Mon équipe", back: true })}
      <div class="profile wrap">
        ${locked ? html`<div class="note">Les profils de ce site sont gérés par TriDDS. Pour ajouter ou retirer un agent, écrivez-nous : c'est fait dans la journée.</div>` : html`<p class="hint">Chaque agent choisit son nom à la connexion, avec le code du site. Un profil ne peut être ouvert que sur un téléphone à la fois.</p>`}
        <section class="card" data-team>${team ? teamList(team) : html`<div class="empty-state"><span class="spinner"></span></div>`}</section>
        ${!locked ? html`<form class="card" data-add style="display:grid;gap:12px">
          <label class="field"><span>Ajouter un agent${max ? ` (${team ? team.length : "…"} sur ${max} inclus)` : ""}</span><input class="input" name="name" placeholder="Prénom Nom" autocomplete="off" required></label>
          <button class="btn btn-primary" type="submit">${icon("plus")}Ajouter</button>
        </form>` : ""}
      </div>`.toString();
  },
  mount(el, app) {
    if (!team) load();
    async function load() {
      try {
        const d = await siteCall("team");
        team = d.team || [];
        if (d.teamLocked !== undefined) sess.teamLocked = !!d.teamLocked;
        if (d.maxAgents !== undefined) sess.maxAgents = d.maxAgents;
      } catch (e) { team = []; app.handleError(e); }
      if (app.screen === "team") app.refresh();
    }
    el.addEventListener("click", async e => {
      const pr = e.target.closest("[data-promote]");
      if (pr) {
        const name = pr.dataset.promote;
        if (!(await confirmDialog({ title: `Désigner ${name} responsable ?`, message: "Vous redeviendrez agent : la gestion de l'équipe et des accès passera à " + name + ".", ok: "Désigner" }))) return;
        try { await siteCall("set-user-role", { name, role: "responsable" }); toast(name + " est responsable"); sess.agentRole = "agent"; sess.canManageUsers = false; sess.canManageCatalog = false; app.go("profile", { replace: true }); } catch (err) { app.handleError(err); }
        return;
      }
      const rm = e.target.closest("[data-remove]");
      if (!rm) return;
      const name = rm.dataset.remove;
      if (!(await confirmDialog({ title: `Retirer ${name} ?`, message: "Ce profil ne pourra plus se connecter.", ok: "Retirer", danger: true }))) return;
      try { await siteCall("remove-user", { name }); team = null; toast(name + " retiré"); load(); } catch (err) { app.handleError(err); }
    });
    const add = el.querySelector("[data-add]");
    if (add) add.addEventListener("submit", async e => {
      e.preventDefault();
      const name = add.name.value.trim();
      if (!name) return;
      try { await siteCall("add-user", { name, role: "agent" }); toast(name + " ajouté"); team = null; load(); } catch (err) { app.handleError(err); }
    });
  }
};

function teamList(list) {
  if (!list.length) return html`<p class="hint">Aucun profil.</p>`;
  return html`${list.map(a => html`<div class="person"><span class="av">${a.name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase()}</span>
    <div><b>${a.name}${a.role === "responsable" ? html` <span class="pill-mini">responsable</span>` : ""}</b><span>${a.activeSession ? html`<span class="dot-on"></span>Connecté sur ${a.activeSession.deviceName}` : a.lastSeen ? "Vu " + relTime(a.lastSeen) : "Jamais connecté"}</span>
      ${!sess.teamLocked && a.role !== "responsable" ? html`<div class="person-actions"><button class="btn btn-quiet btn-sm" data-promote="${a.name}">Désigner responsable</button><button class="btn btn-quiet btn-sm" style="color:var(--int-text)" data-remove="${a.name}">Retirer</button></div>` : ""}
    </div>
  </div>`)}`;
}

// ---------- accès du site ----------
let access = null;
export const accessView = {
  tab: "profile",
  render() {
    return html`${topbar({ title: "Accès du site", back: true })}
      <div class="profile wrap">
        ${access ? html`
        <section class="card" style="display:grid;gap:12px">
          <div class="section-h">Code du site</div>
          <div class="codebox"><b>${access.code}</b><button class="btn btn-ghost btn-sm" data-copy>${icon("copy")}Copier</button></div>
          <p class="hint">C'est le mot de passe du site : il est commun à toute l'équipe. Si vous l'avez transmis à quelqu'un qui ne devrait plus y avoir accès, changez-le. Le changement est confirmé par un lien envoyé à l'email de récupération, puis tout le monde se reconnecte avec le nouveau code.</p>
          ${access.pending ? html`<div class="note">${icon("mail")}<span>Demande en attente de confirmation (${access.pending.type === "code" ? "changement de code" : "nouvel email"}) : un lien a été envoyé à ${access.pending.sentTo}. Il est valable 24 h.</span></div>` : ""}
          <button class="btn btn-ghost" data-change>${icon("refresh")}Changer le code du site</button>
        </section>
        <form class="card" data-email style="display:grid;gap:12px">
          <div class="section-h">Email de récupération</div>
          <p class="hint">Reçoit le code en cas d'oubli (bouton « Code oublié » à la connexion) et à chaque changement de code. Pour la remplacer, un lien de confirmation est envoyé à l'adresse actuelle.</p>
          <label class="field"><span>Email du responsable</span><input class="input" type="email" name="email" value="${access.recoveryEmail}" required autocomplete="email"></label>
          <button class="btn btn-primary" type="submit">Enregistrer</button>
        </form>` : html`<div class="empty-state"><span class="spinner"></span></div>`}
      </div>`.toString();
  },
  mount(el, app) {
    if (!access) {
      siteCall("access").then(d => { access = d; if (app.screen === "access") app.refresh(); }).catch(e => { app.handleError(e); app.back(); });
      return;
    }
    el.querySelector("[data-copy]").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(access.code); toast("Code copié"); } catch (e) { toast(access.code, { ms: 6000 }); }
    });
    el.querySelector("[data-email]").addEventListener("submit", async e => {
      e.preventDefault();
      try {
        const d = await siteCall("set-recovery-email", { email: e.target.email.value.trim() });
        if (d.pending) { access.pending = { type: "email", sentTo: d.sentTo }; toast("Lien de confirmation envoyé à " + d.sentTo + ". L'adresse changera après confirmation.", { ms: 8000 }); app.refresh(); }
        else { access.recoveryEmail = d.recoveryEmail; toast("Email enregistré"); }
      } catch (err) { app.handleError(err); }
    });
    el.querySelector("[data-change]").addEventListener("click", () => {
      openSheet({
        title: "Changer le code du site",
        body: html`<p>Un lien de confirmation sera envoyé à ${access.recoveryEmail || "l'email de récupération"}. Après confirmation, tous les agents seront déconnectés et le nouveau code sera envoyé à cette adresse.</p>
          <label class="field"><span>Nouveau code (ou laissez vide pour en générer un)</span><input class="input code-input" data-new placeholder="Ex. : NANC-7K2P4F" autocapitalize="characters" autocomplete="off"></label>
          <p class="hint">Préfixe, tiret, puis au moins 6 lettres et chiffres mélangés. Le plus simple : laisser vide.</p>`.toString(),
        foot: `<button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-int" data-go>Changer le code</button>`,
        onMount(sheet, close) {
          const input = sheet.querySelector("[data-new]");
          input.addEventListener("input", () => { input.value = input.value.toUpperCase().replace(/\s/g, ""); });
          sheet.querySelector("[data-go]").addEventListener("click", async () => {
            const btn = sheet.querySelector("[data-go]");
            btn.disabled = true; btn.textContent = "Changement…";
            try {
              const d = await siteCall("change-code", { newCode: input.value.trim() });
              close();
              access.pending = { type: "code", sentTo: d.sentTo };
              toast("Lien de confirmation envoyé à " + d.sentTo + ". Le code changera après confirmation.", { ms: 8000 });
              app.refresh();
            } catch (err) { btn.disabled = false; btn.textContent = "Changer le code"; app.handleError(err); }
          });
        }
      });
    });
  }
};

// ---------- produits du site ----------
let items = null;
export const catalogView = {
  tab: "profile",
  render() {
    const can = sess.canManageCatalog;
    return html`${topbar({ title: "Produits du site", back: true })}
      <div class="profile wrap">
        <p class="hint">Ajoutez les produits propres à votre déchèterie : ils apparaissent dans la recherche de toute l'équipe.</p>
        ${can ? html`<button class="btn btn-primary btn-lg" data-new>${icon("plus")}Nouvelle fiche</button>` : html`<div class="note">La base produits du site est incluse à partir de l'offre Déchèterie.</div>`}
        <div class="rows" data-list>${items ? (items.length ? items.map((it, i) => productRow(it, `data-i="${i}"`)) : html`<p class="hint">Aucune fiche ajoutée pour l'instant.</p>`) : html`<div class="empty-state"><span class="spinner"></span></div>`}</div>
      </div>`.toString();
  },
  mount(el, app) {
    const load = async () => {
      try { const d = await siteCall("catalog-list"); items = d.items || []; loadBase(items); cache.catalog = { code: sess.code, items }; }
      catch (e) { items = []; app.handleError(e); }
      if (app.screen === "catalog") app.refresh();
    };
    if (!items) load();
    el.addEventListener("click", e => {
      if (e.target.closest("[data-new]")) return editItem(app, null, () => { items = null; load(); });
      const b = e.target.closest("[data-i]");
      if (b && sess.canManageCatalog) editItem(app, items[+b.dataset.i], () => { items = null; load(); });
    });
  }
};

function editItem(app, it, done) {
  const v = it || { n: "", f: "E", x: "", c: "", s: "", y: [] };
  openSheet({
    title: it ? "Modifier la fiche" : "Nouvelle fiche",
    body: html`<form data-form style="display:grid;gap:12px">
      <label class="field"><span>Nom du produit</span><input class="input" name="n" value="${v.n}" required></label>
      <label class="field"><span>Flux</span><select class="select" name="f">
        ${[["E", "EcoDDS"], ["H", "Hors EcoDDS"], ["C", "Refusé / à isoler"]].map(([k, l]) => html`<option value="${k}" ${raw(v.f === k ? "selected" : "")}>${l}</option>`)}</select></label>
      <label class="field"><span>Bac (catégorie)</span><input class="input" name="x" value="${v.x}" placeholder="Pâteux, Solvants, Acides…" required></label>
      <label class="field"><span>Seuil EcoDDS (facultatif)</span><input class="input" name="s" value="${v.s}" placeholder="≤ 5 litres"></label>
      <label class="field"><span>Consigne (facultatif)</span><input class="input" name="c" value="${v.c}"></label>
      <label class="field"><span>Autres noms, marques (séparés par des virgules)</span><input class="input" name="y" value="${(v.y || []).join(", ")}"></label>
    </form>`.toString(),
    foot: `${it ? '<button class="btn btn-danger" data-del>Supprimer</button>' : '<button class="btn btn-ghost" data-close>Annuler</button>'}<button class="btn btn-primary" data-save>Enregistrer</button>`,
    onMount(el, close) {
      const form = el.querySelector("[data-form]");
      el.querySelector("[data-save]").addEventListener("click", async () => {
        if (!form.reportValidity()) return;
        const item = { id: it ? it.id : "", n: form.n.value.trim(), f: form.f.value, x: form.x.value.trim(), s: form.s.value.trim(), c: form.c.value.trim(), y: form.y.value };
        try { await siteCall("catalog-save", { item }); close(); toast("Fiche enregistrée"); done(); } catch (e) { app.handleError(e); }
      });
      const del = el.querySelector("[data-del]");
      if (del) del.addEventListener("click", async () => {
        if (!(await confirmDialog({ title: "Supprimer cette fiche ?", ok: "Supprimer", danger: true }))) return;
        try { await siteCall("catalog-delete", { id: it.id }); close(); toast("Fiche supprimée"); done(); } catch (e) { app.handleError(e); }
      });
    }
  });
}

// ---------- mémoire ----------
export const memoryView = {
  tab: "profile",
  render() {
    const entries = Object.entries(memory.brands || {}).sort((a, b) => (b[1].n || 0) - (a[1].n || 0));
    return html`${topbar({ title: "Mémoire de l'équipe", back: true })}
      <div class="profile wrap">
        <p class="hint">Quand un agent valide ou corrige une photo, la marque lue est associée au bon produit. Les photos suivantes la reconnaissent directement. Supprimez une association si elle est fausse.</p>
        <div class="rows">${entries.length ? entries.map(([brand, e]) => {
          const d = destination({ f: e.f, x: e.c });
          return html`<div class="row ${d.tone}" style="cursor:default"><span class="row-main"><b>${brand}</b><span>${e.p || "?"}, vu ${e.n || 1} fois</span></span>
            <span class="row-dest"><b>${d.bac}</b><span>${d.fluxLabel}</span></span>
            <button class="btn btn-danger btn-sm" data-forget="${brand}" aria-label="Supprimer ${brand}">${icon("trash")}</button></div>`;
        }) : html`<div class="empty-state">${icon("brain")}<b>Aucune marque apprise</b><span>Elles s'ajoutent à chaque photo validée.</span></div>`}</div>
      </div>`.toString();
  },
  mount(el, app) {
    // Une seule synchronisation par ouverture de l'écran, et un rafraîchissement seulement si
    // le contenu a changé : sinon chaque rafraîchissement relançait une synchronisation (boucle).
    if (!app.state.memorySyncing) {
      app.state.memorySyncing = true;
      const before = JSON.stringify(memory.brands || {});
      syncMemory().then(() => {
        if (app.screen === "memory" && JSON.stringify(memory.brands || {}) !== before) app.refresh();
      }).finally(() => { app.state.memorySyncing = false; });
    }
    el.addEventListener("click", async e => {
      const b = e.target.closest("[data-forget]");
      if (!b) return;
      const brand = b.dataset.forget;
      if (!(await confirmDialog({ title: `Oublier « ${brand} » ?`, message: "Les prochaines photos de cette marque ne s'appuieront plus sur cette association.", ok: "Oublier", danger: true }))) return;
      try { await forget(brand); toast("Association supprimée"); app.refresh(); } catch (err) { app.handleError(err); }
    });
  }
};
