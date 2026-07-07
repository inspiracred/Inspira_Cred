/**
 * InspiraCred — Worker de Analytics + Dashboard
 * Cloudflare Workers + D1 (env.DB) + KV (env.KV)
 *
 * Rotas:
 *   POST /track          -> coleta de eventos (aberto, CORS restrito aos domínios)
 *   GET  /api/overview   -> métricas agregadas (protegido por Basic Auth)
 *   GET  /api/leads      -> leads recentes / PII  (protegido por Basic Auth)
 *   GET  / | /dashboard  -> dashboard HTML         (protegido por Basic Auth)
 *
 * Segredo: DASHBOARD_PASSWORD (wrangler secret put DASHBOARD_PASSWORD)
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    // Coleta — aberta (o site precisa enviar), validada abaixo
    if (url.pathname === "/track" && request.method === "POST") {
      return handleTrack(request, env, cors);
    }

    // A partir daqui tudo é protegido por senha
    if (!isAuthorized(request, env)) {
      return unauthorized();
    }

    if (url.pathname === "/api/overview" && request.method === "GET") {
      return handleOverview(request, env);
    }
    if (url.pathname === "/api/leads" && request.method === "GET") {
      return handleLeads(request, env);
    }
    if ((url.pathname === "/" || url.pathname === "/dashboard") && request.method === "GET") {
      return new Response(DASHBOARD_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};

/* ----------------------------- AUTH ----------------------------- */

function isAuthorized(request, env) {
  const pw = env.DASHBOARD_PASSWORD;
  if (!pw) return false; // sem senha configurada = bloqueado
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  let decoded = "";
  try { decoded = atob(header.slice(6)); } catch { return false; }
  const pass = decoded.slice(decoded.indexOf(":") + 1);
  return pass === pw;
}

function unauthorized() {
  return new Response("Autenticação necessária", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="InspiraCred Analytics"' },
  });
}

/* ----------------------------- COLETA ----------------------------- */

async function handleTrack(request, env, cors) {
  try {
    const event = await request.json();
    if (!event.type || !event.session_id) {
      return json({ error: "type e session_id são obrigatórios" }, 400, cors);
    }

    switch (event.type) {
      case "page_view":
        await env.DB.prepare(
          `INSERT INTO page_views (session_id, page_name, url, title, referrer, user_agent, ip_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          event.session_id, event.page_name || "other", event.url || null,
          event.title || null, event.referrer || null,
          event.user_agent || null, event.ip_hash || null
        ).run();
        break;

      case "click":
        await env.DB.prepare(
          `INSERT INTO clicks (session_id, element_id, element_text, destination, link_type, page_name)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          event.session_id, event.element_id || null, event.element_text || null,
          event.destination || null, event.link_type || null, event.page_name || "other"
        ).run();
        break;

      case "form_submit":
        await env.DB.prepare(
          `INSERT INTO form_submissions (session_id, form_id, form_data, success, completion_time_ms, page_name)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          event.session_id, event.form_id || null,
          JSON.stringify(event.form_data || {}),
          event.success === false ? 0 : 1,
          event.completion_time_ms || null, event.page_name || "other"
        ).run();
        break;

      case "lead":
        await env.DB.prepare(
          `INSERT INTO leads (session_id, name, phone, email, property_type, property_value, credit_value, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          event.session_id || null, event.name || null, event.phone || null, event.email || null,
          event.property_type || null, event.property_value || null, event.credit_value || null,
          event.source || null, event.utm_source || null, event.utm_medium || null,
          event.utm_campaign || null, event.utm_content || null, event.utm_term || null
        ).run();
        break;

      case "event":
        await env.DB.prepare(
          `INSERT INTO events (session_id, event_type, event_name, properties, page_name)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(
          event.session_id, event.event_type || "custom", event.event_name || "custom",
          JSON.stringify(event.properties || {}), event.page_name || null
        ).run();
        break;

      default:
        return json({ error: "tipo desconhecido" }, 400, cors);
    }

    return json({ success: true }, 200, cors);
  } catch (err) {
    return json({ error: "erro interno" }, 500, cors);
  }
}

/* ----------------------------- MÉTRICAS ----------------------------- */

function range(url) {
  const p = new URL(url).searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const past = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  return { start: p.get("start") || past, end: p.get("end") || today };
}

async function handleOverview(request, env) {
  const { start, end } = range(request.url);
  const b = [start, end];
  const one = async (sql, bind = b) => (await env.DB.prepare(sql).bind(...bind).first()) || {};
  const many = async (sql, bind = b) => (await env.DB.prepare(sql).bind(...bind).all()).results || [];

  const [visitors, simStart, simComplete, leadsN, pages, forms, clicks, sources, daily] = await Promise.all([
    one(`SELECT COUNT(DISTINCT session_id) n FROM page_views WHERE DATE(created_at) BETWEEN ? AND ?`),
    one(`SELECT COUNT(DISTINCT session_id) n FROM events WHERE event_name='simulation_start' AND DATE(created_at) BETWEEN ? AND ?`),
    one(`SELECT COUNT(DISTINCT session_id) n FROM events WHERE event_name='simulation_complete' AND DATE(created_at) BETWEEN ? AND ?`),
    one(`SELECT COUNT(*) n FROM leads WHERE DATE(created_at) BETWEEN ? AND ?`),
    many(`SELECT page_name, COUNT(*) views, COUNT(DISTINCT session_id) uniques FROM page_views WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY page_name ORDER BY views DESC`),
    many(`SELECT page_name, COUNT(*) n FROM form_submissions WHERE success=1 AND DATE(created_at) BETWEEN ? AND ? GROUP BY page_name`),
    many(`SELECT page_name, element_id, element_text, COUNT(*) clicks FROM clicks WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY page_name, element_id, element_text ORDER BY clicks DESC`),
    many(`SELECT COALESCE(NULLIF(utm_source,''),'direto') source, COUNT(*) n FROM leads WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY source ORDER BY n DESC`),
    many(`SELECT DATE(created_at) d, COUNT(DISTINCT session_id) v FROM page_views WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY d ORDER BY d`),
  ]);

  const formsByPage = {};
  forms.forEach((f) => { formsByPage[f.page_name] = f.n; });
  const pagesOut = pages.map((p) => ({
    page_name: p.page_name, views: p.views, uniques: p.uniques, forms: formsByPage[p.page_name] || 0,
  }));

  const v = visitors.n || 0, ss = simStart.n || 0, sc = simComplete.n || 0, ld = leadsN.n || 0;
  const pct = (a, base) => (base ? +((a / base) * 100).toFixed(1) : 0);

  return json({
    range: { start, end },
    totals: { visitors: v, sim_start: ss, sim_complete: sc, leads: ld },
    rates: {
      visitor_to_start: pct(ss, v),
      start_to_complete: pct(sc, ss),
      complete_to_lead: pct(ld, sc),
      visitor_to_lead: pct(ld, v),
    },
    pages: pagesOut,
    clicks,
    sources,
    daily,
  });
}

async function handleLeads(request, env) {
  const p = new URL(request.url).searchParams;
  const limit = Math.min(parseInt(p.get("limit")) || 50, 200);
  const rows = (await env.DB.prepare(
    `SELECT id, name, phone, property_type, property_value, credit_value, source, utm_source, created_at
     FROM leads ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all()).results || [];
  return json({ leads: rows });
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

/* ----------------------------- DASHBOARD ----------------------------- */

const DASHBOARD_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>InspiraCred · Analytics</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  :root{--bg:#0b1020;--card:#151b2e;--card2:#1b2338;--line:#26304b;--txt:#e8ecf6;--mut:#93a0c0;--accent:#4f7cff;--green:#33c98b;--amber:#f0b429}
  *{box-sizing:border-box}
  body{margin:0;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--txt)}
  header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 28px;border-bottom:1px solid var(--line);flex-wrap:wrap}
  h1{font-size:18px;margin:0;letter-spacing:.3px}
  h1 span{color:var(--accent)}
  select,button{background:var(--card2);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer}
  .wrap{padding:24px 28px;max-width:1240px;margin:0 auto}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:22px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
  .kpi .label{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.5px}
  .kpi .val{font-size:30px;font-weight:700;margin-top:6px}
  .kpi .sub{font-size:12px;color:var(--green);margin-top:4px}
  .grid{display:grid;grid-template-columns:1.4fr 1fr;gap:18px;margin-bottom:22px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
  .card h2{font-size:14px;margin:0 0 14px;color:var(--mut);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
  .pages{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:18px;margin-bottom:22px}
  .pagecard .head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px}
  .pagecard .pname{font-size:15px;font-weight:700}
  .pagecard .pstats{font-size:12px;color:var(--mut)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
  th{color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase}
  .empty{color:var(--mut);font-size:13px;padding:20px 0;text-align:center}
  .funnel-step{display:flex;align-items:center;gap:12px;margin-bottom:10px}
  .funnel-bar{height:34px;background:linear-gradient(90deg,var(--accent),#7aa0ff);border-radius:7px;min-width:44px;display:flex;align-items:center;padding:0 10px;font-weight:700;font-size:13px}
  .funnel-label{width:150px;font-size:12px;color:var(--mut)}
  canvas{max-height:240px}
</style>
</head>
<body>
<header>
  <h1>Inspira<span>Cred</span> · Analytics</h1>
  <div>
    <select id="rangeSel">
      <option value="7">Últimos 7 dias</option>
      <option value="30" selected>Últimos 30 dias</option>
      <option value="90">Últimos 90 dias</option>
    </select>
    <button id="refresh">Atualizar</button>
  </div>
</header>
<div class="wrap">
  <div class="kpis" id="kpis"></div>
  <div class="grid">
    <div class="card"><h2>Funil de conversão</h2><div id="funnel"></div></div>
    <div class="card"><h2>Visitantes por dia</h2><canvas id="dailyChart"></canvas></div>
  </div>
  <div class="grid">
    <div class="card"><h2>Desempenho por página</h2><div class="pages" id="pages"></div></div>
    <div class="card"><h2>Origem dos leads (UTM)</h2><canvas id="sourcesChart"></canvas></div>
  </div>
  <div class="card"><h2>Leads recentes</h2><div id="leads"></div></div>
</div>
<script>
var dailyChart=null, sourcesChart=null, clickCharts=[];
var PAGE_LABELS={landing_page:"Landing (Simulação)",link_bio:"Link na bio",bio_test:"Bio (teste)",other:"Outras"};
function pretty(n){return (n==null?"-":String(n))}
function label(p){return PAGE_LABELS[p]||p}

function daysAgo(n){var d=new Date(Date.now()-n*864e5);return d.toISOString().slice(0,10)}

function loadAll(){
  var days=document.getElementById("rangeSel").value;
  var qs="?start="+daysAgo(parseInt(days)-1)+"&end="+new Date().toISOString().slice(0,10);
  fetch("/api/overview"+qs).then(function(r){return r.json()}).then(render).catch(function(e){console.error(e)});
  fetch("/api/leads?limit=50").then(function(r){return r.json()}).then(renderLeads).catch(function(e){console.error(e)});
}

function render(d){
  var t=d.totals, r=d.rates;
  var kpis=[
    ["Visitantes únicos",t.visitors,r.visitor_to_lead+"% viram lead"],
    ["Simulações iniciadas",t.sim_start,r.visitor_to_start+"% dos visitantes"],
    ["Simulações concluídas",t.sim_complete,r.start_to_complete+"% de conclusão"],
    ["Leads capturados",t.leads,r.complete_to_lead+"% dos que concluíram"]
  ];
  document.getElementById("kpis").innerHTML=kpis.map(function(k){
    return '<div class="kpi"><div class="label">'+k[0]+'</div><div class="val">'+pretty(k[1])+'</div><div class="sub">'+k[2]+'</div></div>';
  }).join("");

  // Funil
  var steps=[["Visitantes",t.visitors],["Simulação iniciada",t.sim_start],["Simulação concluída",t.sim_complete],["Lead",t.leads]];
  var max=Math.max(1,t.visitors);
  document.getElementById("funnel").innerHTML=steps.map(function(s){
    var w=Math.max(6,Math.round((s[1]/max)*100));
    return '<div class="funnel-step"><div class="funnel-label">'+s[0]+'</div><div class="funnel-bar" style="width:'+w+'%">'+pretty(s[1])+'</div></div>';
  }).join("");

  // Daily
  var dl=d.daily||[];
  drawLine("dailyChart", dl.map(function(x){return x.d.slice(5)}), dl.map(function(x){return x.v}));

  // Sources
  var sc=d.sources||[];
  drawDoughnut("sourcesChart", sc.map(function(x){return x.source}), sc.map(function(x){return x.n}));

  // Páginas + cliques
  renderPages(d.pages||[], d.clicks||[]);
}

function renderPages(pages, clicks){
  clickCharts.forEach(function(c){c.destroy()}); clickCharts=[];
  var box=document.getElementById("pages");
  if(!pages.length){box.innerHTML='<div class="empty">Sem dados ainda. Assim que houver acessos, aparece aqui.</div>';return}
  box.innerHTML=pages.map(function(p,i){
    return '<div class="pagecard"><div class="head"><span class="pname">'+label(p.page_name)+
      '</span><span class="pstats">'+p.views+' views · '+p.uniques+' únicos · '+p.forms+' forms</span></div>'+
      '<canvas id="clk'+i+'" height="150"></canvas></div>';
  }).join("");
  pages.forEach(function(p,i){
    var rows=clicks.filter(function(c){return c.page_name===p.page_name}).slice(0,6);
    var labels=rows.map(function(c){return (c.element_id||c.element_text||"?").slice(0,22)});
    var vals=rows.map(function(c){return c.clicks});
    var ctx=document.getElementById("clk"+i);
    if(!ctx)return;
    if(!rows.length){ctx.parentNode.innerHTML+='<div class="empty">Sem cliques.</div>';return}
    clickCharts.push(new Chart(ctx,{type:"bar",data:{labels:labels,datasets:[{data:vals,backgroundColor:"#4f7cff",borderRadius:5}]},
      options:{indexAxis:"y",plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#93a0c0"},grid:{color:"#26304b"}},y:{ticks:{color:"#93a0c0"},grid:{display:false}}}}}));
  });
}

function renderLeads(d){
  var rows=d.leads||[];
  if(!rows.length){document.getElementById("leads").innerHTML='<div class="empty">Nenhum lead ainda.</div>';return}
  var html='<table><thead><tr><th>Data</th><th>Nome</th><th>Telefone</th><th>Imóvel</th><th>Crédito</th><th>Origem</th></tr></thead><tbody>';
  rows.forEach(function(l){
    html+='<tr><td>'+(l.created_at||"").slice(0,16)+'</td><td>'+pretty(l.name)+'</td><td>'+pretty(l.phone)+
      '</td><td>'+pretty(l.property_type)+'</td><td>'+brl(l.credit_value)+'</td><td>'+pretty(l.utm_source||l.source||"direto")+'</td></tr>';
  });
  document.getElementById("leads").innerHTML=html+'</tbody></table>';
}

function brl(v){if(v==null)return"-";return "R$ "+Number(v).toLocaleString("pt-BR")}

function drawLine(id,labels,data){
  var ctx=document.getElementById(id); if(dailyChart)dailyChart.destroy();
  dailyChart=new Chart(ctx,{type:"line",data:{labels:labels,datasets:[{data:data,borderColor:"#33c98b",backgroundColor:"rgba(51,201,139,.15)",fill:true,tension:.3,pointRadius:2}]},
    options:{plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#93a0c0"},grid:{color:"#26304b"}},y:{ticks:{color:"#93a0c0"},grid:{color:"#26304b"}}}}});
}
function drawDoughnut(id,labels,data){
  var ctx=document.getElementById(id); if(sourcesChart)sourcesChart.destroy();
  sourcesChart=new Chart(ctx,{type:"doughnut",data:{labels:labels,datasets:[{data:data,backgroundColor:["#4f7cff","#33c98b","#f0b429","#e0568b","#8b5cf6","#22d3ee"]}]},
    options:{plugins:{legend:{position:"right",labels:{color:"#93a0c0",font:{size:11}}}}}});
}

document.getElementById("refresh").addEventListener("click",loadAll);
document.getElementById("rangeSel").addEventListener("change",loadAll);
loadAll();
</script>
</body>
</html>`;
