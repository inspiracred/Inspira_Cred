/**
 * InspiraCred — Analytics como Pages Function (servido em /analytics/*)
 * Bindings no projeto Pages "inspira-cred": DB (D1), KV, DASHBOARD_PASSWORD (secret)
 *
 * Rotas (sob /analytics):
 *   POST /analytics/track          -> coleta (aberto, CORS restrito)
 *   GET  /analytics/api/overview   -> métricas agregadas (Basic Auth)  [?start&end&page]
 *   GET  /analytics/api/leads      -> leads / PII        (Basic Auth)  [?limit&page]
 *   GET  /analytics/dashboard      -> dashboard          (Basic Auth)
 */

const ALLOWED_ORIGINS = [
  "https://inspiracred.com.br",
  "https://www.inspiracred.com.br",
  "https://nova.inspiracred.com.br",
  "https://links.inspiracred.com.br",
  "https://simulacao.inspiracred.com.br",
  "https://inspira-cred.pages.dev",
  "https://inspira-cred-links.pages.dev",
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const sub = url.pathname.slice("/analytics".length) || "/";
  const origin = request.headers.get("Origin") || "";
  const cors = corsHeaders(origin);

  if (request.method === "OPTIONS") return new Response(null, { headers: cors });

  if (sub === "/track" && request.method === "POST") {
    return handleTrack(request, env, cors, context);
  }

  if (!isAuthorized(request, env)) return unauthorized();

  if (sub === "/api/overview" && request.method === "GET") return handleOverview(request, env);
  if (sub === "/api/leads" && request.method === "GET") return handleLeads(request, env);
  if ((sub === "/" || sub === "/dashboard") && request.method === "GET") {
    return new Response(DASHBOARD_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  return new Response("Not Found", { status: 404 });
}

/* ---- AUTH ---- */
function isAuthorized(request, env) {
  const pw = env.DASHBOARD_PASSWORD;
  if (!pw) return false;
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  let decoded = "";
  try { decoded = atob(header.slice(6)); } catch { return false; }
  return decoded.slice(decoded.indexOf(":") + 1) === pw;
}
function unauthorized() {
  return new Response("Autenticação necessária", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="InspiraCred Analytics"' },
  });
}

/* ---- COLETA ---- */
async function handleTrack(request, env, cors, context) {
  try {
    const event = await request.json();
    if (!event.type || !event.session_id) {
      return json({ error: "type e session_id obrigatórios" }, 400, cors);
    }
    switch (event.type) {
      case "page_view":
        await env.DB.prepare(
          `INSERT INTO page_views (session_id, page_name, url, title, referrer, user_agent, ip_hash) VALUES (?,?,?,?,?,?,?)`
        ).bind(event.session_id, event.page_name || "other", event.url || null, event.title || null,
          event.referrer || null, event.user_agent || null, event.ip_hash || null).run();
        break;
      case "click":
        await env.DB.prepare(
          `INSERT INTO clicks (session_id, element_id, element_text, destination, link_type, page_name) VALUES (?,?,?,?,?,?)`
        ).bind(event.session_id, event.element_id || null, event.element_text || null,
          event.destination || null, event.link_type || null, event.page_name || "other").run();
        break;
      case "form_submit":
        await env.DB.prepare(
          `INSERT INTO form_submissions (session_id, form_id, form_data, success, completion_time_ms, page_name) VALUES (?,?,?,?,?,?)`
        ).bind(event.session_id, event.form_id || null, JSON.stringify(event.form_data || {}),
          event.success === false ? 0 : 1, event.completion_time_ms || null, event.page_name || "other").run();
        break;
      case "lead": {
        const leadInsert = await env.DB.prepare(
          `INSERT INTO leads (session_id, name, phone, email, property_type, property_value, credit_value, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbp, fbc, fbclid, gclid, event_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(event.session_id || null, event.name || null, event.phone || null, event.email || null,
          event.property_type || null, event.property_value || null, event.credit_value || null,
          event.source || null, event.utm_source || null, event.utm_medium || null,
          event.utm_campaign || null, event.utm_content || null, event.utm_term || null,
          event.fbp || null, event.fbc || null, event.fbclid || null, event.gclid || null,
          event.event_id || null).run();
        const leadId = leadInsert.meta && leadInsert.meta.last_row_id;
        if (leadId && context) {
          context.waitUntil(sendLeadToRD(event, env, leadId));
        }
        break;
      }
      case "event":
        await env.DB.prepare(
          `INSERT INTO events (session_id, event_type, event_name, properties, page_name) VALUES (?,?,?,?,?)`
        ).bind(event.session_id, event.event_type || "custom", event.event_name || "custom",
          JSON.stringify(event.properties || {}), event.page_name || null).run();
        break;
      default:
        return json({ error: "tipo desconhecido" }, 400, cors);
    }
    return json({ success: true }, 200, cors);
  } catch (err) {
    return json({ error: "erro interno" }, 500, cors);
  }
}

/* ---- RD STATION (CRM do cliente — já em produção; só plugamos as páginas novas) ----
 * Token público (mesma conta onde os leads de hoje já caem, era usado no WP antigo) —
 * fica em env.RD_STATION_TOKEN (Cloudflare Pages), não hardcoded no código-fonte.
 * `identificador` é próprio de cada página nova — não usado pelas páginas antigas do
 * cliente — pra não misturar relatório. `cf_variante_pagina` marca a origem (redesign
 * em teste A/B) mesmo se o tráfego chegar sem UTM.
 */
const RD_PAGE_CONFIG = {
  landing_page: { identificador: "landing-nova-raiz" },
  home_equity_lp: { identificador: "home-equity-lp" },
};

async function sendLeadToRD(event, env, leadId) {
  const cfg = RD_PAGE_CONFIG[event.source];
  if (!cfg || !env.RD_STATION_TOKEN) return; // fonte desconhecida ou token não configurado

  const phoneDigits = (event.phone || "").replace(/\D/g, "");
  const payload = {
    token_rdstation: env.RD_STATION_TOKEN,
    identificador: cfg.identificador,
    nome: event.name || undefined,
    email: event.email || (phoneDigits ? `${phoneDigits}@lead.inspiracred.com.br` : undefined),
    telefone: phoneDigits ? `+55${phoneDigits}` : undefined,
    cf_tipo_imovel: event.property_type || undefined,
    cf_valor_imovel: event.property_value != null ? String(event.property_value) : undefined,
    cf_valor_emprestimo_desejado: event.credit_value != null ? String(event.credit_value) : undefined,
    cf_variante_pagina: "redesign-2026",
    traffic_source: event.utm_source || undefined,
    traffic_medium: event.utm_medium || undefined,
    traffic_campaign: event.utm_campaign || undefined,
  };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  let status = "erro";
  try {
    const res = await fetch("https://www.rdstation.com.br/api/1.3/conversions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    status = res.ok ? "ok" : `http_${res.status}`;
  } catch (e) {
    status = "fetch_error";
  }
  try {
    await env.DB.prepare(`UPDATE leads SET rd_status = ? WHERE id = ?`).bind(status, leadId).run();
  } catch (e) {
    // não deixa uma falha de log derrubar o fan-out
  }
}

/* ---- MÉTRICAS ---- */
function params(url) {
  const p = new URL(url).searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const past = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const pageRaw = p.get("page");
  return {
    start: p.get("start") || past,
    end: p.get("end") || today,
    page: pageRaw && pageRaw !== "all" ? pageRaw : null,
  };
}

async function handleOverview(request, env) {
  const { start, end, page } = params(request.url);
  const pv = page ? " AND page_name = ?" : "";   // filtro por página (page_views/clicks/forms/events)
  const sc = page ? " AND source = ?" : "";      // filtro de leads (coluna source guarda a página)
  const bp = page ? [start, end, page] : [start, end];
  const bs = page ? [start, end, page] : [start, end];

  const one = async (sql, b) => (await env.DB.prepare(sql).bind(...b).first()) || {};
  const many = async (sql, b) => (await env.DB.prepare(sql).bind(...b).all()).results || [];

  const [visitors, simStart, simComplete, leadsN, pages, forms, clicks, sources, daily] = await Promise.all([
    one(`SELECT COUNT(DISTINCT session_id) n FROM page_views WHERE DATE(created_at) BETWEEN ? AND ?${pv}`, bp),
    one(`SELECT COUNT(DISTINCT session_id) n FROM events WHERE event_name='simulation_start' AND DATE(created_at) BETWEEN ? AND ?${pv}`, bp),
    one(`SELECT COUNT(DISTINCT session_id) n FROM events WHERE event_name='simulation_complete' AND DATE(created_at) BETWEEN ? AND ?${pv}`, bp),
    one(`SELECT COUNT(*) n FROM leads WHERE DATE(created_at) BETWEEN ? AND ?${sc}`, bs),
    many(`SELECT page_name, COUNT(*) views, COUNT(DISTINCT session_id) uniques FROM page_views WHERE DATE(created_at) BETWEEN ? AND ?${pv} GROUP BY page_name ORDER BY views DESC`, bp),
    many(`SELECT page_name, COUNT(*) n FROM form_submissions WHERE success=1 AND DATE(created_at) BETWEEN ? AND ?${pv} GROUP BY page_name`, bp),
    many(`SELECT page_name, element_id, element_text, COUNT(*) clicks FROM clicks WHERE DATE(created_at) BETWEEN ? AND ?${pv} GROUP BY page_name, element_id, element_text ORDER BY clicks DESC`, bp),
    many(`SELECT COALESCE(NULLIF(utm_source,''),'direto') source, COUNT(*) n FROM leads WHERE DATE(created_at) BETWEEN ? AND ?${sc} GROUP BY source ORDER BY n DESC`, bs),
    many(`SELECT DATE(created_at) d, COUNT(DISTINCT session_id) v FROM page_views WHERE DATE(created_at) BETWEEN ? AND ?${pv} GROUP BY d ORDER BY d`, bp),
  ]);

  const formsByPage = {};
  forms.forEach((f) => { formsByPage[f.page_name] = f.n; });
  const pagesOut = pages.map((p) => ({ page_name: p.page_name, views: p.views, uniques: p.uniques, forms: formsByPage[p.page_name] || 0 }));

  const v = visitors.n || 0, ss = simStart.n || 0, scv = simComplete.n || 0, ld = leadsN.n || 0;
  const pct = (a, base) => (base ? +((a / base) * 100).toFixed(1) : 0);

  return json({
    range: { start, end }, page: page || "all",
    totals: { visitors: v, sim_start: ss, sim_complete: scv, leads: ld },
    rates: { visitor_to_start: pct(ss, v), start_to_complete: pct(scv, ss), complete_to_lead: pct(ld, scv), visitor_to_lead: pct(ld, v) },
    pages: pagesOut, clicks, sources, daily,
  });
}

async function handleLeads(request, env) {
  const p = new URL(request.url).searchParams;
  const limit = Math.min(parseInt(p.get("limit")) || 100, 500);
  const pageRaw = p.get("page");
  const page = pageRaw && pageRaw !== "all" ? pageRaw : null;
  let sql = `SELECT id, name, phone, email, property_type, property_value, credit_value, source, utm_source, utm_medium, utm_campaign, rd_status, meta_status, created_at FROM leads`;
  const binds = [];
  if (page) { sql += ` WHERE source = ?`; binds.push(page); }
  sql += ` ORDER BY created_at DESC LIMIT ?`; binds.push(limit);
  const rows = (await env.DB.prepare(sql).bind(...binds).all()).results || [];
  return json({ leads: rows, count: rows.length });
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...extra } });
}

/* ---- DASHBOARD ---- */
const API = "/analytics/api";
const DASHBOARD_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>InspiraCred · Analytics</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  :root{--bg:#0b1020;--card:#151b2e;--card2:#1b2338;--line:#26304b;--txt:#e8ecf6;--mut:#93a0c0;--accent:#4f7cff;--green:#33c98b}
  *{box-sizing:border-box}
  body{margin:0;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--txt)}
  header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 28px;border-bottom:1px solid var(--line);flex-wrap:wrap}
  h1{font-size:18px;margin:0}h1 span{color:var(--accent)}
  .controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  select,button{background:var(--card2);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer}
  button:hover{border-color:var(--accent)}
  .wrap{padding:22px 28px;max-width:1240px;margin:0 auto}
  .scope{font-size:12px;color:var(--mut);margin-bottom:16px}
  .scope b{color:var(--accent)}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:22px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
  .kpi .label{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.5px}
  .kpi .val{font-size:30px;font-weight:700;margin-top:6px}
  .kpi .sub{font-size:12px;color:var(--green);margin-top:4px}
  .grid{display:grid;grid-template-columns:1.4fr 1fr;gap:18px;margin-bottom:22px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
  .card h2{font-size:14px;margin:0 0 14px;color:var(--mut);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
  .card .h2row{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
  .card .h2row h2{margin:0}
  .pages{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:18px}
  .pagecard{border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--card2)}
  .pagecard .head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px}
  .pagecard .pname{font-size:15px;font-weight:700}.pagecard .pstats{font-size:12px;color:var(--mut)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase;cursor:pointer}
  tbody tr:hover{background:var(--card2)}
  .tag{display:inline-block;background:var(--card2);border:1px solid var(--line);border-radius:20px;padding:2px 10px;font-size:11px;color:var(--mut)}
  .btn-sm{padding:5px 10px;font-size:12px}
  .empty{color:var(--mut);font-size:13px;padding:20px 0;text-align:center}
  .funnel-step{display:flex;align-items:center;gap:12px;margin-bottom:10px}
  .funnel-bar{height:34px;background:linear-gradient(90deg,var(--accent),#7aa0ff);border-radius:7px;min-width:44px;display:flex;align-items:center;padding:0 10px;font-weight:700;font-size:13px}
  .funnel-label{width:150px;font-size:12px;color:var(--mut)}
  canvas{max-height:240px}
  .table-scroll{overflow:auto;max-height:520px}
  .modal-bg{position:fixed;inset:0;background:rgba(4,8,20,.7);display:none;align-items:center;justify-content:center;z-index:50;padding:20px}
  .modal-bg.show{display:flex}
  .modal{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;max-width:460px;width:100%;position:relative}
  .modal h3{margin:0 0 4px;font-size:17px}
  .modal .close{position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;color:var(--mut);cursor:pointer;padding:0}
  dl{display:grid;grid-template-columns:130px 1fr;gap:8px 12px;margin:16px 0 0;font-size:13px}
  dt{color:var(--mut)}dd{margin:0;font-weight:600}
</style>
</head>
<body>
<header>
  <h1>Inspira<span>Cred</span> · Analytics</h1>
  <div class="controls">
    <select id="pageSel">
      <option value="all" selected>Todas as páginas</option>
      <option value="landing_page">Landing (Simulação)</option>
      <option value="link_bio">Link na bio</option>
      <option value="bio_test">Bio (teste)</option>
    </select>
    <select id="rangeSel"><option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select>
    <button id="refresh">Atualizar</button>
    <button id="openPage" title="Abrir a página selecionada em nova aba">Abrir página ↗</button>
  </div>
</header>
<div class="wrap">
  <div class="scope" id="scope"></div>
  <div class="kpis" id="kpis"></div>
  <div class="grid">
    <div class="card"><h2>Funil de conversão</h2><div id="funnel"></div></div>
    <div class="card"><h2>Visitantes por dia</h2><canvas id="dailyChart"></canvas></div>
  </div>
  <div class="grid">
    <div class="card"><h2>Desempenho por página</h2><div class="pages" id="pages"></div></div>
    <div class="card"><h2>Origem dos leads (UTM)</h2><canvas id="sourcesChart"></canvas></div>
  </div>
  <div class="card">
    <div class="h2row"><h2 id="leadsTitle">Leads</h2><button class="btn-sm" id="csvBtn">Baixar CSV</button></div>
    <div class="table-scroll"><div id="leads"></div></div>
  </div>
</div>

<div class="modal-bg" id="leadModal">
  <div class="modal">
    <button class="close" id="modalClose">&times;</button>
    <h3 id="modalName">Lead</h3>
    <div class="tag" id="modalDate"></div>
    <dl id="modalBody"></dl>
  </div>
</div>

<script>
var dailyChart=null, sourcesChart=null, clickCharts=[], lastLeads=[];
var PAGE_LABELS={landing_page:"Landing (Simulação)",link_bio:"Link na bio",bio_test:"Bio (teste)",other:"Outras"};
var PAGE_URLS={landing_page:"https://nova.inspiracred.com.br/",link_bio:"https://links.inspiracred.com.br/",bio_test:"https://nova.inspiracred.com.br/bio/"};
function pretty(n){return (n==null||n===""?"-":String(n))}
function label(p){return PAGE_LABELS[p]||p}
function daysAgo(n){return new Date(Date.now()-n*864e5).toISOString().slice(0,10)}
function brl(v){if(v==null)return"-";return "R$ "+Number(v).toLocaleString("pt-BR")}
function currentPage(){return document.getElementById("pageSel").value}

function setLoading(on){var b=document.getElementById("refresh");b.disabled=on;b.textContent=on?"Atualizando…":"Atualizar";}
function updateOpenBtn(){var b=document.getElementById("openPage");if(PAGE_URLS[currentPage()]){b.style.display="";}else{b.style.display="none";}}
function loadAll(){
  var days=document.getElementById("rangeSel").value;
  var page=currentPage();
  var pageQ=(page&&page!=="all")?"&page="+encodeURIComponent(page):"";
  var qs="?start="+daysAgo(parseInt(days)-1)+"&end="+new Date().toISOString().slice(0,10);
  updateOpenBtn();
  setLoading(true);
  var scopeTxt="Exibindo: <b>"+(page==="all"?"Todas as páginas":label(page))+"</b> · últimos "+days+" dias";
  document.getElementById("scope").innerHTML=scopeTxt+' · <span style="color:var(--mut)">carregando…</span>';
  var p1=fetch("${API}/overview"+qs+pageQ+"&_="+Date.now()).then(function(r){return r.json()}).then(render);
  var p2=fetch("${API}/leads?limit=500"+pageQ+"&_="+Date.now()).then(function(r){return r.json()}).then(renderLeads);
  Promise.all([p1,p2]).then(function(){
    document.getElementById("scope").innerHTML=scopeTxt+' · <span style="color:var(--green)">atualizado às '+new Date().toLocaleTimeString("pt-BR")+'</span>';
  }).catch(function(e){console.error(e);document.getElementById("scope").innerHTML=scopeTxt+' · <span style="color:#e0568b">erro ao carregar</span>';})
  .then(function(){setLoading(false);});
}

function render(d){
  var t=d.totals, r=d.rates;
  var kpis=[["Visitantes únicos",t.visitors,r.visitor_to_lead+"% viram lead"],["Simulações iniciadas",t.sim_start,r.visitor_to_start+"% dos visitantes"],["Simulações concluídas",t.sim_complete,r.start_to_complete+"% de conclusão"],["Leads capturados",t.leads,r.complete_to_lead+"% dos que concluíram"]];
  document.getElementById("kpis").innerHTML=kpis.map(function(k){return '<div class="kpi"><div class="label">'+k[0]+'</div><div class="val">'+pretty(k[1])+'</div><div class="sub">'+k[2]+'</div></div>'}).join("");
  var steps=[["Visitantes",t.visitors],["Simulação iniciada",t.sim_start],["Simulação concluída",t.sim_complete],["Lead",t.leads]];
  var max=Math.max(1,t.visitors);
  document.getElementById("funnel").innerHTML=steps.map(function(s){var w=Math.max(6,Math.round((s[1]/max)*100));return '<div class="funnel-step"><div class="funnel-label">'+s[0]+'</div><div class="funnel-bar" style="width:'+w+'%">'+pretty(s[1])+'</div></div>'}).join("");
  var dl=d.daily||[]; drawLine("dailyChart",dl.map(function(x){return x.d.slice(5)}),dl.map(function(x){return x.v}));
  var so=d.sources||[]; drawDoughnut("sourcesChart",so.map(function(x){return x.source}),so.map(function(x){return x.n}));
  renderPages(d.pages||[],d.clicks||[]);
}

function renderPages(pages,clicks){
  clickCharts.forEach(function(c){c.destroy()}); clickCharts=[];
  var box=document.getElementById("pages");
  if(!pages.length){box.innerHTML='<div class="empty">Sem dados ainda. Assim que houver acessos, aparece aqui.</div>';return}
  box.innerHTML=pages.map(function(p,i){var pl=PAGE_URLS[p.page_name]?' <a href="'+PAGE_URLS[p.page_name]+'" target="_blank" rel="noopener" title="Abrir esta página" style="color:var(--accent);text-decoration:none;font-size:12px">↗ abrir</a>':'';return '<div class="pagecard"><div class="head"><span class="pname">'+label(p.page_name)+pl+'</span><span class="pstats">'+p.views+' views · '+p.uniques+' únicos · '+p.forms+' forms</span></div><canvas id="clk'+i+'" height="150"></canvas></div>'}).join("");
  pages.forEach(function(p,i){
    var rows=clicks.filter(function(c){return c.page_name===p.page_name}).slice(0,6);
    var labels=rows.map(function(c){return (c.element_id||c.element_text||"?").slice(0,22)});
    var vals=rows.map(function(c){return c.clicks});
    var ctx=document.getElementById("clk"+i); if(!ctx)return;
    if(!rows.length){ctx.parentNode.innerHTML+='<div class="empty">Sem cliques.</div>';return}
    clickCharts.push(new Chart(ctx,{type:"bar",data:{labels:labels,datasets:[{data:vals,backgroundColor:"#4f7cff",borderRadius:5}]},options:{indexAxis:"y",plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#93a0c0"},grid:{color:"#26304b"}},y:{ticks:{color:"#93a0c0"},grid:{display:false}}}}}));
  });
}

function renderLeads(d){
  lastLeads=d.leads||[];
  document.getElementById("leadsTitle").textContent="Leads ("+lastLeads.length+")";
  if(!lastLeads.length){document.getElementById("leads").innerHTML='<div class="empty">Nenhum lead para este filtro.</div>';return}
  var html='<table><thead><tr><th>Data</th><th>Nome</th><th>Telefone</th><th>Imóvel</th><th>Crédito</th><th>Origem</th><th></th></tr></thead><tbody>';
  lastLeads.forEach(function(l,i){
    html+='<tr><td>'+(l.created_at||"").slice(0,16)+'</td><td>'+pretty(l.name)+'</td><td>'+pretty(l.phone)+'</td><td>'+pretty(l.property_type)+'</td><td>'+brl(l.credit_value)+'</td><td>'+pretty(l.utm_source||l.source||"direto")+'</td><td><button class="btn-sm" onclick="showLead('+i+')">Ver ficha</button></td></tr>';
  });
  document.getElementById("leads").innerHTML=html+'</tbody></table>';
}

function showLead(i){
  var l=lastLeads[i]; if(!l)return;
  document.getElementById("modalName").textContent=l.name||"Lead sem nome";
  document.getElementById("modalDate").textContent=(l.created_at||"").slice(0,16);
  var fields=[["Telefone",pretty(l.phone)],["E-mail",pretty(l.email)],["Tipo de imóvel",pretty(l.property_type)],["Valor do imóvel",brl(l.property_value)],["Crédito desejado",brl(l.credit_value)],["Origem (página)",pretty(l.source)],["utm_source",pretty(l.utm_source)],["utm_medium",pretty(l.utm_medium)],["utm_campaign",pretty(l.utm_campaign)],["RD Station",pretty(l.rd_status)],["Meta CAPI",pretty(l.meta_status)]];
  document.getElementById("modalBody").innerHTML=fields.map(function(f){return '<dt>'+f[0]+'</dt><dd>'+f[1]+'</dd>'}).join("");
  document.getElementById("leadModal").classList.add("show");
}
function closeModal(){document.getElementById("leadModal").classList.remove("show")}

function exportCSV(){
  if(!lastLeads.length){alert("Sem leads para exportar.");return}
  var cols=["created_at","name","phone","email","property_type","property_value","credit_value","source","utm_source","utm_medium","utm_campaign","rd_status","meta_status"];
  var head=cols.join(",");
  var lines=lastLeads.map(function(l){return cols.map(function(c){var v=l[c]==null?"":String(l[c]).replace(/"/g,'""');return '"'+v+'"'}).join(",")});
  var csv=head+"\\n"+lines.join("\\n");
  var url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  var a=document.createElement("a"); a.href=url; a.download="leads-"+currentPage()+"-"+new Date().toISOString().slice(0,10)+".csv"; a.click();
  URL.revokeObjectURL(url);
}

function drawLine(id,labels,data){var ctx=document.getElementById(id);if(dailyChart)dailyChart.destroy();dailyChart=new Chart(ctx,{type:"line",data:{labels:labels,datasets:[{data:data,borderColor:"#33c98b",backgroundColor:"rgba(51,201,139,.15)",fill:true,tension:.3,pointRadius:2}]},options:{plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#93a0c0"},grid:{color:"#26304b"}},y:{ticks:{color:"#93a0c0"},grid:{color:"#26304b"}}}}})}
function drawDoughnut(id,labels,data){var ctx=document.getElementById(id);if(sourcesChart)sourcesChart.destroy();sourcesChart=new Chart(ctx,{type:"doughnut",data:{labels:labels,datasets:[{data:data,backgroundColor:["#4f7cff","#33c98b","#f0b429","#e0568b","#8b5cf6","#22d3ee"]}]},options:{plugins:{legend:{position:"right",labels:{color:"#93a0c0",font:{size:11}}}}}})}

document.getElementById("refresh").addEventListener("click",loadAll);
document.getElementById("rangeSel").addEventListener("change",loadAll);
document.getElementById("pageSel").addEventListener("change",loadAll);
document.getElementById("openPage").addEventListener("click",function(){var u=PAGE_URLS[currentPage()];if(u)window.open(u,"_blank","noopener");});
document.getElementById("csvBtn").addEventListener("click",exportCSV);
document.getElementById("modalClose").addEventListener("click",closeModal);
document.getElementById("leadModal").addEventListener("click",function(e){if(e.target.id==="leadModal")closeModal()});
loadAll();
</script>
</body>
</html>`;
