const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const client = fs.readFileSync(path.join(__dirname, "../inspiracred/homeequity/script.js"), "utf8");

function element(value = "") {
  const classes = new Set();
  return {
    value, textContent: "", disabled: false, listeners: {},
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
    },
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); },
    async emit(name) { for (const callback of this.listeners[name] || []) await callback({ preventDefault() {} }); },
    setAttribute() {}, setSelectionRange() {}, querySelectorAll() { return []; }, style: { setProperty() {} },
  };
}

function setup(transport = "tracker", overrides = {}) {
  const values = {
    "f-nome": "QA Local", "f-email": "qa@example.invalid", "f-celular": "(21) 92345-6789",
    "f-bem": "Imóvel", "f-valor-emp": "R$ 500.000,00", "f-tipo": "Casa",
    "f-situacao": "Quitado", "f-valor-imovel": "R$ 1.000.000,00", "f-saldo": "", ...overrides,
  };
  const ids = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, element(value)]));
  for (const id of ["lead-form", "form-success", "form-message", "f-tipo-field", "f-situacao-label", "f-valor-imovel-label", "f-saldo-field", "f-saldo-label"]) ids[id] = element();
  const button = element();
  button.textContent = "Enviar";
  ids["lead-form"].querySelector = (selector) => selector === "button[type='submit']" ? button : null;
  const events = [], leads = [], requests = [], timers = [];
  const location = { search: "?utm_source=qa-local", href: "/homeequity/" };
  const window = {
    location, matchMedia: () => ({ matches: true }), addEventListener() {},
    inspiraTrack: transport.startsWith("missing") ? null : {
      lead(payload) { leads.push(payload); return transport === "tracker" || transport === "event-throws"; },
      event(name, props) { if (transport === "event-throws") throw new Error("event mock"); events.push({ name, props }); },
    },
  };
  const context = vm.createContext({
    window, location, URLSearchParams, Blob,
    document: { getElementById: (id) => ids[id], querySelector: () => null, querySelectorAll: () => [], body: element() },
    localStorage: { getItem: () => "offline-session" },
    navigator: { sendBeacon(url, blob) { requests.push({ url, blob }); return transport.includes("beacon"); } },
    fetch(url, options) {
      requests.push({ url, payload: JSON.parse(options.body) });
      if (transport === "reject") return Promise.reject(new Error("offline mock"));
      return Promise.resolve({ ok: transport === "fetch" });
    },
    setTimeout(callback) { timers.push(callback); },
  });
  vm.runInContext(client, context);
  return { ids, button, events, leads, requests, timers, window, submit: () => ids["lead-form"].emit("submit") };
}

test("valid submission keeps internal MQL but sends non-selected Lead", async () => {
  const r = setup();
  await Promise.all([r.submit(), r.submit()]);
  assert.equal(r.leads.length, 1);
  assert.equal(r.leads[0].lead_kind, "home_equity_mql");
  assert.deepEqual(Array.from(r.leads[0].meta_events), ["Lead"]);
  assert.equal(JSON.stringify(r.events), '[{"name":"simulation_complete","props":{"source":"home_equity_lp"}}]');
  assert.equal(r.timers.length, 1);
});

test("low-value submission remains internally classified and still uses Lead action", async () => {
  const r = setup("tracker", { "f-valor-emp": "R$ 199.999,00" });
  await r.submit();
  assert.equal(r.leads[0].lead_kind, "baixo_valor");
  assert.deepEqual(Array.from(r.leads[0].meta_events), ["Lead"]);
});

test("failed fallback handoff remains retryable and never completes", async () => {
  const r = setup("reject");
  await r.submit();
  assert.equal(r.events.length, 0);
  assert.equal(r.timers.length, 0);
  assert.equal(r.button.disabled, false);
  assert.equal(r.button.textContent, "Enviar");
  assert.ok(r.ids["form-message"].classList.contains("is-visible"));
});

test("fallback payload also contains only Lead", async () => {
  const r = setup("missing-beacon");
  await r.submit();
  const payload = JSON.parse(await r.requests[0].blob.text());
  assert.deepEqual(payload.meta_events.map((event) => event.name), ["Lead"]);
  assert.equal(payload.lead_kind, "home_equity_mql");
});
