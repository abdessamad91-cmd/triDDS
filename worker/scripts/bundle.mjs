// Assemble le Worker en un seul fichier (worker/dist/worker.js) pour le coller dans l'éditeur
// du tableau de bord Cloudflare, sans outil installé sur le PC. Lancement : node worker/scripts/bundle.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../src/", import.meta.url));
const strip = (file, keepExports = false) => readFileSync(src + file, "utf8")
  .replace(/^import .*?;\n/gm, "")
  .replace(/^export (const|function|async function)/gm, "$1");
const plans = strip("plans.js");
const prompt = strip("prompt.js");
const usage = strip("usage.js"); // garde « export class SiteUsage » : la plateforme en a besoin
const index = strip("index.js").replace("export { SiteUsage };\n", "");
const out = `// TriDDS API v2 — fichier assemblé automatiquement (worker/scripts/bundle.mjs). Ne pas modifier à la main :
// modifier worker/src/*.js puis relancer le script.
${plans}
${prompt}
${usage}
${index}`;
mkdirSync(fileURLToPath(new URL("../dist/", import.meta.url)), { recursive: true });
writeFileSync(fileURLToPath(new URL("../dist/worker.js", import.meta.url)), out);
console.log("worker/dist/worker.js : " + out.length + " caractères");
