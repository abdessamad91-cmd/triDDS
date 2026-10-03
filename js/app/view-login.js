// Connexion : code du site, puis choix du profil. Pas d'inscription libre :
// les codes sont créés par TriDDS.

import { html, raw, icon, esc, confirmDialog } from "../shared/ui.js";
import { post, ApiError } from "../shared/api.js";
import { sess, applyAccess, saveSess, lastLogin, deviceName } from "./store.js";
import { afterLogin } from "./session.js";

let step = "code"; // code | names | forgot
let pending = null; // réponse du login (site, agents)
let msg = null; // { kind: "err"|"ok", text }

const initials = n => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");

export const loginView = {
  tabs: false,
  render() {
    const last = lastLogin();
    const m = msg ? html`<div class="${msg.kind === "ok" ? "login-ok" : "login-err"}" role="alert">${msg.text}</div>` : "";
    let card;
    if (step === "names" && pending) {
      card = html`<div class="login-card">
        <div><div class="hint">Site</div><div style="font-size:20px;font-weight:700">${pending.site}</div></div>
        <div class="field"><span>Qui êtes-vous ?</span>
          ${pending.agents.length
            ? html`<div class="names">${pending.agents.map(n => html`<button class="name-btn" data-agent="${n}"><span class="av">${initials(n)}</span>${n}</button>`)}</div>`
            : html`<p class="note hors">Aucun profil n'est encore créé sur ce site. Demandez à votre responsable ou à TriDDS d'ajouter votre nom.</p>`}
        </div>
        ${m}
        <button class="btn btn-quiet" data-step="code">Changer de code</button>
      </div>`;
    } else if (step === "forgot") {
      card = html`<form class="login-card" data-forgot>
        <div><div style="font-size:20px;font-weight:700">Code oublié</div>
        <p class="hint" style="margin-top:4px">Réservé au responsable du site : saisissez l'email donné à l'ouverture de l'accès, le code y sera renvoyé.</p></div>
        <label class="field"><span>Email du responsable</span><input class="input" type="email" name="email" autocomplete="email" required></label>
        ${m}
        <button class="btn btn-primary btn-lg" type="submit">Recevoir le code</button>
        <button class="btn btn-quiet" type="button" data-step="code">Retour</button>
      </form>`;
    } else {
      card = html`<form class="login-card" data-code>
        <label class="field"><span>Code du site</span>
          <input class="input code-input" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Ex. : NANC-7K2P4F" required value="${(last && last.code) || ""}"></label>
        ${m}
        <button class="btn btn-primary btn-lg" type="submit">Continuer</button>
      </form>`;
    }

    const resume = step === "code" && last && last.agent
      ? html`<button class="resume" data-resume>${icon("user")}<div><b>Reprendre : ${last.agent}</b><span>${last.site || last.code}</span></div>${icon("chevron")}</button>`
      : "";

    return html`<div class="login">
      <div class="login-in">
        <div class="login-brand"><img src="./assets/symbol-128.png" alt="" width="52" height="52"><b>TriDDS</b></div>
        <div><h1>Le bon bac, en deux secondes.</h1>
        <p class="lead" style="margin-top:8px">Cherchez un produit ou prenez-le en photo : TriDDS indique s'il va en EcoDDS, hors EcoDDS ou s'il doit être refusé.</p></div>
        ${resume}
        ${card}
        <a class="login-discover" href="./pricing.html">
          <div><b>Vous découvrez TriDDS ?</b><span>Voir les offres, tester la démo, demander un mois d'essai gratuit.</span></div>
          ${icon("chevron")}
        </a>
      </div>
      <div class="login-foot">
        <button data-demo>Essayer sans code</button>
        ${step !== "forgot" ? html`<button data-step="forgot">Code oublié</button>` : ""}
      </div>
    </div>`.toString();
  },

  mount(el, app) {
    const rerender = () => app.refresh();
    el.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", () => { step = b.dataset.step; msg = null; rerender(); }));

    el.querySelector("[data-demo]").addEventListener("click", () => {
      Object.assign(sess, { code: "DEMO", site: "Démonstration", agent: "Visiteur", plan: "free", planName: "Démo", sessionId: "DEMO", deviceName: deviceName(), trialTotal: 0, trialRemaining: 0, monthlyLimit: 0, monthlyRemaining: 0, memoryEnabled: false, canManageUsers: false, canManageCatalog: false });
      saveSess();
      step = "code"; msg = null;
      app.go("home", { replace: true });
    });

    const resume = el.querySelector("[data-resume]");
    if (resume) resume.addEventListener("click", async () => {
      const last = lastLogin();
      resume.disabled = true;
      try {
        pending = Object.assign(await post("auth", { action: "login", code: last.code }), { code: last.code });
        await startSession(app, last.agent);
      } catch (e) { resume.disabled = false; msg = { kind: "err", text: e.message }; rerender(); }
    });

    const codeForm = el.querySelector("[data-code]");
    if (codeForm) {
      const input = codeForm.querySelector("input");
      input.addEventListener("input", () => { input.value = input.value.toUpperCase().replace(/\s/g, ""); });
      if (!matchMedia("(pointer:coarse)").matches) input.focus();
      codeForm.addEventListener("submit", async e => {
        e.preventDefault();
        const code = input.value.trim().toUpperCase();
        if (!code) return;
        const btn = codeForm.querySelector("[type=submit]");
        btn.disabled = true; btn.textContent = "Vérification…";
        try {
          const d = await post("auth", { action: "login", code });
          pending = Object.assign(d, { code: d.code || code, agents: d.agents || [] });
          step = "names"; msg = null;
        } catch (err) {
          msg = { kind: "err", text: err.status === 401 ? "Ce code n'existe pas. Vérifiez la saisie, ou demandez-le à votre responsable." : err.message };
        }
        rerender();
      });
    }

    el.querySelectorAll("[data-agent]").forEach(b => b.addEventListener("click", async () => {
      el.querySelectorAll("[data-agent]").forEach(x => { x.disabled = true; });
      b.querySelector(".av").innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px"></span>';
      await startSession(app, b.dataset.agent);
      el.querySelectorAll("[data-agent]").forEach(x => { x.disabled = false; });
    }));

    const forgot = el.querySelector("[data-forgot]");
    if (forgot) forgot.addEventListener("submit", async e => {
      e.preventDefault();
      const email = forgot.email.value.trim();
      const btn = forgot.querySelector("[type=submit]");
      btn.disabled = true; btn.textContent = "Envoi…";
      try {
        const d = await post("forgot-code", { email });
        msg = { kind: "ok", text: d.message || "Si cet email est celui d'un responsable de site, le code vient d'être envoyé." };
      } catch (err) { msg = { kind: "err", text: err.message }; }
      rerender();
    });
  }
};

async function startSession(app, agent, force = false) {
  try {
    const d = await post("auth", { action: "start-session", code: pending.code, agent, sessionId: "", deviceName: deviceName(), force });
    sess.code = d.code || pending.code;
    sess.agent = agent;
    sess.sessionId = d.sessionId;
    sess.deviceName = deviceName();
    applyAccess(d);
    afterLogin();
    step = "code"; msg = null; pending = null;
    app.go("home", { replace: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const where = e.data && e.data.activeSession ? e.data.activeSession.deviceName : "un autre appareil";
      const ok = await confirmDialog({ title: `${agent} est déjà connecté`, message: `Une session est ouverte sur ${where}. Continuer ici fermera l'autre session.`, ok: "Continuer ici" });
      if (ok) return startSession(app, agent, true);
      return;
    }
    msg = { kind: "err", text: e.message || "Connexion impossible" };
    step = pending ? "names" : "code";
    app.refresh();
  }
}
