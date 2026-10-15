const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const site = path.join(repo, "inspiracred");
const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");

test("all requested pages load the shared tracker with an explicit page identity", () => {
  const pages = [
    [read(site, "index.html"), "landing_page", /assets\/js\/track\.js/],
    [read(site, "homeequity", "index.html"), "home_equity_lp", /\.\.\/assets\/js\/track\.js/],
    [read(repo, "hosting", "official-home", "index.html"), "home_institucional", /https:\/\/nova\.inspiracred\.com\.br\/assets\/js\/track\.js/],
  ];

  for (const [html, pageName, trackerPattern] of pages) {
    assert.match(html, new RegExp(`window\\.IC_PAGE\\s*=\\s*["']${pageName}["']`));
    assert.match(html, trackerPattern);
  }
});

test("Cloudflare pages keep the Krob first-party attribution chain", () => {
  const middleware = read(site, "functions", "_middleware.js");
  assert.match(middleware, /COOKIE_MAX_AGE\s*=\s*34560000/);
  for (const cookie of ["_krob_sid", "_krob_eid", "_fbp", "_fbc"]) {
    assert.match(middleware, new RegExp(cookie));
  }
  for (const identifier of ["fbclid", "gclid", "msclkid", "utm_source", "utm_campaign"]) {
    assert.match(middleware, new RegExp(identifier));
  }
  assert.match(middleware, /INSERT INTO sessions/);
  assert.match(middleware, /context\.waitUntil/);
});

test("shared tracker uses unique event ids, first-touch attribution and CAPI-only policy", () => {
  const tracker = read(site, "assets", "js", "track.js");
  assert.match(tracker, /crypto\.randomUUID/);
  assert.match(tracker, /ic_utm/);
  assert.match(tracker, /rawParam\("fbclid"\)/);
  assert.match(tracker, /cookieVal\("_fbp"\)/);
  assert.match(tracker, /type:\s*"lead"/);
  assert.match(tracker, /https:\/\/nova\.inspiracred\.com\.br\/analytics\/track/);
  assert.doesNotMatch(tracker, /connect\.facebook\.net|fbq\s*\(/);
});

test("server enriches, hashes and fans out conversions without exposing financial qualifiers", () => {
  const server = read(site, "functions", "analytics", "_app.js");
  assert.match(server, /resolveFbIdentity/);
  assert.match(server, /sha256Hex/);
  assert.match(server, /context\.waitUntil\(sendLeadToRD/);
  assert.match(server, /context\.waitUntil\(sendLeadToMeta/);
  assert.match(server, /custom_data:\s*\{\}/);
  assert.match(server, /isRuralPropertyType/);
});
