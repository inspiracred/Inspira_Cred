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
        // Enriquece fbp/fbc a partir dos cookies do Pixel (mesma origem) se o client não mandou
        const leadCookies = parseCookies(request.headers.get("Cookie") || "");
        if (!event.fbp && leadCookies._fbp) event.fbp = leadCookies._fbp;
        if (!event.fbc && leadCookies._fbc) event.fbc = leadCookies._fbc;
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
          context.waitUntil(sendLeadToMeta(event, env, leadId, {
            clientIp: request.headers.get("CF-Connecting-IP") || "",
            userAgent: request.headers.get("User-Agent") || "",
            sourceUrl: event.url || request.headers.get("Referer") || "",
          }));
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

/* ---- META CAPI (server-side; dedup por event_id com o Pixel do navegador) ----
 * DORME até os secrets META_PIXEL_ID + META_ACCESS_TOKEN existirem no Pages —
 * sem eles, retorna cedo e nada é enviado (seguro pra deixar no ar já).
 * PII (email/telefone/nome) vai SHA-256 (Advanced Matching do Meta). fbp/fbc
 * vêm do cookie do Pixel (mesma origem, lidos no case "lead"). Usa o MESMO
 * event_id que o Pixel do navegador mandou → Meta deduplica. Grava o resultado
 * em leads.meta_status (visível na ficha do lead / CSV do dashboard).
 * Opcional: META_TEST_EVENT_CODE p/ validar na aba "Testar eventos" do Meta.
 */
async function sha256Hex(value) {
  if (!value) return "";
  const norm = String(value).toLowerCase().trim();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach((c) => {
    const i = c.indexOf("=");
    if (i > -1) out[c.slice(0, i).trim()] = c.slice(i + 1).trim();
  });
  return out;
}

async function sendLeadToMeta(event, env, leadId, ctx) {
  if (!env.META_PIXEL_ID || !env.META_ACCESS_TOKEN) return; // dormindo até ter os secrets

  const phoneDigits = (event.phone || "").replace(/\D/g, "");
  const nameParts = (event.name || "").trim().split(/\s+/);
  const fn = nameParts[0] || "";
  const ln = nameParts.slice(1).join(" ") || "";

  // fbc: usa o cookie do Pixel; se só tiver fbclid, monta no formato do Meta
  // (nova.inspiracred.com.br é .com.br → subdomain index 2).
  let fbc = event.fbc || "";
  if (!fbc && event.fbclid) fbc = `fb.2.${Date.now()}.${event.fbclid}`;

  const userData = {
    client_ip_address: ctx.clientIp || undefined,
    client_user_agent: ctx.userAgent || undefined,
    fbp: event.fbp || undefined,
    fbc: fbc || undefined,
  };
  const em = await sha256Hex(event.email);
  const ph = await sha256Hex(phoneDigits);
  const hfn = await sha256Hex(fn);
  const hln = await sha256Hex(ln);
  const ext = await sha256Hex(event.session_id);
  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  if (hfn) userData.fn = [hfn];
  if (hln) userData.ln = [hln];
  if (ext) userData.external_id = [ext];

  const payload = {
    data: [{
      event_name: "Lead",
      event_time: Math.floor(Date.now() / 1000),
      event_id: event.event_id || undefined,
      event_source_url: ctx.sourceUrl || undefined,
      action_source: "website",
      user_data: userData,
      custom_data: {
        currency: "BRL",
        value: event.credit_value != null ? Number(event.credit_value) : undefined,
        content_category: event.property_type || undefined,
      },
    }],
  };
  if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;

  let status = "erro";
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${env.META_PIXEL_ID}/events?access_token=${env.META_ACCESS_TOKEN}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
    status = res.ok ? "ok" : `http_${res.status}`;
  } catch (e) {
    status = "fetch_error";
  }
  try {
    await env.DB.prepare(`UPDATE leads SET meta_status = ? WHERE id = ?`).bind(status, leadId).run();
  } catch (e) {
    // falha de log não derruba o fan-out
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
<link rel="icon" type="image/svg+xml" href="/assets/icons/favicon.svg"/>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<style>
  :root{
    --blue:#0b2d72;--blue-dark:#061a42;--orange:#f97316;--orange-soft:#fdeee5;
    --surface:#f4f5f7;--card:#ffffff;--text:#111827;--muted:#6b7280;--border:#e5e7eb;
    --green:#10b981;--green-soft:#e7f7f0;--green-ink:#047857;--red:#ef4444;--red-soft:#fdecec;--red-ink:#b91c1c;
    --shadow:0 1px 2px rgba(6,26,66,.05),0 10px 26px rgba(6,26,66,.06);
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:"Inter",-apple-system,Segoe UI,Roboto,sans-serif;background:var(--surface);color:var(--text);-webkit-font-smoothing:antialiased}
  .num,h2,.logo,.kpi .val,.funnel-bar{font-family:"Instrument Sans","Inter",sans-serif}
  header{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 26px;background:#fff;border-bottom:1px solid var(--border);flex-wrap:wrap}
  .logo{font-size:20px;font-weight:800;color:var(--blue);letter-spacing:-.02em;display:flex;align-items:baseline;gap:9px}
  .logo .o{color:var(--orange)}
  .logo small{font-family:"Inter",sans-serif;font-weight:600;color:var(--muted);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
  .controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  select,button{font-family:inherit;background:#fff;color:var(--text);border:1px solid var(--border);border-radius:10px;padding:8px 12px;font-size:13px;cursor:pointer;transition:border-color .15s,box-shadow .15s,filter .15s}
  select:hover,button:hover{border-color:var(--blue)}
  button.primary{background:var(--orange);border-color:var(--orange);color:#fff;font-weight:600}
  button.primary:hover{filter:brightness(1.04);box-shadow:0 6px 14px rgba(249,115,22,.28)}
  .tabs{position:sticky;top:57px;z-index:19;display:flex;gap:2px;padding:0 26px;background:#fff;border-bottom:1px solid var(--border);flex-wrap:wrap}
  .tab{padding:13px 15px;font-size:14px;font-weight:600;color:var(--muted);background:none;border:none;border-bottom:2px solid transparent;border-radius:0}
  .tab:hover{color:var(--blue)}
  .tab.active{color:var(--blue);border-bottom-color:var(--orange)}
  .wrap{padding:22px 26px;max-width:1240px;margin:0 auto}
  .scope{font-size:12.5px;color:var(--muted);margin-bottom:18px}
  .scope b{color:var(--blue)}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:20px}
  .kpi{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:15px 18px;box-shadow:var(--shadow)}
  .kpi .label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
  .kpi .val{font-size:29px;font-weight:800;color:var(--blue);margin-top:7px;line-height:1}
  .kpi .sub{font-size:12px;color:var(--muted);margin-top:8px}
  .kpi .sub b{color:var(--green-ink);font-weight:700}
  .grid{display:grid;grid-template-columns:1.5fr 1fr;gap:18px;margin-bottom:20px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:18px;padding:18px 20px;box-shadow:var(--shadow)}
  .card h2{font-size:12px;margin:0 0 16px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em}
  .h2row{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
  .h2row h2{margin:0}
  .pages{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
  .pagecard{border:1px solid var(--border);border-radius:14px;padding:14px;background:var(--surface)}
  .pagecard .head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;gap:8px}
  .pagecard .pname{font-size:14px;font-weight:700;color:var(--blue)}
  .pagecard .pstats{font-size:11.5px;color:var(--muted)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:10px;border-bottom:1px solid var(--border);white-space:nowrap}
  th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  tbody tr:hover{background:var(--surface)}
  .chip{display:inline-block;background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:3px 11px;font-size:11px;color:var(--muted)}
  .pill{display:inline-block;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600}
  .pill.ok{background:var(--green-soft);color:var(--green-ink)}
  .pill.err{background:var(--red-soft);color:var(--red-ink)}
  .pill.wait{background:var(--surface);color:var(--muted)}
  .btn-sm{padding:6px 12px;font-size:12px;border-radius:9px}
  .empty{color:var(--muted);font-size:13px;padding:28px 0;text-align:center}
  .funnel-step{display:flex;align-items:center;gap:12px;margin-bottom:11px}
  .funnel-label{width:150px;font-size:12.5px;color:var(--muted)}
  .funnel-bar{height:36px;background:var(--blue);border-radius:9px;min-width:46px;display:flex;align-items:center;padding:0 12px;font-weight:700;font-size:13px;color:#fff}
  .funnel-step:last-child .funnel-bar{background:var(--orange)}
  .chart-box{position:relative;height:250px}
  .table-scroll{overflow:auto;max-height:560px}
  .modal-bg{position:fixed;inset:0;background:rgba(6,26,66,.55);display:none;align-items:center;justify-content:center;z-index:50;padding:20px}
  .modal-bg.show{display:flex}
  .modal{background:#fff;border-radius:20px;padding:26px;max-width:480px;width:100%;position:relative;box-shadow:0 24px 60px rgba(6,26,66,.3)}
  .modal h3{margin:0 0 6px;font-size:19px;color:var(--blue);font-family:"Instrument Sans","Inter",sans-serif}
  .modal .close{position:absolute;top:16px;right:18px;background:none;border:none;font-size:24px;color:var(--muted);cursor:pointer;padding:0;line-height:1}
  dl{display:grid;grid-template-columns:140px 1fr;gap:9px 12px;margin:18px 0 0;font-size:13px}
  dt{color:var(--muted)}dd{margin:0;font-weight:600;color:var(--text)}
  .tab-section{display:none}
  @media(max-width:760px){.grid{grid-template-columns:1fr}.tabs{top:auto}}
</style>
</head>
<body>
<header>
  <div class="logo">Inspira<span class="o">Cred</span><small>Analytics</small></div>
  <div class="controls">
    <select id="pageSel">
      <option value="all" selected>Todas as páginas</option>
      <option value="landing_page">Landing / Simulação</option>
      <option value="home_equity_lp">Home Equity</option>
      <option value="link_bio">Link na bio</option>
    </select>
    <select id="rangeSel"><option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select>
    <button id="refresh" class="primary">Atualizar</button>
    <button id="openPage" title="Abrir a página selecionada em nova aba">Abrir página ↗</button>
  </div>
</header>
<div class="tabs">
  <button class="tab" id="tabbtn-overview" onclick="showTab('overview')">Visão geral</button>
  <button class="tab" id="tabbtn-leads" onclick="showTab('leads')">Leads</button>
  <button class="tab" id="tabbtn-traffic" onclick="showTab('traffic')">Tráfego</button>
</div>
<div class="wrap">
  <div class="scope" id="scope"></div>

  <section class="tab-section" id="tab-overview">
    <div class="kpis" id="kpis"></div>
    <div class="grid">
      <div class="card"><h2>Funil de conversão</h2><div id="funnel"></div></div>
      <div class="card"><h2>Visitantes por dia</h2><div class="chart-box"><canvas id="dailyChart"></canvas></div></div>
    </div>
  </section>

  <section class="tab-section" id="tab-leads">
    <div class="kpis" id="leadKpis"></div>
    <div class="card">
      <div class="h2row"><h2 id="leadsTitle">Leads</h2><button class="btn-sm" id="csvBtn">Baixar CSV</button></div>
      <div class="table-scroll"><div id="leads"></div></div>
    </div>
  </section>

  <section class="tab-section" id="tab-traffic">
    <div class="grid">
      <div class="card"><h2>Origem dos leads (UTM)</h2><div class="chart-box"><canvas id="sourcesChart"></canvas></div></div>
      <div class="card"><h2>Desempenho por página</h2><div class="pages" id="pages"></div></div>
    </div>
  </section>
</div>

<div class="modal-bg" id="leadModal">
  <div class="modal">
    <button class="close" id="modalClose">&times;</button>
    <h3 id="modalName">Lead</h3>
    <div class="chip" id="modalDate"></div>
    <dl id="modalBody"></dl>
  </div>
</div>

<script>
var dailyChart=null, sourcesChart=null, clickCharts=[], lastLeads=[], activeTab="overview";
var PAGE_LABELS={landing_page:"Landing / Simulação",home_equity_lp:"Home Equity",link_bio:"Link na bio",bio_test:"Bio (teste)",other:"Outras"};
var PAGE_URLS={landing_page:"https://nova.inspiracred.com.br/",home_equity_lp:"https://nova.inspiracred.com.br/homeequity/",link_bio:"https://links.inspiracred.com.br/"};
var CHART_PALETTE=["#f97316","#0b2d72","#10b981","#f59e0b","#3b82f6","#8b5cf6","#ec4899"];
function pretty(n){return (n==null||n===""?"-":String(n))}
function label(p){return PAGE_LABELS[p]||p}
function daysAgo(n){return new Date(Date.now()-n*864e5).toISOString().slice(0,10)}
function brl(v){if(v==null)return"-";return "R$ "+Number(v).toLocaleString("pt-BR")}
function pct(a,b){return b?Math.round((a/b)*100):0}
function currentPage(){return document.getElementById("pageSel").value}
function badge(s){if(s==="ok")return '<span class="pill ok">entregue</span>';if(s==null||s==="")return '<span class="pill wait">pendente</span>';return '<span class="pill err">'+pretty(s)+'</span>';}

function showTab(name){
  activeTab=name;
  ["overview","leads","traffic"].forEach(function(t){
    document.getElementById("tab-"+t).style.display=(t===name)?"block":"none";
    document.getElementById("tabbtn-"+t).classList.toggle("active",t===name);
  });
  setTimeout(function(){[dailyChart,sourcesChart].concat(clickCharts).forEach(function(c){if(c){try{c.resize()}catch(e){}}});},30);
}

function setLoading(on){var b=document.getElementById("refresh");b.disabled=on;b.textContent=on?"Atualizando…":"Atualizar";}
function updateOpenBtn(){var b=document.getElementById("openPage");b.style.display=PAGE_URLS[currentPage()]?"":"none";}
function loadAll(){
  var days=document.getElementById("rangeSel").value;
  var page=currentPage();
  var pageQ=(page&&page!=="all")?"&page="+encodeURIComponent(page):"";
  var qs="?start="+daysAgo(parseInt(days)-1)+"&end="+new Date().toISOString().slice(0,10);
  updateOpenBtn();
  setLoading(true);
  var scopeTxt="Exibindo: <b>"+(page==="all"?"Todas as páginas":label(page))+"</b> · últimos "+days+" dias";
  document.getElementById("scope").innerHTML=scopeTxt+' · <span style="color:var(--muted)">carregando…</span>';
  var p1=fetch("${API}/overview"+qs+pageQ+"&_="+Date.now()).then(function(r){return r.json()}).then(function(d){render(d);renderTraffic(d);});
  var p2=fetch("${API}/leads?limit=500"+pageQ+"&_="+Date.now()).then(function(r){return r.json()}).then(renderLeads);
  Promise.all([p1,p2]).then(function(){
    document.getElementById("scope").innerHTML=scopeTxt+' · <span style="color:var(--green-ink)">atualizado às '+new Date().toLocaleTimeString("pt-BR")+'</span>';
  }).catch(function(e){console.error(e);document.getElementById("scope").innerHTML=scopeTxt+' · <span style="color:var(--red-ink)">erro ao carregar</span>';})
  .then(function(){setLoading(false);});
}

function render(d){
  var t=d.totals, r=d.rates;
  var kpis=[["Visitantes únicos",pretty(t.visitors),r.visitor_to_lead+"% viram lead"],["Simulações concluídas",pretty(t.sim_complete),r.start_to_complete+"% de conclusão"],["Leads capturados",pretty(t.leads),r.complete_to_lead+"% dos que concluíram"],["Conversão visitante→lead",r.visitor_to_lead+"%",pretty(t.leads)+" de "+pretty(t.visitors)]];
  document.getElementById("kpis").innerHTML=kpis.map(function(k){return '<div class="kpi"><div class="label">'+k[0]+'</div><div class="val">'+k[1]+'</div><div class="sub"><b>'+k[2]+'</b></div></div>'}).join("");
  var steps=[["Visitantes",t.visitors],["Simulação iniciada",t.sim_start],["Simulação concluída",t.sim_complete],["Lead",t.leads]];
  var max=Math.max(1,t.visitors);
  document.getElementById("funnel").innerHTML=steps.map(function(s){var w=Math.max(6,Math.round(((s[1]||0)/max)*100));return '<div class="funnel-step"><div class="funnel-label">'+s[0]+'</div><div class="funnel-bar" style="width:'+w+'%">'+pretty(s[1])+'</div></div>'}).join("");
  var dl=d.daily||[]; drawLine("dailyChart",dl.map(function(x){return x.d.slice(5)}),dl.map(function(x){return x.v}));
}

function renderTraffic(d){
  var so=d.sources||[]; drawDoughnut("sourcesChart",so.map(function(x){return x.source}),so.map(function(x){return x.n}));
  renderPages(d.pages||[],d.clicks||[]);
}

function renderPages(pages,clicks){
  clickCharts.forEach(function(c){c.destroy()}); clickCharts=[];
  var box=document.getElementById("pages");
  if(!pages.length){box.innerHTML='<div class="empty">Sem dados ainda. Assim que houver acessos, aparece aqui.</div>';return}
  box.innerHTML=pages.map(function(p,i){var pl=PAGE_URLS[p.page_name]?' <a href="'+PAGE_URLS[p.page_name]+'" target="_blank" rel="noopener" title="Abrir esta página" style="color:var(--orange);text-decoration:none;font-size:12px">↗</a>':'';return '<div class="pagecard"><div class="head"><span class="pname">'+label(p.page_name)+pl+'</span><span class="pstats">'+p.views+' views · '+p.uniques+' únicos · '+p.forms+' forms</span></div><canvas id="clk'+i+'" height="150"></canvas></div>'}).join("");
  pages.forEach(function(p,i){
    var rows=clicks.filter(function(c){return c.page_name===p.page_name}).slice(0,6);
    var labels=rows.map(function(c){return (c.element_id||c.element_text||"?").slice(0,22)});
    var vals=rows.map(function(c){return c.clicks});
    var ctx=document.getElementById("clk"+i); if(!ctx)return;
    if(!rows.length){ctx.parentNode.innerHTML+='<div class="empty">Sem cliques.</div>';return}
    clickCharts.push(new Chart(ctx,{type:"bar",data:{labels:labels,datasets:[{data:vals,backgroundColor:"#0b2d72",borderRadius:5}]},options:{indexAxis:"y",plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#6b7280"},grid:{color:"#eef0f3"}},y:{ticks:{color:"#6b7280"},grid:{display:false}}}}}));
  });
}

function renderLeads(d){
  lastLeads=d.leads||[];
  var n=lastLeads.length;
  document.getElementById("leadsTitle").textContent="Leads ("+n+")";
  var totalCredit=0, rdOk=0, metaOk=0;
  lastLeads.forEach(function(l){totalCredit+=Number(l.credit_value||0);if(l.rd_status==="ok")rdOk++;if(l.meta_status==="ok")metaOk++;});
  var lk=[["Total de leads",pretty(n),""],["Valor total solicitado",brl(totalCredit),"em crédito"],["Ticket médio",n?brl(Math.round(totalCredit/n)):"-","por lead"],["Entrega RD Station",rdOk+"/"+n,pct(rdOk,n)+"% no CRM"],["Entrega Meta CAPI",metaOk+"/"+n,pct(metaOk,n)+"% no Pixel"]];
  document.getElementById("leadKpis").innerHTML=lk.map(function(k){return '<div class="kpi"><div class="label">'+k[0]+'</div><div class="val">'+k[1]+'</div><div class="sub">'+k[2]+'</div></div>'}).join("");
  if(!n){document.getElementById("leads").innerHTML='<div class="empty">Nenhum lead para este filtro.</div>';return}
  var html='<table><thead><tr><th>Data</th><th>Nome</th><th>Telefone</th><th>Imóvel</th><th>Crédito</th><th>Origem</th><th>RD</th><th>Meta</th><th></th></tr></thead><tbody>';
  lastLeads.forEach(function(l,i){
    html+='<tr><td>'+(l.created_at||"").slice(0,16)+'</td><td>'+pretty(l.name)+'</td><td>'+pretty(l.phone)+'</td><td>'+pretty(l.property_type)+'</td><td>'+brl(l.credit_value)+'</td><td>'+pretty(l.utm_source||l.source||"direto")+'</td><td>'+badge(l.rd_status)+'</td><td>'+badge(l.meta_status)+'</td><td><button class="btn-sm" onclick="showLead('+i+')">Ver ficha</button></td></tr>';
  });
  document.getElementById("leads").innerHTML=html+'</tbody></table>';
}

function showLead(i){
  var l=lastLeads[i]; if(!l)return;
  document.getElementById("modalName").textContent=l.name||"Lead sem nome";
  document.getElementById("modalDate").textContent=(l.created_at||"").slice(0,16);
  var fields=[["Telefone",pretty(l.phone)],["E-mail",pretty(l.email)],["Tipo de imóvel",pretty(l.property_type)],["Valor do imóvel",brl(l.property_value)],["Crédito desejado",brl(l.credit_value)],["Origem (página)",label(l.source)],["utm_source",pretty(l.utm_source)],["utm_medium",pretty(l.utm_medium)],["utm_campaign",pretty(l.utm_campaign)],["RD Station",badge(l.rd_status)],["Meta CAPI",badge(l.meta_status)]];
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

function drawLine(id,labels,data){var ctx=document.getElementById(id);if(dailyChart)dailyChart.destroy();dailyChart=new Chart(ctx,{type:"line",data:{labels:labels,datasets:[{data:data,borderColor:"#f97316",backgroundColor:"rgba(249,115,22,.12)",fill:true,tension:.3,pointRadius:2,pointBackgroundColor:"#f97316"}]},options:{maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#6b7280"},grid:{color:"#eef0f3"}},y:{ticks:{color:"#6b7280"},grid:{color:"#eef0f3"}}}}})}
function drawDoughnut(id,labels,data){var ctx=document.getElementById(id);if(sourcesChart)sourcesChart.destroy();sourcesChart=new Chart(ctx,{type:"doughnut",data:{labels:labels,datasets:[{data:data,backgroundColor:CHART_PALETTE,borderColor:"#fff",borderWidth:2}]},options:{maintainAspectRatio:false,cutout:"60%",plugins:{legend:{position:"right",labels:{color:"#374151",font:{size:11}}}}}})}

document.getElementById("refresh").addEventListener("click",loadAll);
document.getElementById("rangeSel").addEventListener("change",loadAll);
document.getElementById("pageSel").addEventListener("change",loadAll);
document.getElementById("openPage").addEventListener("click",function(){var u=PAGE_URLS[currentPage()];if(u)window.open(u,"_blank","noopener");});
document.getElementById("csvBtn").addEventListener("click",exportCSV);
document.getElementById("modalClose").addEventListener("click",closeModal);
document.getElementById("leadModal").addEventListener("click",function(e){if(e.target.id==="leadModal")closeModal()});
showTab("overview");
loadAll();
</script>
</body>
</html>`;
