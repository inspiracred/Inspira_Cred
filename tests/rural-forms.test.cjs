const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("all four active forms expose Rural", () => {
  const pages = [
    read("inspiracred/index.html"),
    read("inspiracred/homeequity/index.html"),
    read("hosting/official-home/index.html"),
  ];
  for (const html of pages) {
    assert.match(html, /(?:name="(?:property_type|tipo_imovel)"[\s\S]*?)?<option value="Rural">Rural<\/option>/);
  }
  const guidedForm = read("inspiracred/formulario/script.js");
  assert.match(guidedForm, /\{ label: "Imóvel rural", value: "rural" \}/);
});

test("landing and Home Equity preserve rural leads for D1/RD", () => {
  const landing = read("inspiracred/index.html");
  const homeEquity = read("inspiracred/homeequity/script.js");
  const guidedForm = read("inspiracred/formulario/script.js");
  for (const source of [landing, homeEquity]) {
    assert.match(source, /simulation_discard/);
    assert.match(source, /rural_property/);
    assert.match(source, /obrigado\/nao-elegivel/);
  }
  assert.match(landing, /var kind = ruralProperty \? "rural"/);
  assert.ok(landing.indexOf("enviarLead({") < landing.indexOf('window.inspiraTrack.event("simulation_discard"'));
  assert.match(homeEquity, /lead_kind: ruralProperty \? "rural" : leadKind/);
  assert.ok(homeEquity.indexOf("accepted = await enviarLead") < homeEquity.indexOf('window.inspiraTrack.event("simulation_discard"'));
  assert.match(guidedForm, /if \(isRuralProperty\(answers\.tipo_imovel\)\) return "rural"/);
  assert.match(guidedForm, /reason: "rural_property"/);
  assert.ok(guidedForm.indexOf("accepted = await enviarLead") < guidedForm.indexOf('window.inspiraTrack.event("simulation_discard"'));
});

test("official home package sends rural to D1/RD before redirecting as not eligible", () => {
  const script = read("hosting/official-home/script.js");
  assert.match(script, /var leadKind = ruralProperty \? "rural"/);
  assert.match(script, /accepted = await enviarLead\(Object\.assign\(/);
  assert.match(script, /if \(ruralProperty \|\| baixoValor\)/);
  assert.match(script, /obrigado\/home-nao-elegivel/);
  assert.ok(script.indexOf('window.inspiraTrack.event("simulation_discard"') < script.indexOf("accepted = await enviarLead(Object.assign"));
});
