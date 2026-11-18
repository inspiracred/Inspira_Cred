const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("shared tracker installs the confirmed Clarity project once on production hosts", () => {
  const tracker = read("inspiracred/assets/js/track.js");

  assert.match(tracker, /CLARITY_PROJECT_ID = "zf3gn4v6p5"/);
  assert.match(tracker, /"nova\.inspiracred\.com\.br": true/);
  assert.match(tracker, /"links\.inspiracred\.com\.br": true/);
  assert.match(tracker, /window\.__inspiraClarityLoaded/);
  assert.match(tracker, /document\.querySelector\('script\[src="'/);
  assert.match(tracker, /https:\/\/www\.clarity\.ms\/tag\//);
  assert.doesNotMatch(tracker, /"(?:[^"]*pages\.dev|localhost)"\s*:\s*true/);
});

test("link in bio no longer carries a second inline Clarity tag", () => {
  const html = read("inspiracred/links/index.html");

  assert.match(html, /assets\/js\/track\.js/);
  assert.doesNotMatch(html, /CLARITY_PROJECT_ID|clarity\.ms\/tag/);
});

test("dashboard exposes the official authenticated Clarity embed without frontend credentials", () => {
  const app = read("inspiracred/functions/analytics/_app.js");

  assert.match(app, /id="tabbtn-heatmap"[^>]*>[\s\S]*?Mapa de calor/);
  assert.match(app, /https:\/\/clarity\.microsoft\.com\/embed\?project=zf3gn4v6p5&amp;lang=pt-br&amp;iframeRedirect=heatmaps/);
  assert.match(app, /https:\/\/clarity\.microsoft\.com\/projects\/view\/zf3gn4v6p5\/heatmaps/);
  assert.match(app, /allow-storage-access-by-user-activation/);
  assert.match(app, /if\(name==="heatmap"\)loadClarityEmbed\(\)/);
  assert.doesNotMatch(app, /integration=Wordpress|wpsite=|siteurl=/);
  assert.doesNotMatch(app, /CLARITY_API|clarityToken|clarity_token|api\.clarity\.ms/);
});
