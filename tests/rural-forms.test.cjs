const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("all three requested forms expose Rural", () => {
  const pages = [
    read("inspiracred/index.html"),
    read("inspiracred/homeequity/index.html"),
    read("hosting/official-home/index.html"),
  ];
  for (const html of pages) {
    assert.match(html, /(?:name="(?:property_type|tipo_imovel)"[\s\S]*?)?<option value="Rural">Rural<\/option>/);
  }
});

test("landing and Home Equity route rural to discard instead of lead", () => {
  const landing = read("inspiracred/index.html");
  const homeEquity = read("inspiracred/homeequity/script.js");
  for (const source of [landing, homeEquity]) {
    assert.match(source, /simulation_discard/);
    assert.match(source, /rural_property/);
    assert.match(source, /obrigado\/nao-elegivel/);
  }
  assert.match(landing, /if \(!ruralProperty\) \{[\s\S]*?enviarLead\(/);
  assert.match(homeEquity, /if \(ruralProperty\) \{[\s\S]*?simulation_discard[\s\S]*?\} else \{[\s\S]*?enviarLead\(/);
});

test("official home package discards rural before its lead handoff", () => {
  const script = read("hosting/official-home/script.js");
  const ruralBlock = script.match(/if \(isRuralProperty\(data\.tipo_imovel\)\) \{[\s\S]*?return;\s*\}/);
  assert.ok(ruralBlock);
  assert.match(ruralBlock[0], /simulation_discard/);
  assert.doesNotMatch(ruralBlock[0], /enviarLead\(/);
  assert.ok(script.indexOf(ruralBlock[0]) < script.indexOf("enviarLead(Object.assign"));
});
