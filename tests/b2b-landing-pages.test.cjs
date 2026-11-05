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

test("pages avoid template patterns and keep the rebuilt editorial rhythm", () => {
  const counters = read("contadores", "index.html");
  const partners = read("parceiros", "index.html");
  for (const html of [counters, partners]) {
    assert.doesNotMatch(html, /hero-kicker|class="eyebrow/);
    assert.doesNotMatch(html, /class="(?:navy-panel|step-card|audience-card|model-card|hero-grid)/);
    assert.match(html, /lp-b2b-rebuild\.css/);
  }
  assert.match(counters, /class="hero contador-acquisition-hero"/);
  assert.match(counters, /class="hero-emphasis"/);
  assert.match(counters, /class="contador-process-rail"/);
  assert.match(counters, /class="contador-simulation-board"/);
  assert.match(counters, /class="form-surface contador-process-form" id="avaliacao"/);
  assert.ok(counters.indexOf('id="avaliacao"') < counters.indexOf('id="simulacoes"'), "contador form stays in the third fold before simulations");
  assert.match(partners, /class="hero partner-sentence"/);
  assert.match(partners, /data-site-header/);
  assert.match(partners, /class="hero-emphasis"/);
  assert.match(partners, /class="relay-process"/);
  assert.match(partners, /class="audience-rows"/);
  assert.match(partners, /class="model-split"/);
  assert.match(partners, /class="faq-editorial partner-faq"/);
  assert.match(partners, /class="button cta-pulse"/);
  assert.match(partners, /class="shell partner-form-grid"/);
  assert.doesNotMatch(counters + partners, /class="step-number"/);
  assert.ok(fs.existsSync(path.join(site, "assets", "img", "parceiros-hero-square-v4.webp")));
  const css = read("assets", "css", "lp-b2b-rebuild.css");
  const script = read("assets", "js", "lp-b2b.js");
  assert.match(css, /\.site-header\.is-sticky/);
  assert.match(css, /\.page-parceiros \.site-header:not\(\.is-sticky\)[^}]+background: transparent/);
  assert.match(css, /\.nav-links \.button \{ color: #fff; \}/);
  assert.match(css, /parceiros-hero-portfolio-v6\.webp/);
  assert.match(css, /--radius-panel: 24px;/);
  assert.match(css, /--radius-media: 24px;/);
  assert.match(css, /\.partner-hero-visual::before, \.partner-hero-visual::after, \.partner-hero-visual > span \{ display: none; \}/);
  assert.doesNotMatch(css, /border-radius: 34px 10px|border-radius: 28px 8px|border-radius: 20px 6px/);
  assert.match(css, /@keyframes header-drop/);
  assert.match(css, /@keyframes cta-pulse/);
  assert.match(css, /\.partner-closing[^}]+linear-gradient/);
  assert.match(css, /\.partner-transition-band::after[^}]+linear-gradient\(to right/);
  assert.match(css, /\.partner-transition-band::after \{ background: linear-gradient\(to top/);
  assert.ok((css.match(/linear-gradient|radial-gradient/g) || []).length <= 12, "gradients stay bounded to purposeful image and section transitions");
  assert.match(css, /\.contador-acquisition-hero::before[^}]+linear-gradient/);
  assert.match(css, /\.contador-closing::before[^}]+linear-gradient/);
  assert.match(script, /data-scroll-scene/);
  assert.match(script, /event\.key !== "Tab"/);
  assert.match(script, /closeMenu\(true\)/);
  assert.match(css, /--scene-progress/);
  assert.match(css, /prefers-reduced-motion/);
});

test("B2B narratives use purpose-built scenes and the verified InspiraCred team photo", () => {
  const counters = read("contadores", "index.html");
  const partners = read("parceiros", "index.html");
  const generated = path.join(site, "assets", "img", "generated");
  const requiredAssets = [
    "contadores-hero-acquisition-v1.webp",
    "contadores-property-office-v1.webp",
    "contadores-closing-v1.webp",
    "contadores-advisory-team-v1.webp",
    "contadores-new-office-v2.webp",
    "contadores-acquisition-negotiation-v3.webp",
    "contadores-entry-structure-v2.webp",
    "contadores-proposal-comparison-v2.webp",
    "contadores-new-office-closing-v2.webp",
    "parceiros-opportunity-v1.webp",
    "parceiros-introduction-v2.webp",
    "parceiros-introduction-v3.webp",
    "parceiros-hero-referral-v5.webp",
    "parceiros-hero-referral-v7.webp",
    "parceiros-hero-referral-v8.webp",
    "parceiros-hero-portfolio-v6.webp",
    "parceiros-closing-abstract-v1.webp",
    "parceiros-trust-handoff-v1.webp",
  ];

  for (const asset of requiredAssets) {
    assert.ok(fs.existsSync(path.join(generated, asset)), `missing purpose-built image: ${asset}`);
    assert.ok(fs.existsSync(path.join(generated, `${asset}.json`)), `missing image provenance: ${asset}`);
  }
  assert.match(partners, /\.\.\/home\/img\/equipe\.webp/);
  assert.match(counters, /contadores-entry-structure-v2\.webp/);
  assert.match(counters, /\.\.\/home\/img\/equipe\.webp/);
  assert.doesNotMatch(counters, /contadores-(?:hero-acquisition|property-office|closing-v1|advisory-team|new-office-v2)\.webp/);
  assert.doesNotMatch(partners, /class="audience-band"/);
  assert.match(partners, /class="shell commission-overlay"/);
  assert.doesNotMatch(partners, /class="commission-line"/);
  assert.doesNotMatch(counters + partners, /home\/img\/consultoria\.webp|homeequity\/img\/(?:mansao2\.jpg|handshake\.webp)/);
});

test("contador page preserves the original acquisition argument and legal return path", () => {
  const html = read("contadores", "index.html");
  const privacy = read("politica-de-privacidade.html");
  const terms = read("termos-de-uso.html");

  assert.match(html, /O lucro gerado pelos novos clientes pode ajudar a pagar as parcelas do próprio crédito utilizado na aquisição\./);
  assert.match(html, /politica-de-privacidade\.html\?return=%2Fcontadores%2F/);
  assert.match(html, /termos-de-uso\.html\?return=%2Fcontadores%2F/);
  for (const legal of [privacy, terms]) {
    assert.match(legal, /data-return-link/);
    assert.match(legal, /class="floating-back"/);
    assert.match(legal, /Voltar ao site/);
    assert.match(legal, /position:fixed/);
    assert.match(legal, /new URLSearchParams\(window\.location\.search\)\.get\("return"\)/);
    assert.match(legal, /requested\.slice\(0, 2\) !== "\/\/"/);
  }
});

test("secondary phone guidance is available on demand without reserving form space", () => {
  const html = read("contadores", "index.html");
  const css = read("assets", "css", "lp-b2b-rebuild.css");
  assert.match(html, /class="field-info"/);
  assert.match(html, /role="tooltip"/);
  assert.doesNotMatch(html, /class="field-help"/);
  assert.match(css, /\.field-info-wrap:focus-within \.field-tooltip/);
});
