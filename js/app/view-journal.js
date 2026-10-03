// Journal du site : toutes les décisions de l'équipe (synchronisées), avec les lectures IA à vérifier.
// Les entrées de cet appareil s'envoient au site en arrière-plan ; celles des collègues arrivent
// à la connexion, à l'ouverture de cet écran et à chaque battement de session.

import { html, icon, relTime, toast } from "../shared/ui.js";
import { destination } from "../shared/catalog.js";
import { sess, isDemo, siteJournal, updateJournal } from "./store.js";
import { learn } from "./memory.js";
import { topbar, pickProduct } from "./common.js";
import { syncJournal } from "./journal-sync.js";

const FILTERS = [
  { id: "all", label: "Tout", test: () => true },
  { id: "review", label: "À vérifier", test: e => !e.reviewed },
  { id: "ok", label: "Validés", test: e => e.reviewed && !["corrected", "consulted"].includes(e.validationType) },
  { id: "corrected", label: "Corrigés", test: e => e.validationType === "corrected" },
  { id: "refused", label: "Refusés", test: e => toneOf(e) === "int" }
];
const PERIODS = [
  { id: "7", label: "7 jours", ms: 7 * 86400000 },
  { id: "30", label: "30 jours", ms: 30 * 86400000 },
  { id: "all", label: "Tout", ms: Infinity }
];

function toneOf(e) {
  const d = destination({ f: e.correctedFlux || e.flux, x: e.correctedCategory || e.category, overSeuil: e.overSeuil });
  return d ? d.tone : "";
}
function statusOf(e) {
  if (e.validationType === "corrected") return html`<span class="status fixed">Corrigé</span>`;
  if (!e.reviewed) return html`<span class="status review">À vérifier</span>`;
  if (e.validationType === "consulted") return html`<span class="status">Consulté</span>`;
  return html`<span class="status ok">${e.validationType === "auto" ? "Lu par l'IA" : "Validé"}</span>`;
}

function csvOf(list) {
  const esc = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const head = ["date", "heure", "agent", "produit lu", "produit retenu", "flux", "bac ou catégorie", "statut", "source", "seuil dépassé"];
  const rows = list.map(e => {
    const d = new Date(e.timestamp || 0);
    const flux = e.correctedFlux || e.flux;
    return [d.toLocaleDateString("fr-FR"), d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), e.agent || "", e.name || "", e.correctedTo || e.name || "",
      flux === "E" ? "EcoDDS" : "Hors EcoDDS", e.correctedCategory || e.category || "", e.validationType === "corrected" ? "corrigé" : !e.reviewed ? "à vérifier" : e.validationType === "consulted" ? "consulté" : "validé",
      e.source === "scan" || e.validationType === "auto" || e.model ? "photo" : "recherche", e.overSeuil ? "oui" : ""].map(esc).join(";");
  });
  return "﻿" + head.map(esc).join(";") + "\n" + rows.join("\n");
}

export const journalView = {
  tab: "journal",
  render(app) {
    const f = FILTERS.find(x => x.id === app.state.jrnFilter) || FILTERS[0];
    const period = PERIODS.find(x => x.id === app.state.jrnPeriod) || PERIODS[1];
    const onlyMine = app.state.jrnMine === true;
    const since = period.ms === Infinity ? 0 : Date.now() - period.ms;
    const all = siteJournal().filter(e => (e.timestamp || 0) >= since && (!onlyMine || e.agent === sess.agent));
    const list = all.filter(f.test);
    const isResp = sess.agentRole === "responsable";
    const agents = new Set(all.map(e => e.agent).filter(Boolean));
    return html`${topbar({ title: "Journal" })}
      <div class="wrap">
        ${!isDemo() ? html`<div class="chips" role="group" aria-label="Qui et quand">
          <button class="chip" data-mine="0" aria-pressed="${!onlyMine}">Tout le site</button>
          <button class="chip" data-mine="1" aria-pressed="${onlyMine}">Moi</button>
          ${PERIODS.map(p => html`<button class="chip" data-period="${p.id}" aria-pressed="${p.id === period.id}">${p.label}</button>`)}
        </div>` : ""}
        <div class="chips" role="group" aria-label="Filtrer le journal" style="margin-top:6px">${FILTERS.map(x => html`<button class="chip" data-f="${x.id}" aria-pressed="${x.id === f.id}">${x.label}<span class="n">${all.filter(x.test).length}</span></button>`)}</div>
        ${!isDemo() && all.length ? html`<p class="hint" style="margin:8px 0 0;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px"><span>${all.length} produit${all.length > 1 ? "s" : ""} sur ${period.id === "all" ? "toute la période" : "les " + period.label}${agents.size > 1 ? `, ${agents.size} agents` : ""}.</span>${isResp ? html`<button class="btn btn-quiet" data-csv style="min-height:44px">${icon("download")}Exporter en CSV</button>` : ""}</p>` : ""}
        <div class="pad rows" style="margin-top:10px">
          ${list.length ? list.slice(0, 200).map(e => {
            const flux = e.correctedFlux || e.flux;
            const d = destination({ f: flux, x: e.correctedCategory || e.category, overSeuil: e.overSeuil });
            const mine = !e.agent || e.agent === sess.agent;
            return html`<article class="entry ${d.tone}">
              <div class="entry-head"><b>${e.correctedTo || e.name}</b>${statusOf(e)}</div>
              ${e.correctedTo ? html`<s>Lu : ${e.name}</s>` : ""}
              <div class="entry-meta"><span>${d.tone === "int" ? d.kicker : d.fluxLabel + ", bac " + d.bac}</span><span>${relTime(e.timestamp)}</span>${e.source === "scan" || e.validationType === "auto" || e.model ? html`<span>${icon("camera")} photo${e.confidence ? ", " + Math.round(e.confidence) + " %" : ""}</span>` : ""}${e.agent ? html`<span>${e.agent}</span>` : ""}</div>
              ${!e.reviewed && mine ? html`<div class="two"><button class="btn btn-ghost btn-sm" data-fix="${e.id}">${icon("edit")}Corriger</button><button class="btn btn-eco btn-sm" data-ok="${e.id}">${icon("check")}Confirmer</button></div>` : ""}
            </article>`;
          }) : html`<div class="empty-state">${icon("list")}<b>${f.id === "review" ? "Rien à vérifier" : "Journal vide"}</b><span>${f.id === "review" ? "Toutes les lectures IA ont été confirmées ou corrigées." : "Les produits orientés par l'équipe apparaissent ici."}</span></div>`}
        </div>
      </div>`.toString();
  },
  mount(el, app) {
    // Une synchronisation par ouverture ; rafraîchissement seulement si le journal a changé.
    if (!isDemo() && !app.state.journalSyncing) {
      app.state.journalSyncing = true;
      const sig = () => JSON.stringify(siteJournal().map(e => e.id + e.validationType + e.reviewed));
      const before = sig();
      syncJournal().then(() => {
        if (app.screen === "journal" && sig() !== before) app.refresh();
      }).finally(() => { app.state.journalSyncing = false; });
    }
    el.addEventListener("click", async e => {
      const f = e.target.closest("[data-f]");
      if (f) { app.state.jrnFilter = f.dataset.f; return app.refresh(); }
      const m = e.target.closest("[data-mine]");
      if (m) { app.state.jrnMine = m.dataset.mine === "1"; return app.refresh(); }
      const p = e.target.closest("[data-period]");
      if (p) { app.state.jrnPeriod = p.dataset.period; return app.refresh(); }
      if (e.target.closest("[data-csv]")) {
        const period = PERIODS.find(x => x.id === app.state.jrnPeriod) || PERIODS[1];
        const since = period.ms === Infinity ? 0 : Date.now() - period.ms;
        const rows = siteJournal().filter(x => (x.timestamp || 0) >= since);
        const blob = new Blob([csvOf(rows)], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `tridds-journal-${(sess.site || sess.code || "site").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast(`${rows.length} ligne${rows.length > 1 ? "s" : ""} exportée${rows.length > 1 ? "s" : ""}`);
        return;
      }
      const ok = e.target.closest("[data-ok]");
      if (ok) {
        const it = updateJournal(ok.dataset.ok, { reviewed: true, validationType: "confirmed" });
        if (it && it.brand && it.name !== "Produit non identifié" && it.category !== "Produits non ID ou Laboratoire") learn(it.brand, it.name, it.flux, it.category);
        app.updateTabs();
        return app.refresh();
      }
      const fix = e.target.closest("[data-fix]");
      if (fix) {
        const it = siteJournal().find(x => x.id === fix.dataset.fix);
        const p = await pickProduct({ sub: "Lu : " + (it ? it.name : ""), initial: it ? it.name : "" });
        if (!p || !it) return;
        updateJournal(it.id, { correctedTo: p.n, correctedFlux: p.f, correctedCategory: p.x, validationType: "corrected", reviewed: true });
        if (it.brand) learn(it.brand, p.n, p.f, p.x, "correct");
        app.updateTabs();
        app.refresh();
      }
    });
  }
};
