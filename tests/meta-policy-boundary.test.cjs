const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const root = path.resolve(__dirname, "../inspiracred");
const trackerSource = fs.readFileSync(path.join(root, "assets/js/track.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "functions/analytics/_app.js"), "utf8");

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

test("browser queues one non-selected Lead for CAPI without calling Meta Pixel", async () => {
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
  assert.deepEqual(lead.meta_events.map((event) => event.name), ["Lead"]);
  assert.equal(lead.url, "https://nova.inspiracred.com.br/");
  assert.equal(lead.credit_value, 900000, "financial qualification remains internal");
});

test("funnel events keep internal properties and queue only a CAPI marker", async () => {
  const h = trackerHarness();
  h.window.inspiraTrack.event("simulation_complete", { source: "home_equity_lp", credit_value: 900000 });
  assert.equal(h.fbqCalls.length, 0);
  const payloads = await Promise.all(h.beacons.map(beaconPayload));
  const event = payloads.find((payload) => payload.event_name === "simulation_complete");
  assert.equal(event.properties.credit_value, 900000);
  assert.equal(event.url, "https://nova.inspiracred.com.br/");
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
      requests.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
    },
  });
  const executable = serverSource.replace("export async function onRequest", "async function onRequest");
  vm.runInContext(`${executable};globalThis.__policy={normalizeLeadMetaEvents,normalizeFunnelMetaEvent,sanitizeMetaSourceUrl,sendLeadToMeta,sendCustomEventToMeta};`, context);
  const env = {
    META_PIXEL_ID: "3021870508000260", META_ACCESS_TOKEN: "test-secret",
    DB: { prepare(sql) { let params = []; return { bind(...values) { params = values; return this; }, async run() { writes.push({ sql, params }); } }; } },
  };
  return { api: context.__policy, env, requests, writes };
}

test("server rewrites hostile or legacy lead markers to exactly Lead", async () => {
  const h = serverHarness();
  const event = {
    session_id: "session-safe", name: "Pessoa Teste", email: "qa@example.invalid", phone: "+5521999999999",
    credit_value: 900000, property_type: "casa", event_id: "legacy-event",
    meta_events: [
      { name: "LeadQualificado", event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { name: "Lead", event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    ],
  };
  assert.deepEqual(Array.from(h.api.normalizeLeadMetaEvents(event), (item) => item.name), ["Lead"]);
  await h.api.sendLeadToMeta(event, h.env, 42, {
    clientIp: "203.0.113.10", userAgent: "Mozilla/5.0 QA", sourceUrl: "https://nova.inspiracred.com.br/homeequity/?credit_value=900000#private",
  });
  assert.equal(h.requests.length, 1);
  const sent = h.requests[0].body.data;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].event_name, "Lead");
  assert.match(sent[0].event_id, /^[0-9a-f-]{36}$/i);
  assert.notEqual(sent[0].event_id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.deepEqual(sent[0].custom_data, {});
  assert.equal(sent[0].event_source_url, "https://nova.inspiracred.com.br/");
  assert.doesNotMatch(JSON.stringify(sent), /900000|home_equity_mql|LeadQualificado|DocumentacaoIrregular/);
});

test("server allows only the two truthful funnel mappings", async () => {
  const h = serverHarness();
  assert.equal(h.api.normalizeFunnelMetaEvent("simulation_start"), "InitiateCheckout");
  assert.equal(h.api.normalizeFunnelMetaEvent("simulation_complete"), "SubmitApplication");
  assert.equal(h.api.normalizeFunnelMetaEvent("LeadQualificado"), "");
  for (const hostile of ["__proto__", "constructor", "toString", null, {}]) {
    assert.equal(h.api.normalizeFunnelMetaEvent(hostile), "");
  }
  await h.api.sendCustomEventToMeta({ event_name: "LeadQualificado", meta_event_name: "LeadQualificado" }, h.env, {});
  assert.equal(h.requests.length, 0);
  await h.api.sendCustomEventToMeta({ event_name: "simulation_complete", event_id: "credito_900000_documentacao_irregular" }, h.env, {});
  assert.match(h.requests[0].body.data[0].event_id, /^[0-9a-f-]{36}$/i);
  assert.notEqual(h.requests[0].body.data[0].event_id, "credito_900000_documentacao_irregular");
});

test("source URL sanitizer always reduces input to the allowed domain", () => {
  const h = serverHarness();
  assert.equal(h.api.sanitizeMetaSourceUrl("https://nova.inspiracred.com.br/inspiracred?utm_source=x#y"), "https://nova.inspiracred.com.br/");
  assert.equal(h.api.sanitizeMetaSourceUrl("https://evil.example/private"), "https://nova.inspiracred.com.br/");
});
