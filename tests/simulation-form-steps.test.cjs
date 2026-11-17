const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "../inspiracred");
const landing = fs.readFileSync(path.join(root, "index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "assets/css/main.css"), "utf8");
const server = fs.readFileSync(path.join(root, "functions/analytics/_app.js"), "utf8");
const form = landing.slice(landing.indexOf('<form class="form-card is-dark form-floating"'), landing.indexOf("</form>", landing.indexOf('id="simulation-form"')));

test("simulation form exposes two accessible steps without visible required markers", () => {
  assert.match(form, /data-form-step="1"/);
  assert.match(form, /data-form-step="2"[^>]*hidden/);
  assert.match(form, /id="contact-email"[^>]*type="email"[^>]*aria-required="true"/);
  assert.match(form, />Continuar<\/button>/);
  assert.match(form, />Voltar<\/button>/);
  assert.match(form, /data-final-submit/);
  assert.doesNotMatch(form, /class="req"|obrigat[oó]ri|\*/i);
});

test("progress uses the action row instead of reserving a separate line", () => {
  const firstStep = form.slice(form.indexOf('data-form-step="1"'), form.indexOf('data-form-step="2"'));
  const secondStep = form.slice(form.indexOf('data-form-step="2"'));
  assert.match(firstStep, /class="form-step-actions">[\s\S]*class="form-progress"[\s\S]*class="button button-lg form-continue-btn"/);
  assert.match(secondStep, /class="form-step-actions">[\s\S]*class="form-progress"[\s\S]*class="form-step-buttons"/);
  assert.doesNotMatch(form.slice(0, form.indexOf('data-form-step="1"')), /class="form-progress"/);
});

test("property step keeps its five fixed fields on one compact desktop row", () => {
  const secondStep = form.slice(form.indexOf('data-form-step="2"'));
  assert.match(landing, /assets\/css\/main\.css\?v=20261117-2/);
  assert.match(secondStep, /class="form-row form-row-5"/);
  assert.match(styles, /\.form-row-5\s*\{[\s\S]*grid-template-columns:\s*[\s\S]*minmax\(0, 1fr\)[\s\S]*minmax\(0, 1\.2fr\)[\s\S]*minmax\(0, 1\.08fr\)[\s\S]*minmax\(0, 1\.18fr\)[\s\S]*minmax\(0, 1\.05fr\);[\s\S]*gap:\s*18px 12px;/);
  assert.match(styles, /@media \(max-width: 1023px\)[\s\S]*\.form-row-5\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.form-row-5,[\s\S]*grid-template-columns:\s*1fr;/);
});

test("both steps keep the same reassurance and handoff guidance", () => {
  assert.equal((form.match(/Após registrar sua simulação, abriremos o WhatsApp/g) || []).length, 2);
  assert.equal((form.match(/>Dados protegidos<\/span>/g) || []).length, 2);
  assert.equal((form.match(/>Atendimento consultivo<\/span>/g) || []).length, 2);
});

test("contact validation gates step two and the final payload carries the real email", () => {
  assert.match(landing, /function validateContact\(data\)/);
  assert.match(landing, /if \(currentStep === 1\)[\s\S]*validateContact\(contactData\(\)\)[\s\S]*showStep\(2, true\)/);
  assert.match(landing, /if \(!validEmail\(data\.email\)\)/);
  assert.match(landing, /email:\s*data\.email/);
  assert.match(landing, /var isSubmitting = false/);
  assert.match(landing, /if \(isSubmitting\) return/);
  assert.match(landing, /isSubmitting = true;[\s\S]*aria-busy/);
});

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("simulation contact is also required at the server boundary", async () => {
  const executable = server.replace("export async function onRequest", "async function onRequest");
  const context = vm.createContext({
    URL,
    Request,
    Response,
    Headers,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    AbortController,
    crypto: webcrypto,
    Date,
    Math,
    JSON,
    Map,
    Set,
    String,
    Number,
    setTimeout,
    clearTimeout,
    fetch: async () => response({ ok: true }),
  });
  vm.runInContext(`${executable};globalThis.__server={onRequest};`, context);
  let dbCalls = 0;
  const env = {
    DB: {
      prepare() {
        dbCalls += 1;
        throw new Error("invalid simulation must be rejected before D1");
      },
    },
  };
  const base = {
    type: "lead",
    source: "landing_page",
    name: "Pessoa QA",
    phone: "+5521999990000",
    email: "pessoa.qa@example.com",
  };
  const cases = [
    [{ ...base, name: "" }, "Informe seu nome completo."],
    [{ ...base, phone: "123" }, "Informe um celular com DDD."],
    [{ ...base, email: "email-invalido" }, "Informe um e-mail válido."],
  ];

  for (const [payload, message] of cases) {
    const request = new Request("https://nova.inspiracred.com.br/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://nova.inspiracred.com.br" },
      body: JSON.stringify(payload),
    });
    const result = await context.__server.onRequest({ request, env, waitUntil() {} });
    assert.equal(result.status, 422);
    assert.equal((await result.json()).error, message);
  }
  assert.equal(dbCalls, 0);
});

test("RD conversion keeps the submitted email and the current Simulação identifier", async () => {
  const requests = [];
  const rdCode = server.slice(server.indexOf("const RD_PAGE_CONFIG"), server.indexOf("/* ---- META CAPI"));
  const context = vm.createContext({
    Date,
    encodeURIComponent,
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
      return response({ ok: true });
    },
  });
  vm.runInContext(rdCode, context);
  const updates = [];
  const env = {
    RD_STATION_TOKEN: "test-token",
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return { async run() { updates.push({ sql, values }); } };
          },
        };
      },
    },
  };

  await context.sendLeadToRD({
    source: "landing_page",
    lead_kind: "home_equity",
    name: "Pessoa QA",
    phone: "+5521999990000",
    email: "pessoa.qa@example.com",
    property_type: "residencial",
    property_value: 800000,
    credit_value: 350000,
  }, env, 17);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.identificador, "Simulação");
  assert.equal(requests[0].body.email, "pessoa.qa@example.com");
  assert.equal(requests[0].body.cf_formulario_de_origem, "Simulação");
  assert.deepEqual(updates[0].values, ["ok", 17]);
});

function metaHarness() {
  const requests = [];
  const executable = server.replace("export async function onRequest", "async function onRequest");
  const context = vm.createContext({
    URL,
    Response,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    AbortController,
    crypto: webcrypto,
    Date,
    Math,
    JSON,
    Map,
    String,
    Number,
    setTimeout,
    clearTimeout,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url: String(url), body });
      return response({ events_received: body.data.length });
    },
  });
  vm.runInContext(`${executable};globalThis.__meta={sendLeadToMeta};`, context);
  const env = {
    META_PIXEL_ID: "3021870508000260",
    META_ACCESS_TOKEN: "test-secret",
    DB: {
      prepare() {
        return { bind() { return this; }, async run() {} };
      },
    },
  };
  return { api: context.__meta, env, requests };
}

test("landing email remains internal to D1/RD and is not added to Meta", async () => {
  const h = metaHarness();
  await h.api.sendLeadToMeta({
    source: "landing_page",
    lead_kind: "home_equity",
    name: "Pessoa QA",
    phone: "+5521999990000",
    email: "pessoa.qa@example.com",
    session_id: "session-qa",
  }, h.env, 19, { clientIp: "203.0.113.10", userAgent: "Mozilla/5.0 QA", sourceUrl: "https://nova.inspiracred.com.br/" });

  assert.equal(h.requests.length, 1);
  const userData = h.requests[0].body.data[0].user_data;
  assert.equal(Object.hasOwn(userData, "em"), false);
  assert.ok(userData.ph);
  assert.ok(userData.fn);
  assert.deepEqual(h.requests[0].body.data[0].custom_data, {});
});
