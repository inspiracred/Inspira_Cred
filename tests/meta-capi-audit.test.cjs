const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");
const source = fs.readFileSync(path.join(__dirname, "../inspiracred/functions/analytics/_app.js"), "utf8");
const code = source.slice(source.indexOf("function metaAuditInteger("), source.indexOf("async function sendLeadToMeta("));

function harness() {
  const calls = [];
  const context = vm.createContext({ Response, TextDecoder, Uint8Array, Number, JSON });
  vm.runInContext(code, context);
  const env = { DB: { prepare(sql) { let params = []; return { bind(...values) { params = values; return this; }, async run() { calls.push({ sql, params }); } }; } } };
  return { context, env, calls };
}

test("records only bounded aggregate receipt fields", async () => {
  const h = harness();
  const response = new Response(JSON.stringify({ events_received: 1, fbtrace_id: "ignored", message: "private" }), { status: 200 });
  const audit = await h.context.readMetaAuditResponse(response, 1);
  assert.deepEqual({ ...audit }, { http_status: 200, events_received: 1, error_code: null, error_subcode: null, outcome: "batch_reported" });
  await h.context.recordMetaBatchAudit(h.env, 42, [{ event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }], audit);
  const insert = h.calls.find((call) => call.sql.includes("INSERT INTO meta_capi_batches"));
  assert.deepEqual(insert.params, [42, 1, 200, 1, null, null, "batch_reported"]);
  assert.doesNotMatch(insert.sql, /event_ids_json|event_id/);
  assert.doesNotMatch(JSON.stringify(h.calls), /private|fbtrace/);
});

test("does not claim individual acceptance", async () => {
  const h = harness();
  const response = new Response(JSON.stringify({ events_received: 0 }), { status: 200 });
  const audit = await h.context.readMetaAuditResponse(response, 1);
  assert.equal(audit.outcome, "count_mismatch");
  assert.equal(audit.events_received, 0);
});

test("migration is idempotent, bounded and supports retention", () => {
  const db = new DatabaseSync(":memory:");
  const sql = fs.readFileSync(path.join(__dirname, "../inspiracred/migrations/0012_meta_capi_batches.sql"), "utf8");
  db.exec(sql);
  db.exec(sql);
  db.prepare("INSERT INTO meta_capi_batches(lead_id,outcome,created_at) VALUES(?,?,datetime('now','-31 days'))")
    .run(42, "count_unknown");
  assert.throws(() => db.prepare("INSERT INTO meta_capi_batches(lead_id,outcome) VALUES(42,'individual_accepted')").run());
  db.exec("DELETE FROM meta_capi_batches WHERE created_at < datetime('now','-30 days')");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM meta_capi_batches").get().n, 0);
  db.close();
});
