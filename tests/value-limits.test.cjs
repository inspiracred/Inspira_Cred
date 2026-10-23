const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../inspiracred");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("all active forms expose the requested value ceilings", () => {
  const landing = read("index.html");
  const home = read("home/script.js");
  const homeEquity = read("homeequity/script.js");
  const guided = read("formulario/script.js");

  assert.match(landing, /MAX_PROPERTY\s*=\s*20000000/);
  assert.match(landing, /MAX_CREDIT\s*=\s*12000000/);
  assert.match(home, /MAX_CREDITO\s*=\s*12000000/);
  assert.match(homeEquity, /MAX_PROPERTY_VALUE\s*=\s*20000000/);
  assert.match(homeEquity, /MAX_CREDIT_VALUE\s*=\s*12000000/);
  assert.match(guided, /MAX_PROPERTY_VALUE\s*=\s*20000000/);
  assert.match(guided, /R\$ 900 mil a R\$ 12 milhões/);
  assert.match(guided, /R\$ 500 mil a R\$ 12 milhões/);
});

test("server rejects outliers before inserting a lead", () => {
  const server = read("functions/analytics/_app.js");
  const validation = server.indexOf("const valueLimitError = validateLeadValueLimits(event)");
  const insert = server.indexOf("INSERT INTO leads");
  assert.ok(validation > 0 && validation < insert);
  assert.match(server, /const MAX_PROPERTY_VALUE = 20000000/);
  assert.match(server, /const MAX_CREDIT_VALUE = 12000000/);
  assert.match(server, /return json\(\{ error: valueLimitError \}, 422, cors\)/);
});
