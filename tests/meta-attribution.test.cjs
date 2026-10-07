const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const server = fs.readFileSync(
  path.resolve(__dirname, "../inspiracred/functions/analytics/_app.js"),
  "utf8"
);
const attributionCode = server.slice(
  server.indexOf("const LEGACY_META_CAMPAIGN_ALIASES"),
  server.indexOf("async function handleOverview(")
);
const backend = vm.createContext({ decodeURIComponent, Map, String });
vm.runInContext(attributionCode, backend);

const currentMetaRows = [{
  campaign_id: "12001",
  campaign_name: "[Leads_LP]_04/09",
  adset_id: "22001",
  adset_name: "RJ | Proprietários",
  ad_id: "32001",
  ad_name: "Vídeo 01",
}];

test("decodifica nomes de campanha recebidos percent-encoded", () => {
  assert.equal(
    backend.decodeAttributionLabel("%5BLeads_LP%5D_04%2F09"),
    "[Leads_LP]_04/09"
  );
});

test("um campaign_id antigo assume o nome atual devolvido pela Meta", () => {
  const [row] = backend.reconcileAttributionRows([{
    camp: "Nome anterior",
    med: "Conjunto anterior",
    cont: "Criativo anterior",
    meta_campaign_id: "12001",
    meta_adset_id: "22001",
    meta_ad_id: "32001",
  }], currentMetaRows, []);

  assert.equal(row.camp, "[Leads_LP]_04/09");
  assert.equal(row.med, "RJ | Proprietários");
  assert.equal(row.cont, "Vídeo 01");
});

test("alias histórico reúne 03/09 à campanha atual e preenche o ID", () => {
  const aliases = [{
    raw_name: "[Leads_LP]_03/09",
    canonical_name: "[Leads_LP]_04/09",
    campaign_id: "",
  }];
  const [row] = backend.reconcileAttributionRows([{
    camp: "%5BLeads_LP%5D_03%2F09",
    med: "RJ | Proprietários",
    cont: "Vídeo 01",
  }], currentMetaRows, aliases);

  assert.equal(row.camp, "[Leads_LP]_04/09");
  assert.equal(row.meta_campaign_id, "12001");
  assert.equal(row.meta_adset_id, "22001");
  assert.equal(row.meta_ad_id, "32001");
});

test("fallback legado continua disponível sem a tabela de aliases", async () => {
  const env = {
    DB: {
      prepare() {
        return { async all() { throw new Error("no such table"); } };
      },
    },
  };
  const aliases = await backend.loadMetaCampaignAliases(env);
  assert.equal(aliases[0].raw_name, "[Leads_LP]_03/09");
  assert.equal(aliases[0].canonical_name, "[Leads_LP]_04/09");
});
