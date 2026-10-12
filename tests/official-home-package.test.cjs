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
  assert.match(html, /window\.IC_PAGE = "home_institucional"/);
  assert.doesNotMatch(html, /content="noindex"/);
});

test("assets, tracking e sucesso ficam explícitos sem alterar a raiz de nova", () => {
  assert.match(html, /https:\/\/nova\.inspiracred\.com\.br\/home\/style\.css/);
  assert.match(html, /https:\/\/nova\.inspiracred\.com\.br\/home\/img\/consultoria\.webp/);
  assert.match(html, /https:\/\/nova\.inspiracred\.com\.br\/home\/img\/equipe\.webp/);
  assert.match(html, /src="\/_institucional\/script\.js"/);
  assert.match(html, /https:\/\/nova\.inspiracred\.com\.br\/assets\/js\/track\.js/);
  assert.match(script, /https:\/\/nova\.inspiracred\.com\.br\/analytics\/track/);
  assert.match(script, /https:\/\/nova\.inspiracred\.com\.br\/obrigado\/home\//);
  assert.match(script, /https:\/\/nova\.inspiracred\.com\.br\/obrigado\/home-nao-elegivel\//);
  assert.doesNotMatch(script, /sendBeacon\("\/analytics\/track"/);
  assert.doesNotMatch(script, /fetch\("\/analytics\/track"/);
});

test("rewrite Hostinger atua somente na raiz dos hosts oficiais", () => {
  assert.match(rewrite, /\^\(\?:www\\\.\)\?inspiracred\\\.com\\\.br\$/);
  assert.match(rewrite, /RewriteRule \^\$ \/_institucional\/index\.html \[L\]/);
  assert.doesNotMatch(rewrite, /Redirect|RewriteRule \^\.\*/);
  assert.doesNotMatch(rewrite, /MX|TXT|nameserver/i);
});
