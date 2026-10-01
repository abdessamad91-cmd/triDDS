// Outils d'interface partagés : échappement HTML, icônes, toasts, feuilles et confirmations.

export const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]));

// Gabarit HTML : les valeurs interpolées sont échappées, sauf celles marquées raw().
class Raw { constructor(v) { this.v = v; } toString() { return this.v; } }
export const raw = v => new Raw(v == null ? "" : String(v));
export function html(strings, ...values) {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (v instanceof Raw) out += v.v;
      else if (Array.isArray(v)) out += v.map(x => (x instanceof Raw ? x.v : esc(x))).join("");
      else if (v === false || v == null) out += "";
      else out += esc(v);
    }
  });
  return raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.8"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  upload: '<path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0V4z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 0"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  flash: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  wifiOff: '<path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.8M19 13a10 10 0 0 0-2.2-1.6M2 8.8a15 15 0 0 1 4.3-2.6M22 8.8A15 15 0 0 0 11 5M12 20h.01"/>',
  download: '<path d="M12 4v12m0 0-4-4m4 4 4-4"/><path d="M4 20h16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>'
};
export function icon(name, cls = "") {
  return raw(`<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`);
}

// ---------- toasts ----------
let toastHost;
export function toast(msg, { error = false, ms = 2800 } = {}) {
  if (!toastHost) {
    toastHost = document.createElement("div");
    toastHost.className = "toast-host";
    toastHost.setAttribute("role", "status");
    toastHost.setAttribute("aria-live", "polite");
    document.body.appendChild(toastHost);
  }
  toastHost.innerHTML = "";
  const el = document.createElement("div");
  el.className = "toast" + (error ? " err" : "");
  el.textContent = msg;
  toastHost.appendChild(el);
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.remove(), ms);
}

// ---------- fenêtres ouvertes (pour le bouton retour) ----------
const overlays = [];
export function registerOverlay(close) { overlays.push(close); return () => { const i = overlays.indexOf(close); if (i >= 0) overlays.splice(i, 1); }; }
export function closeTopOverlay() {
  const close = overlays.pop();
  if (!close) return false;
  close();
  return true;
}

// ---------- feuilles ----------
// openSheet({ title, sub, body, foot, onMount }) → { el, close }
export function openSheet({ title, sub = "", body = "", foot = "", onMount, onClose, label }) {
  const back = document.createElement("div");
  back.className = "sheet-backdrop";
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label || title)}">
    <div class="sheet-head"><div style="flex:1;min-width:0"><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>
    <button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Fermer">${icon("close")}</button></div>
    <div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ""}</div>`;
  const prevFocus = document.activeElement;
  let closed = false;
  let unregister = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    unregister();
    back.remove();
    document.removeEventListener("keydown", onKey);
    if (onClose) onClose();
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };
  const onKey = e => { if (e.key === "Escape") close(); };
  back.addEventListener("click", e => { if (e.target === back || e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(back);
  unregister = registerOverlay(close);
  const sheet = back.querySelector(".sheet");
  if (onMount) onMount(sheet, close);
  const first = sheet.querySelector("input, textarea, select");
  if (first && !matchMedia("(pointer:coarse)").matches) first.focus();
  return { el: sheet, close };
}

export function confirmDialog({ title, message = "", ok = "Confirmer", cancel = "Annuler", danger = false }) {
  return new Promise(resolve => {
    let answered = false;
    openSheet({
      title,
      body: message ? `<p style="font-size:16px;line-height:1.5">${esc(message)}</p>` : "",
      foot: `<button class="btn btn-ghost" data-close>${esc(cancel)}</button><button class="btn ${danger ? "btn-int" : "btn-primary"}" data-ok>${esc(ok)}</button>`,
      onMount(el, close) {
        el.querySelector("[data-ok]").addEventListener("click", () => { answered = true; resolve(true); close(); });
        el.querySelector("[data-ok]").focus();
      },
      onClose() { if (!answered) resolve(false); }
    });
  });
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function relTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return "il y a " + Math.round(diff / 60) + " min";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (d >= today) return "aujourd'hui " + time;
  const y = new Date(today); y.setDate(y.getDate() - 1);
  if (d >= y) return "hier " + time;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + " " + time;
}
