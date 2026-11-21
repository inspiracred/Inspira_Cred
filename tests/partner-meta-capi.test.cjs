const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "inspiracred/functions/analytics/_app.js"), "utf8");
const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36";
const partner = {
  type: "lead", source: "parceiros_lp", lead_kind: "parceiro", session_id: "synthetic-session",
  event_id: "abcd1111-1111-4111-8111-111111111111", name: "Pessoa Sintética",
  email: "qa@example.invalid", phone: "21999990000", partner_role: "Contador",
};

function harness(t, { enabled = true, writeError } = {}) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(fs.readFileSync(path.join(root, "analytics/schema.sql"), "utf8"));
  const migrations = path.join(root, "inspiracred/migrations");
  for (const filename of fs.readdirSync(migrations).sort()) {
    if (filename.startsWith("0011_")) continue;
    db.exec(fs.readFileSync(path.join(migrations, filename), "utf8"));
  }
  const leads = () => db.prepare("SELECT * FROM leads ORDER BY id").all();
  const meta = [];
  const marketing = [];
  const context = vm.createContext({
    URL, Request, Response, Headers, TextEncoder, TextDecoder, Uint8Array, AbortController,
    crypto: webcrypto, setTimeout, clearTimeout,
    async fetch(url, options) {
      if (url.startsWith("https://graph.facebook.com/")) {
        meta.push({ url, body: JSON.parse(options.body), stored: leads() });
        return new Response('{"events_received":1}', { status: 200 });
      }
      if (url.includes("/api/1.3/conversions")) {
        marketing.push(JSON.parse(options.body));
        return new Response("{}", { status: 200 });
      }
      assert.fail("Chamada externa não simulada");
    },
  });
  vm.runInContext(server.replace("export async function onRequest", "async function onRequest"), context);
  let lostResponse = false;
  const env = {
    META_PARTNER_LEAD_ENABLED: enabled ? "true" : undefined,
    META_PIXEL_ID: "synthetic-dataset", META_ACCESS_TOKEN: "synthetic-token",
    RD_STATION_TOKEN: "synthetic-rd",
    DB: {
      prepare(sql) {
        let params = [];
        return {
          bind(...values) { params = values; return this; },
          async first() { return db.prepare(sql).get(...params) || null; },
          async run() {
            const isInsert = sql.startsWith("INSERT INTO leads ");
            if (isInsert && writeError === "failure") throw Error("D1 indisponível");
            if (isInsert && writeError === "rejected") return { success: false, meta: { changes: 0 } };
            const result = db.prepare(sql).run(...params);
            if (isInsert && writeError === "lost_response" && !lostResponse) {
              lostResponse = true;
              throw Error("A escrita persistiu, mas a resposta se perdeu");
            }
            return { success: true, meta: {
              changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid),
            } };
          },
        };
      },
    },
  };

  async function submit(event, headers = {}, origin = "https://nova.inspiracred.com.br") {
    const pending = [];
    const response = await context.onRequest({
      request: new Request(origin + "/analytics/track", {
        method: "POST",
        headers: { "User-Agent": browserUA, "CF-Connecting-IP": "203.0.113.1", ...headers },
        body: JSON.stringify(event),
      }),
      env,
      waitUntil(promise) { pending.push(promise); },
    });
    await Promise.all(pending);
    return response;
  }
  return { submit, leads, meta, marketing };
}

test("Parceiros persiste antes da CAPI e envia um Lead por tentativa concorrente ou repetida", async (t) => {
  const h = harness(t);
  const event = { ...partner, meta_events: [{ name: "LeadQualificado" }],
    url: "https://nova.inspiracred.com.br/parceiros/?utm_source=private", utm_source: "synthetic-utm",
    city: "Cidade Sintética", credit_value: 900000, property_value: 2000000 };
  const firstPair = await Promise.all([h.submit(event), h.submit(event)]);
  const retry = await h.submit({ ...event, event_id: event.event_id.toUpperCase() });
  for (const response of [...firstPair, retry]) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
  }
  assert.equal(h.leads().length, 1);
  assert.equal(h.leads()[0].meta_status, "ok");
  assert.equal(h.marketing.length, 1);
  assert.equal(h.meta.length, 1);
  const [{ url, body, stored }] = h.meta;
  assert.equal(new URL(url).pathname, "/v21.0/synthetic-dataset/events");
  assert.equal(body.data.length, 1);
  const [conversion] = body.data;
  assert.equal(stored[0].event_id, conversion.event_id);
  assert.equal(stored[0].lead_kind, "parceiro");
  assert.equal(conversion.event_name, "Lead");
  assert.notEqual(conversion.event_id, partner.event_id);
  assert.equal(conversion.event_source_url, "https://nova.inspiracred.com.br/");
  assert.deepEqual(conversion.custom_data, {});
  assert.deepEqual(Object.keys(conversion.user_data).sort(), [
    "client_ip_address", "client_user_agent", "country", "external_id",
  ]);
  assert.doesNotMatch(JSON.stringify(body), /LeadQualificado|synthetic-utm|900000|Contador|example\.invalid/);
  assert.equal((await h.submit({ ...event, event_id: webcrypto.randomUUID() })).status, 200);
  assert.equal(h.leads().length, 2);
  assert.equal(h.meta.length, 2);
});

test("Parceiros recupera a escrita que persistiu com resposta perdida sem duplicar o fan-out", async (t) => {
  const h = harness(t, { writeError: "lost_response" });
  assert.equal((await h.submit(partner)).status, 200);
  assert.equal(h.leads().length, 1);
  assert.equal(h.meta.length, 1);
  assert.equal(h.marketing.length, 1);
});

test("Parceiros bloqueia fan-out com contato inválido ou cadastro não persistido", async (t) => {
  const h = harness(t);
  for (const fields of [{ name: "" }, { email: "inválido" }, { phone: "000" }, { partner_role: " " }]) {
    assert.equal((await h.submit({ ...partner, ...fields })).status, 422);
  }
  for (const result of ["failure", "rejected"]) {
    const failed = harness(t, { writeError: result });
    assert.equal((await failed.submit(partner)).status, 500);
    assert.equal(failed.leads().length, 0);
    assert.equal(failed.meta.length, 0);
    assert.equal(failed.marketing.length, 0);
  }
  assert.equal(h.leads().length, 0);
  assert.equal(h.meta.length, 0);
  assert.equal(h.marketing.length, 0);
});

test("Parceiros mantém D1 e RD com CAPI desligada, sinais de privacidade, robô ou cliente legado", async (t) => {
  const disabled = harness(t, { enabled: false });
  const eligible = harness(t);
  assert.equal((await disabled.submit(partner)).status, 200);
  assert.equal(disabled.leads()[0].meta_status, "nao_aplicavel");
  assert.equal(disabled.marketing.length, 1);
  assert.equal(disabled.meta.length, 0);
  for (const [eventId, headers] of [
    [webcrypto.randomUUID(), { "Sec-GPC": "1" }],
    [webcrypto.randomUUID(), { DNT: "1" }],
    [webcrypto.randomUUID(), { "User-Agent": "curl/8.0" }],
    ["legacy", {}],
  ]) {
    assert.equal((await eligible.submit({ ...partner, event_id: eventId }, headers)).status, 200);
  }
  assert.equal((await eligible.submit({
    ...partner, event_id: webcrypto.randomUUID(),
  }, {}, "https://preview.inspira-cred.pages.dev")).status, 200);
  assert.deepEqual(eligible.leads().map((lead) => lead.meta_status), [
    "nao_aplicavel", "nao_aplicavel", "bot_skip", "nao_aplicavel", "nao_aplicavel",
  ]);
  assert.equal(eligible.marketing.length, 5);
  assert.equal(eligible.meta.length, 0);
});

test("O sinal habilitado de Parceiros mantém as regras das outras LPs", async (t) => {
  const h = harness(t);
  for (const [source, propertyType, credit, property, expected] of [
    ["contador_aquisicao_lp", "Comercial", 200000, 400000, ["Lead"]],
    ["landing_page", "Casa", 350000, 700000, ["Lead", "LeadQualificado"]],
    ["home_equity_lp", "Rural", 800000, 1200000, []],
    ["home_institucional", "Casa", 350000, 700000, []],
    ["home_equity_form", "Casa", 350000, 700000, ["Lead", "LeadQualificado"]],
  ]) {
    const prior = h.meta.length;
    const response = await h.submit({
      ...partner, source, property_type: propertyType, credit_value: credit, property_value: property,
    });
    assert.equal(response.status, 200, source);
    assert.deepEqual(h.meta.slice(prior).flatMap(({ body }) => body.data.map((event) => event.event_name)),
      expected, source);
  }
  assert.ok(h.leads().every((lead) => lead.partner_submission_id == null));
});
