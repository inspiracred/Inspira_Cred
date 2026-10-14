const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const server = fs.readFileSync(path.resolve(__dirname, "../inspiracred/functions/analytics/_app.js"), "utf8");
const migration = fs.readFileSync(path.resolve(__dirname, "../inspiracred/migrations/0013_rd_deal_events.sql"), "utf8");
const safeEqualCode = server.slice(server.indexOf("function safeEqual("), server.indexOf("async function makeSessionToken("));
const handlerCode = server.slice(server.indexOf("const RD_DEAL_RULE_VERSION"), server.indexOf("/* Leitura do faturamento"));
const jsonCode = server.slice(server.indexOf("function json("), server.indexOf("/* ---- DASHBOARD ---- */"));

let crmRequest = null;
const backend = vm.createContext({
  URL,
  Response,
  fetch: async (url, options) => {
    crmRequest = { url: String(url), options, body: JSON.parse(options.body) };
    return { ok: true, status: 200 };
  },
});
vm.runInContext(safeEqualCode + handlerCode + jsonCode, backend);

function db({ duplicate = false } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) { call.values = values; return this; },
        async run() { return { meta: { changes: duplicate && sql.includes("INSERT") ? 0 : 1 } }; },
      };
    },
  };
}

function request(body, key = "new-secret") {
  return {
    headers: { get(name) { return name.toLowerCase() === "x-inspira-rd-webhook" ? key : null; } },
    async json() { return body; },
  };
}

function event(overrides = {}) {
  return {
    event_name: "crm_deal_created",
    transaction_uuid: "11111111-2222-4333-8444-555555555555",
    document: {
      id: "deal-exato-42",
      deal_pipeline_id: "pipeline-real",
      deal_stage: { id: "stage-real", deal_pipeline_id: "pipeline-real" },
      deal_source: { name: "Desconhecido" },
      deal_custom_fields: [{
        custom_field_id: "field-origin-real",
        custom_field: { id: "field-origin-real", label: "Formulário de Origem" },
        value: "Site Institucional",
      }],
      ...overrides,
    },
  };
}

test("observa passivamente o deal exato e persiste só metadados mínimos", async () => {
  crmRequest = null;
  const database = db();
  const response = await backend.handleRdDealCreated(request(event()), {
    RD_DEAL_WEBHOOK_KEY: "new-secret",
    DB: database,
  });
  const result = await response.json();
  assert.equal(response.status, 202);
  assert.equal(result.passive, true);
  assert.equal(result.candidate, true);
  assert.equal(result.deal_id, "deal-exato-42");
  assert.equal(crmRequest, null);
  assert.match(database.calls[0].sql, /INSERT OR IGNORE INTO rd_deal_events/);
  assert.equal(database.calls[0].values.includes("Desconhecido"), false);
  assert.equal(database.calls[0].values.includes("Site Institucional"), true);
});

test("não confunde Fonte com Formulário de Origem", async () => {
  const database = db();
  const payload = event({
    deal_source: { name: "Site Institucional" },
    deal_custom_fields: [{
      custom_field_id: "field-origin-real",
      custom_field: { label: "Formulário de Origem" },
      value: "Outra origem",
    }],
  });
  const response = await backend.handleRdDealCreated(request(payload), { RD_DEAL_WEBHOOK_KEY: "new-secret", DB: database });
  const result = await response.json();
  assert.equal(result.candidate, false);
  assert.equal(crmRequest, null);
});

test("deduplica pelo transaction_uuid sem anotar novamente", async () => {
  crmRequest = null;
  const response = await backend.handleRdDealCreated(request(event()), {
    RD_DEAL_WEBHOOK_KEY: "new-secret",
    RD_DEAL_NOTES_ENABLED: "true",
    RD_ORIGIN_FIELD_ID: "field-origin-real",
    RD_ORIGIN_EXPECTED_VALUE: "Site Institucional",
    RD_DEAL_PIPELINE_ID: "pipeline-real",
    RD_DEAL_STAGE_ID: "stage-real",
    RD_CRM_USER_ID: "user-real",
    RD_CRM_API_TOKEN: "crm-token",
    DB: db({ duplicate: true }),
  });
  const result = await response.json();
  assert.equal(result.dedup, true);
  assert.equal(crmRequest, null);
});

test("modo ativo só anota com IDs e regra exatos", async () => {
  crmRequest = null;
  const database = db();
  const response = await backend.handleRdDealCreated(request(event()), {
    RD_DEAL_WEBHOOK_KEY: "new-secret",
    RD_DEAL_NOTES_ENABLED: "true",
    RD_ORIGIN_FIELD_ID: "field-origin-real",
    RD_ORIGIN_EXPECTED_VALUE: "Site Institucional",
    RD_DEAL_PIPELINE_ID: "pipeline-real",
    RD_DEAL_STAGE_ID: "stage-real",
    RD_CRM_USER_ID: "user-real",
    RD_CRM_API_TOKEN: "crm-token",
    DB: database,
  });
  const result = await response.json();
  assert.equal(result.annotated, true);
  assert.match(crmRequest.url, /^https:\/\/crm\.rdstation\.com\/api\/v1\/activities\?token=/);
  assert.equal(crmRequest.body.activity.deal_id, "deal-exato-42");
  assert.equal(crmRequest.body.activity.user_id, "user-real");
});

test("modo ativo falha fechado quando qualquer ID diverge", async () => {
  crmRequest = null;
  const response = await backend.handleRdDealCreated(request(event()), {
    RD_DEAL_WEBHOOK_KEY: "new-secret",
    RD_DEAL_NOTES_ENABLED: "true",
    RD_ORIGIN_FIELD_ID: "field-origin-real",
    RD_ORIGIN_EXPECTED_VALUE: "Site Institucional",
    RD_DEAL_PIPELINE_ID: "pipeline-real",
    RD_DEAL_STAGE_ID: "outra-stage",
    RD_CRM_USER_ID: "user-real",
    RD_CRM_API_TOKEN: "crm-token",
    DB: db(),
  });
  const result = await response.json();
  assert.equal(result.annotated, false);
  assert.equal(result.reason, "exact_rule_mismatch");
  assert.equal(crmRequest, null);
});

test("rejeita chave, JSON e identidade incompletos", async () => {
  const database = db();
  assert.equal((await backend.handleRdDealCreated(request(event(), "wrong"), { RD_DEAL_WEBHOOK_KEY: "new-secret", DB: database })).status, 401);
  assert.equal((await backend.handleRdDealCreated(request({ event_name: "crm_deal_created", document: {} }), { RD_DEAL_WEBHOOK_KEY: "new-secret", DB: database })).status, 422);
  const ignored = await backend.handleRdDealCreated(request({ event_name: "crm_deal_updated" }), { RD_DEAL_WEBHOOK_KEY: "new-secret", DB: database });
  assert.equal((await ignored.json()).ignored, true);
});

test("migration é idempotente e não possui colunas de PII ou valor financeiro", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS rd_deal_events/);
  assert.match(migration, /transaction_uuid TEXT NOT NULL UNIQUE/);
  assert.doesNotMatch(migration, /\b(raw|email|phone|contact_name|credit_value|property_value|amount)\b/i);
});
