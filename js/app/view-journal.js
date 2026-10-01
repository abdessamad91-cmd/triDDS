// Journal : chaque produit orienté sur cet appareil, avec les lectures IA à vérifier.

import { html, icon, relTime } from "../shared/ui.js";
import { destination } from "../shared/catalog.js";
import { siteJournal, updateJournal } from "./store.js";
import { learn } from "./memory.js";
import { topbar, pickProduct } from "./common.js";

const FILTERS = [
  { id: "all", label: "Tout", test: () => true },
  { id: "review", label: "À vérifier", test: e => !e.reviewed },
  { id: "ok", label: "Validés", test: e => e.reviewed && !["corrected", "consulted"].includes(e.validationType) },
  { id: "corrected", label: "Corrigés", test: e => e.validationType === "corrected" }
];

function statusOf(e) {
  if (e.validationType === "corrected") return html`<span class="status fixed">Corrigé</span>`;
  if (!e.reviewed) return html`<span class="status review">À vérifier</span>`;
  if (e.validationType === "consulted") return html`<span class="status">Consulté</span>`;
  return html`<span class="status ok">${e.validationType === "auto" ? "Lu par l'IA" : "Validé"}</span>`;
}

export const journalView = {
  tab: "journal",
  render(app) {
    const f = FILTERS.find(x => x.id === app.state.jrnFilter) || FILTERS[0];
    const journal = siteJournal();
    const list = journal.filter(f.test);
    return html`${topbar({ title: "Journal" })}
      <div class="wrap">
        <div class="chips" role="group" aria-label="Filtrer le journal">${FILTERS.map(x => html`<button class="chip" data-f="${x.id}" aria-pressed="${x.id === f.id}">${x.label}<span class="n">${journal.filter(x.test).length}</span></button>`)}</div>
        <div class="pad rows" style="margin-top:10px">
          ${list.length ? list.slice(0, 120).map(e => {
            const flux = e.correctedFlux || e.flux;
            const d = destination({ f: flux, x: e.correctedCategory || e.category, overSeuil: e.overSeuil });
            return html`<article class="entry ${d.tone}">
              <div class="entry-head"><b>${e.correctedTo || e.name}</b>${statusOf(e)}</div>
              ${e.correctedTo ? html`<s>Lu : ${e.name}</s>` : ""}
              <div class="entry-meta"><span>${d.tone === "int" ? d.kicker : d.fluxLabel + ", bac " + d.bac}</span><span>${relTime(e.timestamp)}</span>${e.source === "scan" || e.validationType === "auto" || e.model ? html`<span>${icon("camera")} scan${e.confidence ? ", " + Math.round(e.confidence) + " %" : ""}</span>` : ""}${e.agent ? html`<span>${e.agent}</span>` : ""}</div>
              ${!e.reviewed ? html`<div class="two"><button class="btn btn-ghost btn-sm" data-fix="${e.id}">${icon("edit")}Corriger</button><button class="btn btn-eco btn-sm" data-ok="${e.id}">${icon("check")}Confirmer</button></div>` : ""}
            </article>`;
          }) : html`<div class="empty-state">${icon("list")}<b>${f.id === "review" ? "Rien à vérifier" : "Journal vide"}</b><span>${f.id === "review" ? "Toutes les lectures IA ont été confirmées ou corrigées." : "Les produits que vous orientez apparaissent ici."}</span></div>`}
        </div>
      </div>`.toString();
  },
  mount(el, app) {
    el.addEventListener("click", async e => {
      const f = e.target.closest("[data-f]");
      if (f) { app.state.jrnFilter = f.dataset.f; return app.refresh(); }
      const ok = e.target.closest("[data-ok]");
      if (ok) {
        const it = updateJournal(ok.dataset.ok, { reviewed: true, validationType: "confirmed" });
        if (it && it.brand) learn(it.brand, it.name, it.flux, it.category);
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
