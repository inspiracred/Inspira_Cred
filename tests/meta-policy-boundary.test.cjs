const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const root = path.resolve(__dirname, "../inspiracred");
const trackerSource = fs.readFileSync(path.join(root, "assets/js/track.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "functions/analytics/_app.js"), "utf8");
const rootLandingSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const formSource = fs.readFileSync(path.join(root, "formulario/script.js"), "utf8");
const homeEquitySource = fs.readFileSync(path.join(root, "homeequity/script.js"), "utf8");

function trackerHarness() {
  const beacons = [];
  const fbqCalls = [];
  const location = {
    origin: "https://nova.inspiracred.com.br",
    pathname: "/homeequity/",
    search: "?utm_source=meta_ads&credit_value=900000",
    href: "https://nova.inspiracred.com.br/homeequity/?utm_source=meta_ads&credit_value=900000",
  };
  const document = {
    title: "Teste", referrer: "", cookie: "",
    createElement() { return {}; },
    getElementsByTagName() { return [{ parentNode: { insertBefore() {} } }]; },
    addEventListener() {}, querySelectorAll() { return []; },
    documentElement: { scrollHeight: 1000 },
  };
  const window = {
    IC_PAGE: "home_equity_lp", location, innerWidth: 1200, innerHeight: 800,
    addEventListener() {}, requestAnimationFrame() {},
  };
  window.fbq = (...args) => fbqCalls.push(args);
  const context = vm.createContext({
    window, document, location,
    localStorage: { getItem() { return null; }, setItem() {} },
    navigator: { sendBeacon(url, blob) { beacons.push({ url, blob }); return true; } },
    crypto: { randomUUID: () => "12345678-1234-4234-9234-123456789abc" },
    URLSearchParams, Blob, Image: function Image() {}, screen: { width: 1200, height: 800 },
    performance: { getEntriesByType: () => [] }, setTimeout() {}, fetch: async () => ({ ok: true }),
    IntersectionObserver: function () { this.observe = () => {}; this.unobserve = () => {}; },
  });
  vm.runInContext(trackerSource, context);
  return { window, beacons, fbqCalls };
}

async function beaconPayload(entry) {
  return JSON.parse(await entry.blob.text());
}

test("browser sends full lead data to the server without choosing a Meta event", async () => {
  const h = trackerHarness();
  h.window.inspiraTrack.lead({
    credit_value: 900000,
    property_value: 2000000,
    documentacao_ok: "Não",
    lead_kind: "home_equity_mql",
    meta_events: ["LeadQualificado", "Financiado50Mais", "DocumentacaoIrregular"],
  });
  assert.equal(h.fbqCalls.length, 0);
  const payloads = await Promise.all(h.beacons.map(beaconPayload));
  const lead = payloads.find((payload) => payload.type === "lead");
  assert.equal(Object.hasOwn(lead, "meta_events"), false);
  assert.equal(lead.url, "https://nova.inspiracred.com.br/");
  assert.equal(lead.credit_value, 900000, "financial qualification remains internal");
});

test("browser preserves rural lead data for D1 and RD", async () => {
  const h = trackerHarness();
  h.window.inspiraTrack.lead({
    source: "home_equity_lp",
    property_type: "Rural",
    name: "Deve ficar no CRM",
    phone: "+5521999999999",
    credit_value: 250000,
    property_value: 800000,
    lead_kind: "rural",
  });
  const payloads = await Promise.all(h.beacons.map(beaconPayload));
  const lead = payloads.find((payload) => payload.type === "lead");
  assert.ok(lead);
  assert.equal(lead.name, "Deve ficar no CRM");
  assert.equal(lead.credit_value, 250000);
  assert.equal(lead.property_value, 800000);
  assert.equal(Object.hasOwn(lead, "meta_events"), false);
});

test("funnel events keep internal properties without a Meta marker", async () => {
  const h = trackerHarness();
  h.window.inspiraTrack.event("simulation_complete", { source: "home_equity_lp", credit_value: 900000 });
  assert.equal(h.fbqCalls.length, 0);
  const payloads = await Promise.all(h.beacons.map(beaconPayload));
  const event = payloads.find((payload) => payload.event_name === "simulation_complete");
  assert.equal(event.properties.credit_value, 900000);
  assert.equal(Object.hasOwn(event, "meta_event_name"), false);
  assert.equal(Object.hasOwn(event, "event_id"), false);
});

test("browser exposes no arbitrary Meta API or direct Pixel fallback", () => {
  const h = trackerHarness();
  assert.equal(h.window.inspiraTrack.meta, undefined);
  assert.doesNotMatch(trackerSource, /facebook\.com\/tr\/\?/);
  assert.doesNotMatch(trackerSource, /sendPixelBrowserFallback/);
  assert.doesNotMatch(trackerSource, /connect\.facebook\.net|window\.fbq\(/);
});

test("all published HTML routes are free of Meta browser Pixel code", () => {
  const htmlFiles = [
    path.join(root, "docs/fe3ad243-8f41-4056-939b-fe087b3244cc~/index.html"),
    path.join(root, "docs/fe3ad243-8f41-4056-939b-fe087b3244cc~/pages/termos-de-uso.html"),
    path.join(root, "docs/fe3ad243-8f41-4056-939b-fe087b3244cc~/pages/politica-de-privacidade.html"),
  ];
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(html, /fbevents\.js|fbq\s*\(/, path.relative(root, file));
  }
  const legacyBundle = fs.readFileSync(path.join(root, "docs/fe3ad243-8f41-4056-939b-fe087b3244cc~/scripts/index-FQntuO21.js"), "utf8");
  assert.doesNotMatch(legacyBundle, /window\.fbq|trackCustom\s*\(/);
});

function serverHarness() {
  const requests = [];
  const writes = [];
  const context = vm.createContext({
    URL, Response, TextDecoder, TextEncoder, Uint8Array, AbortController,
    crypto: webcrypto, Date, Math, JSON, Map, String, Number,
    setTimeout, clearTimeout,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      return new Response(JSON.stringify({ events_received: body.data.length }), { status: 200 });
    },
  });
  const executable = serverSource.replace("export async function onRequest", "async function onRequest");
  vm.runInContext(`${executable};globalThis.__policy={isRuralPropertyType,normalizeLeadKind,metaEventNameForLeadKind,metaEventNamesForLeadKind,normalizeLeadMetaEvents,normalizeFunnelMetaEvent,sanitizeMetaSourceUrl,sendLeadToMeta,sendCustomEventToMeta};`, context);
  const env = {
    META_PIXEL_ID: "3021870508000260", META_ACCESS_TOKEN: "test-secret",
    DB: { prepare(sql) { let params = []; return { bind(...values) { params = values; return this; }, async run() { writes.push({ sql, params }); } }; } },
  };
  return { api: context.__policy, env, requests, writes };
}

test("server rewrites hostile markers to the two events only for the upper band", async () => {
  const h = serverHarness();
  const event = {
    session_id: "session-safe", name: "Pessoa Teste", email: "qa@example.invalid", phone: "+5521999999999",
    credit_value: 900000, property_value: 2000000, property_type: "casa", lead_kind: "home_equity_mql", event_id: "legacy-event",
    meta_events: [
      { name: "QualifiedLead", event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { name: "Lead", event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    ],
  };
  assert.deepEqual(Array.from(h.api.normalizeLeadMetaEvents(event), (item) => item.name), ["Lead", "LeadQualificado"]);
  await h.api.sendLeadToMeta(event, h.env, 42, {
    clientIp: "203.0.113.10", userAgent: "Mozilla/5.0 QA", sourceUrl: "https://nova.inspiracred.com.br/homeequity/?credit_value=900000#private",
  });
  assert.equal(h.requests.length, 2);
  const sent = h.requests.flatMap((request) => request.body.data);
  assert.ok(h.requests.every((request) => request.body.data.length === 1));
  assert.equal(sent.length, 2);
  assert.deepEqual(Array.from(sent, (item) => item.event_name), ["Lead", "LeadQualificado"]);
  for (const item of sent) {
    assert.match(item.event_id, /^[0-9a-f-]{36}$/i);
    assert.notEqual(item.event_id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    assert.deepEqual(item.custom_data, {});
    assert.equal(item.event_source_url, "https://nova.inspiracred.com.br/");
  }
  assert.notEqual(sent[0].event_id, sent[1].event_id);
  assert.doesNotMatch(JSON.stringify(sent), /900000|home_equity_mql|QualifiedLead|DocumentacaoIrregular/);
});

test("server recognizes rural property variants and suppresses Meta", () => {
  const h = serverHarness();
  assert.equal(h.api.isRuralPropertyType("Rural"), true);
  assert.equal(h.api.isRuralPropertyType("imóvel rural"), true);
  assert.equal(h.api.isRuralPropertyType("Residencial"), false);
  const rural = { property_type: "Rural", credit_value: 900000, property_value: 2000000 };
  assert.equal(h.api.normalizeLeadKind(rural), "rural");
  assert.deepEqual(Array.from(h.api.normalizeLeadMetaEvents(rural), (item) => item.name), []);
});

test("server uses financial bands only to select event names", () => {
  const h = serverHarness();
  const cases = [
    [{ property_type: "rural", credit_value: 900000, property_value: 2000000 }, "rural", []],
    [{ credit_value: 199999, property_value: 700000 }, "baixo_valor", []],
    [{ credit_value: 200000, property_value: 400000 }, "home_equity", ["Lead"]],
    [{ credit_value: 349999, property_value: 700000 }, "home_equity", ["Lead"]],
    [{ credit_value: 350000, property_value: 699999 }, "home_equity", ["Lead"]],
    [{ credit_value: 350000, property_value: 700000 }, "home_equity_mql", ["Lead", "LeadQualificado"]],
    [{ lead_kind: "descarte" }, "descarte", []],
  ];
  for (const [event, kind, metaNames] of cases) {
    assert.equal(h.api.normalizeLeadKind(event), kind);
    assert.deepEqual(Array.from(h.api.metaEventNamesForLeadKind(kind)), metaNames);
    event.lead_kind = kind;
    assert.deepEqual(Array.from(h.api.normalizeLeadMetaEvents(event), (item) => item.name), metaNames);
  }
});

test("all forms and the dashboard use the approved 700k/350k MQL boundary", () => {
  assert.match(rootLandingSource, /MQL_CREDIT = 350000/);
  assert.match(rootLandingSource, /MQL_PROPERTY = 700000/);
  assert.match(formSource, /MQL_CREDIT_VALUE = 350000/);
  assert.match(formSource, /MQL_PROPERTY_VALUE = 700000/);
  assert.match(homeEquitySource, /MQL_EMP = 350000/);
  assert.match(homeEquitySource, /MQL_IMOVEL = 700000/);
  assert.match(serverSource, /credit >= 350000 && property >= 700000/);
  assert.match(serverSource, /MQL_IMOVEL=700000, MQL_CREDITO=350000/);
  assert.match(formSource, /De R\$ 200 mil a R\$ 349 mil[\s\S]*amount: 300000/);
  assert.match(formSource, /De R\$ 350 mil a R\$ 499 mil[\s\S]*amount: 350000/);
  assert.doesNotMatch(formSource, /value: "200k_500k"/);
});

test("rural and disqualified submissions send no Meta event", async () => {
  for (const lead_kind of ["rural", "baixo_valor", "descarte"]) {
    const h = serverHarness();
    await h.api.sendLeadToMeta({ lead_kind, credit_value: 900000, property_value: 2000000 }, h.env, 42, {});
    assert.equal(h.requests.length, 0);
    assert.ok(h.writes.some((write) => write.sql.includes("UPDATE leads SET meta_status")));
    assert.ok(h.writes.some((write) => write.params.includes("nao_aplicavel")));
  }
});

test("server allows PageView and blocks simulation stages from Meta", async () => {
  const h = serverHarness();
  assert.equal(h.api.normalizeFunnelMetaEvent("page_view"), "PageView");
  assert.equal(h.api.normalizeFunnelMetaEvent("simulation_start"), "");
  assert.equal(h.api.normalizeFunnelMetaEvent("simulation_complete"), "");
  assert.equal(h.api.normalizeFunnelMetaEvent("LeadQualificado"), "");
  for (const hostile of ["__proto__", "constructor", "toString", null, {}]) {
    assert.equal(h.api.normalizeFunnelMetaEvent(hostile), "");
  }
  await h.api.sendCustomEventToMeta({ event_name: "LeadQualificado", meta_event_name: "LeadQualificado" }, h.env, {});
  assert.equal(h.requests.length, 0);
  await h.api.sendCustomEventToMeta({ event_name: "simulation_complete", event_id: "credito_900000_documentacao_irregular" }, h.env, {});
  assert.equal(h.requests.length, 0);
  await h.api.sendCustomEventToMeta({ event_name: "page_view", event_id: "credito_900000_documentacao_irregular" }, h.env, { sourceUrl: "https://nova.inspiracred.com.br/private?credit=900000" });
  assert.match(h.requests[0].body.data[0].event_id, /^[0-9a-f-]{36}$/i);
  assert.notEqual(h.requests[0].body.data[0].event_id, "credito_900000_documentacao_irregular");
  assert.equal(h.requests[0].body.data[0].event_name, "PageView");
  assert.equal(h.requests[0].body.data[0].event_source_url, "https://nova.inspiracred.com.br/");
  assert.doesNotMatch(JSON.stringify(h.requests[0].body), /900000/);
});

test("source URL sanitizer always reduces input to the allowed domain", () => {
  const h = serverHarness();
  assert.equal(h.api.sanitizeMetaSourceUrl("https://nova.inspiracred.com.br/inspiracred?utm_source=x#y"), "https://nova.inspiracred.com.br/");
  assert.equal(h.api.sanitizeMetaSourceUrl("https://evil.example/private"), "https://nova.inspiracred.com.br/");
});

test("dashboard explains and displays the financial Meta routing", () => {
  assert.match(serverSource, /rural:"Imóvel rural"/);
  assert.match(serverSource, /<th>Meta Lead<\/th><th>Meta LeadQualificado<\/th>/);
  assert.match(serverSource, /\["Meta Lead",pretty\(leadOk\)/);
  assert.match(serverSource, /\["Meta LeadQualificado",pretty\(qualifiedOk\)/);
  assert.match(serverSource, /\["Classificação MQL",pretty\(internalMql\)/);
  assert.match(serverSource, /metaOk\+"\/"\+metaEligible/);
  assert.doesNotMatch(serverSource, /<th>Meta MQL<\/th>/);
  assert.match(serverSource, /Rural, descarte ou abaixo da faixa mínima/);
  assert.match(serverSource, /eventos <b>Lead<\/b> e <b>LeadQualificado<\/b>/);
  assert.match(serverSource, /não entram no payload da Meta/);
  assert.match(serverSource, /Vendas do CRM/);
  assert.match(serverSource, /Projeto Piloto → Crédito Liberado → Meta Purchase/);
  assert.match(serverSource, /\["Meta Purchase",pretty\(t\.meta_purchase_ok\|\|0\)/);
  assert.match(serverSource, /custom_data: \{\}/);
});
