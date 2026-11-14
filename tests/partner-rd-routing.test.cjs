const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const server = fs.readFileSync(
  path.resolve(__dirname, "../inspiracred/functions/analytics/_app.js"),
  "utf8"
);
const rdCode = server.slice(
  server.indexOf("const RD_PAGE_CONFIG"),
  server.indexOf("/* ---- META CAPI")
);

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function database(updates) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() { updates.push({ sql, values }); },
          };
        },
      };
    },
  };
}

test("novos parceiros usam conversão própria e entram em Parceiros / Novo lead", async () => {
  const requests = [];
  const updates = [];
  const context = vm.createContext({
    Date,
    encodeURIComponent,
    fetch: async (url, options = {}) => {
      const request = { url: String(url), options };
      if (options.body) request.body = JSON.parse(options.body);
      requests.push(request);
      if (String(url).includes("/api/1.3/conversions")) return response({ ok: true });
      if (String(url).includes("/deal_pipelines")) {
        return response({ deal_pipelines: [{ id: "pipeline-parceiros", name: "Parceiros" }] });
      }
      if (String(url).includes("/deal_stages")) {
        return response({ deal_stages: [{ id: "stage-novo", name: "Novo Lead" }] });
      }
      if (String(url).includes("/custom_fields") && !options.method) {
        return response([]);
      }
      if (String(url).includes("/custom_fields") && options.method === "POST") {
        const entity = request.body.custom_field.for;
        return response({ id: `field-${entity}`, label: "Área de atuação", for: entity }, 201);
      }
      if (String(url).includes("/deals")) {
        return response({ deal: {
          id: "deal-created",
          deal_stage_id: "stage-novo",
          deal_pipeline_id: "pipeline-parceiros",
        } });
      }
      throw new Error(`unexpected URL: ${url}`);
    },
  });
  vm.runInContext(rdCode, context);

  await context.sendLeadToRD({
    source: "parceiros_lp",
    lead_kind: "parceiro",
    name: "Parceiro QA",
    email: "qa@example.com",
    phone: "(21) 99999-0000",
    partner_role: "Contador",
  }, {
    RD_STATION_TOKEN: "marketing-token",
    RD_CRM_API_TOKEN: "crm-token",
    DB: database(updates),
  }, 4321);

  assert.equal(requests.length, 8);
  assert.equal(requests[0].body.identificador, "Parceiros LP");
  assert.deepEqual(Array.from(requests[0].body.tags), ["parceiro"]);
  assert.equal(requests[0].body.cf_formulario_de_origem, "Parceiros");
  assert.match(requests[1].url, /deal_pipelines\?limit=200&token=/);
  assert.match(requests[2].url, /deal_stages\?deal_pipeline_id=pipeline-parceiros&limit=12&token=/);
  assert.match(requests[3].url, /custom_fields\?for=contact&token=/);
  assert.match(requests[4].url, /custom_fields\?token=/);
  assert.deepEqual(requests[4].body.custom_field, {
    label: "Área de atuação", type: "text", for: "contact", required: false, unique: false, visible: true,
  });
  assert.match(requests[5].url, /custom_fields\?for=deal&token=/);
  assert.match(requests[6].url, /custom_fields\?token=/);
  assert.equal(requests[6].body.custom_field.for, "deal");
  assert.equal(requests[7].body.deal.deal_stage_id, "stage-novo");
  assert.equal(requests[7].body.deal.name, "Parceria | Parceiro QA | Lead 4321");
  assert.deepEqual(requests[7].body.deal.deal_custom_fields[0], {
    custom_field_id: "field-deal", value: "Contador",
  });
  assert.equal(requests[7].body.contacts[0].emails[0].email, "qa@example.com");
  assert.equal(requests[7].body.contacts[0].phones[0].phone, "+5521999990000");
  assert.deepEqual(requests[7].body.contacts[0].contact_custom_fields[0], {
    custom_field_id: "field-contact", value: "Contador",
  });
  assert.deepEqual(updates[0].values, ["ok", 4321]);
});

test("reaproveita os dois campos Área de atuação já existentes sem duplicá-los", async () => {
  const requests = [];
  const context = vm.createContext({
    Date,
    encodeURIComponent,
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).includes("for=contact")) {
        return response([{ id: "contact-existing", label: "Área de atuação", for: "contact" }]);
      }
      if (String(url).includes("for=deal")) {
        return response([{ id: "deal-existing", label: "Área de atuação", for: "deal" }]);
      }
      throw new Error(`unexpected URL: ${url}`);
    },
  });
  vm.runInContext(rdCode, context);

  const fields = await context.resolvePartnerRoleFields("crm-token");
  assert.equal(fields.contactFieldId, "contact-existing");
  assert.equal(fields.dealFieldId, "deal-existing");
  assert.equal(requests.length, 2);
  assert.equal(requests.some((request) => request.options.method === "POST"), false);
});

test("rota de parceiros falha fechada quando o funil é ausente ou ambíguo", async () => {
  const requests = [];
  const context = vm.createContext({
    Date,
    encodeURIComponent,
    fetch: async (url) => {
      requests.push(String(url));
      return response({ deal_pipelines: [
        { id: "one", name: "Parceiros" },
        { id: "two", name: "Parceiros" },
      ] });
    },
  });
  vm.runInContext(rdCode, context);

  const status = await context.createPartnerDealInRD(
    { name: "QA", partner_role: "Contador" },
    { RD_CRM_API_TOKEN: "crm-token" },
    99,
    "21999990000"
  );

  assert.equal(status, "pipeline_missing_or_ambiguous");
  assert.equal(requests.length, 1);
});

test("contadores preservam Home Equity e não usam a rota CRM de parceiros", async () => {
  const requests = [];
  const updates = [];
  const context = vm.createContext({
    Date,
    encodeURIComponent,
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), body: options.body && JSON.parse(options.body) });
      return response({ ok: true });
    },
  });
  vm.runInContext(rdCode, context);

  await context.sendLeadToRD({
    source: "contador_aquisicao_lp",
    lead_kind: "home_equity",
    name: "Contador QA",
    email: "contador@example.com",
    phone: "21999990000",
  }, {
    RD_STATION_TOKEN: "marketing-token",
    RD_CRM_API_TOKEN: "crm-token",
    DB: database(updates),
  }, 55);

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /api\/1\.3\/conversions/);
  assert.equal(requests[0].body.identificador, "Home Equity");
  assert.deepEqual(updates[0].values, ["ok", 55]);
});
