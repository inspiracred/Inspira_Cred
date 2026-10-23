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
    "f-bem": "Imóvel", "f-valor-emp": "R$ 350.000,00", "f-tipo": "Casa",
    "f-situacao": "Quitado", "f-valor-imovel": "R$ 700.000,00", "f-saldo": "", ...overrides,
  };
  const ids = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, element(value)]));
  for (const id of ["lead-form", "form-success", "form-message", "f-tipo-field", "f-situacao-label", "f-valor-imovel-label", "f-saldo-field", "f-saldo-label"]) ids[id] = element();
  const errors = {
    valor_emprestimo: element(), valor_imovel: element(), nome: element(), celular: element(),
    email: element(), tipo_bem: element(), tipo_imovel: element(), situacao_imovel: element(), saldo_devedor: element(),
  };
  const button = element();
  button.textContent = "Enviar";
  ids["lead-form"].querySelector = (selector) => {
    if (selector === "button[type='submit']") return button;
    const errorMatch = selector.match(/^\[data-error="([^"]+)"\]$/);
    if (errorMatch) return errors[errorMatch[1]] || null;
    const nameMatch = selector.match(/^\[name="([^"]+)"\]$/);
    if (!nameMatch) return null;
    return ({
      nome: ids["f-nome"], celular: ids["f-celular"], email: ids["f-email"], tipo_bem: ids["f-bem"],
      valor_emprestimo: ids["f-valor-emp"], tipo_imovel: ids["f-tipo"], situacao_imovel: ids["f-situacao"],
      valor_imovel: ids["f-valor-imovel"], saldo_devedor: ids["f-saldo"],
    })[nameMatch[1]] || null;
  };
  const events = [], leads = [], requests = [], timers = [];
  const location = { search: "?utm_source=qa-local", href: "/homeequity/" };
  const window = {
    location, matchMedia: () => ({ matches: true }), addEventListener() {},
    inspiraTrack: transport.startsWith("missing") ? null : {
      leadConfirmed(payload) { leads.push(payload); return Promise.resolve(transport === "tracker" || transport === "event-throws"); },
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
      return Promise.resolve({ ok: transport.includes("fetch") });
    },
    setTimeout(callback) { timers.push(callback); },
  });
  vm.runInContext(client, context);
  return { ids, errors, button, events, leads, requests, timers, window, submit: () => ids["lead-form"].emit("submit") };
}

test("valid submission preserves MQL data and leaves Meta routing to the server", async () => {
  const r = setup();
  await Promise.all([r.submit(), r.submit()]);
  assert.equal(r.leads.length, 1);
  assert.equal(r.leads[0].lead_kind, "home_equity_mql");
  assert.equal(Object.hasOwn(r.leads[0], "meta_events"), false);
  assert.equal(JSON.stringify(r.events), '[{"name":"simulation_complete","props":{"source":"home_equity_lp"}}]');
  assert.equal(r.timers.length, 1);
  r.timers[0]();
  assert.match(r.window.location.href, /^https:\/\/wa\.me\/5521977340731\?text=/);
  const message = decodeURIComponent(r.window.location.href.split("?text=")[1]);
  assert.match(message, /Nome: QA Local/);
  assert.match(message, /Valor do imóvel: R\$\s*700\.000/);
  assert.match(message, /Valor desejado: R\$\s*350\.000/);
  assert.deepEqual(r.events.map((event) => event.name), ["simulation_complete", "whatsapp_open"]);
});

test("low-value submission remains classified without a client-selected event", async () => {
  const r = setup("tracker", { "f-valor-emp": "R$ 199.999,00" });
  await r.submit();
  assert.equal(r.leads[0].lead_kind, "baixo_valor");
  assert.equal(Object.hasOwn(r.leads[0], "meta_events"), false);
});

for (const [field, value, errorField, limit] of [
  ["f-valor-emp", "R$ 12.000.001,00", "valor_emprestimo", /12\.000\.000/],
  ["f-valor-imovel", "R$ 20.000.001,00", "valor_imovel", /20\.000\.000/],
]) {
  test("reject value above limit: " + field, async () => {
    const r = setup("tracker", { [field]: value });
    await r.submit();
    assert.equal(r.leads.length, 0);
    assert.match(r.errors[errorField].textContent, limit);
  });
}

test("rural property is saved for D1/RD without completion conversion", async () => {
  const r = setup("tracker", { "f-tipo": "Rural" });
  await r.submit();
  assert.equal(r.leads.length, 1);
  assert.equal(r.leads[0].lead_kind, "rural");
  assert.equal(r.leads[0].property_type, "rural");
  assert.deepEqual(r.events.map((event) => event.name), ["simulation_discard"]);
  assert.equal(r.events[0].props.reason, "rural_property");
  assert.equal(r.timers.length, 1);
  r.timers[0]();
  assert.equal(r.window.location.href, "/obrigado/nao-elegivel/");
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

test("fallback payload also leaves the Meta event to the server", async () => {
  const r = setup("missing-fetch");
  await r.submit();
  const payload = r.requests[0].payload;
  assert.equal(Object.hasOwn(payload, "meta_events"), false);
  assert.equal(payload.lead_kind, "home_equity_mql");
});
