const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const site = path.resolve(__dirname, "../inspiracred");
const read = (...parts) => fs.readFileSync(path.join(site, ...parts), "utf8");

test("both B2B pages keep explicit identities and the shared tracking contract", () => {
  const counters = read("contadores", "index.html");
  const partners = read("parceiros", "index.html");
  const tracker = read("assets", "js", "track.js");

  assert.match(counters, /window\.IC_PAGE\s*=\s*"contador_aquisicao_lp"/);
  assert.match(partners, /window\.IC_PAGE\s*=\s*"parceiros_lp"/);
  for (const html of [counters, partners]) {
    assert.match(html, /\.\.\/assets\/js\/track\.js/);
    assert.match(html, /\.\.\/assets\/js\/lp-b2b\.js/);
    assert.match(html, /politica-de-privacidade\.html/);
  }
  assert.match(tracker, /contador_aquisicao_lp:\s*1/);
  assert.match(tracker, /parceiros_lp:\s*1/);
});

test("contador page preserves simulation values, ranges and financial disclaimers", () => {
  const html = read("contadores", "index.html");
  const script = read("assets", "js", "lp-b2b.js");

  for (const copy of ["R$ 250 mil", "R$ 500 mil", "R$ 6.491,67", "R$ 12.932,84", "1,09% ao mês + IPCA", "Custo Efetivo Total (CET)"]) {
    assert.ok(html.includes(copy), `missing required copy: ${copy}`);
  }
  assert.match(html, /não vende carteiras contábeis/i);
  assert.match(script, /propertyValue < 400000 \|\| propertyValue > 20000000/);
  assert.match(script, /creditValue < 200000 \|\| creditValue > 12000000/);
  assert.match(script, /source:\s*"contador_aquisicao_lp"/);
});

test("partner page preserves eligibility and commission conditions", () => {
  const html = read("parceiros", "index.html");
  const script = read("assets", "js", "lp-b2b.js");
  const server = read("functions", "analytics", "_app.js");

  assert.match(html, /sujeita à análise e aprovação de perfil/i);
  assert.match(html, /operações concluídas e com crédito liberado/i);
  assert.match(html, /condições de remuneração variam conforme o modelo/i);
  assert.match(html, /name="partner_role"/);
  assert.match(script, /lead_kind:\s*"parceiro"/);
  assert.match(server, /event\.source === "parceiros_lp"\) return "parceiro"/);
  assert.match(server, /UPDATE leads SET partner_role/);
  assert.doesNotMatch(server, /parceiros_lp:\s*\{\s*identificador/);
});

test("contador origin reuses the confirmed Home Equity RD identifier", () => {
  const server = read("functions", "analytics", "_app.js");
  assert.match(server, /contador_aquisicao_lp:\s*\{\s*identificador:\s*"Home Equity",\s*label:\s*"Contadores — Aquisição"/);
  assert.match(server, /tags\.push\("lp contadores", "aquisição carteira contábil"\)/);
  assert.match(server, /contador_aquisicao_lp:\s*"Contadores — Aquisição"/);
});

test("forms expose persistent labels, error regions and success states", () => {
  for (const page of ["contadores", "parceiros"]) {
    const html = read(page, "index.html");
    assert.match(html, /<label for=/);
    assert.match(html, /role="alert" aria-live="polite"/);
    assert.match(html, /data-form-success hidden/);
    assert.match(html, /type="submit"/);
  }
});

test("forms keep required semantics without visual asterisk noise", () => {
  for (const page of ["contadores", "parceiros"]) {
    const html = read(page, "index.html");
    assert.doesNotMatch(html, /Campos com/i);
    assert.doesNotMatch(html, /class="required"/);
    assert.match(html, /name="name"[^>]*required/);
    assert.match(html, /name="phone"[^>]*required/);
  }
});
