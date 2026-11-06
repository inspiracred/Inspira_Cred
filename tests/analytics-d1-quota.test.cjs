const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const source = fs.readFileSync(path.join(__dirname, "../inspiracred/functions/analytics/_app.js"), "utf8");
function harness() {
  const values = new Map();
  let reads = 0, writes = 0, now = 100000;
  const context = vm.createContext({ URL, Response, Request, Headers, TextEncoder, Uint8Array, crypto: webcrypto, Date: { now: () => now }, console });
  vm.runInContext(source.replace('export async function onRequest', 'async function onRequest'), context);
  const env = { DASHBOARD_PASSWORD: 'local-test-only', KV: {
    async get(k) { reads++; return values.get(k) || null; },
    async put(k, value, opts) { writes++; assert.equal(opts.expirationTtl, 60); values.set(k, JSON.parse(value)); }
  } };
  return { context, env, values, stats: () => ({reads,writes}), tick: (ms) => { now += ms; } };
}
const req = (query = '') => new Request('https://nova.inspiracred.com.br/analytics/api/overview'+query);
test('relatorios continuam autenticados antes de qualquer consulta ao cache', async () => {
  const h = harness();
  const response = await h.context.onRequest({ request: req(), env: h.env });
  assert.equal(response.status, 401);
  assert.deepEqual(h.stats(), { reads: 0, writes: 0 });
});
test('cache privado ignora apenas cache-buster e preserva filtros e origem', async () => {
  const h = harness(); let calls = 0;
  const handler = async () => new Response(JSON.stringify({ count: ++calls }));
  const first = await h.context.cachedReport(req('?start=2026-11-06&page=home&_=1'), h.env, handler);
  const second = await h.context.cachedReport(req('?_=2&page=home&start=2026-11-06'), h.env, handler);
  assert.equal((await first.json()).count, 1);
  assert.equal((await second.json()).count, 1);
  assert.equal(second.headers.get('X-Analytics-Cache'), 'hit');
  assert.equal(second.headers.get('Cache-Control'), 'private, no-store');
  await h.context.cachedReport(req('?start=2026-11-06&page=home&src=meta'), h.env, handler);
  assert.equal(calls, 2);
  await h.context.cachedReport(new Request('https://preview.inspira-cred.pages.dev/analytics/api/overview?start=2026-11-06&page=home'), h.env, handler);
  assert.equal(calls, 3);
  h.tick(60001);
  await h.context.cachedReport(req('?start=2026-11-06&page=home&_=3'), h.env, handler);
  assert.equal(calls, 4);
});
test('cache nao guarda erros ou resultados incompletos e falha sem bloquear', async () => {
  for (const [body,status] of [[{error:'failed'},500],[{error:'failed'},200],[{pendente:true},200],[{meta_insights_ok:false},200]]) {
    const h = harness(); let calls = 0;
    const handler = async () => { calls++; return new Response(JSON.stringify(body),{status}); };
    await h.context.cachedReport(req(),h.env,handler);
    await h.context.cachedReport(req(),h.env,handler);
    assert.equal(calls,2); assert.equal(h.stats().writes,0);
  }
  const h=harness(); h.env.KV={async get(){throw Error('offline')},async put(){throw Error('offline')}};
  const response=await h.context.cachedReport(req(),h.env,async()=>new Response('{"ok":true}'));
  assert.equal((await response.json()).ok,true);
});
test('leads, jornadas e vendas com dados pessoais nao usam cache agregado', () => {
  for (const route of ['leads','journey','sales']) assert.doesNotMatch(source,new RegExp('sub === "/api/'+route+'"[^\\n]+cachedReport'));
});
test('intervalos UTC preservam resultados e usam indice em texto, epoch e vendas', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE data(id INTEGER PRIMARY KEY, created_at TEXT, epoch INTEGER, received_at TEXT, page TEXT); CREATE INDEX dates ON data(created_at); CREATE INDEX epochs ON data(epoch); CREATE INDEX sales ON data(received_at);');
  const timestamps = ['2026-11-05 23:59:59','2026-11-06 00:00:00','2026-11-06 12:34:56','2026-11-06 23:59:59','2026-11-07 00:00:00'];
  for (const [i,t] of timestamps.entries()) db.prepare('INSERT INTO data VALUES(?,?,?,?,?)').run(i+1,t,Date.parse(t.replace(' ','T')+'Z')/1000,t,i%2?'home':'landing');
  for (const [col,old,newer] of [
    ['created_at','DATE(created_at) BETWEEN ? AND ?',"created_at >= ? AND created_at < datetime(?,'+1 day')"],
    ['epoch',"DATE(epoch,'unixepoch') BETWEEN ? AND ?","epoch >= unixepoch(?) AND epoch < unixepoch(?,'+1 day')"],
    ['received_at','DATE(received_at) BETWEEN ? AND ?',"received_at >= ? AND received_at < datetime(?,'+1 day')"]
  ]) {
    for (const [start,end] of [['2026-11-06','2026-11-06'],['2026-11-04','2026-11-04'],['2026-11-05','2026-11-07']]) {
      for (const suffix of [''," AND page IN ('home','landing')"," AND page='home'"]) {
        const a=db.prepare('SELECT id FROM data WHERE '+old+suffix+' ORDER BY id').all(start,end);
        const b=db.prepare('SELECT id FROM data WHERE '+newer+suffix+' ORDER BY id').all(start,end);
        assert.deepEqual(a,b);
      }
    }
    const plan=db.prepare('EXPLAIN QUERY PLAN SELECT id FROM data WHERE '+newer).all('2026-11-06','2026-11-06');
    assert.ok(plan.some(r=>/SEARCH .*INDEX/.test(r.detail)),col+': '+JSON.stringify(plan));
  }
  assert.doesNotMatch(source,/DATE\((?:created_at|received_at)(?:,'unixepoch')?\) BETWEEN/);
  db.close();
});
test('captura dos seis formularios persiste em SQLite local e respeita CORS sem envio externo', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname,'../analytics/schema.sql'),'utf8'));
  for(const filename of fs.readdirSync(path.join(__dirname,'../inspiracred/migrations')).sort()) {
    if(filename.startsWith('0011_')) continue; // colunas ja estao no schema base atualizado
    db.exec(fs.readFileSync(path.join(__dirname,'../inspiracred/migrations',filename),'utf8'));
  }
  const context = vm.createContext({URL,Request,Response,Headers,TextEncoder,TextDecoder,Uint8Array,crypto:webcrypto,Date,Math,JSON,console,
    fetch:async()=>{throw Error('Rede externa proibida no teste');},setTimeout,clearTimeout,AbortController});
  vm.runInContext(source.replace('export async function onRequest','async function onRequest'),context);
  const env={DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this},async run(){const r=db.prepare(sql).run(...args);return{meta:{last_row_id:Number(r.lastInsertRowid),changes:Number(r.changes)}}},async first(){return db.prepare(sql).get(...args)||null},async all(){return{results:db.prepare(sql).all(...args)}}}}}};
  const origins=['landing_page','home_equity_lp','home_equity_form','home_institucional','contador_aquisicao_lp','parceiros_lp'];
  for(const [i,origin] of origins.entries()) {
    const pending=[];
    const event={type:'lead',session_id:'isolated-'+i,name:'Teste local isolado',email:'local@example.invalid',phone:'+5521999999999',property_type:'Comercial',credit_value:500000,source:origin,city:'Cidade local',partner_role:'corretor'};
    const request=new Request('https://nova.inspiracred.com.br/analytics/track',{method:'POST',headers:{Origin:'https://inspiracred.com.br','Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(event)});
    const response=await context.onRequest({request,env,waitUntil(p){pending.push(p)}});
    assert.equal(response.status,200,origin);
    assert.equal((await response.json()).success,true);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://inspiracred.com.br');
    await Promise.all(pending);
    const lead=db.prepare('SELECT source,city,credit_value FROM leads WHERE session_id=?').get(event.session_id);
    assert.equal(lead.source,origin);assert.equal(lead.city,'Cidade local');assert.equal(lead.credit_value,500000);
  }
  assert.equal(db.prepare('SELECT count(*) n FROM leads').get().n,6);
  db.close();
});