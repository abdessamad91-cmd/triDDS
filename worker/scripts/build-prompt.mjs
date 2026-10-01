// Copie les consignes métier de data.js (TRIDDS_PROMPT) dans le Worker.
// À relancer après chaque modification de data.js : node worker/scripts/build-prompt.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(root + "data.js", "utf8"), ctx);
const sys = ctx.window.TRIDDS_PROMPT;
if (!sys) throw new Error("TRIDDS_PROMPT introuvable dans data.js");
writeFileSync(root + "worker/src/prompt.js",
  "// Généré par worker/scripts/build-prompt.mjs depuis data.js. Ne pas modifier à la main.\n" +
  "export const SYSTEM_PROMPT = " + JSON.stringify(sys) + ";\n");
console.log("worker/src/prompt.js : " + sys.length + " caractères");
