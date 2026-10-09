const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../inspiracred");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const masks = [
  ["raiz", "index.html", "phone"],
  ["home", "home/script.js", "celular"],
  ["homeequity", "homeequity/script.js", "celular"],
].map(([name, file, field]) => {
  const source = read(file);
  const start = source.indexOf(field + '.addEventListener("input", function () {');
  assert.ok(start >= 0);
  const callback = source.slice(start, source.indexOf("});", start) + 3);
  return [name, value => {
    const input = { value, addEventListener: (_, fn) => fn() };
    vm.runInNewContext(callback, { [field]: input, digits: v => v.replace(/\D/g, ""), clearError() {} });
    return input.value;
  }];
});
const form = read("formulario/script.js");
const ctx = {};
vm.runInNewContext(form.slice(form.indexOf("function formatPhone("), form.indexOf("function parseMoney(")), ctx);
masks.push(["formulario", ctx.formatPhone]);
const cases = [
  ["(21) 2345-6789", "2123456789"],
  ["(21) 92345-6789", "21923456789"],
  ["+55 (21) 2345-6789", "2123456789"],
  ["5521923456789", "21923456789"],
  ["+55 55 (21) 92345-6789", "21923456789"],
  ["+55 55 (21) 2345-6789", "2123456789"],
  ["(55) 92345-6789", "55923456789"],
  ["(55) 2345-6789", "5523456789"],
  ["+55 (55) 92345-6789", "55923456789"],
  ["+55 55 (55) 92345-6789", "55923456789"],
  ["", ""],
  ["abc", ""],
  ["123", "123"],
  ["219234567890", "219234567890"],
  ["55219234567890", "55219234567890"],
];
for (const [name, mask] of masks) {
  test(name + ": máscara preserva sufixo, DDD 55 e entradas inválidas", () => {
    for (const [input, expected] of cases) {
      const result = mask(input);
      assert.equal(result.replace(/\D/g, ""), expected, input);
      assert.equal(mask(result), result, "idempotência: " + input);
    }
  });
}
const server = read("functions/analytics/_app.js");
const rdFunction = server.slice(server.indexOf("async function sendLeadToRD("), server.indexOf("/* ---- META CAPI"));
test("RD: payload internacional único, campo nacional e fallback sem DDI", async () => {
  for (const [input, national] of cases) {
    let payload;
    const updates = [];
    const rd = {
      RD_PAGE_CONFIG: { home: { label: "Home" } },
      LEAD_KIND_LABEL: {},
      rdIdentificador: () => "mock", rdTags: () => [],
      fetch: async (_, options) => { payload = JSON.parse(options.body); return { ok: true }; },
    };
    vm.runInNewContext(rdFunction, rd);
    await rd.sendLeadToRD({ source: "home", phone: input, name: "QA sintético" }, {
      RD_STATION_TOKEN: "mock-only",
      DB: { prepare: () => ({ bind: (...values) => ({ run: async () => updates.push(values) }) }) },
    }, 1);
    const valid = /^[0-9]{10,11}$/.test(national);
    assert.equal(payload.telefone, valid ? "+55" + national : undefined, input);
    assert.equal(payload.cf_whatsapp_com_ddd, valid ? national : undefined, input);
    assert.equal(payload.email, valid ? national + "@lead.inspiracred.com.br" : undefined, input);
    assert.equal(updates.length, 1);
  }
});
