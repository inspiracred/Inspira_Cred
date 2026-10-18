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
let capturedRdRequest = null;
let rdContactResponse = null;
const backend = vm.createContext({
  crypto: webcrypto,
  TextEncoder,
  Date,
  URL,
  Response,
  fetch: async (url, options) => {
    if (String(url).includes("crm.rdstation.com/api/v1/deals/")) {
      capturedRdRequest = { url, options };
      return {
        ok: true,
        status: 200,
        async json() { return rdContactResponse || { contacts: [] }; },
      };
    }
    capturedRequest = { url, options, payload: JSON.parse(options.body) };
    return { ok: true, status: 200, async json() { return { events_received: 1 }; } };
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

test("recognizes Meta evidence without classifying unrelated CRM deals", () => {
  assert.equal(backend.rdMetaLeadEvidence({ campaign: { name: "n8n-meta-lead-ads" } }), true);
  assert.equal(backend.rdMetaLeadEvidence({ deal_source: { name: "Facebook Lead Ads" } }), true);
  assert.equal(backend.rdMetaLeadEvidence({ custom_fields: [{ name: "UTM Source", value: "meta_ads" }] }), true);
  assert.equal(backend.rdMetaLeadEvidence({ campaign: { name: "Indicação de parceiro" } }), false);
});

test("maps only Projeto Piloto / Crédito Liberado to Purchase", () => {
  assert.equal(backend.metaCrmEventName("Não Trabalhado", 0), "");
  assert.equal(backend.metaCrmEventName("Reunião agendada", 0), "");
  assert.equal(backend.metaCrmEventName("Lead qualificado", 0), "");
  assert.equal(backend.metaCrmEventName("Crédito Liberado", 0, "Funil de Vendas"), "");
  assert.equal(backend.metaCrmEventName("Crédito Liberado", 0, "Projeto Piloto"), "Purchase");
  assert.equal(backend.metaCrmEventName("credito liberado", 0, "projeto piloto"), "Purchase");
  assert.equal(backend.metaCrmEventName("Crédito Liberado", 0, "", "6a8c96abcbaeaf0020f79f42"), "Purchase");
});

test("normalizes timestamps and Brazilian phone numbers", () => {
  assert.equal(backend.metaCrmEventTime(1780000000), 1780000000);
  assert.equal(backend.metaCrmEventTime(1780000000000), 1780000000);
  assert.equal(backend.metaCrmEventTime("2026-09-30T12:00:00Z"), 1790769600);
  assert.equal(backend.normalizeMetaPhone("(21) 99999-9999"), "5521999999999");
  assert.equal(backend.normalizeMetaPhone("+55 21 99999-9999"), "5521999999999");
});

test("CRM sender emits Purchase without financial or classification data", async () => {
  capturedRequest = null;
  const result = await backend.sendCrmStageToMeta({
    eventName: "Purchase",
    eventTime: 1790769600,
    eventId: "rd:deal-42:Purchase",
    leadId: "1234567890123456",
    email: "Pessoa@Example.com ",
    phone: "(21) 99999-9999",
    externalId: "visitor-42",
    fbp: "fb.1.1700000000.123456789",
    fbc: "fb.1.1700000000.AbcDef",
  }, {
    META_PIXEL_ID: "3021870508000260",
    META_ACCESS_TOKEN: "test-token",
    META_CRM_SOURCE_NAME: "RD Station CRM",
  });

  assert.deepEqual({ ...result }, { ok: true, status: "ok" });
  assert.ok(capturedRequest);
  const sent = capturedRequest.payload.data[0];
  assert.equal(sent.event_name, "Purchase");
  assert.equal(sent.event_id, "rd:deal-42:Purchase");
  assert.equal(sent.action_source, "system_generated");
  assert.deepEqual(sent.custom_data, {});
  assert.equal(sent.user_data.lead_id, "1234567890123456");
  assert.equal(sent.user_data.fbp, "fb.1.1700000000.123456789");
  assert.equal(sent.user_data.fbc, "fb.1.1700000000.AbcDef");
  assert.doesNotMatch(JSON.stringify(capturedRequest.payload), /credit|property|faixa|classifica|motivo|250000|500000/i);
});

test("does not call Meta without a match key", async () => {
  capturedRequest = null;
  const result = await backend.sendCrmStageToMeta({
    eventName: "Purchase",
    eventTime: 1790769600,
  }, {
    META_PIXEL_ID: "3021870508000260",
    META_ACCESS_TOKEN: "test-token",
  });
  assert.deepEqual({ ...result }, { ok: true, status: "no_match_key" });
  assert.equal(capturedRequest, null);
});

test("suppresses every CRM event that is not Purchase", async () => {
  capturedRequest = null;
  for (const [stage, won] of [["MQL qualificado", false], ["Venda ganha", true], ["Análise financeira", false]]) {
    const eventName = backend.metaCrmEventName(stage, won);
    assert.equal(eventName, "");
    const result = await backend.sendCrmStageToMeta({ eventName, email: "qa@example.invalid" }, {
      META_PIXEL_ID: "3021870508000260", META_ACCESS_TOKEN: "test-token",
    });
    assert.deepEqual({ ...result }, { ok: true, status: "not_purchase_stage" });
  }
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

test("opted-in webhook keeps non-sale stages internal when sales table is unavailable", async () => {
  capturedRequest = null;
  const response = await backend.handleRdWebhook(webhookRequest("&meta_crm=1", {
    deal: {
      id: "deal-2",
      stage: { name: "Reunião agendada" },
      campaign: { name: "n8n-meta-lead-ads" },
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
  assert.equal(result.meta_crm.status, "not_purchase_stage");
  assert.equal(capturedRequest, null);
});

test("parses the official RD CRM document payload and ignores a non-sale stage", async () => {
  capturedRequest = null;
  capturedRdRequest = null;
  rdContactResponse = {
    contacts: [{
      emails: [{ email: "crm@example.com" }],
      phones: [{ phone: "(11) 98888-7777" }],
    }],
  };

  const response = await backend.handleRdWebhook(webhookRequest("&meta_crm=1", {
    event_name: "crm_deal_updated",
    event_timestamp: "2026-10-01T15:00:00Z",
    transaction_uuid: "11111111-2222-4333-8444-555555555555",
    document: {
      id: "rd-deal-42",
      name: "Lead Meta",
      amount_total: 250000,
      status: "ongoing",
      deal_stage: { name: "Reunião Agendada" },
      campaign: { name: "Facebook Lead Ads" },
    },
  }), {
    RD_WEBHOOK_TOKEN: "secret",
    RD_CRM_API_TOKEN: "rd-api-token",
    META_PIXEL_ID: "3021870508000260",
    META_ACCESS_TOKEN: "test-token",
    DB: failingDb(),
  });

  const result = await response.json();
  assert.equal(result.parsed.dealId, "rd-deal-42");
  assert.equal(result.parsed.stage, "Reunião Agendada");
  assert.equal(result.meta_crm.status, "not_purchase_stage");
  assert.equal(capturedRdRequest, null);
  assert.equal(capturedRequest, null);
});

test("ignores a deal outside the Purchase stage even when the webhook opts in", async () => {
  capturedRequest = null;
  capturedRdRequest = null;
  const response = await backend.handleRdWebhook(webhookRequest("&meta_crm=1", {
    event_name: "crm_deal_updated",
    document: {
      id: "rd-deal-organic",
      deal_stage: { name: "Reunião Agendada" },
      campaign: { name: "Indicação de parceiro" },
    },
  }), {
    RD_WEBHOOK_TOKEN: "secret",
    RD_CRM_API_TOKEN: "rd-api-token",
    META_PIXEL_ID: "3021870508000260",
    META_ACCESS_TOKEN: "test-token",
    DB: failingDb(),
  });
  const result = await response.json();
  assert.equal(result.meta_crm.status, "not_purchase_stage");
  assert.equal(capturedRequest, null);
  assert.equal(capturedRdRequest, null);
});

test("sends one Purchase for an eligible matched site lead at Crédito Liberado", async () => {
  capturedRequest = null;
  const writes = [];
  const matchedDb = {
    prepare(sql) {
      return {
        params: [],
        bind(...values) { this.params = values; return this; },
        async first() {
          if (sql.includes("FROM rd_sales")) return null;
          if (sql.includes("FROM leads l")) return {
            id: 42,
            name: "Pessoa Teste",
            email: "pessoa@example.com",
            phone: "(21) 99999-9999",
            session_id: "session-42",
            external_id: "visitor-42",
            fbp: "fb.1.1700000000.123456789",
            fbc: "fb.1.1700000000.AbcDef",
            meta_status: "partial_failure",
            lead_kind: "home_equity_mql",
          };
          return null;
        },
        async run() { writes.push({ sql, params: this.params }); return { success: true }; },
      };
    },
  };

  const response = await backend.handleRdWebhook(webhookRequest("&meta_crm=1", {
    event_name: "crm_deal_updated",
    event_timestamp: "2026-10-18T12:00:00Z",
    document: {
      id: "rd-sale-42",
      name: "Operação 42",
      deal_pipeline: { id: "6a8c96abcbaeaf0020f79f42", name: "Projeto Piloto" },
      deal_stage: { id: "stage-credit", name: "Crédito Liberado" },
      contacts: [{
        emails: [{ email: "pessoa@example.com" }],
        phones: [{ phone: "(21) 99999-9999" }],
      }],
      amount_total: 500000,
    },
  }), {
    RD_WEBHOOK_TOKEN: "secret",
    META_PIXEL_ID: "3021870508000260",
    META_ACCESS_TOKEN: "test-token",
    DB: matchedDb,
  });

  const result = await response.json();
  assert.equal(result.stored, true);
  assert.equal(result.parsed.pipeline, "Projeto Piloto");
  assert.equal(result.parsed.stage, "Crédito Liberado");
  assert.equal(result.parsed.won, 1);
  assert.equal(result.parsed.matchedLeadId, 42);
  assert.equal(result.meta_crm.status, "ok");
  assert.equal(capturedRequest.payload.data[0].event_name, "Purchase");
  assert.equal(capturedRequest.payload.data[0].event_id, "rd:rd-sale-42:Purchase");
  assert.deepEqual(capturedRequest.payload.data[0].custom_data, {});
  assert.doesNotMatch(JSON.stringify(capturedRequest.payload), /500000|amount_total|home_equity_mql|Projeto Piloto|Crédito Liberado/);
  assert.ok(writes.some((entry) => entry.sql.includes("INSERT INTO rd_sales") && entry.params.includes("ok")));
});

test("does not send Purchase for a rural or disqualified matched lead", async () => {
  for (const leadKind of ["rural", "baixo_valor", "descarte"]) {
    capturedRequest = null;
    const db = {
      prepare(sql) {
        return {
          bind() { return this; },
          async first() {
            if (sql.includes("FROM rd_sales")) return null;
            if (sql.includes("FROM leads l")) return {
              id: 77, email: "fora@example.com", phone: "5521999999999",
              meta_status: "nao_aplicavel", lead_kind: leadKind,
            };
            return null;
          },
          async run() { return { success: true }; },
        };
      },
    };
    const response = await backend.handleRdWebhook(webhookRequest("&meta_crm=1", {
      document: {
        id: `rd-${leadKind}`,
        deal_pipeline: { name: "Projeto Piloto" },
        deal_stage: { name: "Crédito Liberado" },
        contacts: [{ emails: [{ email: "fora@example.com" }] }],
      },
    }), {
      RD_WEBHOOK_TOKEN: "secret",
      META_PIXEL_ID: "3021870508000260",
      META_ACCESS_TOKEN: "test-token",
      DB: db,
    });
    const result = await response.json();
    assert.equal(result.meta_crm.status, "ignored_ineligible_lead");
    assert.equal(capturedRequest, null);
  }
});

test("deduplicates repeated updates in the same CRM stage before calling Meta", async () => {
  capturedRequest = null;
  const duplicateDb = {
    prepare() {
      return {
        bind() { return this; },
        async first() { return { id: 99 }; },
        async run() { throw new Error("must not insert"); },
      };
    },
  };
  const response = await backend.handleRdWebhook(webhookRequest("&meta_crm=1", {
    document: {
      id: "rd-deal-duplicate",
      deal_pipeline: { name: "Projeto Piloto" },
      deal_stage: { name: "Crédito Liberado" },
      campaign: { name: "Facebook Lead Ads" },
    },
  }), {
    RD_WEBHOOK_TOKEN: "secret",
    META_PIXEL_ID: "3021870508000260",
    META_ACCESS_TOKEN: "test-token",
    DB: duplicateDb,
  });
  const result = await response.json();
  assert.equal(result.dedup, true);
  assert.equal(result.meta_crm.status, "duplicate_stage");
  assert.equal(capturedRequest, null);
});
