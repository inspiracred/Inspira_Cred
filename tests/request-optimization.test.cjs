const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const root = path.resolve(__dirname, "..");
const site = path.join(root, "inspiracred");
const server = fs.readFileSync(path.join(site, "functions/analytics/_app.js"), "utf8");
const tracker = fs.readFileSync(path.join(site, "assets/js/track.js"), "utf8");

function sqliteEnv(db) {
  return {
    DB: {
      prepare(sql) {
        let args = [];
        return {
          bind(...values) { args = values; return this; },
          async run() {
            const result = db.prepare(sql).run(...args);
            return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
          },
          async first() { return db.prepare(sql).get(...args) || null; },
          async all() { return { results: db.prepare(sql).all(...args) }; },
        };
      },
    },
  };
}

function serverContext() {
  const context = vm.createContext({
    URL, Request, Response, Headers, TextEncoder, TextDecoder, Uint8Array,
    crypto: webcrypto, Date, Math, JSON, console, setTimeout, clearTimeout,
    AbortController,
    fetch: async () => { throw new Error("rede externa proibida no teste de lote"); },
  });
  vm.runInContext(server.replace("export async function onRequest", "async function onRequest"), context);
  return context;
}

test("Pages Functions ficam limitadas a páginas HTML e analytics", () => {
  const routes = JSON.parse(fs.readFileSync(path.join(site, "_routes.json"), "utf8"));
  assert.equal(routes.version, 1);
  assert.ok(routes.include.includes("/analytics/*"));
  assert.ok(routes.include.includes("/"));
  for (const route of ["/home/", "/homeequity/", "/formulario/", "/parceiros/", "/contadores/"]) {
    assert.ok(routes.include.includes(route), route);
  }
  assert.ok(routes.exclude.includes("/obrigado/style.css"));
  assert.ok(!routes.include.includes("/*"), "rotas desconhecidas não devem invocar Functions");
  assert.ok(!routes.include.some((route) => /assets|\.(?:js|css|png|webp|svg)$/.test(route)));
});

test("tracker agrupa somente eventos analíticos de baixa prioridade", () => {
  assert.match(tracker, /LOW_PRIORITY_BATCH_MAX\s*=\s*20/);
  assert.match(tracker, /function sendLowPriority\(/);
  assert.match(tracker, /visibilitychange/);
  assert.match(tracker, /pagehide/);
  assert.match(tracker, /sendLowPriority\(\{ type: "event", event_name: "scroll_depth"/);
  assert.match(tracker, /sendLowPriority\(\{ type: "event", event_name: "section_view"/);
  assert.match(tracker, /sendLowPriority\(\{\s*type: "tap"/);
  assert.match(tracker, /return send\(leadPayload\(data\)\)/, "lead continua imediato");
  assert.match(tracker, /return sendConfirmed\(leadPayload\(data\)\)/, "lead confirmado continua aguardando HTTP 200");
});

test("endpoint aceita lote seguro e preserva cada evento no D1", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT, event_type TEXT, event_name TEXT, properties TEXT, page_name TEXT
    );
    CREATE TABLE heatmap_taps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT, page_name TEXT, x_pct REAL, y_pct REAL, vw INTEGER, doc_h INTEGER, element_id TEXT
    );
  `);
  const context = serverContext();
  const env = sqliteEnv(db);
  const payload = [
    { type: "event", event_name: "section_view", session_id: "s-1", page_name: "landing_page", properties: { section: "hero" } },
    { type: "event", event_name: "scroll_depth", session_id: "s-1", page_name: "landing_page", properties: { pct: 50 } },
    { type: "tap", session_id: "s-1", page_name: "landing_page", x_pct: 0.5, y_pct: 0.3, vw: 390, doc_h: 2400 },
  ];
  const request = new Request("https://nova.inspiracred.com.br/analytics/track", {
    method: "POST",
    headers: { Origin: "https://nova.inspiracred.com.br", "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(payload),
  });
  const response = await context.onRequest({ request, env, waitUntil() {} });
  assert.equal(response.status, 200);
  assert.deepEqual({ ...(await response.json()) }, { success: true, accepted: 3 });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM events").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM heatmap_taps").get().n, 1);

  const unsafe = new Request("https://nova.inspiracred.com.br/analytics/track", {
    method: "POST",
    headers: { Origin: "https://nova.inspiracred.com.br", "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify([{ type: "lead", session_id: "s-1", email: "blocked@example.invalid" }]),
  });
  const rejected = await context.onRequest({ request: unsafe, env, waitUntil() {} });
  assert.equal(rejected.status, 400);
  db.close();
});
