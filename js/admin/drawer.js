// Panneau latéral réutilisable de l'administration.

import { esc, icon } from "../shared/ui.js";

export function openDrawer({ title, sub = "", body = "", foot = "", onMount, onClose }) {
  const back = document.createElement("div");
  back.className = "drawer-back";
  back.innerHTML = `<aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="drawer-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>
    <button class="btn btn-ghost btn-icon btn-sm" data-x aria-label="Fermer">${icon("close")}</button></div>
    <div class="drawer-body">${body}</div>${foot ? `<div class="drawer-foot">${foot}</div>` : ""}</aside>`;
  const close = () => { back.remove(); document.removeEventListener("keydown", key); if (onClose) onClose(); };
  const key = e => { if (e.key === "Escape" && !document.querySelector(".sheet-backdrop")) close(); };
  back.addEventListener("click", e => { if (e.target === back || e.target.closest("[data-x]")) close(); });
  document.addEventListener("keydown", key);
  document.body.appendChild(back);
  const el = back.querySelector(".drawer");
  const setBody = h => { el.querySelector(".drawer-body").innerHTML = h; };
  if (onMount) onMount(el, close, setBody);
  return { el, close, setBody };
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const t = document.createElement("textarea");
    t.value = text; document.body.appendChild(t); t.select();
    const ok = document.execCommand("copy"); t.remove(); return ok;
  }
}

export const appUrl = () => location.origin + location.pathname.replace(/[^/]*$/, "");
