// Banc d'essai local du Worker v2, avec des données de départ au format actuel.
// Lancement : node worker/test/dev-server.mjs [port]  → API sur http://localhost:PORT/api/...
import http from "node:http";
import worker from "../src/index.js";
import { makeEnv, sent } from "./env.mjs";

const port = Number(process.argv[2] || 8787);
const env = await makeEnv();

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const url = "http://localhost:" + port + req.url;
  const init = { method: req.method, headers: req.headers };
  if (!["GET", "HEAD"].includes(req.method)) init.body = Buffer.concat(chunks);
  const ctx = { waitUntil: p => p };
  const r = await worker.fetch(new Request(url, init), env, ctx);
  const headers = Object.fromEntries(r.headers.entries());
  res.writeHead(r.status, headers);
  res.end(Buffer.from(await r.arrayBuffer()));
});
server.listen(port, () => console.log("Worker de test sur http://localhost:" + port));
process.on("SIGUSR2", () => console.log(JSON.stringify(sent, null, 1)));
