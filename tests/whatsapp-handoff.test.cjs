const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("all traffic forms announce the WhatsApp handoff before submission", () => {
  const pages = [
    read("inspiracred", "index.html"),
    read("inspiracred", "homeequity", "index.html"),
    read("hosting", "official-home", "index.html"),
  ];
  for (const html of pages) {
    assert.match(html, />Enviar e falar no WhatsApp<\/button>/);
    assert.match(html, /abriremos o WhatsApp/i);
  }
});

test("eligible submissions wait for Cloudflare and then open a personalized WhatsApp message", () => {
  const implementations = [
    read("inspiracred", "index.html"),
    read("inspiracred", "homeequity", "script.js"),
    read("inspiracred", "home", "script.js"),
    read("hosting", "official-home", "script.js"),
  ];
  for (const source of implementations) {
    assert.match(source, /leadConfirmed/);
    assert.match(source, /accepted = await enviarLead/);
    assert.match(source, /https:\/\/wa\.me\/5521977340731\?text=/);
    assert.match(source, /"whatsapp_open"/);
    assert.match(source, /trigger: "form_success"/);
  }
});

test("the detailed simulator message carries the form answers without adding them to tracking", () => {
  const landing = read("inspiracred", "index.html");
  for (const label of [
    "Nome: ",
    "Tipo de imóvel: ",
    "Valor do imóvel: ",
    "Valor desejado: ",
    "Imóvel quitado: ",
    "Documentação regularizada: ",
  ]) assert.ok(landing.includes(label));

  const trackingCall = landing.slice(
    landing.indexOf("function trackWhatsappHandoff"),
    landing.indexOf("function payment"),
  );
  assert.doesNotMatch(trackingCall, /property|credit|valor|documenta|quitado/i);
});

test("rural and below-minimum leads keep the non-eligible route", () => {
  const landing = read("inspiracred", "index.html");
  const homeEquity = read("inspiracred", "homeequity", "script.js");
  const home = read("inspiracred", "home", "script.js");
  assert.match(landing, /kind === "baixo_valor" \|\| kind === "descarte" \|\| kind === "rural"/);
  assert.match(homeEquity, /if \(!isLead\)/);
  assert.match(home, /if \(ruralProperty \|\| baixoValor\)/);
});

test("shared tracker exposes a confirmed lead transport without changing ordinary beacon events", () => {
  const tracker = read("inspiracred", "assets", "js", "track.js");
  assert.match(tracker, /function sendConfirmed\(payload\)/);
  assert.match(tracker, /leadConfirmed: function \(data\)/);
  assert.match(tracker, /return sendConfirmed\(leadPayload\(data\)\)/);
  assert.match(tracker, /navigator\.sendBeacon/);
});
