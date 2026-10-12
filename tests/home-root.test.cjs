const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const siteRoot = path.join(projectRoot, "inspiracred");
const read = (relativePath) => fs.readFileSync(path.join(siteRoot, relativePath), "utf8");

function homeAsRoot(html) {
  return html
    .replace(
      '    <!-- Em aprovação em /home/: fora do Google até virar a página principal (aí sai o noindex). -->\r\n    <meta name="robots" content="noindex" />',
      '    <link rel="canonical" href="https://nova.inspiracred.com.br/" />',
    )
    .replace(
      '<meta property="og:image" content="img/equipe.webp" />',
      '<meta property="og:image" content="/home/img/equipe.webp" />',
    )
    .replaceAll('href="style.css"', 'href="/home/style.css"')
    .replaceAll('src="img/', 'src="/home/img/')
    .replaceAll('src="script.js"', 'src="/home/script.js"')
    .replaceAll("../assets/", "/assets/");
}

test("a raiz serve a mesma home aprovada com assets absolutos", () => {
  const home = read("home/index.html");
  const root = read("index.html");

  assert.equal(root.replaceAll("\r\n", "\n").trim(), homeAsRoot(home).replaceAll("\r\n", "\n").trim());
  assert.doesNotMatch(root, /name="robots" content="noindex"/);
  assert.match(root, /<link rel="canonical" href="https:\/\/nova\.inspiracred\.com\.br\/"/);
  assert.match(root, /<meta property="og:image" content="\/home\/img\/equipe\.webp"/);
  assert.match(root, /<link rel="stylesheet" href="\/home\/style\.css"/);
  assert.match(root, /<script src="\/home\/script\.js"><\/script>/);
  assert.match(root, /src="\/home\/img\/consultoria\.webp"/);
  assert.match(root, /src="\/assets\/js\/track\.js"/);
  assert.match(root, /href="#simular"/);
});

test("os assets usados pela raiz existem e as rotas de resultado continuam absolutas", () => {
  [
    "home/style.css",
    "home/script.js",
    "home/img/consultoria.webp",
    "home/img/equipe.webp",
    "assets/js/track.js",
    "assets/img/landing-logo-ref.png",
  ].forEach((asset) => assert.ok(fs.existsSync(path.join(siteRoot, asset)), asset));

  const script = read("home/script.js");
  assert.match(script, /var PAGE_SOURCE = "home_institucional"/);
  assert.match(script, /"\/obrigado\/home-nao-elegivel\/"\s*:\s*"\/obrigado\/home\/"/);
  assert.match(script, /fetch\("\/analytics\/track"/);
});
