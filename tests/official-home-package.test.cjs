const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const packageDir = path.join(root, "hosting", "official-home");
const html = fs.readFileSync(path.join(packageDir, "index.html"), "utf8");
const script = fs.readFileSync(path.join(packageDir, "script.js"), "utf8");
const rewrite = fs.readFileSync(path.join(packageDir, "htaccess-root-snippet.conf"), "utf8");

test("pacote oficial publica a home aprovada com canonical do apex", () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/inspiracred\.com\.br\/" \/>/);
  assert.match(html, /<meta name="robots" content="index,follow" \/>/);
  assert.match(html, /id="home-lead-form"/);
  assert.match(html, /name="tipo_imovel"/);
  assert.match(html, /<option value="Rural">Rural<\/option>/);
  assert.match(html, /window\.IC_PAGE = "home_institucional"/);
  assert.doesNotMatch(html, /content="noindex"/);
});

test("assets, tracking e sucesso ficam explícitos sem alterar a raiz de nova", () => {
  assert.match(html, /https:\/\/nova\.inspiracred\.com\.br\/home\/style\.css/);
  assert.match(html, /https:\/\/nova\.inspiracred\.com\.br\/home\/img\/consultoria\.webp/);
  assert.match(html, /https:\/\/nova\.inspiracred\.com\.br\/home\/img\/equipe\.webp/);
  assert.match(html, /src="\/_institucional\/script\.js"/);
  assert.match(html, /https:\/\/nova\.inspiracred\.com\.br\/assets\/js\/track\.js/);
  assert.equal(
    (html.match(/https:\/\/nova\.inspiracred\.com\.br\/politica-de-privacidade/g) || []).length,
    2,
  );
  assert.match(html, /https:\/\/nova\.inspiracred\.com\.br\/termos-de-uso/);
  assert.doesNotMatch(html, /href="\/termos-de-uso\//);
  assert.match(script, /https:\/\/nova\.inspiracred\.com\.br\/analytics\/track/);
  assert.match(script, /https:\/\/nova\.inspiracred\.com\.br\/obrigado\/home\//);
  assert.match(script, /https:\/\/nova\.inspiracred\.com\.br\/obrigado\/home-nao-elegivel\//);
  assert.doesNotMatch(script, /sendBeacon\("\/analytics\/track"/);
  assert.doesNotMatch(script, /fetch\("\/analytics\/track"/);
  assert.match(script, /simulation_discard/);
  assert.match(script, /rural_property/);
});

test("rewrite Hostinger atua somente na raiz do apex e preserva www", () => {
  assert.match(rewrite, /\^inspiracred\\\.com\\\.br\$/);
  assert.match(rewrite, /RewriteRule \^\$ \/_institucional\/index\.html \[L\]/);
  assert.doesNotMatch(rewrite, /www\\\.|\(\?:www/);
  assert.doesNotMatch(rewrite, /Redirect|RewriteRule \^\.\*/);
  assert.doesNotMatch(rewrite, /MX|TXT|nameserver/i);
});

test("URLs legadas exibidas como sitelinks recebem redirects permanentes e exatos", () => {
  assert.match(
    rewrite,
    /RewriteRule \^\(\?:lp\|sitebackup\|obrigado\)\/\?\$ https:\/\/inspiracred\.com\.br\/ \[R=301,L\]/,
  );
  assert.match(
    rewrite,
    /RewriteRule \^\(\?:lp-cgi\|homeequity\)\/\?\$ https:\/\/nova\.inspiracred\.com\.br\/ \[R=301,L\]/,
  );
  assert.match(
    rewrite,
    /RewriteRule \^politica-de-privacidade\/\?\$ https:\/\/nova\.inspiracred\.com\.br\/politica-de-privacidade \[R=301,L\]/,
  );
  assert.match(
    rewrite,
    /RewriteRule \^\(\?:termos-e-condicoes\|termos-de-uso\)\/\?\$ https:\/\/nova\.inspiracred\.com\.br\/termos-de-uso \[R=301,L\]/,
  );
  assert.doesNotMatch(rewrite, /RewriteRule \^\.\*/);
});
