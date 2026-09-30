const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "../inspiracred");
const server = fs.readFileSync(path.join(root, "functions/analytics/_app.js"), "utf8");
const hashCode = server.slice(
  server.indexOf("async function sha256Hex("),
  server.indexOf("// Chaves de PII")
);
const crmCode = server.slice(
  server.indexOf("function findMetaLeadId("),
  server.indexOf("/* ---- MÉTRICAS ---- */")
);
const safeEqualCode = server.slice(
  server.indexOf("function safeEqual("),
  server.indexOf("async function makeSessionToken(")
);
const webhookCode = server.slice(
  server.indexOf("async function handleRdWebhook("),
  server.indexOf("/* Leitura do faturamento")
);
const jsonCode = server.slice(
  server.indexOf("function json("),
  server.indexOf("/* ---- DASHBOARD ---- */")
);

let capturedRequest = null;
const backend = vm.createContext({
  crypto: webcrypto,
  TextEncoder,
  Date,
  URL,
  Response,
  fetch: async (url, options) => {
    capturedRequest = { url, options, payload: JSON.parse(options.body) };
    return { ok: true, status: 200 };
  },
});
vm.runInContext(hashCode + crmCode + safeEqualCode + webhookCode + jsonCode, backend);

function failingDb() {
  return {
    prepare() {
      return {
        bind() { return this; },
        async first() { return null; },
        async run() { throw new Error("rd_sales missing"); },
      };
    },
  };
}

function webhookRequest(query = "", body = {}) {
  return {
    url: `https://nova.inspiracred.com.br/analytics/rd-webhook?token=secret${query}`,
    async json() { return body; },
  };
}

test("finds a nested Meta leadgen id and rejects unrelated numbers", () => {
  assert.equal(
    backend.findMetaLeadId({ deal: { custom_fields: [{ name: "leadgen_id", value: "1234567890123456" }] } }),
    "1234567890123456"
  );
  assert.equal(backend.findMetaLeadId({ lead_id: "12345", phone: "5521999999999" }), "");
});

test("maps RD stages to stable Meta funnel events", () => {
  assert.equal(backend.metaCrmEventName("Não Trabalhado", 0), "Lead");
  assert.equal(backend.metaCrmEventName("Reunião agendada", 0), "Schedule");
  assert.equal(backend.metaCrmEventName("Lead qualificado", 0), "QualifiedLead");
  assert.equal(backend.metaCrmEventName("Etapa personalizada", 0), "Etapa personalizada");
  assert.equal(backend.metaCrmEventName("Em negociação", 1), "Converted");
});

test("normalizes timestamps and Brazilian phone numbers", () => {
  assert.equal(backend.metaCrmEventTime(1780000000), 1780000000);
  assert.equal(backend.metaCrmEventTime(1780000000000), 1780000000);
  assert.equal(backend.metaCrmEventTime("2026-09-30T12:00:00Z"), 1790769600);
  assert.equal(backend.normalizeMetaPhone("(21) 99999-9999"), "5521999999999");
  assert.equal(backend.normalizeMetaPhone("+55 21 99999-9999"), "5521999999999");
});

test("sends a CRM event with Meta's required fields and hashed contact data", async () => {
  capturedRequest = null;
  const result = await backend.sendCrmStageToMeta({
    eventName: "Schedule",
    eventTime: 1790769600,
    eventId: "rd:deal-42:Schedule:1790769600",
    leadId: "1234567890123456",
    email: "Pessoa@Example.com ",
    phone: "(21) 99999-9999",
  }, {
    META_PIXEL_ID: "3021870508000260",
    META_ACCESS_TOKEN: "test-token",
    META_CRM_SOURCE_NAME: "RD Station CRM",
  });

  assert.deepEqual({ ...result }, { ok: true, status: "ok" });
  assert.ok(capturedRequest.url.includes("/3021870508000260/events"));
  const event = capturedRequest.payload.data[0];
  assert.equal(event.event_name, "Schedule");
  assert.equal(event.event_time, 1790769600);
  assert.equal(event.event_id, "rd:deal-42:Schedule:1790769600");
  assert.equal(event.action_source, "system_generated");
  assert.equal(event.user_data.lead_id, "1234567890123456");
  assert.match(event.user_data.em[0], /^[a-f0-9]{64}$/);
  assert.match(event.user_data.ph[0], /^[a-f0-9]{64}$/);
  assert.notEqual(event.user_data.em[0], "pessoa@example.com");
  assert.deepEqual(
    JSON.parse(JSON.stringify(event.custom_data)),
    { lead_event_source: "RD Station CRM", event_source: "crm" }
  );
});

test("does not call Meta without a match key", async () => {
  capturedRequest = null;
  const result = await backend.sendCrmStageToMeta({
    eventName: "Lead",
    eventTime: 1790769600,
  }, {
    META_PIXEL_ID: "3021870508000260",
    META_ACCESS_TOKEN: "test-token",
  });
  assert.deepEqual({ ...result }, { ok: false, status: "missing_match_key" });
  assert.equal(capturedRequest, null);
});

test("keeps Meta CRM disabled unless the webhook explicitly opts in", async () => {
  capturedRequest = null;
  const response = await backend.handleRdWebhook(webhookRequest("", {
    deal: { id: "deal-1", stage: { name: "Reunião agendada" } },
    email: "pessoa@example.com",
  }), {
    RD_WEBHOOK_TOKEN: "secret",
    META_PIXEL_ID: "3021870508000260",
    META_ACCESS_TOKEN: "test-token",
    DB: failingDb(),
  });
  const result = await response.json();
  assert.equal(result.meta_crm.status, "disabled");
  assert.equal(capturedRequest, null);
});

test("sends the opted-in CRM event even while the local sales table is unavailable", async () => {
  capturedRequest = null;
  const response = await backend.handleRdWebhook(webhookRequest("&meta_crm=1", {
    deal: {
      id: "deal-2",
      stage: { name: "Reunião agendada" },
      contacts: [{ emails: [{ email: "pessoa@example.com" }] }],
    },
    leadgen_id: "1234567890123456",
    updated_at: "2026-09-30T12:00:00Z",
  }), {
    RD_WEBHOOK_TOKEN: "secret",
    META_PIXEL_ID: "3021870508000260",
    META_ACCESS_TOKEN: "test-token",
    DB: failingDb(),
  });
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.stored, false);
  assert.equal(result.meta_crm.status, "ok");
  assert.equal(capturedRequest.payload.data[0].event_name, "Schedule");
  assert.equal(capturedRequest.payload.data[0].action_source, "system_generated");
});
