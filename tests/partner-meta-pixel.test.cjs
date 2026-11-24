const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "../inspiracred");
const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");
const pixelCode = read("parceiros/meta-pixel.js");
const trackerCode = read("assets/js/track.js");
const serverCode = read("functions/analytics/_app.js")
  .replace("export async function onRequest", "async function onRequest");
const host = "https://nova.inspiracred.com.br";
const pixelId = "3021870508000260";
const uuid = "12345678-1234-4234-9234-123456789abc";

function browser({ origin = host, pathname = "/parceiros/", navigator = {}, doNotTrack, tracker = false, fetch } = {}) {
  const scripts = [];
  const beacons = [];
  const location = { origin, pathname, search: "?utm_source=meta", href: origin + pathname + "?utm_source=meta" };
  const window = { IC_PAGE: "parceiros_lp", location, doNotTrack, addEventListener() {} };
  const document = {
    cookie: "", title: "", referrer: "",
    createElement: () => ({}),
    head: { appendChild(script) { scripts.push(script.src); } },
    querySelectorAll: () => [],
    documentElement: { scrollHeight: 1000 },
    addEventListener() {},
  };
  const context = vm.createContext({
    window, document, location, URLSearchParams, TextEncoder, Uint8Array, Blob, fetch,
    crypto: { randomUUID: () => uuid, subtle: webcrypto.subtle },
    localStorage: { getItem: () => "synthetic-session", setItem() {} },
    navigator: { sendBeacon(url, blob) { beacons.push(blob); return true; }, ...navigator },
    screen: { width: 1200, height: 800 },
    setTimeout() {},
    IntersectionObserver: function () { this.observe = () => {}; },
  });
  vm.runInContext(pixelCode, context);
  let pending;
  if (tracker) {
    const pageView = window.inspiraPartnerPageView;
    window.inspiraPartnerPageView = (id) => { pending = pageView(id); };
    vm.runInContext(trackerCode, context);
  }
  return { window, scripts, beacons, pending };
}

async function server(payload, headers = {}, requestHost = host) {
  const requests = [];
  const tasks = [];
  const context = vm.createContext({
    URL, Request, Response, TextEncoder, Uint8Array, crypto: webcrypto,
    async fetch(url, options) { requests.push({ url, body: JSON.parse(options.body) }); },
  });
  vm.runInContext(serverCode, context);
  const response = await context.onRequest({
    request: new Request(requestHost + "/analytics/track", {
      method: "POST", body: JSON.stringify(payload),
      headers: { "User-Agent": "Mozilla/5.0 Chrome/142.0.0.0 Safari/537.36", ...headers },
    }),
    env: {
      META_PIXEL_ID: pixelId, META_ACCESS_TOKEN: "local-only",
      DB: { prepare() { return { bind() { return this; }, async first() { return null; }, async run() {} }; } },
    },
    waitUntil(task) { tasks.push(task); },
  });
  assert.equal(response.status, 200);
  await Promise.all(tasks);
  return requests;
}

test("somente o HTML de Parceiros carrega o Pixel", () => {
  const references = fs.readdirSync(root, { recursive: true })
    .filter((filename) => filename.endsWith(".html"))
    .map((filename) => filename.split(path.sep).join("/"))
    .filter((filename) => /(?:\.\/meta-pixel\.js|3021870508000260|connect\.facebook\.net\/.*fbevents\.js)/.test(read(filename)));
  assert.deepEqual(references, ["parceiros/index.html"]);
});

test("PageView da LP usa o Pixel indicado e o mesmo ID na Conversions API", async () => {
  const h = browser({ tracker: true });
  await h.pending;
  const [set, init, track] = h.window.fbq.queue.map((args) => Array.from(args));
  assert.deepEqual(h.scripts, ["https://connect.facebook.net/en_US/fbevents.js"]);
  assert.deepEqual(set, ["set", "autoConfig", false, pixelId]);
  assert.deepEqual(init, ["init", pixelId]);
  assert.deepEqual(track.slice(0, 3), ["trackSingle", pixelId, "PageView"]);
  assert.deepEqual(Object.keys(track[3]), []);
  assert.match(track[4].eventID, /^[0-9a-f]{64}$/);
  assert.equal(h.window.fbq.queue.length, 3);

  const payload = JSON.parse(await h.beacons[0].text());
  assert.equal(payload.event_id, uuid);
  const [request] = await server(payload);
  assert.equal(new URL(request.url).pathname, "/v21.0/" + pixelId + "/events");
  assert.equal(request.body.data[0].event_name, "PageView");
  assert.equal(request.body.data[0].event_id, track[4].eventID);
  assert.equal(request.body.data[0].event_source_url, host + "/");
});

test("Pixel fica fora de outras páginas, previews e navegadores com preferência de privacidade", async () => {
  for (const options of [
    { pathname: "/contadores/" },
    { origin: "https://preview.inspira-cred.pages.dev" },
    { navigator: { globalPrivacyControl: true } },
    { navigator: { doNotTrack: "1" } },
    { doNotTrack: "1" },
  ]) {
    const h = browser(options);
    assert.equal(h.window.fbq, undefined);
    assert.equal(h.scripts.length, 0);
  }
  const evt = { type: "page_view", event_id: uuid, session_id: "synthetic-session",
    page_name: "parceiros_lp", url: "/parceiros/?utm_source=meta" };
  for (const headers of [{ "Sec-GPC": "1" }, { DNT: "1" }]) {
    assert.deepEqual(await server(evt, headers), []);
  }
  for (const details of [
    { event_id: "invalid-marker" },
    { page_name: "contador_aquisicao_lp", url: "/contadores/" },
    { page_name: "parceiros_lp", url: "/contadores/" },
  ]) {
    const [request] = await server({ ...evt, ...details });
    assert.match(request.body.data[0].event_id, /^[0-9a-f-]{36}$/);
  }
});

test("Pixel de Parceiros manda Lead apenas com o ID opaco confirmado, uma vez", () => {
  const h = browser();
  h.window.inspiraPartnerLead(undefined);
  h.window.inspiraPartnerLead("invalid-marker");
  assert.equal(h.window.fbq.queue.length, 2);
  h.window.inspiraPartnerLead(uuid);
  h.window.inspiraPartnerLead(uuid);
  assert.equal(h.window.fbq.queue.length, 3);
  const command = Array.from(h.window.fbq.queue[2]);
  assert.deepEqual(command.slice(0, 3), ["trackSingle", pixelId, "Lead"]);
  assert.deepEqual(Object.keys(command[3]), []);
  assert.equal(command[4].eventID, uuid);
});

test("formulário aguarda enfileirar o Lead confirmado antes de concluir o envio", async () => {
  let allowBody;
  let callbackStarted;
  let submitted = false;
  const body = new Promise((resolve) => { allowBody = resolve; });
  const started = new Promise((resolve) => { callbackStarted = resolve; });
  const h = browser({ tracker: true, fetch: async () => ({ ok: true, json: () => body }) });
  await h.pending;
  const sending = h.window.inspiraTrack.leadConfirmed({ source: "parceiros_lp" }, async (response) => {
    callbackStarted();
    const result = await response.json();
    h.window.inspiraPartnerLead(result.meta_lead_event_id);
  }).then((ok) => { submitted = ok; });
  await started;
  assert.equal(submitted, false);
  assert.equal(h.window.fbq.queue.some((args) => args[2] === "Lead"), false);
  allowBody({ success: true, meta_lead_event_id: uuid });
  await sending;
  assert.equal(submitted, true);
  assert.equal(h.window.fbq.queue.find((args) => args[2] === "Lead")[4].eventID, uuid);

  const fail = browser({ tracker: true, fetch: async () => ({ ok: false }) });
  assert.equal(await fail.window.inspiraTrack.leadConfirmed({ source: "parceiros_lp" },
    () => assert.fail("Envio inválido não deve chamar o Pixel")), false);
});
