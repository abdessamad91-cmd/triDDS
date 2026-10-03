// Compteurs d'usage d'un site, sérialisés par Cloudflare (Durable Object) :
// une instance par code de site, exécution strictement séquentielle, stockage fort.
// Évite les scans simultanés non facturés et les secondes lectures gratuites multiples
// que permettait le lecture-modification-écriture sur KV.
//
// Les valeurs sont initialisées au premier appel à partir des compteurs KV du site (migration
// sans intervention), puis le DO fait foi ; le Worker recopie ses résultats dans KV pour l'affichage.

const monthOf = (iso) => iso.slice(0, 7);
const dayOf = (iso) => iso.slice(0, 10);

export class SiteUsage {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async load(seed) {
    let u = await this.state.storage.get("usage");
    if (!u) {
      u = { month: seed && seed.usageMonth ? seed.usageMonth : monthOf(new Date().toISOString()), monthlyUsed: (seed && seed.monthlyUsed) || 0, trialUsed: (seed && seed.trialUsed) || 0, imgDay: "", imgCount: 0, retries: {} };
    }
    const now = new Date().toISOString();
    if (u.month !== monthOf(now)) { u.month = monthOf(now); u.monthlyUsed = 0; }
    if (u.imgDay !== dayOf(now)) { u.imgDay = dayOf(now); u.imgCount = 0; }
    return u;
  }

  async save(u) { await this.state.storage.put("usage", u); }

  view(u) { return { usageMonth: u.month, monthlyUsed: u.monthlyUsed, trialUsed: u.trialUsed, imgCount: u.imgCount }; }

  async fetch(request) {
    const body = await request.json().catch(() => ({}));
    const op = body.op || "get";
    const now = Date.now();
    const u = await this.load(body.seed);
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

    if (op === "get") return json({ ok: true, usage: this.view(u) });

    if (op === "reset") {
      u.monthlyUsed = 0; u.trialUsed = 0; u.retries = {};
      await this.save(u);
      return json({ ok: true, usage: this.view(u) });
    }

    if (op === "charge") {
      // monthlyLimit, trialTotal, trialExpired, agent, hash
      const monthlyLimit = Number(body.monthlyLimit) || 0;
      const trialTotal = Number(body.trialTotal) || 0;
      let charged = null;
      if (monthlyLimit > 0 && u.monthlyUsed < monthlyLimit) { u.monthlyUsed++; charged = "monthly"; }
      else if (trialTotal - u.trialUsed > 0 && !body.trialExpired) { u.trialUsed++; charged = "trial"; }
      if (!charged) return json({ ok: false, reason: "quota", usage: this.view(u) }, 403);
      if (body.agent) u.retries[body.agent] = { hash: body.hash || "", at: now, left: 1 };
      await this.save(u);
      return json({ ok: true, charged, usage: this.view(u) });
    }

    if (op === "retry") {
      const r = body.agent ? u.retries[body.agent] : null;
      if (!r || !r.left || r.hash !== (body.hash || "") || now - r.at > 180000) return json({ ok: false, reason: "no-retry", usage: this.view(u) }, 409);
      r.left = 0;
      await this.save(u);
      return json({ ok: true, usage: this.view(u) });
    }

    if (op === "refund") {
      if (body.charged === "monthly") u.monthlyUsed = Math.max(0, u.monthlyUsed - 1);
      if (body.charged === "trial") u.trialUsed = Math.max(0, u.trialUsed - 1);
      if (body.mode === "retry" && body.agent && u.retries[body.agent]) u.retries[body.agent].left = 1;
      await this.save(u);
      return json({ ok: true, usage: this.view(u) });
    }

    if (op === "img") {
      const limit = Number(body.limit) || 40;
      if (u.imgCount >= limit) return json({ ok: false, reason: "daily", usage: this.view(u) }, 429);
      u.imgCount++;
      await this.save(u);
      return json({ ok: true, usage: this.view(u) });
    }

    // ---------- journal des tris du site ----------
    // Une clé par jour (« j:AAAA-MM-JJ »), entrées identifiées par l'id du client ; 12 mois conservés.
    if (op === "journal-sync") {
      const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
      const days = new Map();
      const dayFor = e => (e.t || new Date().toISOString()).slice(0, 10);
      const loadDay = async d => { if (!days.has(d)) days.set(d, (await this.state.storage.get("j:" + d)) || []); return days.get(d); };
      for (const it of items) {
        if (it.op === "add" && it.entry && it.entry.id) {
          const e = it.entry;
          const list = await loadDay(dayFor(e));
          const i = list.findIndex(x => x.id === e.id);
          if (i >= 0) list[i] = Object.assign(list[i], e); else list.push(e);
        } else if (it.op === "update" && it.id && it.patch) {
          // L'entrée est récente : on la cherche sur les 10 derniers jours.
          for (let k = 0; k < 10; k++) {
            const d = new Date(now - k * 86400000).toISOString().slice(0, 10);
            const list = await loadDay(d);
            const e = list.find(x => x.id === it.id);
            if (e) { Object.assign(e, it.patch); break; }
          }
        }
      }
      for (const [d, list] of days) await this.state.storage.put("j:" + d, list.slice(-400));
      // Purge au-delà de 12 mois (une clé par jour : au plus 365 clés vivantes).
      const cutoff = new Date(now - 366 * 86400000).toISOString().slice(0, 10);
      const old = await this.state.storage.list({ prefix: "j:", end: "j:" + cutoff });
      for (const k of old.keys()) await this.state.storage.delete(k);
      return json({ ok: true, synced: items.length });
    }
    if (op === "journal-list") {
      const daysBack = Math.min(Math.max(Number(body.days) || 30, 1), 366);
      const limit = Math.min(Number(body.limit) || 500, 2000);
      const start = new Date(now - daysBack * 86400000).toISOString().slice(0, 10);
      const all = [];
      const map = await this.state.storage.list({ prefix: "j:", start: "j:" + start });
      for (const list of map.values()) for (const e of list) all.push(e);
      all.sort((a, b) => (b.t || "").localeCompare(a.t || ""));
      return json({ ok: true, items: all.slice(0, limit), total: all.length });
    }
    if (op === "journal-stats") {
      const month = /^\d{4}-\d{2}$/.test(body.month || "") ? body.month : new Date(now).toISOString().slice(0, 7);
      const map = await this.state.storage.list({ prefix: "j:" + month });
      const st = { month, total: 0, scans: 0, confirmed: 0, corrected: 0, toReview: 0, refused: 0, eco: 0, hors: 0, byAgent: {}, products: {}, corrections: {} };
      for (const list of map.values()) for (const e of list) {
        st.total++;
        if (e.src === "scan") st.scans++;
        if (e.v === "corrected") { st.corrected++; const k = (e.n || "?") + " → " + (e.to || "?"); st.corrections[k] = (st.corrections[k] || 0) + 1; }
        else if (e.v === "confirmed" || e.v === "auto" || e.v === "consulted") st.confirmed++;
        if (e.review === false) st.toReview++;
        if (e.tone === "int") st.refused++; else if (e.tone === "eco") st.eco++; else if (e.tone === "hors") st.hors++;
        if (e.agent) st.byAgent[e.agent] = (st.byAgent[e.agent] || 0) + 1;
        const name = e.to || e.n || "?";
        st.products[name] = (st.products[name] || 0) + 1;
      }
      const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10);
      return json({ ok: true, stats: Object.assign(st, { topProducts: top(st.products), topCorrections: top(st.corrections), products: undefined, corrections: undefined }) });
    }

    return json({ ok: false, reason: "op" }, 400);
  }
}
