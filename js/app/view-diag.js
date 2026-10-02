// Diagnostic de la dictée : journal de tous les événements de reconnaissance vocale,
// pour comprendre ce qui se passe sur un téléphone donné sans outil de développement.

import { html, icon, toast } from "../shared/ui.js";
import { topbar } from "./common.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let log = [];
let current = null;
let t0 = 0;

function line(text) {
  const t = ((performance.now() - t0) / 1000).toFixed(2);
  log.push(`${t}s  ${text}`);
}

async function envInfo() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let perm = "inconnue";
  try { if (navigator.permissions) perm = (await navigator.permissions.query({ name: "microphone" })).state; } catch (e) { perm = "non interrogeable"; }
  return [
    `TriDDS ${(window.APP_CONFIG || {}).VERSION || "?"}`,
    `Reconnaissance vocale : ${SR ? "disponible" : "absente"}`,
    `Mode : ${standalone ? "application installée" : "navigateur"}`,
    `Permission micro : ${perm}`,
    `Réseau : ${navigator.onLine ? "en ligne" : "hors ligne"}`,
    `Navigateur : ${navigator.userAgent}`
  ];
}

function run(mode, redraw) {
  if (!SR) return toast("Reconnaissance vocale absente de ce navigateur.", { error: true });
  if (current) { line("start() refusé : un test est déjà en cours"); return redraw(); }
  const r = new SR();
  r.lang = "fr-FR";
  r.continuous = mode === "continu";
  r.interimResults = true;
  current = r;
  log = [];
  t0 = performance.now();
  line(`new SpeechRecognition(), continuous=${r.continuous}`);
  ["start", "audiostart", "soundstart", "speechstart", "speechend", "soundend", "audioend", "nomatch"].forEach(ev => {
    r.addEventListener(ev, () => { line("événement " + ev); redraw(); });
  });
  r.onresult = e => {
    const parts = [];
    for (let i = 0; i < e.results.length; i++) parts.push((e.results[i].isFinal ? "[final] " : "[interim] ") + e.results[i][0].transcript);
    line("result : " + parts.join(" | "));
    redraw();
  };
  r.onerror = e => { line("ERREUR " + e.error + (e.message ? " : " + e.message : "")); redraw(); };
  r.onend = () => { line("événement end"); current = null; redraw(); };
  try { r.start(); line("start() appelé"); } catch (e) { line("start() a levé une exception : " + e.message); current = null; }
  setTimeout(() => { if (current === r) { line("arrêt automatique après 8 s : stop()"); try { r.stop(); } catch (e) { /* ignore */ } redraw(); } }, 8000);
  redraw();
}

export const micDiagView = {
  tab: "profile",
  render() {
    return html`${topbar({ title: "Diagnostic du micro", back: true })}
      <div class="profile wrap">
        <p class="hint">Lancez un test, parlez une fois (« white spirit »), puis relancez un deuxième test. Tout ce que le téléphone signale est noté ci-dessous. Copiez le rapport et envoyez-le à TriDDS.</p>
        <section class="card"><pre class="diag" data-env>…</pre></section>
        <div class="actions" style="display:flex;gap:10px;flex-wrap:wrap;margin:14px 0">
          <button class="btn btn-primary" data-test="simple">${icon("mic")}Test (une phrase)</button>
          <button class="btn btn-ghost" data-test="continu">Test (continu)</button>
          <button class="btn btn-ghost" data-stop>Arrêter</button>
          <button class="btn btn-ghost" data-copy>${icon("copy")}Copier le rapport</button>
        </div>
        <section class="card"><pre class="diag" data-log>${log.length ? log.join("\n") : "Aucun test lancé."}</pre></section>
      </div>`.toString();
  },
  mount(el) {
    const envEl = el.querySelector("[data-env]");
    const logEl = el.querySelector("[data-log]");
    let env = [];
    envInfo().then(lines => { env = lines; envEl.textContent = lines.join("\n"); });
    const redraw = () => { logEl.textContent = log.length ? log.join("\n") : "Aucun test lancé."; };
    el.addEventListener("click", async e => {
      const t = e.target.closest("[data-test]");
      if (t) return run(t.dataset.test, redraw);
      if (e.target.closest("[data-stop]")) { if (current) { line("stop() demandé"); try { current.stop(); } catch (err) { /* ignore */ } redraw(); } return; }
      if (e.target.closest("[data-copy]")) {
        const report = env.concat(["", "--- journal ---"], log).join("\n");
        try { await navigator.clipboard.writeText(report); toast("Rapport copié"); }
        catch (err) { toast("Copie impossible : faites une capture d'écran.", { error: true }); }
      }
    });
  }
};
