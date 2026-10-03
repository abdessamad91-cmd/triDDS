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

    return json({ ok: false, reason: "op" }, 400);
  }
}
