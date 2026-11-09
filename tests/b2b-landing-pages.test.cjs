const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
  assert.match(server, /parceiros_lp:\s*\{\s*identificador:\s*"Home Equity",\s*label:\s*"Parceiros"/);
  assert.match(server, /kind === "parceiro"/);
  assert.match(server, /event\.source === "parceiros_lp"\) tags\.push\("parceiro"\)/);
});

test("partner page keeps the original audience copy and early registration path", () => {
  const html = read("parceiros", "index.html");

  assert.match(html, /class="hero-lead-emphasis">ganhe comissões<\/strong>/);
  assert.match(html, /class="opportunity-cards"/);
  assert.match(html, /Essas demandas podem já existir entre os clientes que você atende todos os dias\./);
  assert.match(html, /Você conhece a realidade financeira dos seus clientes/);
  assert.match(html, /Você atende clientes que podem precisar de recursos/);
  assert.match(html, /Você ajuda seus clientes a tomar decisões sobre dinheiro/);
  assert.match(html, /Você já tem experiência com crédito e uma carteira de clientes/);
  assert.match(html, /Você indica\. Nossa equipe conduz a operação\./);
  assert.equal((html.match(/id="cadastro"/g) || []).length, 1);
  assert.ok(html.indexOf('id="cadastro"') < html.indexOf('id="como-funciona"'), "partner form stays in the third fold before the process section");
  assert.doesNotMatch(html, /[—–]/);
});

test("contador origin reuses the confirmed Home Equity RD identifier", () => {
  const server = read("functions", "analytics", "_app.js");
  assert.match(server, /contador_aquisicao_lp:\s*\{\s*identificador:\s*"Home Equity",\s*label:\s*"Contadores — Aquisição"/);
  assert.match(server, /tags\.push\("contabilidade", "lp contadores", "aquisição carteira contábil"\)/);
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
    assert.match(html, /name="email"[^>]*required/);
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
  assert.match(html, /<span class="no-break">Custo Efetivo Total \(CET\)<\/span>/);
  assert.match(read("assets", "css", "lp-b2b-rebuild.css"), /\.contador-simulation-foot \.no-break \{ white-space: nowrap; \}/);
  assert.match(html, /politica-de-privacidade\.html\?return=%2Fcontadores%2F/);
  assert.match(html, /termos-de-uso\.html\?return=%2Fcontadores%2F/);
  for (const legal of [privacy, terms]) {
    assert.match(legal, /data-return-link/);
    assert.match(legal, /class="floating-back"/);
    assert.match(legal, /Voltar ao site/);
    assert.match(legal, /position:fixed/);
    assert.match(legal, /new URLSearchParams\(window\.location\.search\)\.get\("return"\)/);
    assert.match(legal, /value\.slice\(0, 2\) !== "\/\/"/);
    assert.match(legal, /document\.referrer/);
    assert.match(legal, /referrer\.origin === window\.location\.origin/);
    assert.match(legal, /politica-de-privacidade\|termos-de-uso/);
  }
});

test("every active InspiraCred route preserves its own origin in legal links", () => {
  const routes = [
    [["index.html"], "/"],
    [["contadores", "index.html"], "/contadores/"],
    [["parceiros", "index.html"], "/parceiros/"],
    [["formulario", "index.html"], "/formulario/"],
    [["formulario", "script.js"], "/formulario/"],
    [["home", "index.html"], "/home/"],
    [["homeequity", "index.html"], "/homeequity/"],
    [["obrigado", "auto", "index.html"], "/obrigado/auto/"],
    [["obrigado", "formulario", "index.html"], "/obrigado/formulario/"],
    [["obrigado", "home", "index.html"], "/obrigado/home/"],
    [["obrigado", "home-equity", "index.html"], "/obrigado/home-equity/"],
    [["obrigado", "simulacao", "index.html"], "/obrigado/simulacao/"],
    [["obrigado", "home-nao-elegivel", "index.html"], "/obrigado/home-nao-elegivel/"],
    [["obrigado", "nao-elegivel", "index.html"], "/obrigado/nao-elegivel/"],
  ];

  for (const [segments, route] of routes) {
    const source = read(...segments);
    const links = [...source.matchAll(/href="\/(?:politica-de-privacidade|termos-de-uso)\.html([^"#]*)"/g)];
    assert.ok(links.length > 0, `missing legal link in ${segments.join("/")}`);
    for (const link of links) assert.equal(link[1], `?return=${encodeURIComponent(route)}`, `wrong legal return in ${segments.join("/")}`);
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

test("latest ClickUp refinements keep the B2B forms focused and connect successful leads to WhatsApp", () => {
  const counters = read("contadores", "index.html");
  const partners = read("parceiros", "index.html");
  const script = read("assets", "js", "lp-b2b.js");

  assert.doesNotMatch(counters, /class="contador-process-action"/);
  assert.doesNotMatch(partners, /Dados usados apenas para retorno sobre a parceria|Cadastro sujeito à avaliação de perfil/);
  assert.match(partners, /data-partner-whatsapp-success/);
  assert.match(partners, /https:\/\/wa\.me\/5521977340731/);
  assert.match(script, /data-partner-whatsapp-success/);
  assert.match(script, /Acabei de me cadastrar no programa de parceiros da InspiraCred/);
  for (const html of [counters, partners]) {
    assert.match(html, /Entre em contato pelo Whatsapp com a nossa equipe\./);
  }
  assert.match(script, /scheduleWhatsappRedirect\(form\)/);
  assert.match(script, /window\.setTimeout\([\s\S]*?window\.location\.href = link\.href;[\s\S]*?3000\);/);
});

test("B2B WhatsApp redirect waits three seconds, runs only after success and cannot duplicate", () => {
  const script = read("assets", "js", "lp-b2b.js");
  const start = script.indexOf("function scheduleWhatsappRedirect");
  const end = script.indexOf("\n  function formStatus", start);
  assert.ok(start >= 0 && end > start, "redirect helper is extractable");

  const timers = [];
  const context = vm.createContext({
    window: {
      location: { href: "https://nova.inspiracred.com.br/parceiros/" },
      setTimeout(callback, delay) { timers.push({ callback, delay }); }
    },
    qs(selector, root) { return root.querySelector(selector); }
  });
  vm.runInContext(`${script.slice(start, end)};globalThis.scheduleWhatsappRedirect=scheduleWhatsappRedirect;`, context);

  const link = { href: "https://wa.me/5521977340731?text=teste-local" };
  const form = { dataset: {}, parentNode: { querySelector: () => link } };
  assert.equal(context.scheduleWhatsappRedirect(form), true);
  assert.equal(context.scheduleWhatsappRedirect(form), false, "duplicate success does not schedule twice");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 3000);
  assert.equal(context.window.location.href, "https://nova.inspiracred.com.br/parceiros/");
  timers[0].callback();
  assert.equal(context.window.location.href, link.href);

  const failedForm = { dataset: {}, parentNode: { querySelector: () => null } };
  assert.equal(context.scheduleWhatsappRedirect(failedForm), false, "missing success destination does not redirect");
  assert.equal(timers.length, 1);
});

test("root simulator and contador form collect and forward the real email", () => {
  const root = read("index.html");
  const counters = read("contadores", "index.html");
  const script = read("assets", "js", "lp-b2b.js");

  assert.match(root, /id="contact-email"[^>]+name="email"[^>]+type="email"/);
  assert.match(root, /email:\s*document\.getElementById\("contact-email"\)\.value\.trim\(\)/);
  assert.match(root, /email:\s*data\.email/);
  assert.match(counters, /id="contador-email"[^>]+name="email"[^>]+type="email"[^>]+required/);
  assert.match(script, /email:\s*countersForm\.elements\.email\.value\.trim\(\)/);
});
