const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../inspiracred");
const client = fs.readFileSync(path.join(root, "home/script.js"), "utf8");
const server = fs.readFileSync(path.join(root, "functions/analytics/_app.js"), "utf8");
const normalizeCode = server.slice(server.indexOf("function normalizeLeadKind("), server.indexOf("async function markLeadStatus("));
const backend = vm.createContext({});
vm.runInContext(normalizeCode, backend);

function element(value = "") {
  const classes = new Set();
  return {
    value, name: "", tagName: "INPUT", disabled: false, textContent: "", listeners: {},
    classList: {
      add: (...names) => names.forEach(n => classes.add(n)),
      remove: (...names) => names.forEach(n => classes.delete(n)),
      contains: n => classes.has(n),
      toggle: (n, on) => on ? classes.add(n) : classes.delete(n),
    },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    setAttribute() {}, removeAttribute() {}, focus() {}, setSelectionRange() {},
    querySelectorAll() { return []; }, style: { setProperty() {} },
  };
}

function submit(value, solution, tracking = "ok", overrides = {}) {
  const fields = {
    nome: ["f-nome", "Teste Local"], email: ["f-email", "teste@example.com"],
    celular: ["f-celular", "(21) 99999-9999"], estado: ["f-estado", "RJ"],
    cidade: ["f-cidade", "Niteroi"], valor_credito: ["f-valor", value],
    solucao: ["f-solucao", solution],
  };
  const ids = {};
  const inputs = {};
  const errors = {};
  for (const [name, [id, initial]] of Object.entries(fields)) {
    const el = element(overrides[name] ?? initial);
    el.name = name;
    if (name === "estado" || name === "solucao") el.tagName = "SELECT";
    ids[id] = inputs[name] = el;
    errors[name] = element();
  }
  const button = element();
  const form = element();
  form.querySelector = selector => {
    if (selector === "button[type='submit']") return button;
    if (selector === ".is-invalid") return Object.values(inputs).find(e => e.classList.contains("is-invalid"));
    const match = selector.match(/^\[(data-error|name)="([^"]+)"\]$/);
    return match ? (match[1] === "name" ? inputs : errors)[match[2]] : null;
  };
  form.querySelectorAll = selector => selector === ".money" ? [inputs.valor_credito] : Object.values(inputs);
  ids["home-lead-form"] = form;
  ids["form-message"] = element();
  ids["cidades-list"] = element();
  ids["main-nav"] = element();
  ids["site-header"] = element();
  ids["site-header"].querySelector = () => element();
  const leads = [];
  const events = [];
  const window = {
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    addEventListener() {}, location: { search: "?utm_source=teste-local", href: "/home/" },
    inspiraTrack: tracking === "missing" ? null : {
      lead(data) { if (tracking === "throw") throw Error("offline"); leads.push(data); },
      event(...args) { events.push(args); },
    },
  };
  const context = vm.createContext({
    window, URLSearchParams,
    document: {
      getElementById: id => ids[id],
      querySelectorAll: () => [],
      addEventListener() {},
      body: element(),
    },
  });
  vm.runInContext(client, context);
  const send = () => form.listeners.submit({ preventDefault() {} });
  send();
  return { window, leads, events, button, inputs, errors, message: ids["form-message"], send };
}

for (const solution of ["home_equity", "capital_giro", "financiamento_imoveis", "veiculos"]) {
  for (const credit of [1, 99999, 100000, 500000]) {
    test(solution + " / R$ " + credit, () => {
      const result = submit(credit.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), solution);
      assert.equal(result.leads.length, 1);
      const payload = result.leads[0];
      const kind = credit < 100000 ? "baixo_valor" : solution === "veiculos" ? "auto" : "institucional";
      assert.equal(payload.lead_kind, kind);
      assert.equal(payload.credit_value, credit);
      assert.equal(payload.utm_source, "teste-local");
      assert.equal(JSON.stringify(payload.meta_events), credit < 100000 ? "[]" : '["Lead"]');
      assert.equal(result.window.location.href, credit < 100000 ? "/obrigado/home-nao-elegivel/" : "/obrigado/home/");
      assert.equal(backend.normalizeLeadKind(payload), kind);
      assert.equal(backend.shouldSendLeadToRD(kind), true);
      result.send();
      assert.equal(result.leads.length, 1, "double submit must not duplicate lead");
    });
  }
}

for (const value of ["", "R$ 0,00"]) {
  test("reject empty or zero credit: " + value, () => {
    const r = submit(value, "home_equity");
    assert.equal(r.leads.length, 0);
    assert.equal(r.window.location.href, "/home/");
    assert.ok(r.errors.valor_credito.textContent);
  });
}
for (const overrides of [{ email: "invalido" }, { celular: "123" }, { cidade: "" }, { estado: "" }, { nome: "" }]) {
  test("validate required contact: " + JSON.stringify(overrides), () => {
    const r = submit("R$ 100.000,00", "home_equity", "ok", overrides);
    assert.equal(r.leads.length, 0);
    assert.equal(r.window.location.href, "/home/");
  });
}
for (const solution of ["", "unknown", "toString"]) {
  test("reject unsupported solution " + solution, () => {
    assert.equal(submit("R$ 100.000,00", solution).leads.length, 0);
  });
}
for (const state of ["missing", "throw"]) {
  test("keep form usable when tracking is " + state, () => {
    const r = submit("R$ 100.000,00", "home_equity", state);
    assert.equal(r.window.location.href, "/home/");
    assert.equal(r.button.disabled, false);
    assert.ok(r.message.classList.contains("is-visible"));
  });
}
test("backend enforces home minimum for legacy auto payloads", () => {
  assert.equal(backend.normalizeLeadKind({ source: "home_institucional", lead_kind: "auto", credit_value: 50000 }), "baixo_valor");
  assert.equal(backend.normalizeLeadKind({ source: "home_institucional", credit_value: "invalid" }), "baixo_valor");
});
test("existing home equity thresholds remain unchanged", () => {
  for (const [credit_value, property_value, expected] of [
    [199999, 1000000, "baixo_valor"], [200000, 399999, "baixo_valor"],
    [200000, 400000, "home_equity"], [500000, 1000000, "home_equity_mql"],
  ]) assert.equal(backend.normalizeLeadKind({ source: "home_equity_lp", credit_value, property_value }), expected);
  assert.equal(backend.normalizeLeadKind({ source: "home_equity_form", lead_kind: "auto" }), "auto");
  assert.equal(backend.normalizeLeadKind({ source: "home_equity_form", lead_kind: "descarte" }), "descarte");
});
for (const route of ["home", "home-nao-elegivel"]) {
  test("thank-you page assets and CTA: " + route, () => {
    const html = fs.readFileSync(path.join(root, "obrigado", route, "index.html"), "utf8");
    assert.match(html, /wa\.me\/5521977340731/);
    assert.match(html, /href="\/home\//);
    assert.match(html, /noindex, nofollow/);
    assert.match(html, /href="\.\.\/style.css"/);
    assert.match(html, /src="\/assets\/img\/landing-logo-ref.png"/);
    assert.equal(html.includes('class="is-not-qualified"'), route === "home-nao-elegivel");
  });
}
