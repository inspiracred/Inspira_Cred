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

  // Login próprio (tela nossa) — o POST tem que rodar ANTES do guard de autenticação.
  if (sub === "/login" && request.method === "POST") return handleLogin(request, env);
  if (sub === "/logout") return handleLogout();

  if (!(await isAuthorized(request, env))) {
    // Página do dashboard devolve a TELA de login; API continua 401 seco.
    if ((sub === "/" || sub === "/dashboard" || sub === "/login") && request.method === "GET") {
      return loginPage(url.searchParams.get("erro") === "1");
    }
    return unauthorized();
  }

  if (sub === "/api/overview" && request.method === "GET") return handleOverview(request, env);
  if (sub === "/api/leads" && request.method === "GET") return handleLeads(request, env);
  if (sub === "/api/journey" && request.method === "GET") return handleJourney(request, env);
  if (sub === "/api/heatmap" && request.method === "GET") return handleHeatmap(request, env);
  if (sub === "/api/pagemap" && request.method === "GET") return handlePageMap(request, env);
  if (sub === "/api/campaigns" && request.method === "GET") return handleCampaigns(request, env);
  if (sub === "/api/health" && request.method === "GET") return handleHealth(request, env);
  if (sub === "/api/meta-test" && request.method === "GET") return handleMetaTest(request, env);
  // já logado tentando abrir a tela de login: manda direto pro painel
  if (sub === "/login" && request.method === "GET") {
    return new Response(null, { status: 303, headers: { Location: "/analytics/dashboard" } });
  }
  if ((sub === "/" || sub === "/dashboard") && request.method === "GET") {
    return new Response(DASHBOARD_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  return new Response("Not Found", { status: 404 });
}

/* ---- AUTH ----
 * Duas portas para a MESMA senha (`DASHBOARD_PASSWORD`):
 *   1) tela de login nossa -> cookie de sessão assinado (o caminho normal, no navegador)
 *   2) Basic Auth -> continua valendo, pra não quebrar link salvo/curl/monitoramento.
 * O cookie NÃO guarda a senha: é `expiração.assinatura`, com HMAC-SHA256 usando a
 * própria senha como chave. Sem a senha não dá pra forjar, e o token morre sozinho.
 */
const SESSION_COOKIE = "ic_dash";
// Marca "saiu no navegador". Existe por um motivo prático: quem já entrou pelo popup
// de Basic Auth alguma vez tem a senha guardada NO NAVEGADOR e o header vai junto em
// toda requisição, pra sempre. Sem esta marca, clicar em "Sair" limpava o cookie e o
// Basic cacheado logava de novo na hora — que é exatamente o que estava acontecendo.
// curl/monitoramento não mandam cookie, então continuam entrando por Basic normalmente.
const LOGOUT_COOKIE = "ic_out";
const SESSION_TTL = 60 * 60 * 12; // 12 horas

function setCookie(name, value, maxAge) {
  return name + "=" + value + "; Path=/analytics; Max-Age=" + maxAge + "; HttpOnly; Secure; SameSite=Lax";
}

async function hmacHex(key, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function makeSessionToken(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  return exp + "." + (await hmacHex(env.DASHBOARD_PASSWORD, "dash|" + exp));
}
async function sessionTokenOk(env, token) {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const exp = token.slice(0, dot), sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(sig, await hmacHex(env.DASHBOARD_PASSWORD, "dash|" + exp));
}

async function isAuthorized(request, env) {
  const pw = env.DASHBOARD_PASSWORD;
  if (!pw) return false;
  const cookies = parseCookies(request.headers.get("Cookie"));
  const cookie = cookies[SESSION_COOKIE];
  if (cookie && (await sessionTokenOk(env, cookie))) return true;
  // saiu de propósito neste navegador: ignora o Basic Auth que ficou em cache
  if (cookies[LOGOUT_COOKIE] === "1") return false;
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  let decoded = "";
  try { decoded = atob(header.slice(6)); } catch { return false; }
  return decoded.slice(decoded.indexOf(":") + 1) === pw;
}
function unauthorized() {
  // Sem WWW-Authenticate de propósito: é ele que faz o navegador abrir aquele popup
  // feio. Quem usa Basic manda o header direto e continua entrando normalmente.
  return new Response("Autenticação necessária", { status: 401 });
}

async function handleLogin(request, env) {
  let senha = "";
  try {
    const form = await request.formData();
    senha = String(form.get("senha") || "");
  } catch (e) { /* corpo inválido */ }
  if (!env.DASHBOARD_PASSWORD || !safeEqual(senha, env.DASHBOARD_PASSWORD)) {
    return new Response(null, { status: 303, headers: { Location: "/analytics/login?erro=1" } });
  }
  const token = await makeSessionToken(env);
  const h = new Headers({ Location: "/analytics/dashboard" });
  h.append("Set-Cookie", setCookie(SESSION_COOKIE, token, SESSION_TTL));
  h.append("Set-Cookie", setCookie(LOGOUT_COOKIE, "", 0)); // entrou: some a marca de saída
  return new Response(null, { status: 303, headers: h });
}
function handleLogout() {
  const h = new Headers({ Location: "/analytics/login" });
  h.append("Set-Cookie", setCookie(SESSION_COOKIE, "", 0));
  h.append("Set-Cookie", setCookie(LOGOUT_COOKIE, "1", SESSION_TTL));
  return new Response(null, { status: 303, headers: h });
}
function loginPage(erro) {
  return new Response(LOGIN_HTML.replace("<!--ERRO-->", erro ? '<p class="erro">Senha incorreta. Tente de novo.</p>' : ""), {
    status: erro ? 401 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const LOGIN_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>InspiraCred · Analytics</title>
<link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml"/>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--blue:#0b2d72;--blue-dark:#061a42;--orange:#f97316;--border:#e6e8ec;--muted:#6b7280}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    font-family:"Inter",-apple-system,Segoe UI,Roboto,sans-serif;color:#fff;
    background:radial-gradient(1100px 620px at 15% -10%,#12408f 0%,transparent 60%),linear-gradient(160deg,var(--blue-dark),#04122e 70%)}
  .card{width:100%;max-width:392px}
  .brand{font-family:"Instrument Sans","Inter",sans-serif;font-size:31px;font-weight:800;letter-spacing:-.03em;margin:0 0 4px}
  .brand span{color:var(--orange)}
  .sub{margin:0 0 26px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.55)}
  form{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.13);border-radius:20px;padding:24px;backdrop-filter:blur(9px)}
  h1{margin:0 0 6px;font-family:"Instrument Sans","Inter",sans-serif;font-size:20px;font-weight:800;letter-spacing:-.02em}
  p.lead{margin:0 0 20px;font-size:13.5px;line-height:1.5;color:rgba(255,255,255,.66)}
  label{display:block;font-size:11.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.6);margin-bottom:7px}
  input{width:100%;padding:13px 14px;border-radius:13px;border:1px solid rgba(255,255,255,.18);background:rgba(4,15,38,.55);color:#fff;font-size:15px;font-family:inherit}
  input:focus{outline:none;border-color:var(--orange);box-shadow:0 0 0 3px rgba(249,115,22,.22)}
  button{width:100%;margin-top:16px;padding:13px 16px;border:0;border-radius:13px;background:var(--orange);color:#fff;
    font-family:"Instrument Sans","Inter",sans-serif;font-size:15px;font-weight:800;cursor:pointer}
  button:hover{filter:brightness(1.06);box-shadow:0 10px 24px rgba(249,115,22,.32)}
  .erro{margin:14px 0 0;padding:10px 12px;border-radius:11px;background:rgba(239,68,68,.16);border:1px solid rgba(239,68,68,.35);font-size:13px;font-weight:600}
  .foot{margin:18px 2px 0;font-size:11.5px;color:rgba(255,255,255,.42);line-height:1.5}
</style>
</head>
<body>
  <div class="card">
    <p class="brand">Inspira<span>Cred</span></p>
    <p class="sub">Analytics</p>
    <form method="POST" action="/analytics/login">
      <h1>Acesso ao painel</h1>
      <p class="lead">Digite a senha de acesso para ver os dados de leads, campanhas e tráfego.</p>
      <label for="senha">Senha de acesso</label>
      <input id="senha" name="senha" type="password" autocomplete="current-password" autofocus required placeholder="••••••••"/>
      <button type="submit">Entrar</button>
      <!--ERRO-->
    </form>
    <p class="foot">Acesso restrito à equipe InspiraCred. A sessão fica ativa por 12 horas neste navegador.</p>
  </div>
</body>
</html>`;

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
        const leadCookies = parseCookies(request.headers.get("Cookie") || "");
        const leadUA = request.headers.get("User-Agent") || "";

        // Identidade de sessão server-side (Fase A): cookies setados no edge pelo
        // functions/_middleware.js. `_krob_eid` é o external_id ESTÁVEL do Meta
        // (por-pessoa, sobrevive à limpeza do localStorage); fallback pro session_id
        // do client pra leads em voo durante o rollout (antes de o visitante receber
        // o cookie). `_krob_sid` liga o lead à linha `sessions`.
        const krobSid = leadCookies._krob_sid || null;
        const krobEid = leadCookies._krob_eid || null;
        event.external_id = krobEid || event.session_id || null;

        // Fontes CRUAS de fbp/fbc/fbclid, capturadas ANTES de resolver (Fase B: saúde).
        //   body   = o que o navegador mandou (Pixel/cookie lido no client — track.js A.3)
        //   cookie = cookie de edge 400d (_middleware.js) — resgate ITP-safe
        //   session= linha `sessions` (fbp/fbc/fbclid do 1º acesso)
        const bodyFbp = validateFbCookie(event.fbp);
        const bodyFbc = validateFbCookie(event.fbc);
        const bodyFbclid = event.fbclid || "";
        const cookieFbp = validateFbCookie(leadCookies._fbp);
        const cookieFbc = validateFbCookie(leadCookies._fbc);

        // Enriquece com a origem CRUA capturada no 1º acesso: a linha `sessions` vence
        // quando o lead chegou sem o parâmetro (ex.: URL "limpa" antes do submit, ou
        // navegação interna que perdeu fbclid/UTM). try/catch: se a tabela `sessions`
        // ainda não existir (migration 0006 pendente), segue sem enriquecer.
        let s = null;
        if (krobSid) {
          try {
            s = await env.DB.prepare("SELECT * FROM sessions WHERE session_id = ?").bind(krobSid).first();
          } catch (e) { /* sessions ainda não existe (migration 0006 pendente) — ok */ }
        }
        const sessionFbp = s ? validateFbCookie(s.fbp) : "";
        const sessionFbc = s ? validateFbCookie(s.fbc) : "";

        // Resolve fbp/fbc pela cadeia body -> cookie -> session (melhor id disponível);
        // fbclid/gclid/UTMs herdam da sessão quando faltaram no lead.
        event.fbp = bodyFbp || cookieFbp || sessionFbp || "";
        event.fbc = bodyFbc || cookieFbc || sessionFbc || "";
        if (s) {
          if (!bodyFbclid && s.fbclid) event.fbclid = s.fbclid;
          if (!event.gclid && s.gclid) event.gclid = s.gclid;
          ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((k) => {
            if (!event[k] && s[k]) event[k] = s[k];
          });
        }

        // Sinais de saúde do tracking (Fase B) — gravados no UPDATE 0008 mais abaixo.
        const fbpSource = bodyFbp ? "body" : (cookieFbp ? "edge_cookie" : (sessionFbp ? "session" : "none"));
        const fbcSource = bodyFbc ? "body" : (cookieFbc ? "edge_cookie" : (sessionFbc ? "session" : "none"));
        const fbclidSource = bodyFbclid ? "url" : (s && s.fbclid ? "session" : "none");
        const pixelWasBlocked = (!bodyFbp && !bodyFbc) ? 1 : 0;
        const itpExtended = ((!bodyFbp && !!event.fbp) || (!bodyFbc && !!event.fbc)) ? 1 : 0;
        const bot = detectBot(leadUA);
        const uaInfo = parseBrowser(leadUA);
        const hasEmail = event.email ? 1 : 0;
        const hasPhone = event.phone ? 1 : 0;
        const hasName = event.name ? 1 : 0;

        event.lead_kind = normalizeLeadKind(event);

        const leadInsert = await env.DB.prepare(
          `INSERT INTO leads (session_id, name, phone, email, property_type, property_value, credit_value, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbp, fbc, fbclid, gclid, event_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(event.session_id || null, event.name || null, event.phone || null, event.email || null,
          event.property_type || null, event.property_value || null, event.credit_value || null,
          event.source || null, event.utm_source || null, event.utm_medium || null,
          event.utm_campaign || null, event.utm_content || null, event.utm_term || null,
          event.fbp || null, event.fbc || null, event.fbclid || null, event.gclid || null,
          event.event_id || null).run();
        const leadId = leadInsert.meta && leadInsert.meta.last_row_id;
        // Campos qualificadores no NOSSO D1 (pra o dado bater com o que vai pro RD).
        // UPDATE separado + try/catch: se a migration 0003 ainda não tiver criado as
        // colunas, ignora sem quebrar a captura do lead (o INSERT core acima já gravou).
        if (leadId) {
          try {
            await env.DB.prepare(
              `UPDATE leads SET imovel_quitado=?, documentacao_ok=?, situacao_imovel=?, saldo_devedor=?, possui_imovel=?, possui_matricula=?, faixa_credito=?, city=? WHERE id=?`
            ).bind(
              event.imovel_quitado || null, event.documentacao_ok || null, event.situacao_imovel || event.automovel_quitado || null,
              event.saldo_devedor != null ? String(event.saldo_devedor) : null, event.possui_imovel || null,
              event.possui_matricula || null, event.faixa_credito || null, event.city || null, leadId
            ).run();
          } catch (e) { /* colunas ainda não existem (migration 0003 pendente) — ok */ }
          // lead_kind (migration 0004) em UPDATE PRÓPRIO: se a coluna ainda não existir,
          // só isto falha — os qualificadores da 0003 acima continuam sendo gravados.
          try {
            await env.DB.prepare(`UPDATE leads SET lead_kind=? WHERE id=?`)
              .bind(event.lead_kind || null, leadId).run();
          } catch (e) { /* coluna lead_kind ainda não existe (migration 0004 pendente) — ok */ }
          // Saúde do tracking (migration 0005): de onde vieram fbp/fbc usados na CAPI.
          try {
            await env.DB.prepare(`UPDATE leads SET fbp_source=?, fbc_source=? WHERE id=?`)
              .bind(fbpSource, fbcSource, leadId).run();
          } catch (e) { /* colunas ainda não existem (migration 0005 pendente) — ok */ }
          // Liga o lead à linha `sessions` (migration 0007). UPDATE próprio: se a coluna
          // ainda não existir, só isto falha — o resto do lead já foi gravado.
          try {
            await env.DB.prepare(`UPDATE leads SET krob_sid=? WHERE id=?`).bind(krobSid, leadId).run();
          } catch (e) { /* coluna krob_sid ainda não existe (migration 0007 pendente) — ok */ }
          // Saúde do tracking completa (migration 0008): fonte de fbclid, pixel bloqueado,
          // resgate ITP, bot, navegador/os e cobertura de PII. UPDATE próprio try/catch.
          try {
            await env.DB.prepare(
              `UPDATE leads SET fbclid_source=?, pixel_was_blocked=?, itp_cookie_extended=?, is_bot=?, bot_reason=?, browser=?, os=?, is_mobile=?, has_email=?, has_phone=?, has_name=? WHERE id=?`
            ).bind(
              fbclidSource, pixelWasBlocked, itpExtended, bot.isBot ? 1 : 0, bot.botReason || null,
              uaInfo.browser, uaInfo.os, uaInfo.isMobile ? 1 : 0, hasEmail, hasPhone, hasName, leadId
            ).run();
          } catch (e) { /* colunas 0008 ainda não existem — ok */ }
          if (context) context.waitUntil(recordMetaEventAudit(env, event, leadId));
          else await recordMetaEventAudit(env, event, leadId);
        }
        if (leadId && context) {
          const sendsToRD = shouldSendLeadToRD(event.lead_kind);
          const hasExplicitMetaEvents = Array.isArray(event.meta_events);
          const sendsToMeta = !hasExplicitMetaEvents || event.meta_events.length > 0;

          if (sendsToRD) {
            context.waitUntil(sendLeadToRD(event, env, leadId));
          } else {
            context.waitUntil(markLeadStatus(env, leadId, "rd_status", "nao_enviado"));
          }

          // Filtro de bot (Fase B): crawler (WhatsApp/Slack/Facebook/curl/headless…) NÃO
          // vai pra CAPI — não polui o Pixel/otimização. O lead já foi salvo no D1 com
          // is_bot=1 (métrica de saúde correta). O RD NÃO é gateado por bot de propósito:
          // dropar um lead real por falso-positivo de UA no CRM custa mais que um bot raro.
          if (!sendsToMeta) {
            context.waitUntil(markLeadStatus(env, leadId, "meta_status", "nao_enviado"));
          } else if (!bot.isBot) {
            context.waitUntil(sendLeadToMeta(event, env, leadId, {
              clientIp: request.headers.get("CF-Connecting-IP") || "",
              userAgent: leadUA,
              sourceUrl: event.url || request.headers.get("Referer") || "",
            }));
          } else {
            try { await env.DB.prepare(`UPDATE leads SET meta_status=? WHERE id=?`).bind("bot_skip", leadId).run(); } catch (e) {}
          }
        }
        break;
      }
      case "event":
        await env.DB.prepare(
          `INSERT INTO events (session_id, event_type, event_name, properties, page_name) VALUES (?,?,?,?,?)`
        ).bind(event.session_id, event.event_type || "custom", event.event_name || "custom",
          JSON.stringify(event.properties || {}), event.page_name || null).run();
        if (event.meta_event_name && context) {
          const eventCookies = parseCookies(request.headers.get("Cookie") || "");
          const eventUA = request.headers.get("User-Agent") || "";
          const bot = detectBot(eventUA);
          if (!bot.isBot) {
            event.external_id = eventCookies._krob_eid || event.session_id || null;
            event.fbp = validateFbCookie(event.fbp) || validateFbCookie(eventCookies._fbp) || "";
            event.fbc = validateFbCookie(event.fbc) || validateFbCookie(eventCookies._fbc) || "";
            context.waitUntil(sendCustomEventToMeta(event, env, {
              clientIp: request.headers.get("CF-Connecting-IP") || "",
              userAgent: eventUA,
              sourceUrl: event.url || request.headers.get("Referer") || "",
            }));
          }
        }
        break;
      case "tap":
        await env.DB.prepare(
          `INSERT INTO heatmap_taps (session_id, page_name, x_pct, y_pct, vw, doc_h, element_id) VALUES (?,?,?,?,?,?,?)`
        ).bind(event.session_id, event.page_name || "other", event.x_pct, event.y_pct,
          event.vw || null, event.doc_h || null, event.element_id || null).run();
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
 * cliente — pra não misturar relatório. (O marcador `cf_variante_pagina` que a gente
 * mandava antes NUNCA chegou a existir como campo na conta — o RD descartava
 * silenciosamente; removido. Diferenciar variante hoje é só por `identificador`/UTM.)
 */
const RD_PAGE_CONFIG = {
  landing_page: { identificador: "Simulação", label: "Simulação" },
  home_equity_lp: { identificador: "Home Equity", label: "Home Equity" },
  home_equity_form: { identificador: "Typeform", label: "Typeform" },
};

// Rótulo legível da classificação — vai no campo de Lead cf_classificacao_lead.
// Baixo valor também vai ao RD como lead não qualificado; descarte fica só no D1.
const LEAD_KIND_LABEL = {
  home_equity: "Lead",
  home_equity_mql: "Lead qualificado",
  auto: "Lead automotivo",
  baixo_valor: "Lead desqualificado",
  descarte: "Banco de dados — não qualificado",
};

function normalizeLeadKind(event) {
  const current = event.lead_kind || "";
  if (current === "auto") return "auto";
  if (current === "descarte") return "descarte";

  const credit = Number(event.credit_value || 0);
  const property = Number(event.property_value || 0);
  const docsOk =
    event.documentacao_ok === "Sim" ||
    event.possui_matricula === "Sim" ||
    event.possui_matricula === "sim" ||
    event.situacao_imovel === "Quitado";

  if (!docsOk || credit < 200000 || property < 400000) return "baixo_valor";
  if (credit >= 500000 && property >= 1000000) return "home_equity_mql";
  if (credit >= 200000 && property >= 400000) return "home_equity";
  return "baixo_valor";
}

function shouldSendLeadToRD(kind) {
  return kind === "home_equity" || kind === "home_equity_mql" || kind === "auto" || kind === "baixo_valor";
}

async function markLeadStatus(env, leadId, column, status) {
  if (column !== "rd_status" && column !== "meta_status") return;
  try {
    await env.DB.prepare(`UPDATE leads SET ${column} = ? WHERE id = ?`).bind(status, leadId).run();
  } catch (e) { /* não derruba captura */ }
}

async function recordMetaEventAudit(env, event, leadId) {
  const raw = Array.isArray(event.meta_events)
    ? event.meta_events
    : (event.meta_events === undefined ? [{ name: "Lead", event_id: event.event_id }] : []);
  if (!raw.length) return;
  for (const item of raw) {
    const name = typeof item === "string" ? item : item && item.name;
    if (!name) continue;
    const eventId = typeof item === "string" ? event.event_id : item.event_id;
    try {
      await env.DB.prepare(
        `INSERT INTO events (session_id, event_type, event_name, properties, page_name) VALUES (?,?,?,?,?)`
      ).bind(
        event.session_id || null,
        "meta",
        name,
        JSON.stringify({ lead_id: leadId || null, lead_kind: event.lead_kind || null, event_id: eventId || null, channel: "pixel_capi" }),
        event.source || event.page_name || "lead"
      ).run();
    } catch (e) { /* auditoria não pode derrubar captura */ }
  }
}

// Identificador do RD por PÁGINA. O tipo do lead vai separado por tag +
// cf_classificacao_lead, pra não misturar página de origem com classificação.
function rdIdentificador(cfg) {
  return cfg.identificador;
}

async function sendLeadToRD(event, env, leadId) {
  const cfg = RD_PAGE_CONFIG[event.source];
  if (!cfg || !env.RD_STATION_TOKEN) return; // fonte desconhecida ou token não configurado

  // O client sempre manda event.phone já com "+55" -> replace(/\D/g,"") deixa o "55"
  // embutido nos dígitos. Removê-lo aqui (se sobrar >11 dígitos começando com 55) evita
  // duplicar o DDI ao remontar "+55..." abaixo (bug que gerava telefone "+555521999998888").
  const rawDigits = (event.phone || "").replace(/\D/g, "");
  const phoneDigits = rawDigits.length > 11 && rawDigits.startsWith("55") ? rawDigits.slice(2) : rawDigits;
  const str = (v) => (v != null && v !== "" ? String(v) : undefined);
  // Deriva a faixa de crédito (texto legível) a partir do valor numérico — usada nas
  // páginas que não têm o passo de faixa (landing/home equity) pra alimentar o campo
  // de Lead "Qual valor você está buscando?" que o CRM mapeia p/ a Negociação "Valor Pretendido".
  const faixaFromCredit = (v) => {
    const n = Number(v);
    if (!n || isNaN(n)) return undefined;
    if (n < 200000) return "Menos de R$ 200 mil";
    if (n < 500000) return "De R$ 200 mil a R$ 500 mil";
    if (n < 900000) return "De R$ 500 mil a R$ 900 mil";
    return "Acima de R$ 900 mil";
  };
  // "Imóvel Quitado?" (Sim/Não) p/ o campo de Lead cf_imovel_quitado — TEXTO LIVRE que
  // a Combinação de Campos do CRM mapeia p/ a Negociação "Imóvel Quitado?" (também texto).
  // ⚠️ Tem que ser TEXTO nos dois lados: o RD só mapeia campos de MESMO tipo, então o
  // picklist "Situação atual no imóvel" (seleção única) NÃO serve p/ preencher o card.
  // Normaliza p/ Sim/Não consistente nas 2 páginas que perguntam sobre a quitação:
  //   • landing: "Seu imóvel está quitado?" já vem "Sim"/"Não" (event.imovel_quitado)
  //   • home equity: "Situação do imóvel" vem "Quitado"/"Financiado" (event.situacao_imovel)
  const imovelQuitado = (() => {
    if (event.imovel_quitado === "Sim" || event.imovel_quitado === "Não") return event.imovel_quitado;
    if (event.automovel_quitado === "Sim" || event.automovel_quitado === "Não") return event.automovel_quitado;
    if (event.situacao_imovel === "Quitado") return "Sim";
    if (event.situacao_imovel === "Financiado") return "Não";
    if (event.automovel_quitado === "Quitado") return "Sim";
    if (event.automovel_quitado === "Financiado") return "Não";
    return undefined;
  })();
  const payload = {
    token_rdstation: env.RD_STATION_TOKEN,
    identificador: rdIdentificador(cfg),
    tags: event.lead_kind === "auto"
      ? ["lead automóvel"]
      : (event.lead_kind === "baixo_valor" ? ["lead não qualificado"] : undefined),
    nome: event.name || undefined,
    email: event.email || (phoneDigits ? `${phoneDigits}@lead.inspiracred.com.br` : undefined),
    telefone: phoneDigits ? `+55${phoneDigits}` : undefined,
    // Campos personalizados (cf_*): identificadores CONFIRMADOS na conta do cliente (lidos
    // em RD Station > Configurações > Campos personalizados, 2026-07-15 — lista de 25).
    // ⚠️ Antes mandávamos identificadores INVENTADOS (cf_tipo_imovel, cf_valor_imovel,
    // cf_valor_emprestimo_desejado, cf_faixa_credito, cf_possui_imovel,
    // cf_imovel_com_matricula, cf_cidade, cf_saldo_devedor, cf_variante_pagina) que não
    // existiam na conta — a API do RD ignora silenciosamente cf_* desconhecido (não cria
    // campo novo, só descarta). É por isso que só nome/e-mail/telefone chegavam.
    // Estes 4 alimentam campos que o CRM mapeia p/ a NEGOCIAÇÃO (Combinação de Campos):
    //   cf_qual_o_tipo_do_seu_imovel   -> Negociação "Qual o tipo do seu imóvel?"
    //   cf_avaliacao_do_imovel         -> Negociação "Valor Imóvel"
    //   cf_qual_valor_voce_esta_buscando -> Negociação "Valor Pretendido"
    //   cf_seu_imovel_possui_matricula -> Negociação "Documentação ok?"
    // Por isso mandamos o valor/faixa/documentação em TODAS as páginas (não só no multi-step).
    cf_qual_o_tipo_do_seu_imovel: str(event.property_type),
    cf_valor_aproximado_do_imovel: str(event.property_value),
    cf_avaliacao_do_imovel: str(event.property_value),           // mesmo valor; é este campo que o CRM lê p/ "Valor Imóvel" da Negociação
    cf_valor_de_emprestimo_desejado: str(event.credit_value),
    cf_qual_valor_voce_esta_buscando: str(event.faixa_credito) || faixaFromCredit(event.credit_value), // faixa: multi-step manda pronto; landing/HE deriva do valor
    cf_voce_possui_imovel: str(event.possui_imovel),             // formulário multi-step: Sim/Não
    cf_seu_imovel_possui_matricula: str(event.possui_matricula) || str(event.documentacao_ok), // multi-step: matrícula; landing: documentação (mesma pergunta na Negociação "Documentação ok?")
    cf_whatsapp_com_ddd: phoneDigits || undefined,               // duplica o telefone (campo próprio da conta)
    cf_anuncio: str(event.utm_content),                          // nome do anúncio/criativo (utm_content = {{ad.name}} do Meta) — campo "Anúncio"/cf_anuncio criado na conta 2026-07-16
    // "Imóvel Quitado?" (cf_imovel_quitado, TEXTO) — campo de Lead criado 2026-07-17 que a
    // Combinação de Campos do CRM mapeia p/ a Negociação "Imóvel Quitado?" (texto->texto).
    // Sim/Não vindo da landing ("está quitado?") e da HE ("situação"->Sim/Não). Ver helper acima.
    cf_imovel_quitado: imovelQuitado,
    // "cidade" — campo PADRÃO do RD (nome de API "city", não é cf_*). Vem do multi-step.
    city: str(event.city),
    // saldo_devedor (landing) segue sem campo correspondente no RD — fica só no nosso D1.
    traffic_source: event.utm_source || undefined,
    traffic_medium: event.utm_medium || undefined,
    traffic_campaign: event.utm_campaign || undefined,
    // Classificação do lead (pivô 2026-07-22) — TEXTO, pra equipe ver/filtrar dentro do
    // RD. ⚠️ Depende de existir um campo de Lead com identificador EXATO
    // "cf_classificacao_lead" na conta (senão o RD ignora silenciosamente, como sempre
    // faz com cf_* desconhecido) — confirmar/criar antes de contar com isso no card.
    cf_classificacao_lead: LEAD_KIND_LABEL[event.lead_kind] || undefined,
    // UTMs individuais em campos de Lead PRÓPRIOS (além de traffic_source/medium/campaign
    // nativos acima). Os nativos traffic_* NÃO sobem pra Negociação — só campo de Lead
    // personalizado é mapeável na "Combinação de Campos" (De→Para, texto→texto). Por isso
    // o card da Negociação vinha com UTM vazio.
    // ✅ Identificadores CONFERIDOS ao vivo na conta do cliente (RD > Converter > Campos
    // personalizados, 2026-07-23): cf_utm_source, cf_utm_medium, cf_utm_campaign,
    // cf_utm_content, cf_utm_term — os 5 existem. NUNCA usar o ID interno hex do campo:
    // a API de conversão só aceita o "identificador" cf_*, e descarta em silêncio o resto.
    cf_utm_source: str(event.utm_source),
    cf_utm_medium: str(event.utm_medium),
    cf_utm_campaign: str(event.utm_campaign),
    // ⚠️ cf_utm_content É NECESSÁRIO: o cf_anuncio (acima) é um campo SEPARADO ("Anúncio").
    // Mandar só pro cf_anuncio deixava o campo "UTM Content" da Negociação vazio.
    cf_utm_content: str(event.utm_content),
    cf_utm_term: str(event.utm_term),
    // "Formulário de Origem" — campo de Lead CRIADO em 2026-07-23 + mapeado pra Negociação.
    // ⚠️ O identificador tem "de": `cf_formulario_de_origem` (o RD gera o slug a partir do
    // nome e MANTÉM as preposições). Enviar `cf_formulario_origem` seria descartado em
    // silêncio. Valor legível = Simulação / Home Equity / Typeform.
    cf_formulario_de_origem: str(cfg.label || event.source),
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

// Valida o formato do cookie _fbp/_fbc do Meta (fb.{index}.{ts}.{payload}); retorna ""
// se malformado, pra não mandar lixo pra CAPI. Portado de krob-tracking-stack/tracker.js.
function validateFbCookie(value) {
  if (!value) return "";
  const parts = String(value).split(".");
  if (parts.length < 4 || parts.length > 5) return "";
  if (parts[0] !== "fb") return "";
  if (!/^\d+$/.test(parts[1])) return "";
  if (!/^\d+$/.test(parts[2])) return "";
  if (!parts[3]) return "";
  return value;
}

// Detecta crawler/bot por User-Agent (WhatsApp/Slack/Facebook/curl/headless…). Bot NÃO
// vai pra CAPI (não polui o Pixel). Portado de krob-tracking-stack/tracker.js.
function detectBot(userAgent) {
  if (!userAgent || userAgent.length < 10) return { isBot: true, botReason: "UA ausente ou curto" };
  const patterns = [
    { p: /googlebot|google-inspectiontool/i, r: "Googlebot" },
    { p: /bingbot|msnbot/i, r: "Bingbot" },
    { p: /facebookexternalhit|facebot/i, r: "Facebook crawler" },
    { p: /twitterbot/i, r: "Twitter crawler" },
    { p: /linkedinbot/i, r: "LinkedIn crawler" },
    { p: /slackbot/i, r: "Slackbot" },
    { p: /whatsapp/i, r: "WhatsApp preview" },
    { p: /bot|crawler|spider|scraper|headless/i, r: "Bot genérico" },
    { p: /python-requests|axios|node-fetch|curl|wget|httpie/i, r: "Lib HTTP" },
    { p: /phantomjs|selenium|puppeteer|playwright/i, r: "Automação" },
  ];
  for (const { p, r } of patterns) if (p.test(userAgent)) return { isBot: true, botReason: r };
  return { isBot: false, botReason: "" };
}

// Parse leve de navegador/OS/mobile a partir do UA. Portado de krob-tracking-stack.
function parseBrowser(ua) {
  const r = { browser: "Desconhecido", os: "Desconhecido", isMobile: false };
  if (!ua) return r;
  r.isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  if (/Edg\//i.test(ua)) r.browser = "Edge";
  else if (/OPR\//i.test(ua)) r.browser = "Opera";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) r.browser = "Chrome";
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) r.browser = "Safari";
  else if (/Firefox\//i.test(ua)) r.browser = "Firefox";
  if (/Windows/i.test(ua)) r.os = "Windows";
  else if (/Mac OS X/i.test(ua)) r.os = "macOS";
  else if (/iPhone|iPad/i.test(ua)) r.os = "iOS";
  else if (/Android/i.test(ua)) r.os = "Android";
  else if (/Linux/i.test(ua)) r.os = "Linux";
  return r;
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
  // external_id estável: _krob_eid (cookie de edge) resolvido no case "lead"; fallback
  // pro session_id do client pra leads em voo durante o rollout (antes do cookie existir).
  const ext = await sha256Hex(event.external_id || event.session_id);
  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  if (hfn) userData.fn = [hfn];
  if (hln) userData.ln = [hln];
  if (ext) userData.external_id = [ext];

  // Um lead pode disparar 1+ eventos (ex.: MQL = "Lead" + "LeadQualificado").
  // O client manda meta_events = [{name, event_id}] — reenviamos CADA um pela CAPI
  // com o MESMO event_id que o Pixel usou, pra o Meta deduplicar par a par. Array
  // VAZIO é válido e intencional (lead "descarte": não deve contar como conversão
  // de ads) — testa Array.isArray, NÃO .length, senão [] cai no fallback errado.
  // Fallback: só leads antigos/sem meta_events (campo ausente) viram um "Lead" solto.
  const metaEvents = Array.isArray(event.meta_events)
    ? event.meta_events
    : [{ name: "Lead", event_id: event.event_id }];
  if (!metaEvents.length) return; // nenhum evento pra este lead (por design) — não chama a API
  const eventTime = Math.floor(Date.now() / 1000);
  const customData = {
    currency: "BRL",
    value: event.credit_value != null ? Number(event.credit_value) : undefined,
    content_category: event.property_type || undefined,
  };
  const payload = {
    data: metaEvents.map((ev) => ({
      event_name: ev.name || "Lead",
      event_time: eventTime,
      event_id: ev.event_id || event.event_id || undefined,
      event_source_url: ctx.sourceUrl || undefined,
      action_source: "website",
      user_data: userData,
      custom_data: customData,
    })),
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

async function sendCustomEventToMeta(event, env, ctx) {
  if (!env.META_PIXEL_ID || !env.META_ACCESS_TOKEN || !event.meta_event_name) return;

  let fbc = event.fbc || "";
  if (!fbc && event.fbclid) fbc = `fb.2.${Date.now()}.${event.fbclid}`;

  const userData = {
    client_ip_address: ctx.clientIp || undefined,
    client_user_agent: ctx.userAgent || undefined,
    fbp: event.fbp || undefined,
    fbc: fbc || undefined,
  };
  const ext = await sha256Hex(event.external_id || event.session_id);
  if (ext) userData.external_id = [ext];

  const customData = {};
  const props = event.properties && typeof event.properties === "object" ? event.properties : {};
  Object.keys(props).forEach((key) => {
    const value = props[key];
    if (value == null) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      customData[key] = value;
    }
  });

  const payload = {
    data: [{
      event_name: event.meta_event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: event.event_id || undefined,
      event_source_url: ctx.sourceUrl || undefined,
      action_source: "website",
      user_data: userData,
      custom_data: customData,
    }],
  };
  if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;

  try {
    await fetch(
      `https://graph.facebook.com/v21.0/${env.META_PIXEL_ID}/events?access_token=${env.META_ACCESS_TOKEN}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
  } catch (e) {
    // evento de funil não derruba a coleta nem o lead
  }
}

/* ---- MÉTRICAS ---- */
/* `src` = filtro GLOBAL de origem (utm_source), aplicado no dashboard inteiro. O padrão
 * do painel é `meta_ads` porque é onde o cliente investe; dá pra trocar pra "todas".
 * ⚠️ Só vale pro que tem origem gravada: LEADS e SESSÕES. page_views/clicks/events são
 * chaveados pelo id de sessão do navegador (ic_sid) e não guardam UTM — por isso as
 * métricas de tráfego não filtram, e o dashboard avisa isso na tela em vez de mentir.
 */
function params(url) {
  const p = new URL(url).searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const past = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const pageRaw = p.get("page");
  const srcRaw = p.get("src");
  return {
    start: p.get("start") || past,
    end: p.get("end") || today,
    page: pageRaw && pageRaw !== "all" ? pageRaw : null,
    src: srcRaw && srcRaw !== "all" ? srcRaw : null,
  };
}
// trecho de SQL + binds para o filtro de origem sobre a tabela `leads`
const SRC_EXPR = "COALESCE(NULLIF(utm_source,''),'direto')";

async function handleOverview(request, env) {
  const { start, end, page, src } = params(request.url);
  const pv = page ? " AND page_name = ?" : "";   // filtro por página (page_views/clicks/forms/events)
  // leads: filtra por página (coluna source) E por origem (utm_source), quando pedido
  const sc = (page ? " AND source = ?" : "") + (src ? ` AND ${SRC_EXPR} = ?` : "");
  const bp = page ? [start, end, page] : [start, end];
  const bs = [start, end].concat(page ? [page] : []).concat(src ? [src] : []);

  const one = async (sql, b) => (await env.DB.prepare(sql).bind(...b).first()) || {};
  const many = async (sql, b) => (await env.DB.prepare(sql).bind(...b).all()).results || [];

  const [visitors, simStart, simComplete, leadsN, pages, forms, clicks, sources, daily, eventRows, leadKindRows] = await Promise.all([
    one(`SELECT COUNT(DISTINCT session_id) n FROM page_views WHERE DATE(created_at) BETWEEN ? AND ?${pv}`, bp),
    one(`SELECT COUNT(DISTINCT session_id) n FROM events WHERE event_name='simulation_start' AND DATE(created_at) BETWEEN ? AND ?${pv}`, bp),
    one(`SELECT COUNT(DISTINCT session_id) n FROM events WHERE event_name='simulation_complete' AND DATE(created_at) BETWEEN ? AND ?${pv}`, bp),
    one(`SELECT COUNT(*) n FROM leads WHERE DATE(created_at) BETWEEN ? AND ?${sc}`, bs),
    many(`SELECT page_name, COUNT(*) views, COUNT(DISTINCT session_id) uniques FROM page_views WHERE DATE(created_at) BETWEEN ? AND ?${pv} GROUP BY page_name ORDER BY views DESC`, bp),
    many(`SELECT page_name, COUNT(*) n FROM form_submissions WHERE success=1 AND DATE(created_at) BETWEEN ? AND ?${pv} GROUP BY page_name`, bp),
    many(`SELECT page_name, element_id, element_text, COUNT(*) clicks FROM clicks WHERE DATE(created_at) BETWEEN ? AND ?${pv} GROUP BY page_name, element_id, element_text ORDER BY clicks DESC`, bp),
    many(`SELECT COALESCE(NULLIF(utm_source,''),'direto') source, COUNT(*) n FROM leads WHERE DATE(created_at) BETWEEN ? AND ?${sc} GROUP BY source ORDER BY n DESC`, bs),
    many(`
      SELECT d, SUM(v) v, SUM(l) l FROM (
        SELECT DATE(created_at) d, COUNT(DISTINCT session_id) v, 0 l
        FROM page_views WHERE DATE(created_at) BETWEEN ? AND ?${pv} GROUP BY d
        UNION ALL
        SELECT DATE(created_at) d, 0 v, COUNT(*) l
        FROM leads WHERE DATE(created_at) BETWEEN ? AND ?${sc} GROUP BY d
      ) GROUP BY d ORDER BY d
    `, bp.concat(bs)),
    many(`SELECT event_type, event_name, COUNT(*) n, COUNT(DISTINCT session_id) sessions FROM events WHERE DATE(created_at) BETWEEN ? AND ?${pv} GROUP BY event_type, event_name ORDER BY n DESC`, bp),
    many(`SELECT COALESCE(NULLIF(lead_kind,''),'sem_classificacao') kind, COUNT(*) n, SUM(CASE WHEN rd_status='ok' THEN 1 ELSE 0 END) rd_ok, SUM(CASE WHEN meta_status='ok' THEN 1 ELSE 0 END) meta_ok, SUM(CASE WHEN meta_status='nao_enviado' THEN 1 ELSE 0 END) meta_skip, SUM(COALESCE(credit_value,0)) credit FROM leads WHERE DATE(created_at) BETWEEN ? AND ?${sc} GROUP BY kind ORDER BY n DESC`, bs),
  ]);

  const formsByPage = {};
  forms.forEach((f) => { formsByPage[f.page_name] = f.n; });
  const pagesOut = pages.map((p) => ({ page_name: p.page_name, views: p.views, uniques: p.uniques, forms: formsByPage[p.page_name] || 0 }));

  // Com filtro de origem ligado, a VISITA passa a sair da tabela `sessions` (é a única
  // que grava utm_source por acesso). As etapas do meio do funil (simulação iniciada/
  // concluída) vivem em `events`, que não tem origem — então viram null e a tela mostra
  // o funil curto (visita → lead) em vez de misturar número filtrado com não filtrado.
  let v = visitors.n || 0, ss = simStart.n || 0, scv = simComplete.n || 0;
  const ld = leadsN.n || 0;
  let dailyOut = daily;
  if (src) {
    ss = null; scv = null;
    try {
      const sw = `WHERE DATE(created_at,'unixepoch') BETWEEN ? AND ? AND ${SRC_EXPR} = ?`;
      const sv = await env.DB.prepare(`SELECT COUNT(*) n FROM sessions ${sw}`).bind(start, end, src).first();
      v = (sv && sv.n) || 0;
      const sd = (await env.DB.prepare(
        `SELECT DATE(created_at,'unixepoch') d, COUNT(*) n FROM sessions ${sw} GROUP BY d ORDER BY d`
      ).bind(start, end, src).all()).results || [];
      const leadsByDay = {};
      daily.forEach((r) => { leadsByDay[r.d] = r.l || 0; });
      const dias = {};
      sd.forEach((r) => { dias[r.d] = { d: r.d, v: r.n || 0, l: leadsByDay[r.d] || 0 }; });
      Object.keys(leadsByDay).forEach((d) => { if (!dias[d]) dias[d] = { d, v: 0, l: leadsByDay[d] }; });
      dailyOut = Object.keys(dias).sort().map((d) => dias[d]);
    } catch (e) { /* sessions ausente: mantém o que veio de page_views */ }
  }
  const pct = (a, base) => (base && a != null ? +((a / base) * 100).toFixed(1) : 0);

  return json({
    range: { start, end }, page: page || "all", src: src || "all",
    visits_from_sessions: !!src,
    totals: { visitors: v, sim_start: ss, sim_complete: scv, leads: ld },
    rates: { visitor_to_start: pct(ss, v), start_to_complete: pct(scv, ss), complete_to_lead: pct(ld, scv), visitor_to_lead: pct(ld, v) },
    pages: pagesOut, clicks, sources, daily: dailyOut,
    events_summary: eventRows,
    lead_kind_summary: leadKindRows,
  });
}

async function handleLeads(request, env) {
  const { start, end } = params(request.url);
  const p = new URL(request.url).searchParams;
  const limit = Math.min(parseInt(p.get("limit")) || 100, 500);
  const pageRaw = p.get("page");
  const page = pageRaw && pageRaw !== "all" ? pageRaw : null;
  // kind=nao_qualificado -> lead_kind IN baixo_valor/descarte; baixo_valor vai ao RD
  // como não qualificado, descarte fica só no nosso D1. kind=<valor específico> filtra
  // por um lead_kind exato.
  const kind = p.get("kind");
  // Colunas base + qualificadores (migration 0003). Se as colunas novas ainda não
  // existirem no D1, o 1º SELECT falha e caímos no fallback com as colunas antigas —
  // o dashboard nunca quebra por causa de migration pendente.
  const BASE = `id, session_id, name, phone, email, property_type, property_value, credit_value, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, rd_status, meta_status, created_at`;
  const QUAL = `, imovel_quitado, documentacao_ok, situacao_imovel, saldo_devedor, possui_imovel, possui_matricula, faixa_credito, city, lead_kind, fbp_source, fbc_source`;
  const conds = [];
  const binds = [start, end];
  conds.push(`DATE(created_at) BETWEEN ? AND ?`);
  if (page) { conds.push(`source = ?`); binds.push(page); }
  { const { src } = params(request.url); if (src) { conds.push(`${SRC_EXPR} = ?`); binds.push(src); } }
  if (kind === "nao_qualificado") conds.push(`lead_kind IN ('baixo_valor','descarte')`);
  else if (kind) { conds.push(`lead_kind = ?`); binds.push(kind); }
  const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : ``;
  const tail = ` ORDER BY created_at DESC LIMIT ?`;
  binds.push(limit);
  let rows;
  try {
    rows = (await env.DB.prepare(`SELECT ${BASE}${QUAL} FROM leads${where}${tail}`).bind(...binds).all()).results || [];
  } catch (e) {
    // fallback sem QUAL (colunas da migration 0003 pendente) — mas se o filtro pedir
    // lead_kind (migration 0004), não tem como cair pro fallback sem quebrar o filtro;
    // nesse caso devolve vazio em vez de ignorar o filtro (evita misturar qualificados).
    if (kind) { rows = []; }
    else rows = (await env.DB.prepare(`SELECT ${BASE} FROM leads${where}${tail}`).bind(...binds).all()).results || [];
  }
  return json({ leads: rows, count: rows.length });
}

/* ---- CAMPANHAS (hierarquia igual à do Gerenciador de Anúncios do Meta) ----
 * Os 3 níveis do Meta chegam pra gente pelas UTMs dos anúncios (ver CLAUDE.md):
 *   utm_campaign = CAMPANHA · utm_medium = CONJUNTO · utm_content = ANÚNCIO ({{ad.name}}).
 * Devolvemos as combinações CRUAS (uma linha por src/camp/med/cont) e o dashboard
 * agrega no nível que o usuário está olhando — assim a navegação campanha → conjunto
 * → anúncio é instantânea, sem refetch a cada clique.
 *
 * VISITAS vêm da tabela `sessions` (cookie de edge `_krob_sid`, Fase A): é o que
 * permite calcular taxa de conversão por campanha/conjunto/anúncio. Duas ressalvas
 * honestas, devolvidas na resposta pro dashboard avisar em vez de mentir:
 *   - `visits_since`: sessions só existe a partir do deploy da Fase A (22/07/2026);
 *     período anterior a isso tem lead sem visita e a taxa fica inflada.
 *   - `visits_page_scoped: false`: sessão é do SITE, não de uma página — com filtro
 *     de página ligado, os leads filtram mas as visitas não.
 * NÃO temos gasto/CPA/impressão/idade/gênero: isso exige `ads_read` na conta de
 * anúncios do cliente, que segue bloqueado (CLAUDE.md). O painel de público usa o
 * que É nosso: dispositivo, navegador, cidade, faixa de crédito e tipo de imóvel.
 */
async function handleCampaigns(request, env) {
  const { start, end, page } = params(request.url);
  const sc = page ? " AND source = ?" : "";
  const b = page ? [start, end, page] : [start, end];
  const many = async (sql) => (await env.DB.prepare(sql).bind(...b).all()).results || [];
  const manyS = async (sql) => (await env.DB.prepare(sql).bind(start, end).all()).results || [];

  const SRC = "COALESCE(NULLIF(utm_source,''),'direto')";
  const CAMP = "COALESCE(NULLIF(utm_campaign,''),'(sem campanha)')";
  const CONT = "COALESCE(NULLIF(utm_content,''),'(sem criativo)')";
  const MED = "COALESCE(NULLIF(utm_medium,''),'(sem conjunto)')";
  const WHERE = `WHERE DATE(created_at) BETWEEN ? AND ?${sc}`;
  // sessions.created_at é INTEGER (unix seconds) — precisa do 'unixepoch'.
  const SWHERE = `WHERE DATE(created_at,'unixepoch') BETWEEN ? AND ?`;
  const AGG = `COUNT(*) leads,
               SUM(CASE WHEN lead_kind='home_equity_mql' THEN 1 ELSE 0 END) mql,
               SUM(CASE WHEN lead_kind IN ('baixo_valor','descarte') THEN 1 ELSE 0 END) desq,
               SUM(COALESCE(credit_value,0)) valor`;

  const [rows, totals, daily] = await Promise.all([
    many(`SELECT ${SRC} src, ${CAMP} camp, ${MED} med, ${CONT} cont, ${AGG} FROM leads ${WHERE} GROUP BY src,camp,med,cont ORDER BY leads DESC`),
    env.DB.prepare(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN COALESCE(utm_source,'')<>'' THEN 1 ELSE 0 END) com_utm,
              SUM(CASE WHEN lead_kind='home_equity_mql' THEN 1 ELSE 0 END) mql,
              SUM(COALESCE(credit_value,0)) valor
       FROM leads ${WHERE}`
    ).bind(...b).first(),
    many(`SELECT DATE(created_at) d, ${CAMP} camp, ${SRC} src, COUNT(*) n FROM leads ${WHERE} GROUP BY d, camp, src ORDER BY d`),
  ]);

  // Visitas/sessões (tabela da Fase A). Se ainda não existir no banco, o dashboard
  // simplesmente não mostra taxa de conversão em vez de quebrar.
  let visits = [], daily_visits = [], visits_since = null;
  try {
    [visits, daily_visits, visits_since] = await Promise.all([
      manyS(`SELECT ${SRC} src, ${CAMP} camp, ${MED} med, ${CONT} cont, COUNT(*) n FROM sessions ${SWHERE} GROUP BY src,camp,med,cont`),
      manyS(`SELECT DATE(created_at,'unixepoch') d, ${CAMP} camp, ${SRC} src, COUNT(*) n FROM sessions ${SWHERE} GROUP BY d, camp, src ORDER BY d`),
      env.DB.prepare(`SELECT MIN(DATE(created_at,'unixepoch')) d FROM sessions`).first().then((r) => (r && r.d) || null),
    ]);
  } catch (e) { /* sessions ainda não criada */ }

  // Público POSSÍVEL (não é demografia do Meta): sai das colunas que já gravamos no
  // lead. `camp` vai junto pra o dashboard filtrar quando você entra numa campanha.
  let audience = [];
  try {
    const dims = [
      ["Dispositivo", "CASE WHEN is_mobile=1 THEN 'Celular' WHEN is_mobile=0 THEN 'Computador' ELSE '(sem dado)' END"],
      ["Navegador", "COALESCE(NULLIF(browser,''),'(sem dado)')"],
      ["Cidade", "COALESCE(NULLIF(city,''),'(não informada)')"],
      ["Faixa de crédito", "COALESCE(NULLIF(faixa_credito,''),'(não informada)')"],
      ["Tipo de imóvel", "COALESCE(NULLIF(property_type,''),'(não informado)')"],
    ];
    const parts = await Promise.all(dims.map(([dim, expr]) =>
      many(`SELECT '${dim}' dim, ${expr} k, ${CAMP} camp, ${SRC} src, COUNT(*) n FROM leads ${WHERE} GROUP BY k, camp, src`)
    ));
    audience = parts.flat();
  } catch (e) { /* colunas das migrations 0003/0008 ausentes */ }

  const t = totals || {};
  const total = t.total || 0, com_utm = t.com_utm || 0;
  return json({
    range: { start, end }, page: page || "all",
    totals: { total, com_utm, direto: total - com_utm, valor: t.valor || 0, mql: t.mql || 0 },
    rows, daily, visits, daily_visits, visits_since,
    visits_page_scoped: false,
    audience,
    ads_api: false, // sem ads_read: nada de gasto/CPA/idade/gênero vindo do Meta
  });
}

/* ---- MAPA DA PÁGINA (o que alimenta as visões novas do mapa de calor) ----
 * Quatro leituras da MESMA página, todas já existentes no D1:
 *   - profundidade: evento `scroll_depth` (marcos 25/50/75/100, 1x por sessão)
 *   - seções lidas: evento `section_view` (atributo data-section nos HTMLs)
 *   - elementos: tabela `clicks` (o que foi clicado, com texto do elemento)
 *   - etapas: eventos `form_step` / `form_step_choice` do formulário multi-step
 * O denominador de tudo é a quantidade de SESSÕES com page_view na página.
 */
async function handlePageMap(request, env) {
  const p = new URL(request.url).searchParams;
  const pageName = p.get("page");
  if (!pageName) return json({ error: "page obrigatório" }, 400);
  const today = new Date().toISOString().slice(0, 10);
  const past = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const start = p.get("start") || past;
  const end = p.get("end") || today;
  const b = [pageName, start, end];
  const many = async (sql) => (await env.DB.prepare(sql).bind(...b).all()).results || [];
  const RANGE = `page_name=? AND DATE(created_at) BETWEEN ? AND ?`;

  const [sess, scroll, sections, elements, steps, choices] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(DISTINCT session_id) n, COUNT(*) views FROM page_views WHERE ${RANGE}`).bind(...b).first(),
    many(`SELECT CAST(json_extract(properties,'$.pct') AS INTEGER) pct, COUNT(DISTINCT session_id) n
          FROM events WHERE event_name='scroll_depth' AND ${RANGE} GROUP BY pct ORDER BY pct`),
    many(`SELECT json_extract(properties,'$.section') k, COUNT(DISTINCT session_id) n
          FROM events WHERE event_name='section_view' AND ${RANGE} GROUP BY k ORDER BY n DESC`),
    many(`SELECT COALESCE(NULLIF(element_text,''), NULLIF(element_id,''), '(sem identificação)') k,
                 COALESCE(NULLIF(element_id,''),'') id, COALESCE(NULLIF(link_type,''),'') tipo,
                 COUNT(*) n, COUNT(DISTINCT session_id) s
          FROM clicks WHERE ${RANGE} GROUP BY k, id, tipo ORDER BY n DESC LIMIT 24`),
    many(`SELECT json_extract(properties,'$.id') k,
                 MIN(CAST(json_extract(properties,'$.step') AS INTEGER)) ord,
                 MAX(json_extract(properties,'$.title')) title,
                 COUNT(DISTINCT session_id) n
          FROM events WHERE event_name='form_step' AND ${RANGE} GROUP BY k ORDER BY ord`),
    many(`SELECT json_extract(properties,'$.id') step_id,
                 COALESCE(json_extract(properties,'$.label'), json_extract(properties,'$.value')) k,
                 COUNT(*) n
          FROM events WHERE event_name='form_step_choice' AND ${RANGE} GROUP BY step_id, k ORDER BY n DESC`),
  ]);

  const s = sess || {};
  return json({
    page: pageName, range: { start, end },
    sessions: s.n || 0, views: s.views || 0,
    scroll, sections, elements, steps, choices,
  });
}

/* ---- SAÚDE DO TRACKING (Fase B) ----
 * Agrega as colunas de diagnóstico da tabela `leads` (migration 0008): quanto do
 * tráfego o cookie de edge resgatou (itp), quantos bots foram barrados, cobertura de
 * PII pro Advanced Matching, distribuição de origem do fbp e de navegador. Se as
 * colunas ainda não existirem (0008 pendente), volta um aviso em vez de quebrar.
 */
async function handleHealth(request, env) {
  const { start, end, page, src } = params(request.url);
  const sc = (page ? " AND source = ?" : "") + (src ? ` AND ${SRC_EXPR} = ?` : "");
  const b = [start, end].concat(page ? [page] : []).concat(src ? [src] : []);
  const WHERE = `WHERE DATE(created_at) BETWEEN ? AND ?${sc}`;
  const many = async (sql) => (await env.DB.prepare(sql).bind(...b).all()).results || [];

  let totals = {};
  try {
    totals = await env.DB.prepare(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN is_bot=1 THEN 1 ELSE 0 END) bots,
              SUM(CASE WHEN itp_cookie_extended=1 THEN 1 ELSE 0 END) itp_recuperado,
              SUM(CASE WHEN pixel_was_blocked=1 THEN 1 ELSE 0 END) sem_cookie_meta,
              SUM(CASE WHEN has_email=1 THEN 1 ELSE 0 END) com_email,
              SUM(CASE WHEN has_phone=1 THEN 1 ELSE 0 END) com_telefone,
              SUM(CASE WHEN has_name=1 THEN 1 ELSE 0 END) com_nome,
              SUM(CASE WHEN fbclid_source IN ('url','session') THEN 1 ELSE 0 END) com_fbclid,
              SUM(CASE WHEN meta_status='ok' THEN 1 ELSE 0 END) meta_ok
       FROM leads ${WHERE}`
    ).bind(...b).first();
  } catch (e) {
    return json({ range: { start, end }, page: page || "all", pendente: true, totals: {}, by_fbp_source: [], by_browser: [], by_bot: [] });
  }

  let by_fbp_source = [], by_browser = [], by_bot = [];
  try {
    by_fbp_source = await many(`SELECT COALESCE(NULLIF(fbp_source,''),'(nulo)') k, COUNT(*) n FROM leads ${WHERE} GROUP BY k ORDER BY n DESC`);
    by_browser = await many(`SELECT COALESCE(NULLIF(browser,''),'(nulo)') k, COUNT(*) n FROM leads ${WHERE} GROUP BY k ORDER BY n DESC`);
    by_bot = await many(`SELECT COALESCE(NULLIF(bot_reason,''),'(humano)') k, COUNT(*) n FROM leads ${WHERE} GROUP BY k ORDER BY n DESC`);
  } catch (e) { /* ok */ }

  return json({ range: { start, end }, page: page || "all", totals: totals || {}, by_fbp_source, by_browser, by_bot });
}

/* ---- TESTE META ADS (diagnóstico temporário) ----
 * Verifica se o META_ACCESS_TOKEN (o mesmo da CAPI) tem `ads_read` na conta de
 * anúncios da InspiraCred (act_527600591049188). Atrás do Basic Auth. Se as duas
 * chamadas voltarem 200, já dá pra puxar gasto/insights e montar o cron. Se voltar
 * erro de permissão, geramos um token dedicado com ads_read. REMOVER depois do teste.
 */
async function handleMetaTest(request, env) {
  const token = env.META_ACCESS_TOKEN;
  if (!token) return json({ error: "META_ACCESS_TOKEN não configurado" }, 500);
  const act = (new URL(request.url).searchParams.get("act") || "527600591049188").replace(/\D/g, "");
  const ver = "v21.0";
  const call = async (path) => {
    try {
      const r = await fetch(`https://graph.facebook.com/${ver}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
      return { status: r.status, body: await r.json() };
    } catch (e) { return { error: String(e) }; }
  };
  const account = await call(`act_${act}?fields=name,account_status,currency,amount_spent`);
  const insights = await call(`act_${act}/insights?level=campaign&fields=campaign_name,spend,impressions,clicks&date_preset=last_7d&limit=3`);
  const ok = account.status === 200 && insights.status === 200;
  return json({ ad_account: `act_${act}`, ads_read_ok: ok, account, insights });
}

/* ---- JORNADA DO LEAD (timeline por session_id) ----
 * Une page_views + clicks + events + form_submissions numa linha do tempo única,
 * ordenada por created_at. `a`/`b`/`c` são colunas genéricas (o significado muda
 * por `kind`) pra caber tudo num UNION. Devolve também o lead da sessão (se houver).
 */
async function handleJourney(request, env) {
  const p = new URL(request.url).searchParams;
  const sid = p.get("session_id");
  if (!sid) return json({ error: "session_id obrigatório" }, 400);

  const sql = `
    SELECT created_at t, 'page_view' kind, page_name, url a, title b, referrer c FROM page_views WHERE session_id=?
    UNION ALL SELECT created_at, 'click', page_name, element_id, element_text, destination FROM clicks WHERE session_id=?
    UNION ALL SELECT created_at, 'event', page_name, event_name, properties, NULL FROM events WHERE session_id=?
    UNION ALL SELECT created_at, 'form',  page_name, form_id, CAST(success AS TEXT), NULL FROM form_submissions WHERE session_id=?
    ORDER BY t ASC`;
  const timeline = (await env.DB.prepare(sql).bind(sid, sid, sid, sid).all()).results || [];

  const lead = await env.DB.prepare(
    `SELECT name, phone, email, source, utm_source, utm_medium, utm_campaign, credit_value, created_at
     FROM leads WHERE session_id=? ORDER BY created_at DESC LIMIT 1`
  ).bind(sid).first();

  return json({ session_id: sid, timeline, lead: lead || null, count: timeline.length });
}

/* ---- MAPA DE CALOR (pontos por página, ISOLADOS por device) ----
 * Os layouts diferem entre mobile/tablet/desktop, então misturar taps de larguras
 * diferentes no mesmo render não faz sentido. Filtra por `device` usando o `vw`
 * (largura da tela gravada em cada tap). Buckets: mobile <768, tablet 768–1023,
 * desktop >=1024. Também devolve a distribuição por device pra dar visibilidade.
 */
function deviceVwCond(device) {
  if (device === "mobile") return "vw < 768";
  if (device === "tablet") return "vw >= 768 AND vw < 1024";
  return "vw >= 1024"; // desktop (default)
}
async function handleHeatmap(request, env) {
  const p = new URL(request.url).searchParams;
  const page = p.get("page");
  if (!page) return json({ error: "page obrigatório" }, 400);
  const today = new Date().toISOString().slice(0, 10);
  const past = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const start = p.get("start") || past;
  const end = p.get("end") || today;
  const device = p.get("device") || "desktop";

  const rows = (await env.DB.prepare(
    `SELECT x_pct, y_pct, element_id FROM heatmap_taps
     WHERE page_name=? AND DATE(created_at) BETWEEN ? AND ? AND ${deviceVwCond(device)} LIMIT 20000`
  ).bind(page, start, end).all()).results || [];

  // distribuição por device (todos os taps da página no período) — pra saber quanto
  // tráfego vem de cada tamanho de tela, mesmo os que a gente não está vendo agora.
  const dist = (await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN vw < 768 THEN 1 ELSE 0 END) mobile,
       SUM(CASE WHEN vw >= 768 AND vw < 1024 THEN 1 ELSE 0 END) tablet,
       SUM(CASE WHEN vw >= 1024 THEN 1 ELSE 0 END) desktop
     FROM heatmap_taps WHERE page_name=? AND DATE(created_at) BETWEEN ? AND ?`
  ).bind(page, start, end).first()) || {};

  return json({
    page, device, range: { start, end }, points: rows, count: rows.length,
    by_device: { mobile: dist.mobile || 0, tablet: dist.tablet || 0, desktop: dist.desktop || 0 },
  });
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
  body{margin:0;padding-left:246px;font-family:"Inter",-apple-system,Segoe UI,Roboto,sans-serif;background:var(--surface);color:var(--text);-webkit-font-smoothing:antialiased}
  .num,h2,.logo,.kpi .val{font-family:"Instrument Sans","Inter",sans-serif}
  header{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 26px;background:#fff;border-bottom:1px solid var(--border);flex-wrap:wrap}
  .logo{font-size:20px;font-weight:800;color:var(--blue);letter-spacing:-.02em;display:flex;align-items:baseline;gap:9px}
  .logo .o{color:var(--orange)}
  .logo small{font-family:"Inter",sans-serif;font-weight:600;color:var(--muted);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
  .controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  select,button{font-family:inherit;background:#fff;color:var(--text);border:1px solid var(--border);border-radius:10px;padding:8px 12px;font-size:13px;cursor:pointer;transition:border-color .15s,box-shadow .15s,filter .15s}
  select:hover,button:hover{border-color:var(--blue)}
  button.primary{background:var(--orange);border-color:var(--orange);color:#fff;font-weight:600}
  button.primary:hover{filter:brightness(1.04);box-shadow:0 6px 14px rgba(249,115,22,.28)}
  .tabs{position:fixed;left:0;top:0;bottom:0;z-index:40;width:246px;display:flex;flex-direction:column;gap:6px;padding:18px 14px;background:linear-gradient(180deg,var(--blue-dark),var(--blue));border-right:1px solid rgba(255,255,255,.10);box-shadow:10px 0 30px rgba(6,26,66,.14)}
  .side-mark{padding:8px 8px 18px;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,.14)}
  .side-mark .brand{font-family:"Instrument Sans","Inter",sans-serif;font-size:22px;font-weight:850;color:#fff;letter-spacing:-.03em}
  .side-mark .brand span{color:var(--orange)}
  .side-mark small{display:block;margin-top:4px;color:rgba(255,255,255,.62);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
  .side-help{margin-top:auto;padding:12px;border:1px solid rgba(255,255,255,.12);border-radius:15px;background:rgba(255,255,255,.07);color:rgba(255,255,255,.72);font-size:11.5px;line-height:1.45}
  .tab{display:flex;align-items:center;gap:10px;width:100%;padding:11px 12px;font-size:13.5px;font-weight:750;color:rgba(255,255,255,.72);background:transparent;border:1px solid transparent;border-radius:13px;text-align:left}
  .tab .ico{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:rgba(255,255,255,.08);font-size:13px}
  .tab:hover{color:#fff;background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.12)}
  .tab.active{color:var(--blue);background:#fff;border-color:#fff;box-shadow:0 10px 24px rgba(0,0,0,.16)}
  .tab.active .ico{background:var(--orange-soft);color:var(--orange)}
  .wrap{padding:22px 26px;max-width:1240px;margin:0 auto}
  .scope{font-size:12.5px;color:var(--muted);margin-bottom:18px}
  .scope b{color:var(--blue)}
  .dash-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin:2px 0 20px}
  .dash-eyebrow{display:inline-flex;align-items:center;gap:7px;color:var(--orange);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}
  .dash-hero h1{margin:8px 0 4px;font-family:"Instrument Sans","Inter",sans-serif;font-size:32px;line-height:1.05;color:var(--text);letter-spacing:-.04em}
  .dash-hero p{margin:0;color:var(--muted);font-size:14px}
  .hero-meta{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}
  .hero-meta .chip{background:#fff;color:var(--blue);font-weight:700}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:20px}
  .kpi{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:15px 18px;box-shadow:var(--shadow)}
  .kpi .label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
  .kpi .val{font-size:29px;font-weight:800;color:var(--blue);margin-top:7px;line-height:1}
  .kpi .sub{font-size:12px;color:var(--muted);margin-top:8px}
  .kpi .sub b{color:var(--green-ink);font-weight:700}
  .metric-strip{grid-template-columns:repeat(6,minmax(150px,1fr));gap:10px}
  .metric-strip .kpi{border-radius:14px;padding:13px 15px;box-shadow:0 1px 2px rgba(6,26,66,.04)}
  .metric-strip .kpi .val{font-size:25px;color:var(--text)}
  .metric-strip .kpi .sub b{color:var(--orange)}
  .overview-modules{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:0 0 18px}
  .module-card{position:relative;min-height:132px;display:flex;flex-direction:column;justify-content:space-between;text-align:left;background:#fff;border:1px solid var(--border);border-radius:17px;padding:15px;box-shadow:var(--shadow);overflow:hidden}
  .module-card:before{content:"";position:absolute;right:-32px;top:-36px;width:94px;height:94px;border-radius:50%;background:rgba(249,115,22,.10)}
  .module-card:hover{border-color:rgba(249,115,22,.46);box-shadow:0 12px 28px rgba(6,26,66,.10)}
  .module-card .tag{display:inline-flex;align-items:center;gap:7px;color:var(--muted);font-size:11px;font-weight:850;text-transform:uppercase;letter-spacing:.055em}
  .module-card .tag span{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;border-radius:8px;background:var(--orange-soft);color:var(--orange)}
  .module-card .value{font-family:"Instrument Sans","Inter",sans-serif;font-size:28px;font-weight:850;color:var(--blue);letter-spacing:-.03em;line-height:1;margin-top:14px}
  .module-card .sub{font-size:12px;color:var(--muted);line-height:1.35;margin-top:7px}
  .module-card .go{font-size:11.5px;font-weight:800;color:var(--orange);margin-top:12px}
  .grid{display:grid;grid-template-columns:1.5fr 1fr;gap:18px;margin-bottom:20px}
  .overview-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(330px,.85fr);gap:18px;align-items:start}
  .overview-stack{display:grid;gap:18px}
  .overview-side{display:grid;gap:18px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:18px;padding:18px 20px;box-shadow:var(--shadow)}
  .card h2{font-size:12px;margin:0 0 16px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em}
  .h2row{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
  .h2row h2{margin:0}
  .pages{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
  .pagecard{border:1px solid var(--border);border-radius:14px;padding:15px 16px;background:var(--surface)}
  .pagecard .head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;gap:8px}
  .pagecard .pname{font-size:14px;font-weight:700;color:var(--blue);display:flex;align-items:center;gap:6px}
  .pagecard .pstats{font-size:11.5px;color:var(--muted);white-space:nowrap}
  /* topo da aba Tráfego: 2 cards equilibrados */
  .traffic-top{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .hint{font-size:11.5px;color:var(--muted);font-weight:500}
  /* lista de barras ranqueadas (origens / cliques) — padrão Plausible */
  .bars{display:flex;flex-direction:column;gap:3px}
  .bar-row{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 11px;border-radius:9px;overflow:hidden;isolation:isolate}
  .bar-row .fill{position:absolute;inset:0;z-index:-1;background:rgba(11,45,114,.10);border-radius:9px;transform-origin:left;transition:width .5s cubic-bezier(.22,1,.36,1)}
  .bar-row.top .fill{background:rgba(249,115,22,.16)}
  .bar-row .lbl{font-size:13px;color:var(--text);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .bar-row .val{font-size:12.5px;color:var(--blue);font-weight:700;font-variant-numeric:tabular-nums;flex-shrink:0;font-family:"Instrument Sans","Inter",sans-serif}
  .bar-row .val small{color:var(--muted);font-weight:600;font-family:"Inter",sans-serif;margin-left:5px}
  .donut-card{min-height:300px}
  .donut-wrap{position:relative;height:174px;margin:4px auto 10px;max-width:230px}
  .legend-list{display:grid;gap:8px;margin-top:10px}
  .legend-item{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;font-size:12.5px;color:var(--text)}
  .legend-dot{width:9px;height:9px;border-radius:99px;background:var(--blue)}
  .legend-item .name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .legend-item .num{font-weight:800;color:var(--blue)}
  .chart-tall{height:310px}
  .event-bars{display:grid;gap:10px}
  .event-bar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}
  .event-bar .track{grid-column:1/-1;height:8px;background:var(--surface);border-radius:999px;overflow:hidden}
  .event-bar .fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--blue),var(--orange));transition:width .5s cubic-bezier(.22,1,.36,1)}
  .event-bar .name{font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .event-bar .count{font-family:"Instrument Sans","Inter",sans-serif;font-size:13px;font-weight:800;color:var(--blue)}
  .signal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .signal-card{border:1px solid var(--border);border-radius:15px;padding:14px;background:linear-gradient(180deg,#fff 0%,#fafafa 100%)}
  .signal-card.hot{border-color:rgba(249,115,22,.24);background:linear-gradient(180deg,#fff 0%,var(--orange-soft) 100%)}
  .signal-card .top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
  .signal-card .name{font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.045em}
  .signal-card .num{font-family:"Instrument Sans","Inter",sans-serif;font-size:28px;font-weight:850;color:var(--blue);line-height:1}
  .signal-card.hot .num{color:var(--orange)}
  .signal-card .sub{font-size:12px;color:var(--muted);margin-top:8px;line-height:1.35}
  .signal-card .meter{height:7px;border-radius:999px;background:#eef0f3;overflow:hidden;margin-top:12px}
  .signal-card .meter span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--blue),var(--orange))}
  .source-mix{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
  .source-mix .mini{border:1px solid var(--border);border-radius:13px;padding:11px;background:var(--surface)}
  .source-mix .mini span{display:block;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  .source-mix .mini strong{display:block;margin-top:4px;font-family:"Instrument Sans","Inter",sans-serif;font-size:22px;color:var(--blue)}
  .source-mix .mini small{color:var(--muted);font-weight:700}
  .source-note{margin-top:12px;padding:10px 12px;border-radius:13px;background:var(--orange-soft);color:#9a3412;font-size:12px;line-height:1.4}
  .lead-visual-grid{display:grid;grid-template-columns:minmax(280px,.85fr) minmax(0,1.15fr);gap:18px}
  .lead-name-btn{appearance:none;border:0;background:none;padding:0;color:var(--blue);font:inherit;font-weight:800;cursor:pointer;text-align:left;text-decoration:none}
  .lead-name-btn:hover{text-decoration:underline}
  .page-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:999px;padding:3px 9px;background:#fff;color:var(--blue);font-size:11.5px;font-weight:700;text-decoration:none}
  .page-chip:hover{border-color:var(--orange);color:var(--orange)}
  .event-dot{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:800;border:1px solid transparent}
  .event-dot:before{content:"";width:7px;height:7px;border-radius:99px;background:currentColor}
  .event-dot.sent{background:var(--green-soft);color:var(--green-ink);border-color:rgba(16,185,129,.22)}
  .event-dot.skip{background:var(--orange-soft);color:var(--orange);border-color:rgba(249,115,22,.24)}
  .event-dot.off{background:var(--surface);color:var(--muted);border-color:var(--border)}
  .event-dot.err{background:var(--red-soft);color:var(--red-ink);border-color:rgba(239,68,68,.22)}
  .event-dot.bot{background:#eef2ff;color:#4338ca;border-color:rgba(67,56,202,.20)}
  /* valores do lead: verde = atende ao mínimo, vermelho = abaixo */
  .val-ok{color:var(--green-ink);font-weight:800;background:var(--green-soft);border-radius:8px;padding:2px 7px;white-space:nowrap}
  .val-no{color:var(--red-ink);font-weight:800;background:var(--red-soft);border-radius:8px;padding:2px 7px;white-space:nowrap}
  .val-na{color:var(--muted);font-weight:700}
  .criteria{margin:0 0 14px;padding:13px 15px;border:1px solid var(--border);border-left:3px solid var(--orange);border-radius:13px;background:var(--surface)}
  .criteria b{font-size:12.5px;color:var(--text)}
  .criteria ul{margin:8px 0 0;padding-left:17px}
  .criteria li{font-size:12.5px;line-height:1.65;color:var(--muted)}
  .criteria small{display:block;margin-top:9px;font-size:11.5px;color:var(--muted);line-height:1.5}
  .event-legend{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}
  /* ---- Campanhas: navegador de 3 níveis no espírito do Gerenciador do Meta ---- */
  .am-bar{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:0 0 16px;padding:12px 14px;background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow)}
  .am-crumb{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);min-width:0}
  .am-crumb button{padding:5px 10px;border-radius:10px;font-size:12.5px;font-weight:750;color:var(--blue);background:var(--surface);border:1px solid var(--border)}
  .am-crumb button:hover{border-color:var(--orange);color:var(--orange)}
  .am-crumb .now{padding:5px 10px;border-radius:10px;background:var(--orange-soft);color:#9a3412;font-weight:800;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .am-crumb .sep{color:var(--border);font-weight:800}
  .am-levels{display:flex;gap:6px;padding:4px;background:var(--surface);border:1px solid var(--border);border-radius:14px}
  .am-level{display:flex;align-items:center;gap:7px;padding:8px 13px;border:0;border-radius:11px;background:transparent;color:var(--muted);font-size:13px;font-weight:750}
  .am-level b{font-family:"Instrument Sans","Inter",sans-serif;font-size:12px;padding:1px 7px;border-radius:99px;background:#fff;border:1px solid var(--border);color:var(--blue)}
  .am-level:hover{color:var(--blue)}
  .am-level.active{background:var(--blue);color:#fff;box-shadow:0 6px 16px rgba(11,45,114,.22)}
  .am-level.active b{background:rgba(255,255,255,.16);border-color:transparent;color:#fff}
  .camp-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(300px,.85fr);gap:18px;align-items:start;margin-bottom:18px}
  .am-row{display:grid;grid-template-columns:34px minmax(0,1fr) repeat(4,minmax(64px,86px)) 26px;align-items:center;gap:12px;width:100%;padding:13px 14px;border:1px solid var(--border);border-radius:15px;background:#fff;text-align:left;margin-bottom:9px;transition:border-color .15s,box-shadow .15s,transform .15s}
  .am-row:hover{border-color:rgba(249,115,22,.45);box-shadow:0 10px 24px rgba(6,26,66,.09);transform:translateY(-1px)}
  .am-row.is-flat{cursor:default}
  .am-row.is-flat:hover{transform:none;border-color:var(--border);box-shadow:none}
  .am-rank{width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:9px;background:var(--surface);border:1px solid var(--border);font-family:"Instrument Sans","Inter",sans-serif;font-size:12px;font-weight:850;color:var(--muted)}
  .am-row:first-child .am-rank{background:var(--orange-soft);border-color:rgba(249,115,22,.24);color:var(--orange)}
  /* .am-main e .am-metric são filhos diretos do grid (já viram bloco); o que está
     DENTRO deles continua inline por padrão — por isso o display:block explícito,
     senão a barra de share não ganha altura. */
  .am-main{display:block;min-width:0}
  .am-name{display:block;font-size:13.5px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .am-tags{display:flex;gap:6px;flex-wrap:wrap;margin:5px 0 7px}
  .am-tag{font-size:10.5px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:var(--muted);background:var(--surface);border:1px solid var(--border);border-radius:99px;padding:2px 8px}
  .am-track{display:block;height:7px;border-radius:999px;background:#eef0f3;overflow:hidden}
  .am-track span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--blue),var(--orange))}
  .am-metric{text-align:right}
  .am-metric b{display:block;font-family:"Instrument Sans","Inter",sans-serif;font-size:17px;font-weight:850;color:var(--blue);letter-spacing:-.02em;line-height:1.1}
  .am-metric small{display:block;margin-top:2px;font-size:10.5px;font-weight:750;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  .am-metric.hot b{color:var(--orange)}
  .am-go{font-size:19px;color:var(--muted);text-align:center}
  .am-row:hover .am-go{color:var(--orange)}
  .am-head{display:grid;grid-template-columns:34px minmax(0,1fr) repeat(4,minmax(64px,86px)) 26px;gap:12px;padding:0 14px 9px;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  .am-head span:nth-child(n+3){text-align:right}
  .aud-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:12px}
  .aud-card{border:1px solid var(--border);border-radius:15px;padding:13px;background:var(--surface)}
  .aud-card h3{margin:0 0 10px;font-family:"Instrument Sans","Inter",sans-serif;font-size:12px;font-weight:850;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  /* ---- Mapa de calor: modos ---- */
  .hm-steps{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 11px}
  .hm-step-btn{padding:6px 11px;border:1px solid var(--border);border-radius:99px;background:#fff;color:var(--muted);font-size:12px;font-weight:750;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .hm-step-btn:hover{border-color:var(--orange);color:var(--orange)}
  .hm-step-btn.active{background:var(--blue);border-color:var(--blue);color:#fff}
  .hm-badges{position:absolute;inset:0;overflow:hidden;pointer-events:none}
  .hm-badge{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;padding:3px 9px;border-radius:99px;background:var(--orange);color:#fff;font-family:"Instrument Sans","Inter",sans-serif;font-size:11px;font-weight:850;line-height:1.5;box-shadow:0 4px 12px rgba(249,115,22,.42);border:2px solid #fff;cursor:pointer;white-space:nowrap}
  .hm-badge.cool{background:var(--blue);box-shadow:0 4px 12px rgba(11,45,114,.34)}
  .hm-badge:hover{filter:brightness(1.08)}
  .hm-pop{position:absolute;z-index:6;pointer-events:auto;min-width:172px;max-width:240px;padding:12px 13px 12px;border-radius:14px;background:#fff;border:1px solid var(--border);box-shadow:0 16px 36px rgba(6,26,66,.24);font-size:12px;color:var(--muted)}
  .hm-pop b{display:block;font-size:12.5px;color:var(--text);margin:0 14px 6px 0;line-height:1.35}
  .hm-pop .n{font-family:"Instrument Sans","Inter",sans-serif;font-size:23px;font-weight:850;color:var(--orange);line-height:1}
  .hm-pop .x{position:absolute;top:5px;right:9px;color:var(--muted);cursor:pointer;font-weight:800;font-size:14px}
  .hm-legend{display:flex;align-items:center;gap:11px;margin-top:12px;font-size:11.5px;font-weight:750;color:var(--muted)}
  .hm-legend .ramp{flex:1;height:9px;border-radius:99px}
  .hm-modes{display:flex;gap:6px;padding:4px;background:var(--surface);border:1px solid var(--border);border-radius:14px;flex-wrap:wrap}
  .hm-mode{padding:8px 13px;border:0;border-radius:11px;background:transparent;color:var(--muted);font-size:13px;font-weight:750}
  .hm-mode:hover{color:var(--blue)}
  .hm-mode.active{background:var(--orange);color:#fff;box-shadow:0 6px 16px rgba(249,115,22,.26)}
  .hm-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,340px);gap:18px;align-items:start}
  .depth-scale{display:flex;flex-direction:column;gap:8px}
  .depth-band{position:relative;border:1px solid var(--border);border-radius:13px;padding:11px 13px;overflow:hidden;background:#fff}
  .depth-band .bg{position:absolute;inset:0;opacity:.16}
  .depth-band .row{position:relative;display:flex;align-items:baseline;justify-content:space-between;gap:10px}
  .depth-band .who{font-size:12.5px;font-weight:800;color:var(--text)}
  .depth-band .pc{font-family:"Instrument Sans","Inter",sans-serif;font-size:20px;font-weight:850;color:var(--blue)}
  .depth-band .sub{position:relative;margin-top:4px;font-size:11.5px;color:var(--muted)}
  .fold-note{margin-top:12px;padding:11px 13px;border-radius:13px;background:var(--orange-soft);color:#9a3412;font-size:12px;line-height:1.45}
  .step-row{display:grid;grid-template-columns:30px minmax(0,1fr) 74px;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border)}
  .step-row:last-child{border-bottom:0}
  .step-n{width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:9px;background:var(--blue);color:#fff;font-family:"Instrument Sans","Inter",sans-serif;font-size:12px;font-weight:850}
  .step-q{display:block;font-size:13px;font-weight:700;color:var(--text);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .step-bar{display:block;height:9px;border-radius:999px;background:#eef0f3;overflow:hidden}
  .step-bar span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--blue),#3b82f6)}
  .step-drop{font-size:11px;font-weight:800;color:var(--red-ink);margin-top:5px}
  .step-side{text-align:right}
  .step-side b{display:block;font-family:"Instrument Sans","Inter",sans-serif;font-size:17px;font-weight:850;color:var(--blue)}
  .step-side small{font-size:10.5px;color:var(--muted);font-weight:750}
  .choice-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
  .choice-chip{font-size:11px;font-weight:750;color:var(--blue);background:var(--surface);border:1px solid var(--border);border-radius:99px;padding:3px 9px}
  .choice-chip b{color:var(--orange);font-weight:850}
  /* ---- Saúde do tracking: medidores ---- */
  .gauge-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}
  .gauge{border:1px solid var(--border);border-radius:17px;padding:15px;background:#fff;box-shadow:var(--shadow);text-align:center}
  .gauge .ring{position:relative;width:118px;height:118px;margin:2px auto 10px;border-radius:50%}
  .gauge .ring i{position:absolute;inset:11px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;flex-direction:column;font-style:normal}
  .gauge .ring b{font-family:"Instrument Sans","Inter",sans-serif;font-size:26px;font-weight:850;color:var(--blue);letter-spacing:-.03em;line-height:1}
  .gauge .ring small{font-size:10.5px;color:var(--muted);font-weight:750;margin-top:2px}
  .gauge h3{margin:0 0 4px;font-family:"Instrument Sans","Inter",sans-serif;font-size:14px;font-weight:800;color:var(--text)}
  .gauge p{margin:0;font-size:11.5px;line-height:1.45;color:var(--muted)}
  .verdict{display:inline-flex;align-items:center;gap:6px;margin-top:9px;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:800}
  .verdict.good{background:var(--green-soft);color:var(--green-ink)}
  .verdict.warn{background:var(--orange-soft);color:#9a3412}
  .verdict.bad{background:var(--red-soft);color:var(--red-ink)}
  /* tabela-resumo por página */
  .sumtable{width:100%;border-collapse:collapse;font-size:13px}
  .sumtable th{text-align:right;color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:0 10px 9px;border-bottom:1px solid var(--border)}
  .sumtable th:first-child{text-align:left}
  .sumtable td{padding:11px 10px;border-bottom:1px solid var(--border);text-align:right;font-variant-numeric:tabular-nums}
  .sumtable td:first-child{text-align:left;font-weight:600;color:var(--blue)}
  .sumtable tr:last-child td{border-bottom:none}
  .sumtable .num{font-family:"Instrument Sans","Inter",sans-serif;font-weight:700}
  .sumtable tbody tr:hover td{background:var(--surface)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:10px;border-bottom:1px solid var(--border);white-space:nowrap}
  th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  tbody tr:hover{background:var(--surface)}
  .chip{display:inline-block;background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:3px 11px;font-size:11px;color:var(--muted)}
  .pill{display:inline-block;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600}
  .pill.ok{background:var(--green-soft);color:var(--green-ink)}
  .pill.err{background:var(--red-soft);color:var(--red-ink)}
  .pill.wait{background:var(--surface);color:var(--muted)}
  .pill.blue{background:rgba(11,45,114,.10);color:var(--blue)}
  .pill.orange{background:rgba(249,115,22,.15);color:var(--orange)}
  .pill.green{background:var(--green-soft);color:var(--green-ink)}
  .btn-sm{padding:6px 12px;font-size:12px;border-radius:9px}
  .filterbar{display:flex;align-items:end;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:0 0 16px;padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--surface)}
  .filterbar label{display:grid;gap:6px;font-size:12px;font-weight:700;color:var(--blue)}
  .filterbar select{min-width:230px}
  .filter-note{font-size:12px;color:var(--muted);max-width:520px;line-height:1.45}
  .empty{color:var(--muted);font-size:13px;padding:28px 0;text-align:center}
  /* Funil: trapézios empilhados (silhueta contínua) + rótulos fora da forma */
  #funnel{display:flex;flex-direction:column;padding:4px 0}
  .fn-row{display:grid;grid-template-columns:1fr 210px 1fr;column-gap:16px;align-items:stretch}
  .fn-name{align-self:center;text-align:right;font-size:13px;font-weight:600;color:var(--muted)}
  .fn-shape{height:56px}
  .fn-shape .tz{display:block;width:100%;height:100%;background:linear-gradient(180deg,#2a5cb8 0%,var(--blue) 100%);transition:clip-path .5s cubic-bezier(.22,1,.36,1)}
  .fn-row.last .fn-shape .tz{background:linear-gradient(180deg,#fb923c 0%,var(--orange) 100%)}
  .fn-stats{align-self:center;display:flex;flex-direction:column}
  .fn-stats .n{font-family:"Instrument Sans","Inter",sans-serif;font-weight:800;font-size:19px;color:var(--blue);line-height:1}
  .fn-row.last .fn-stats .n{color:var(--orange)}
  .fn-stats .c{font-size:11px;color:var(--muted);margin-top:4px}
  @media(max-width:520px){.fn-row{grid-template-columns:1fr 110px 1fr;column-gap:10px}.fn-name{font-size:12px}}
  .chart-box{position:relative;height:250px}
  .table-scroll{overflow:auto;max-height:560px}
  .modal-bg{position:fixed;inset:0;background:rgba(6,26,66,.55);display:none;align-items:center;justify-content:center;z-index:50;padding:20px}
  .modal-bg.show{display:flex}
  .modal{background:#fff;border-radius:20px;padding:26px;max-width:480px;width:100%;position:relative;box-shadow:0 24px 60px rgba(6,26,66,.3)}
  .modal h3{margin:0 0 6px;font-size:19px;color:var(--blue);font-family:"Instrument Sans","Inter",sans-serif}
  .modal .close{position:absolute;top:16px;right:18px;background:none;border:none;font-size:24px;color:var(--muted);cursor:pointer;padding:0;line-height:1}
  dl{display:grid;grid-template-columns:150px 1fr;gap:8px 12px;margin:18px 0 0;font-size:13px}
  dt{color:var(--muted)}dd{margin:0;font-weight:600;color:var(--text)}
  dl .sec{grid-column:1/-1;font-family:"Instrument Sans","Inter",sans-serif;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--orange);margin-top:12px;padding-bottom:5px;border-bottom:1px solid var(--border)}
  dl .sec:first-child{margin-top:0}
  .modal-scroll{max-height:min(70vh,620px);overflow:auto;margin-right:-8px;padding-right:8px}
  .tab-section{display:none}
  /* Jornada (timeline no modal) */
  .journey-head{margin-top:18px;display:flex;justify-content:flex-end}
  #journey{margin-top:12px;max-height:340px;overflow:auto}
  .tl{position:relative;margin:0;padding:2px 0 2px 4px;list-style:none}
  .tl-item{position:relative;padding:0 0 14px 26px;border-left:2px solid var(--border)}
  .tl-item:last-child{border-left-color:transparent}
  .tl-dot{position:absolute;left:-7px;top:2px;width:12px;height:12px;border-radius:50%;background:var(--blue);border:2px solid #fff;box-shadow:0 0 0 1px var(--border)}
  .tl-item.k-lead .tl-dot,.tl-item.k-form .tl-dot{background:var(--orange)}
  .tl-item.k-event .tl-dot{background:var(--green)}
  .tl-time{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
  .tl-main{font-size:13px;font-weight:600;color:var(--text);margin-top:1px}
  .tl-sub{font-size:12px;color:var(--muted);word-break:break-word}
  .tl-kind{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--blue);margin-right:6px}
  /* Mapa de calor */
  .hm-note{font-size:12.5px;color:var(--muted);margin-bottom:14px}
  .hm-stage{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px;overflow-x:auto}
  /* viewport fixo (vh estável dentro do iframe) + scroll externo controlando o slice */
  .hm-viewport{position:relative;overflow-y:auto;overflow-x:hidden;margin:0 auto;box-shadow:var(--shadow);background:#fff}
  .hm-inner{position:relative}
  .hm-sticky{position:sticky;top:0;line-height:0}
  /* pointer-events:none → a roda do mouse vai pro .hm-viewport (scroll real), não pro iframe;
     assim o drawSlice sincroniza calor + página. scrollTo programático segue funcionando. */
  #hmFrame{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff;pointer-events:none}
  #hmCanvas{position:absolute;inset:0;pointer-events:none}
  @media(max-width:1180px){.overview-modules{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media(max-width:980px){body{padding-left:76px}.tabs{width:76px;padding:12px 9px}.side-mark{padding:6px 4px 12px}.side-mark .brand{font-size:0}.side-mark .brand:before{content:"IC";font-size:18px}.side-mark small,.side-help,.tab .txt{display:none}.tab{justify-content:center;padding:12px 8px}.tab .ico{width:28px;height:28px}.overview-grid,.lead-visual-grid,.camp-grid,.hm-split{grid-template-columns:1fr}.metric-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.dash-hero{align-items:flex-start;flex-direction:column}.hero-meta{justify-content:flex-start}}
  @media(max-width:760px){.grid,.traffic-top,.signal-grid{grid-template-columns:1fr}.overview-modules{grid-template-columns:1fr}.wrap{padding:18px 16px}header{padding:12px 16px}.controls{width:100%}.controls select{max-width:100%}
    .am-head{display:none}.am-row{grid-template-columns:28px minmax(0,1fr) repeat(2,minmax(56px,1fr));row-gap:9px}.am-row .am-go{display:none}.am-row .am-main{grid-column:2/-1}.am-levels{width:100%}.am-level{flex:1;justify-content:center}}
</style>
</head>
<body>
<header>
  <div class="logo">Inspira<span class="o">Cred</span><small>Analytics</small></div>
  <div class="controls">
    <select id="pageSel">
      <option value="all" selected>Todas as páginas</option>
      <option value="landing_page">Simulação</option>
      <option value="home_equity_lp">Home Equity</option>
      <option value="home_equity_form">Typeform</option>
      <option value="link_bio">Link na bio</option>
      <option value="obrigado_simulacao">Obrigado · Simulação</option>
      <option value="obrigado_home_equity">Obrigado · Home Equity</option>
      <option value="obrigado_formulario">Obrigado · Formulário</option>
      <option value="obrigado_auto">Obrigado · Auto</option>
      <option value="obrigado_nao_elegivel">Obrigado · Não elegível</option>
    </select>
    <select id="srcSel" title="Filtro de origem — vale para o dashboard inteiro">
      <option value="meta_ads" selected>Origem: Meta Ads</option>
      <option value="all">Origem: todas</option>
    </select>
    <select id="rangeSel"><option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select>
    <button id="refresh" class="primary">Atualizar</button>
    <a href="/analytics/logout" class="btn-sm" style="text-decoration:none;display:inline-flex;align-items:center">Sair</a>
    <button id="openPage" title="Abrir a página selecionada em nova aba">Abrir página ↗</button>
  </div>
</header>
<div class="tabs">
  <div class="side-mark"><div class="brand">Inspira<span>Cred</span></div><small>Analytics</small></div>
  <button class="tab" id="tabbtn-overview" onclick="showTab('overview')"><span class="ico">▦</span><span class="txt">Visão geral</span></button>
  <button class="tab" id="tabbtn-leads" onclick="showTab('leads')"><span class="ico">◉</span><span class="txt">Leads</span></button>
  <button class="tab" id="tabbtn-campaigns" onclick="showTab('campaigns')"><span class="ico">↗</span><span class="txt">Campanhas</span></button>
  <button class="tab" id="tabbtn-heatmap" onclick="showTab('heatmap')"><span class="ico">⌖</span><span class="txt">Mapa de calor</span></button>
  <button class="tab" id="tabbtn-health" onclick="showTab('health')"><span class="ico">✓</span><span class="txt">Saúde do tracking</span></button>
  <div class="side-help">Visão executiva primeiro, detalhe operacional nas abas. Bom pra abrir na TV e bater o olho sem garimpar tabela.</div>
</div>
<div class="wrap">
  <div class="scope" id="scope"></div>

  <section class="tab-section" id="tab-overview">
    <div class="dash-hero">
      <div>
        <span class="dash-eyebrow">Dashboard</span>
        <h1>Olá, InspiraCred 👋</h1>
        <p>Acompanhe leads, conversões e qualidade do funil em uma visão executiva.</p>
      </div>
      <div class="hero-meta" id="overviewMeta"></div>
    </div>
    <div class="kpis metric-strip" id="kpis"></div>
    <div class="overview-modules" id="overviewModules"></div>
    <div class="overview-grid">
      <div class="overview-stack">
        <div class="card">
          <div class="h2row"><h2>Desempenho ao longo do tempo</h2><span class="hint">visitantes x leads</span></div>
          <div class="chart-box chart-tall"><canvas id="dailyChart"></canvas></div>
        </div>
        <div class="card">
          <div class="h2row"><h2>Sinais de conversão</h2><span class="hint">leitura executiva do funil</span></div>
          <div id="overviewEvents"></div>
        </div>
      </div>
      <div class="overview-side">
        <div class="card"><h2>Funil de conversão</h2><div id="funnel"></div></div>
        <div class="card donut-card">
          <div class="h2row"><h2>Campanhas que mais trazem lead</h2><span class="hint" id="topCampHint"></span></div>
          <div class="donut-wrap"><canvas id="campMixChart"></canvas></div>
          <div id="overviewTopCamps"></div>
        </div>
      </div>
    </div>
  </section>

  <section class="tab-section" id="tab-leads">
    <div class="kpis" id="leadKpis"></div>
    <div class="card">
      <div class="h2row"><h2 id="leadsTitle">Mesa de leads</h2><button class="btn-sm" id="csvBtn">Baixar CSV</button></div>
      <div class="filterbar">
        <label>Filtrar por conversão
          <select id="leadEventFilter">
            <option value="all">Todas as conversões</option>
            <option value="home_equity">Lead</option>
            <option value="home_equity_mql">Lead qualificado</option>
            <option value="auto">Lead automotivo</option>
            <option value="nao_qualificado">Lead desqualificado</option>
            <option value="descarte">Sem imóvel/veículo</option>
          </select>
        </label>
        <div class="filter-note">A tabela agora junta todos os leads capturados. O filtro mostra qual evento/conversão aquele cadastro gerou — inclusive os que vão ao RD sem contar como Lead no Meta.</div>
      </div>
      <div class="table-scroll"><div id="leads"></div></div>
    </div>
    <div class="lead-visual-grid" style="margin-top:18px">
      <div class="card donut-card">
        <div class="h2row"><h2>Leads por tipo</h2><span class="hint" id="leadTypeHint"></span></div>
        <div class="donut-wrap"><canvas id="leadTypeChart"></canvas></div>
        <div class="legend-list" id="leadTypeLegend"></div>
      </div>
      <div class="card">
        <div class="h2row"><h2>Entrega por evento</h2><span class="hint">RD, Meta Lead e MQL</span></div>
        <div id="leadDeliveryBars"></div>
      </div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="h2row"><h2>Eventos enviados / registrados</h2><span class="hint">apoio técnico do período</span></div>
      <div class="kpis" id="eventKpis"></div>
      <div id="eventSummary"></div>
    </div>
  </section>

  <section class="tab-section" id="tab-campaigns">
    <div class="kpis metric-strip" id="campKpis"></div>
    <div class="camp-grid">
      <div class="card">
        <div class="h2row"><h2 id="campChartTitle">Visitas e leads por dia</h2><span class="hint" id="campChartHint"></span></div>
        <div class="chart-box chart-tall"><canvas id="campChart"></canvas></div>
      </div>
      <div class="card donut-card">
        <div class="h2row"><h2>Mix de origem</h2><span class="hint" id="campSourceHint"></span></div>
        <div class="donut-wrap"><canvas id="campSourceChart"></canvas></div>
        <div class="legend-list" id="campSourceLegend"></div>
      </div>
    </div>
    <div class="am-bar">
      <div class="am-crumb" id="campCrumb"></div>
      <div class="am-levels">
        <button class="am-level" id="lvl-campaign" onclick="setCampLevel('campaign')">Campanhas <b id="lvlnCampaign">0</b></button>
        <button class="am-level" id="lvl-adset" onclick="setCampLevel('adset')">Conjuntos <b id="lvlnAdset">0</b></button>
        <button class="am-level" id="lvl-ad" onclick="setCampLevel('ad')">Anúncios <b id="lvlnAd">0</b></button>
      </div>
    </div>
    <div class="card">
      <div class="h2row"><h2 id="campRowsTitle">Campanhas</h2><span class="hint" id="campRowsHint"></span></div>
      <div class="am-head"><span></span><span>Nome</span><span>Leads</span><span>Conversão</span><span>Crédito</span><span>Qualif.</span><span></span></div>
      <div id="campRows"></div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="h2row"><h2>Público dos leads</h2><span class="hint" id="campAudienceHint"></span></div>
      <div class="aud-grid" id="campAudience"></div>
      <p class="hint" style="display:block;margin:14px 0 0;line-height:1.5">
        Idade, gênero e localização do Meta exigem a permissão <b>ads_read</b> na conta de
        anúncios do cliente, que ainda não temos — quando liberar, entra aqui. O que está
        acima é o público real dos <b>nossos</b> leads, medido no nosso banco.
      </p>
    </div>
    <div class="traffic-top" style="margin-top:18px">
      <div class="card">
        <div class="h2row"><h2>Origem dos leads</h2><span class="hint" id="sourcesHint"></span></div>
        <div id="sourcesList"></div>
      </div>
      <div class="card">
        <div class="h2row"><h2>Tráfego por página</h2><span class="hint">acessos do período</span></div>
        <div id="pagesSummary"></div>
      </div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="h2row"><h2>Cliques por página</h2><span class="hint">os elementos mais clicados em cada página</span></div>
      <div class="pages" id="pages"></div>
    </div>
  </section>

  <section class="tab-section" id="tab-heatmap">
    <div class="am-bar">
      <div class="hm-modes">
        <button class="hm-mode" id="hmmode-clicks" onclick="setHmMode('clicks')">Mapa de cliques</button>
        <button class="hm-mode" id="hmmode-depth" onclick="setHmMode('depth')">Profundidade de rolagem</button>
        <button class="hm-mode" id="hmmode-elements" onclick="setHmMode('elements')">Elementos clicados</button>
        <button class="hm-mode" id="hmmode-steps" onclick="setHmMode('steps')">Etapas do formulário</button>
      </div>
      <div class="controls">
        <select id="hmPageSel">
          <option value="link_bio">Link na bio</option>
          <option value="landing_page">Simulação</option>
          <option value="home_equity_lp">Home Equity</option>
          <option value="home_equity_form">Typeform</option>
        </select>
        <select id="hmDevice"><option value="mobile" selected>Mobile</option><option value="tablet">Tablet</option><option value="desktop">Desktop</option></select>
        <button id="hmLoad" class="primary">Carregar</button>
      </div>
    </div>
    <div class="kpis metric-strip" id="hmKpis"></div>

    <div class="hm-split">
      <div class="card">
        <div class="h2row"><h2 id="hmStageTitle">Onde as pessoas clicam</h2><span class="hint" id="hmStageHint">quanto mais quente, mais toques</span></div>
        <div class="hm-steps" id="hmSteps"></div>
        <div class="hm-note" id="hmNote">Escolha a página e clique em <b>Carregar</b>. Tudo é desenhado por cima da própria página. Role para ver o resto.</div>
        <div class="hm-stage" id="hmStage">
          <div class="hm-viewport" id="hmViewport">
            <div class="hm-inner" id="hmInner">
              <div class="hm-sticky" id="hmSticky">
                <iframe id="hmFrame" title="Página"></iframe>
                <canvas id="hmCanvas"></canvas>
                <div class="hm-badges" id="hmBadges"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="hm-legend" id="hmLegend"></div>
      </div>
      <div class="card">
        <div class="h2row"><h2 id="hmPanelTitle">Elementos mais clicados</h2><span class="hint" id="hmPanelHint"></span></div>
        <div id="hmPanel"></div>
      </div>
    </div>
  </section>

  <section class="tab-section" id="tab-health">
    <div class="dash-hero">
      <div>
        <h1 id="healthVerdict">Saúde do rastreamento</h1>
        <p id="healthSummary">Quanto dos seus leads chega inteiro no Meta e no RD.</p>
      </div>
      <div class="hero-meta" id="healthMeta"></div>
    </div>
    <div class="gauge-grid" id="healthGauges"></div>
    <div class="card" style="margin-top:18px">
      <div class="h2row"><h2>O que está acontecendo</h2><span class="hint">tradução dos números acima</span></div>
      <div class="signal-grid" id="healthSignals"></div>
    </div>
    <div class="traffic-top" style="margin-top:18px">
      <div class="card">
        <div class="h2row"><h2>De onde veio o identificador do Meta</h2><span class="hint">quem salvou o cookie</span></div>
        <div id="healthFbp"></div>
      </div>
      <div class="card">
        <div class="h2row"><h2>Navegador dos leads</h2><span class="hint">onde eles preencheram</span></div>
        <div id="healthBrowser"></div>
      </div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="h2row"><h2>Robôs barrados</h2><span class="hint">crawlers que NÃO foram enviados à CAPI</span></div>
      <div id="healthBots"></div>
    </div>
  </section>
</div>

<div class="modal-bg" id="leadModal">
  <div class="modal">
    <button class="close" id="modalClose">&times;</button>
    <h3 id="modalName">Lead</h3>
    <div class="chip" id="modalDate"></div>
    <div class="modal-scroll">
      <dl id="modalBody"></dl>
      <div class="journey-head"><button class="btn-sm" id="journeyBtn">Ver jornada ↓</button></div>
      <div id="journey"></div>
    </div>
  </div>
</div>

<script>
var dailyChart=null, sourceChart=null, leadTypeChart=null, lastLeads=[], lastAllLeads=[], activeTab="overview";
var PAGE_LABELS={landing_page:"Simulação",home_equity_lp:"Home Equity",home_equity_form:"Typeform",link_bio:"Link na bio",obrigado_simulacao:"Obrigado · Simulação",obrigado_home_equity:"Obrigado · Home Equity",obrigado_formulario:"Obrigado · Typeform",obrigado_auto:"Obrigado · Auto",obrigado_nao_elegivel:"Obrigado · Não elegível",other:"Outras"};
var LEAD_KIND_LABELS={home_equity:"Lead",home_equity_mql:"Lead qualificado",baixo_valor:"Lead desqualificado",auto:"Lead automotivo",descarte:"Banco de dados (sem imóvel/veículo)"};
var PAGE_URLS={landing_page:"https://nova.inspiracred.com.br/",home_equity_lp:"https://nova.inspiracred.com.br/homeequity/",home_equity_form:"https://nova.inspiracred.com.br/formulario/",link_bio:"https://links.inspiracred.com.br/",obrigado_simulacao:"https://nova.inspiracred.com.br/obrigado/simulacao/",obrigado_home_equity:"https://nova.inspiracred.com.br/obrigado/home-equity/",obrigado_formulario:"https://nova.inspiracred.com.br/obrigado/formulario/",obrigado_auto:"https://nova.inspiracred.com.br/obrigado/auto/",obrigado_nao_elegivel:"https://nova.inspiracred.com.br/obrigado/nao-elegivel/"};
var CHART_PALETTE=["#f97316","#0b2d72","#10b981","#f59e0b","#3b82f6","#8b5cf6","#ec4899"];
function pretty(n){return (n==null||n===""?"-":String(n))}
function label(p){return PAGE_LABELS[p]||p}
function daysAgo(n){return new Date(Date.now()-n*864e5).toISOString().slice(0,10)}
function brl(v){if(v==null)return"-";return "R$ "+Number(v).toLocaleString("pt-BR")}
function pct(a,b){return b?Math.round((a/b)*100):0}
function currentPage(){return document.getElementById("pageSel").value}
function currentSrc(){var s=document.getElementById("srcSel");return s?s.value:"all"}
function badge(s){if(s==="ok")return '<span class="pill ok">entregue</span>';if(s==="nao_enviado")return '<span class="pill wait">não enviado</span>';if(s==null||s==="")return '<span class="pill wait">pendente</span>';return '<span class="pill err">'+pretty(s)+'</span>';}

function showTab(name){
  activeTab=name;
  ["overview","leads","campaigns","heatmap","health"].forEach(function(t){
    document.getElementById("tab-"+t).style.display=(t===name)?"block":"none";
    document.getElementById("tabbtn-"+t).classList.toggle("active",t===name);
  });
  setTimeout(function(){if(dailyChart){try{dailyChart.resize()}catch(e){}}},30);
}

function setLoading(on){var b=document.getElementById("refresh");b.disabled=on;b.textContent=on?"Atualizando…":"Atualizar";}
function updateOpenBtn(){var b=document.getElementById("openPage");b.style.display=PAGE_URLS[currentPage()]?"":"none";}
function loadAll(){
  var days=document.getElementById("rangeSel").value;
  var page=currentPage();
  var src=currentSrc();
  var pageQ=(page&&page!=="all")?"&page="+encodeURIComponent(page):"";
  // o filtro global vai pro servidor em tudo que TEM origem gravada (leads/sessões).
  // /campaigns fica de fora de propósito: é dele que sai a lista de origens do seletor.
  var srcQ=(src&&src!=="all")?"&src="+encodeURIComponent(src):"";
  var qs="?start="+daysAgo(parseInt(days)-1)+"&end="+new Date().toISOString().slice(0,10);
  updateOpenBtn();
  setLoading(true);
  var scopeTxt="Exibindo: <b>"+(page==="all"?"Todas as páginas":label(page))+"</b> · últimos "+days+" dias"+
    (src!=="all"?' · origem <b>'+esc(src)+'</b>':' · <b>todas as origens</b>');
  document.getElementById("scope").innerHTML=scopeTxt+' · <span style="color:var(--muted)">carregando…</span>';
  var p1=fetch("${API}/overview"+qs+pageQ+srcQ+"&_="+Date.now()).then(function(r){return r.json()}).then(function(d){render(d);renderTraffic(d);});
  var p2=fetch("${API}/leads"+qs+"&limit=500"+pageQ+srcQ+"&_="+Date.now()).then(function(r){return r.json()}).then(renderLeads);
  var p3=fetch("${API}/campaigns"+qs+pageQ+"&_="+Date.now()).then(function(r){return r.json()}).then(renderCampaigns);
  var p5=fetch("${API}/health"+qs+pageQ+srcQ+"&_="+Date.now()).then(function(r){return r.json()}).then(renderHealth);
  if(hmPageLoaded)loadPageMap(); // mantém o mapa da página em sincronia com o período
  Promise.all([p1,p2,p3,p5]).then(function(){
    document.getElementById("scope").innerHTML=scopeTxt+' · <span style="color:var(--green-ink)">atualizado às '+new Date().toLocaleTimeString("pt-BR")+'</span>';
  }).catch(function(e){console.error(e);document.getElementById("scope").innerHTML=scopeTxt+' · <span style="color:var(--red-ink)">erro ao carregar</span>';})
  .then(function(){setLoading(false);});
}

function render(d){
  var t=d.totals, r=d.rates;
  var kinds=d.lead_kind_summary||[], byKind={};
  kinds.forEach(function(k){byKind[k.kind]=k;});
  var mql=(byKind.home_equity_mql&&byKind.home_equity_mql.n)||0;
  var qualifRate=pct(mql,t.leads||0);
  document.getElementById("overviewMeta").innerHTML='<span class="chip">'+(d.page==="all"?"Todas as páginas":label(d.page||"all"))+'</span><span class="chip">'+(d.range?d.range.start+" → "+d.range.end:"período atual")+'</span>';
  // Com filtro de origem ligado, "simulação iniciada/concluída" não existe filtrado
  // (esses eventos não gravam origem) — some do KPI e do funil em vez de aparecer um
  // número de OUTRO recorte do lado de um número filtrado.
  var temFunilMeio=t.sim_start!=null;
  var kpis=[
    [d.visits_from_sessions?"Visitas (sessões)":"Visitas",pretty(t.visitors),r.visitor_to_lead+"% viram lead"],
    ["Engajados",temFunilMeio?pretty(t.sim_start):"—",temFunilMeio?r.visitor_to_start+"% iniciaram":"sem origem gravada"],
    ["Simulações",temFunilMeio?pretty(t.sim_complete):"—",temFunilMeio?r.start_to_complete+"% conclusão":"sem origem gravada"],
    ["Tx. conv.",r.visitor_to_lead+"%",pretty(t.leads)+" leads"],
    ["Leads",pretty(t.leads),temFunilMeio?r.complete_to_lead+"% pós-simulação":"no recorte atual"],
    ["% qualif.",qualifRate+"%",pretty(mql)+" MQLs"]
  ];
  document.getElementById("kpis").innerHTML=kpis.map(function(k){return '<div class="kpi"><div class="label">'+k[0]+'</div><div class="val">'+k[1]+'</div><div class="sub"><b>'+k[2]+'</b></div></div>'}).join("");
  renderOverviewModules(d);
  renderFunnel(temFunilMeio
    ? [["Visitantes",t.visitors],["Simulação iniciada",t.sim_start],["Simulação concluída",t.sim_complete],["Lead",t.leads]]
    : [["Visitas da origem",t.visitors],["Lead",t.leads]]);
  renderEventSummary(d);
  renderOverviewTopCamps();
  var dl=d.daily||[]; drawLine("dailyChart",dl.map(function(x){return x.d.slice(5)}),dl.map(function(x){return x.v}),dl.map(function(x){return x.l||0}));
}

function renderOverviewModules(d){
  d=d||{};
  var t=d.totals||{}, kinds=d.lead_kind_summary||[], byKind={};
  kinds.forEach(function(k){byKind[k.kind]=k;});
  var mql=(byKind.home_equity_mql&&byKind.home_equity_mql.n)||0;
  var rdOk=kinds.reduce(function(a,k){return a+Number(k.rd_ok||0)},0);
  var metaOk=kinds.reduce(function(a,k){return a+Number(k.meta_ok||0)},0);
  var metaSkip=kinds.reduce(function(a,k){return a+Number(k.meta_skip||0)},0);
  var sources=d.sources||[];
  var sourceTotal=sources.reduce(function(a,x){return a+Number(x.n||0)},0);
  var direct=sources.reduce(function(a,x){return a+((!x.source||x.source==="direto")?Number(x.n||0):0)},0);
  var withUtm=Math.max(0,sourceTotal-direct);
  var pages=d.pages||[];
  var views=pages.reduce(function(a,p){return a+Number(p.views||0)},0);
  var topPage=pages[0]?label(pages[0].page_name):"sem página";
  var clicks=(d.clicks||[]).reduce(function(a,c){return a+Number(c.clicks||0)},0);
  var cards=[
    {tab:"leads",ico:"◉",tag:"Leads",val:pretty(t.leads||0),sub:pretty(mql)+" qualificados · "+pretty(rdOk)+" entregues ao RD"},
    {tab:"campaigns",ico:"↗",tag:"Campanhas",val:pretty(withUtm),sub:pct(withUtm,sourceTotal)+"% com UTM · "+pretty(direct)+" sem UTM"},
    {tab:"campaigns",ico:"≋",tag:"Tráfego",val:pretty(t.visitors||0),sub:pretty(views)+" views · topo: "+topPage},
    {tab:"heatmap",ico:"⌖",tag:"Mapa de calor",val:pretty(clicks),sub:"cliques/taps mapeados nas páginas"},
    {tab:"health",ico:"✓",tag:"Saúde",val:pretty(metaOk),sub:"Meta ok · "+pretty(metaSkip)+" sem Lead por regra"}
  ];
  document.getElementById("overviewModules").innerHTML=cards.map(function(c){
    return '<button class="module-card" onclick="showTab(&quot;'+c.tab+'&quot;)">'+
      '<span class="tag"><span>'+c.ico+'</span>'+esc(c.tag)+'</span>'+
      '<span><span class="value">'+esc(c.val)+'</span><span class="sub">'+esc(c.sub)+'</span></span>'+
      '<span class="go">Abrir aba →</span>'+
    '</button>';
  }).join("");
}

function eventLabel(name){
  var m={
    simulation_start:"Simulação iniciada",
    simulation_complete:"Simulação concluída",
    section_view:"Seção visualizada",
    scroll_depth:"Profundidade de scroll",
    CompleteRegistration:"CompleteRegistration",
    Lead:"Lead",
    LeadQualificado:"Lead qualificado"
  };
  return m[name]||name;
}

function signalCards(rows,max){
  max=max||Math.max.apply(null,rows.map(function(x){return x.n||0}).concat([1]));
  return '<div class="signal-grid">'+rows.map(function(x){
    var w=Math.max(4,Math.round((x.n||0)/max*100));
    return '<div class="signal-card '+(x.hot?'hot':'')+'">'+
      '<div class="top"><span class="name">'+esc(x.name)+'</span><span class="num">'+pretty(x.n)+'</span></div>'+
      '<div class="sub">'+x.sub+'</div>'+
      '<div class="meter"><span style="width:'+w+'%"></span></div>'+
    '</div>';
  }).join("")+'</div>';
}

function renderEventSummary(d){
  var rows=d.events_summary||[];
  var kinds=d.lead_kind_summary||[];
  var byKind={};
  kinds.forEach(function(k){byKind[k.kind]=k;});
  var leadOk=(byKind.home_equity&&byKind.home_equity.meta_ok||0)+(byKind.auto&&byKind.auto.meta_ok||0)+(byKind.home_equity_mql&&byKind.home_equity_mql.meta_ok||0);
  var mqlOk=(byKind.home_equity_mql&&byKind.home_equity_mql.meta_ok||0);
  var rdOk=kinds.reduce(function(a,k){return a+Number(k.rd_ok||0)},0);
  var metaSkip=kinds.reduce(function(a,k){return a+Number(k.meta_skip||0)},0);
  var kpis=[
    ["Meta Lead",pretty(leadOk),"eventos com entrega CAPI ok"],
    ["Meta LeadQualificado",pretty(mqlOk),"MQLs enviados ao Meta"],
    ["RD Station",pretty(rdOk),"leads enviados ao CRM"],
    ["Sem Lead no Meta",pretty(metaSkip),"não qualificados por regra"]
  ];
  document.getElementById("eventKpis").innerHTML=kpis.map(function(k){return '<div class="kpi"><div class="label">'+k[0]+'</div><div class="val">'+k[1]+'</div><div class="sub"><b>'+k[2]+'</b></div></div>'}).join("");
  var t=d.totals||{};
  var signalRows=[
    {name:"Iniciaram",n:t.sim_start||0,sub:pct(t.sim_start||0,t.visitors||0)+"% das visitas começaram a simulação"},
    {name:"Concluíram",n:t.sim_complete||0,sub:pct(t.sim_complete||0,t.sim_start||0)+"% de quem iniciou chegou ao fim"},
    {name:"Lead Meta",n:leadOk,sub:"evento Lead enviado ao Meta quando passa na regra",hot:true},
    {name:"Lead qualificado",n:mqlOk,sub:"MQL enviado para otimização mais forte",hot:true},
    {name:"RD Station",n:rdOk,sub:"cadastros entregues ao CRM / RD"},
    {name:"Sem Lead no Meta",n:metaSkip,sub:"capturados no banco, mas sem evento Lead por regra"}
  ];
  document.getElementById("overviewEvents").innerHTML=signalCards(signalRows);
  var leadRows=kinds.map(function(k){
    return {name:LEAD_KIND_LABELS[k.kind]||k.kind,n:k.n||0,sessions:k.rd_ok||0,type:"Conversão"};
  });
  var eventRows=rows.slice(0,8).map(function(e){return {name:eventLabel(e.event_name),n:e.n||0,sessions:e.sessions||0,type:e.event_type||"Evento"};});
  var all=leadRows.concat(eventRows);
  if(!all.length){
    document.getElementById("eventSummary").innerHTML='<div class="empty">Nenhum evento registrado no período.</div>';
    return;
  }
  var max=Math.max.apply(null,all.map(function(x){return x.n||0}).concat([1]));
  document.getElementById("eventSummary").innerHTML='<table class="sumtable"><thead><tr><th>Evento / conversão</th><th style="text-align:left">Tipo</th><th>Qtd.</th><th>Sessões / RD</th></tr></thead><tbody>'+
    all.map(function(x){return '<tr><td>'+esc(x.name)+'</td><td style="text-align:left;font-weight:500;color:var(--muted)">'+esc(x.type)+'</td><td class="num">'+pretty(x.n)+'</td><td class="num">'+pretty(x.sessions)+'</td></tr>';}).join("")+
    '</tbody></table>';
}

function eventBars(rows,max,emptyMsg){
  rows=rows||[];
  if(!rows.length)return '<div class="empty">'+emptyMsg+'</div>';
  max=max||Math.max.apply(null,rows.map(function(x){return x.n||0}).concat([1]));
  return '<div class="event-bars">'+rows.map(function(x){
    var w=Math.max(5,Math.round((x.n||0)/max*100));
    return '<div class="event-bar"><span class="name" title="'+esc(x.name)+'">'+esc(x.name)+'</span><span class="count">'+pretty(x.n)+'</span><span class="track"><span class="fill" style="width:'+w+'%"></span></span></div>';
  }).join("")+'</div>';
}

/* Antes aqui morava um donut de "atribuição" que, na prática, só dizia quanto era
   "direto" — não ajudava a decidir nada e ninguém entendia o nome. Trocado pelo
   ranking das CAMPANHAS que mais trazem lead, com conversão e crédito. Os dados vêm
   do /api/campaigns (mesmo carregamento da aba Campanhas), por isso o renderCampaigns
   chama esta função de novo quando os dados chegam. */
function renderOverviewTopCamps(){
  var box=document.getElementById("overviewTopCamps");
  var hint=document.getElementById("topCampHint");
  if(!box)return;
  if(!campData||!campData.rows){box.innerHTML='<div class="empty">Carregando campanhas…</div>';return;}
  var map={},visits={};
  campData.rows.forEach(function(r){
    map[r.camp]=map[r.camp]||{leads:0,mql:0,valor:0};
    map[r.camp].leads+=Number(r.leads||0);
    map[r.camp].mql+=Number(r.mql||0);
    map[r.camp].valor+=Number(r.valor||0);
  });
  (campData.visits||[]).forEach(function(r){ visits[r.camp]=(visits[r.camp]||0)+Number(r.n||0); });
  var keys=Object.keys(map).sort(function(a,b){return map[b].leads-map[a].leads}).slice(0,5);
  var totalLeads=Object.keys(map).reduce(function(a,k){return a+map[k].leads},0);
  hint.textContent=totalLeads?(totalLeads+" leads no período"):"";
  if(!keys.length){box.innerHTML='<div class="empty">Nenhum lead com campanha identificada no período.</div>';return;}
  // rosca com a fatia de cada campanha + legenda com leads e conversão
  var nomeCamp=function(k){return (k==="(sem campanha)")?"Sem campanha (direto/orgânico)":k;};
  drawDonut("campMixChart",keys.map(nomeCamp),keys.map(function(k){return map[k].leads}));
  box.innerHTML='<div class="legend-list">'+keys.map(function(k,i){
    var m=map[k], v=visits[k]||0;
    return '<div class="legend-item">'+
      '<span class="legend-dot" style="background:'+CHART_PALETTE[i%CHART_PALETTE.length]+'"></span>'+
      '<span class="name" title="'+esc(nomeCamp(k))+'">'+esc(nomeCamp(k))+'</span>'+
      '<span class="num">'+m.leads+' · '+pct(m.leads,totalLeads)+'%'+(v?' <small style="color:var(--muted)">('+pct(m.leads,v)+'% conv.)</small>':'')+'</span>'+
    '</div>';
  }).join("")+'</div>'+
  '<button class="btn-sm" style="margin-top:10px" onclick="showTab(&quot;campaigns&quot;)">Ver todas as campanhas →</button>';
}

function renderOverviewSources(rows){
  rows=rows||[];
  var hint=document.getElementById("overviewSourcesHint");
  var legend=document.getElementById("overviewSourcesLegend");
  if(!hint||!legend)return;
  var total=rows.reduce(function(a,x){return a+(x.n||0)},0);
  var direct=rows.reduce(function(a,x){return a+((!x.source||x.source==="direto")?Number(x.n||0):0)},0);
  var withUtm=Math.max(0,total-direct);
  hint.textContent=total?(total+(total===1?" lead":" leads")+" · "+pct(direct,total)+"% sem UTM"):"";
  if(!rows.length){
    legend.innerHTML='<div class="empty">Nenhuma fonte de lead no período.</div>';
    drawDonut("sourceChart",[],[]);
    return;
  }
  var sourceName=function(s){return (!s||s==="direto")?"Sem UTM / direto":s;};
  var labels=rows.slice(0,6).map(function(x){return sourceName(x.source)});
  var vals=rows.slice(0,6).map(function(x){return x.n||0});
  drawDonut("sourceChart",labels,vals);
  var list=rows.slice(0,6).map(function(x,i){
    var color=CHART_PALETTE[i%CHART_PALETTE.length];
    var nm=sourceName(x.source);
    return '<div class="legend-item"><span class="legend-dot" style="background:'+color+'"></span><span class="name" title="'+esc(nm)+'">'+esc(nm)+'</span><span class="num">'+pretty(x.n)+' · '+pct(x.n,total)+'%</span></div>';
  }).join("");
  legend.innerHTML=list+
    '<div class="source-mix">'+
      '<div class="mini"><span>Com UTM</span><strong>'+pretty(withUtm)+'</strong><small>'+pct(withUtm,total)+'% rastreado por campanha</small></div>'+
      '<div class="mini"><span>Sem UTM</span><strong>'+pretty(direct)+'</strong><small>'+pct(direct,total)+'% entra como direto</small></div>'+
    '</div>'+
    (direct?'<div class="source-note"><b>Direto</b> não é uma campanha. É lead sem <b>utm_source</b> identificado — normalmente link sem UTM, acesso digitado, WhatsApp/Instagram sem parâmetro ou navegador escondendo a origem.</div>':'');
}

/* Funil de conversão com silhueta real: cada etapa é um trapézio que vai da própria
   largura até a largura da etapa seguinte, então as bordas se encontram e formam um
   funil contínuo. Nome e números ficam FORA da forma (nunca são cortados pelo clip). */
function renderFunnel(steps){
  var max=Math.max(1, steps[0][1]||0);
  var pctW=function(v){return Math.max(7, (v||0)/max*100);};
  document.getElementById("funnel").innerHTML=steps.map(function(s,i){
    var last=(i===steps.length-1);
    var wTop=pctW(s[1]), wBot=pctW(last?s[1]:steps[i+1][1]);
    var clip='polygon('+((100-wTop)/2).toFixed(2)+'% 0%,'+((100+wTop)/2).toFixed(2)+'% 0%,'+
             ((100+wBot)/2).toFixed(2)+'% 100%,'+((100-wBot)/2).toFixed(2)+'% 100%)';
    var prev=i>0?steps[i-1][1]:0;
    var conv=i>0?(prev?Math.round(((s[1]||0)/prev)*100)+"% do passo anterior":"—"):"base do funil";
    return '<div class="fn-row'+(last?' last':'')+'">'+
      '<div class="fn-name">'+s[0]+'</div>'+
      '<div class="fn-shape"><span class="tz" style="clip-path:'+clip+'"></span></div>'+
      '<div class="fn-stats"><span class="n">'+pretty(s[1])+'</span><span class="c">'+conv+'</span></div>'+
    '</div>';
  }).join("");
}

/* ---- Saúde do tracking (Fase B): resgate ITP, bots, cobertura de PII ---- */
/* ---- Saúde do tracking: medidores em vez de parede de número ----
   Cada anel responde UMA pergunta em português e já vem com o veredito (bom/atenção/
   ruim), pra não precisar saber o que é ITP ou Advanced Matching pra usar a aba. */
function gaugeCard(title,valuePct,inner,desc,verdictTxt,verdict){
  var color=verdict==="good"?"#10b981":(verdict==="warn"?"#f59e0b":"#ef4444");
  var deg=Math.max(0,Math.min(100,valuePct))*3.6;
  return '<div class="gauge">'+
    '<div class="ring" style="background:conic-gradient('+color+' '+deg+'deg,#eef0f3 0)">'+
      '<i><b>'+valuePct+'%</b><small>'+esc(inner)+'</small></i></div>'+
    '<h3>'+esc(title)+'</h3><p>'+desc+'</p>'+
    '<span class="verdict '+verdict+'">'+esc(verdictTxt)+'</span>'+
  '</div>';
}
function verdictOf(v,good,warn){return v>=good?"good":(v>=warn?"warn":"bad");}

function renderHealth(d){
  var t=(d&&d.totals)||{}, total=t.total||0;
  var g=document.getElementById("healthGauges"), sig=document.getElementById("healthSignals");
  var fbp=document.getElementById("healthFbp"), br=document.getElementById("healthBrowser"), bots=document.getElementById("healthBots");
  if(d&&d.pendente){
    document.getElementById("healthVerdict").textContent="Painel aguardando a migration 0008";
    document.getElementById("healthSummary").textContent="Rode o SQL 0008 no Console do D1 para ligar o diagnóstico de rastreamento.";
    g.innerHTML=''; sig.innerHTML=''; fbp.innerHTML=br.innerHTML=bots.innerHTML='';
    return;
  }
  var entrega=pct(t.meta_ok,total);
  var pii=Math.round((pct(t.com_email,total)+pct(t.com_telefone,total)+pct(t.com_nome,total))/3);
  var atrib=pct(t.com_fbclid,total);
  var limpo=total?100-pct(t.bots,total):100;

  var vEnt=verdictOf(entrega,85,60), vPii=verdictOf(pii,80,55), vAtr=verdictOf(atrib,50,20), vLimpo=verdictOf(limpo,95,85);
  var piores=[vEnt,vPii,vAtr,vLimpo];
  var geral=piores.indexOf("bad")>=0?"bad":(piores.indexOf("warn")>=0?"warn":"good");
  document.getElementById("healthVerdict").textContent=
    geral==="good"?"Rastreamento saudável":(geral==="warn"?"Rastreamento funcionando, com pontos de atenção":"Rastreamento com problema");
  document.getElementById("healthSummary").textContent=
    "De "+total+" lead"+(total===1?"":"s")+" no período, "+pretty(t.meta_ok)+" chegaram no Meta e "+
    pretty(t.itp_recuperado)+" só foram atribuídos porque o nosso cookie de servidor resgatou a origem.";
  document.getElementById("healthMeta").innerHTML=
    '<span class="chip">'+(d.page==="all"?"Todas as páginas":label(d.page||"all"))+'</span>'+
    '<span class="chip">'+(d.range?d.range.start+" → "+d.range.end:"")+'</span>';

  g.innerHTML=
    gaugeCard("Entrega no Meta",entrega,"dos leads",
      "Quantos leads a Meta aceitou pela CAPI. O que não chega aqui não vira conversão nem otimiza campanha.",
      vEnt==="good"?"Entregando bem":(vEnt==="warn"?"Perdendo alguns":"Muita perda"),vEnt)+
    gaugeCard("Dados para casar a pessoa",pii,"de cobertura",
      "Média de e-mail, telefone e nome enviados. Quanto mais completo, maior a chance da Meta reconhecer quem é e dar o crédito da venda ao anúncio certo.",
      vPii==="good"?"Boa qualidade":(vPii==="warn"?"Dá pra melhorar":"Cobertura baixa"),vPii)+
    gaugeCard("Origem identificada",atrib,"com clique",
      "Leads que chegaram com o identificador de clique do anúncio (fbclid). Sem ele a Meta não sabe qual anúncio trouxe a pessoa.",
      vAtr==="good"?"Atribuição forte":(vAtr==="warn"?"Parcial":"Pouca atribuição"),vAtr)+
    gaugeCard("Tráfego limpo",limpo,"humanos",
      "Parte dos leads que veio de gente de verdade. Os robôs identificados são bloqueados antes de sujar o Pixel.",
      vLimpo==="good"?"Sem poluição":(vLimpo==="warn"?"Alguns robôs":"Muito robô"),vLimpo);

  sig.innerHTML=signalCards([
    {name:"Resgatados pelo cookie",n:t.itp_recuperado||0,sub:"leads que o Safari/ITP teria feito perder a origem e o nosso cookie de servidor salvou",hot:true},
    {name:"Robôs barrados",n:t.bots||0,sub:"crawlers bloqueados antes de virarem conversão falsa no Pixel"},
    {name:"Sem cookie do Meta",n:t.sem_cookie_meta||0,sub:"navegador chegou sem cookie do Pixel no envio (bloqueador ou navegação privada)"},
    {name:"Entregues no Meta",n:t.meta_ok||0,sub:"eventos aceitos pela CAPI no período",hot:true}
  ],Math.max(total,1));

  fbp.innerHTML=kvBars(d.by_fbp_source, total, "Sem dados no período.");
  br.innerHTML=kvBars(d.by_browser, total, "Sem dados no período.");
  bots.innerHTML=kvBars(d.by_bot, total, "Nenhum robô registrado no período.");
}
// adapta [{k,n}] pro barList({lbl,val,sub,w})
function kvBars(rows, total, emptyMsg){
  rows=rows||[];
  if(!rows.length)return '<div class="empty">'+emptyMsg+'</div>';
  var max=Math.max.apply(null,rows.map(function(x){return x.n||0}).concat([1]));
  return barList(rows.map(function(x){
    return {lbl:x.k, val:x.n, sub:total?pct(x.n,total)+"%":"", w:max?x.n/max:0};
  }));
}

/* ---- Campanhas: navegação campanha > conjunto > anúncio, no espírito do
   Gerenciador de Anúncios do Meta (as UTMs dos anúncios carregam exatamente esses
   3 níveis: utm_campaign / utm_medium / utm_content). A API manda as combinações
   cruas; a agregação por nível é feita aqui, então trocar de nível é instantâneo. */
var campData=null, campChart=null, campSourceChart=null;
var campLevel="campaign", campSel={camp:null,med:null};
// Filtro de ORIGEM (utm_source) — GLOBAL: sai do seletor do cabeçalho e vale pro
// dashboard inteiro. Já abre em "meta_ads" (é onde o cliente investe); trocar pra
// "todas" mostra tudo, inclusive o lixo de teste (teste-claude, codex-teste…).
var campSrc="meta_ads";
var LEVEL_NAME={campaign:"Campanhas",adset:"Conjuntos de anúncios",ad:"Anúncios"};
var LEVEL_ONE={campaign:"campanha",adset:"conjunto",ad:"anúncio"};

function brlShort(v){
  v=Number(v||0);
  if(v>=1e6)return "R$ "+(v/1e6).toFixed(v>=1e7?0:1).replace(".",",")+" mi";
  if(v>=1e3)return "R$ "+Math.round(v/1e3)+" mil";
  return "R$ "+v;
}
function campKeyOf(r,level){return level==="campaign"?r.camp:(level==="adset"?r.med:r.cont);}
function campSrcOk(r){ return campSrc==="all"||r.src===campSrc; }
function campInScope(r,level){
  if(!campSrcOk(r))return false;
  if(campSel.camp&&r.camp!==campSel.camp)return false;
  if(level==="ad"&&campSel.med&&r.med!==campSel.med)return false;
  return true;
}
function campAggregate(level){
  var map={};
  ((campData&&campData.rows)||[]).forEach(function(r){
    if(!campInScope(r,level))return;
    var k=campKeyOf(r,level);
    if(!map[k])map[k]={k:k,leads:0,mql:0,desq:0,valor:0,srcs:{},kids:{}};
    var m=map[k];
    m.leads+=Number(r.leads||0); m.mql+=Number(r.mql||0);
    m.desq+=Number(r.desq||0);   m.valor+=Number(r.valor||0);
    m.srcs[r.src]=1;
    m.kids[level==="campaign"?r.med:r.cont]=1;
  });
  return Object.keys(map).map(function(k){
    var m=map[k]; m.srcList=Object.keys(m.srcs); m.kidsN=Object.keys(m.kids).length; return m;
  }).sort(function(a,b){return b.leads-a.leads});
}
function campVisitsMap(level){
  var map={};
  ((campData&&campData.visits)||[]).forEach(function(r){
    if(!campInScope(r,level))return;
    map[campKeyOf(r,level)]=(map[campKeyOf(r,level)]||0)+Number(r.n||0);
  });
  return map;
}
function campCount(level){
  var seen={},n=0;
  ((campData&&campData.rows)||[]).forEach(function(r){
    if(!campInScope(r,level))return;
    var k=campKeyOf(r,level);
    if(!seen[k]){seen[k]=1;n++;}
  });
  return n;
}
function setCampLevel(level){ campLevel=level; renderCampScope(); }
function campDrill(level,key){
  if(level==="campaign"){campSel.camp=key;campSel.med=null;campLevel="adset";}
  else if(level==="adset"){campSel.med=key;campLevel="ad";}
  renderCampScope();
}
function campReset(to){
  if(to==="all"){campSel.camp=null;campSel.med=null;campLevel="campaign";}
  else if(to==="camp"){campSel.med=null;campLevel="adset";}
  renderCampScope();
}

function renderCampaigns(d){
  campData=d||{};
  campSrc=currentSrc(); // o filtro é global: vem do cabeçalho
  // se a seleção antiga sumiu do novo período, volta pro topo em vez de mostrar vazio
  var rows=campData.rows||[];
  var hasCamp=!campSel.camp||rows.some(function(r){return r.camp===campSel.camp});
  var hasMed=!campSel.med||rows.some(function(r){return r.camp===campSel.camp&&r.med===campSel.med});
  if(!hasCamp){campSel.camp=null;campSel.med=null;campLevel="campaign";}
  else if(!hasMed){campSel.med=null;if(campLevel==="ad")campLevel="adset";}

  campFillSrcOptions();
  // KPIs saem das linhas FILTRADAS (não do total do servidor), senão o filtro de
  // origem mostraria um número em cima e outro embaixo.
  var t={total:0,com_utm:0,valor:0,mql:0};
  rows.filter(campSrcOk).forEach(function(r){
    t.total+=Number(r.leads||0); t.mql+=Number(r.mql||0); t.valor+=Number(r.valor||0);
    if(r.src&&r.src!=="direto")t.com_utm+=Number(r.leads||0);
  });
  var visitsTotal=(campData.visits||[]).filter(campSrcOk).reduce(function(a,x){return a+Number(x.n||0)},0);
  var kpis=[
    ["Leads no período",pretty(t.total),pretty(t.com_utm)+" vieram de campanha"],
    ["Visitas rastreadas",pretty(visitsTotal),visitsTotal?"sessões no site":"sem sessões no período"],
    ["Conversão do site",visitsTotal?pct(t.total,visitsTotal)+"%":"—","visita → lead"],
    ["Crédito solicitado",brlShort(t.valor),"soma dos leads"],
    ["Qualificados",pretty(t.mql),pct(t.mql,t.total)+"% dos leads"]
  ];
  document.getElementById("campKpis").innerHTML=kpis.map(function(k){
    return '<div class="kpi"><div class="label">'+k[0]+'</div><div class="val">'+k[1]+'</div><div class="sub"><b>'+k[2]+'</b></div></div>';
  }).join("");
  renderCampScope();
  renderOverviewTopCamps(); // a visão geral usa os mesmos dados
}

function renderCampScope(){
  if(!campData)return;
  ["campaign","adset","ad"].forEach(function(l){
    var btn=document.getElementById("lvl-"+l);
    if(btn)btn.classList.toggle("active",l===campLevel);
  });
  document.getElementById("lvlnCampaign").textContent=campCount("campaign");
  document.getElementById("lvlnAdset").textContent=campCount("adset");
  document.getElementById("lvlnAd").textContent=campCount("ad");

  // Trilha (breadcrumb): mostra onde você está e deixa voltar um nível por vez.
  var crumb='<button onclick="campReset(\\'all\\')">Todas as campanhas</button>';
  if(campSel.camp){
    crumb+='<span class="sep">›</span>';
    crumb+=campSel.med?'<button onclick="campReset(\\'camp\\')">'+esc(campSel.camp)+'</button>'
                      :'<span class="now" title="'+esc(campSel.camp)+'">'+esc(campSel.camp)+'</span>';
  }
  if(campSel.med){crumb+='<span class="sep">›</span><span class="now" title="'+esc(campSel.med)+'">'+esc(campSel.med)+'</span>';}
  document.getElementById("campCrumb").innerHTML=crumb;

  renderCampRows();
  renderCampChart();
  renderCampSources();
  renderCampAudience();
}

function renderCampRows(){
  var level=campLevel;
  var rows=campAggregate(level), visits=campVisitsMap(level);
  var box=document.getElementById("campRows");
  document.getElementById("campRowsTitle").textContent=LEVEL_NAME[level];
  var totalLeads=rows.reduce(function(a,x){return a+x.leads},0);
  var scopeTxt=campSel.med?("conjunto "+campSel.med):(campSel.camp?("campanha "+campSel.camp):"todo o período");
  document.getElementById("campRowsHint").textContent=rows.length+" "+(rows.length===1?LEVEL_ONE[level]:LEVEL_ONE[level]+"s")+" · "+scopeTxt;
  if(!rows.length){
    box.innerHTML='<div class="empty">Nenhum '+LEVEL_ONE[level]+' com lead neste recorte.'+
      (level==="ad"?' Os anúncios só aparecem quando o link do Meta manda <b>utm_content</b> com o nome do criativo.':'')+'</div>';
    return;
  }
  var max=Math.max.apply(null,rows.map(function(x){return x.leads}).concat([1]));
  var drillable=level!=="ad";
  box.innerHTML=rows.map(function(r,i){
    var v=visits[r.k]||0;
    var conv=v?pct(r.leads,v)+"%":"—";
    var kidsTxt=level==="campaign"?(r.kidsN+" conjunto"+(r.kidsN===1?"":"s")):(level==="adset"?(r.kidsN+" anúncio"+(r.kidsN===1?"":"s")):"");
    var tags='<span class="am-tag">'+esc(r.srcList.slice(0,2).join(" · "))+'</span>'+
             (kidsTxt?'<span class="am-tag">'+kidsTxt+'</span>':'')+
             (v?'<span class="am-tag">'+v+' visitas</span>':'');
    return '<button class="am-row'+(drillable?'':' is-flat')+'"'+(drillable?' onclick="campDrill(\\''+level+'\\',this.dataset.k)"':'')+
      ' data-k="'+esc(r.k)+'">'+
      '<span class="am-rank">'+(i+1)+'</span>'+
      '<span class="am-main">'+
        '<span class="am-name" title="'+esc(r.k)+'">'+esc(r.k)+'</span>'+
        '<span class="am-tags">'+tags+'</span>'+
        '<span class="am-track"><span style="width:'+Math.max(4,Math.round(r.leads/max*100))+'%"></span></span>'+
      '</span>'+
      '<span class="am-metric"><b>'+r.leads+'</b><small>leads</small></span>'+
      '<span class="am-metric'+(v?' hot':'')+'"><b>'+conv+'</b><small>conversão</small></span>'+
      '<span class="am-metric"><b>'+brlShort(r.valor)+'</b><small>crédito</small></span>'+
      '<span class="am-metric"><b>'+pct(r.mql,r.leads)+'%</b><small>qualif.</small></span>'+
      '<span class="am-go">'+(drillable?'›':'')+'</span>'+
    '</button>';
  }).join("")+(totalLeads?'':'');
}

/* Alimenta o seletor GLOBAL de origem do cabeçalho com as origens que existem de fato
   no período (com a contagem de leads ao lado). O /api/campaigns é o único endpoint que
   volta SEM o filtro aplicado — de propósito: é dele que sai a lista de opções. */
function campFillSrcOptions(){
  var sel=document.getElementById("srcSel");
  if(!sel||!campData)return;
  var by={};
  (campData.rows||[]).forEach(function(r){ by[r.src]=(by[r.src]||0)+Number(r.leads||0); });
  (campData.visits||[]).forEach(function(r){ if(by[r.src]===undefined)by[r.src]=0; });
  if(by.meta_ads===undefined)by.meta_ads=0; // sempre ofertar o padrão do painel
  var keys=Object.keys(by).sort(function(a,b){return by[b]-by[a]});
  var atual=sel.value;
  sel.innerHTML='<option value="all">Origem: todas</option>'+keys.map(function(k){
    return '<option value="'+esc(k)+'">Origem: '+esc(k)+' ('+by[k]+')</option>';
  }).join("");
  sel.value=(keys.indexOf(atual)>-1||atual==="all")?atual:"all";
  campSrc=sel.value;
}

function renderCampChart(){
  var byDay={};
  ((campData&&campData.daily)||[]).forEach(function(r){
    if(!campSrcOk(r))return;
    if(campSel.camp&&r.camp!==campSel.camp)return;
    byDay[r.d]=byDay[r.d]||{l:0,v:0}; byDay[r.d].l+=Number(r.n||0);
  });
  ((campData&&campData.daily_visits)||[]).forEach(function(r){
    if(!campSrcOk(r))return;
    if(campSel.camp&&r.camp!==campSel.camp)return;
    byDay[r.d]=byDay[r.d]||{l:0,v:0}; byDay[r.d].v+=Number(r.n||0);
  });
  var days=Object.keys(byDay).sort();
  var ctx=document.getElementById("campChart");
  if(campChart){campChart.destroy();campChart=null;}
  document.getElementById("campChartTitle").textContent=campSel.med?("Conjunto: "+campSel.med):(campSel.camp?("Campanha: "+campSel.camp):"Visitas e leads por dia");
  var since=(campData&&campData.visits_since)||null;
  document.getElementById("campChartHint").textContent=since?("visitas contadas desde "+since.split("-").reverse().join("/")):"";
  if(!days.length){
    ctx.parentNode.innerHTML='<div class="empty">Sem movimento no período.</div>';
    return;
  }
  campChart=new Chart(ctx,{type:"line",data:{labels:days.map(function(d){return d.slice(5)}),datasets:[
    {label:"Visitas",data:days.map(function(d){return byDay[d].v}),borderColor:"rgba(11,45,114,.32)",backgroundColor:"rgba(11,45,114,.06)",fill:true,tension:.38,pointRadius:0,borderWidth:3},
    {label:"Leads",data:days.map(function(d){return byDay[d].l}),borderColor:"#f97316",backgroundColor:"rgba(249,115,22,.10)",fill:false,tension:.38,pointRadius:2,pointBackgroundColor:"#f97316",borderWidth:3}
  ]},options:{maintainAspectRatio:false,interaction:{intersect:false,mode:"index"},plugins:{legend:{display:true,position:"bottom",labels:{boxWidth:22,usePointStyle:true,pointStyle:"line",color:"#6b7280",font:{family:"Inter",size:12,weight:"600"}}}},scales:{x:{ticks:{color:"#9ca3af"},grid:{display:false}},y:{beginAtZero:true,ticks:{color:"#9ca3af"},grid:{color:"#eef0f3"}}}}});
}

function renderCampSources(){
  var map={};
  ((campData&&campData.rows)||[]).forEach(function(r){
    if(!campSrcOk(r))return;
    if(campSel.camp&&r.camp!==campSel.camp)return;
    if(campSel.med&&r.med!==campSel.med)return;
    var k=(!r.src||r.src==="direto")?"Sem UTM / direto":r.src;
    map[k]=(map[k]||0)+Number(r.leads||0);
  });
  var keys=Object.keys(map).sort(function(a,b){return map[b]-map[a]}).slice(0,6);
  var total=keys.reduce(function(a,k){return a+map[k]},0);
  document.getElementById("campSourceHint").textContent=total?(total+(total===1?" lead":" leads")):"";
  var ctx=document.getElementById("campSourceChart");
  if(campSourceChart){campSourceChart.destroy();campSourceChart=null;}
  var legend=document.getElementById("campSourceLegend");
  if(!keys.length){legend.innerHTML='<div class="empty">Sem leads neste recorte.</div>';return;}
  campSourceChart=new Chart(ctx,{type:"doughnut",data:{labels:keys,datasets:[{data:keys.map(function(k){return map[k]}),backgroundColor:CHART_PALETTE,borderColor:"#fff",borderWidth:4,hoverOffset:4}]},options:{maintainAspectRatio:false,cutout:"66%",plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return " "+c.label+": "+c.raw+" ("+pct(c.raw,total)+"%)";}}}}}});
  legend.innerHTML=keys.map(function(k,i){
    return '<div class="legend-item"><span class="legend-dot" style="background:'+CHART_PALETTE[i%CHART_PALETTE.length]+'"></span>'+
      '<span class="name" title="'+esc(k)+'">'+esc(k)+'</span><span class="num">'+map[k]+' · '+pct(map[k],total)+'%</span></div>';
  }).join("");
}

/* Público POSSÍVEL: o que sabemos dos nossos próprios leads (dispositivo, navegador,
   cidade, faixa de crédito, tipo de imóvel). Idade/gênero do Meta exigiriam ads_read. */
function renderCampAudience(){
  var box=document.getElementById("campAudience");
  var dims={};
  ((campData&&campData.audience)||[]).forEach(function(r){
    if(!campSrcOk(r))return;
    if(campSel.camp&&r.camp!==campSel.camp)return;
    dims[r.dim]=dims[r.dim]||{};
    dims[r.dim][r.k]=(dims[r.dim][r.k]||0)+Number(r.n||0);
  });
  var names=Object.keys(dims);
  document.getElementById("campAudienceHint").textContent=campSel.camp?("campanha "+campSel.camp):"todos os leads do período";
  if(!names.length){
    box.innerHTML='<div class="empty">Sem dados de público no período. Dispositivo e navegador só existem para leads capturados depois de 22/07/2026; cidade só vem do formulário completo.</div>';
    return;
  }
  box.innerHTML=names.map(function(dim){
    var m=dims[dim];
    var keys=Object.keys(m).sort(function(a,b){return m[b]-m[a]}).slice(0,5);
    var total=Object.keys(m).reduce(function(a,k){return a+m[k]},0);
    var max=Math.max.apply(null,keys.map(function(k){return m[k]}).concat([1]));
    return '<div class="aud-card"><h3>'+esc(dim)+'</h3>'+
      barList(keys.map(function(k){return {lbl:k,val:m[k],sub:pct(m[k],total)+"%",w:m[k]/max};}))+
    '</div>';
  }).join("");
}

function renderTraffic(d){
  renderSources(d.sources||[]);
  renderPagesSummary(d.pages||[]);
  renderClicksByPage(d.pages||[], d.clicks||[]);
}

// lista de barras ranqueadas: rows = [{lbl, val, sub, w(0..1)}]; a 1ª barra ganha o acento laranja
function barList(rows){
  return '<div class="bars">'+rows.map(function(r,i){
    var w=Math.max(4,Math.round((r.w||0)*100));
    return '<div class="bar-row'+(i===0?' top':'')+'"><span class="fill" style="width:'+w+'%"></span>'+
      '<span class="lbl" title="'+esc(r.lbl)+'">'+esc(r.lbl)+'</span>'+
      '<span class="val">'+r.val+(r.sub?'<small>'+r.sub+'</small>':'')+'</span></div>';
  }).join("")+'</div>';
}
function pageLink(pn){return PAGE_URLS[pn]?' <a href="'+PAGE_URLS[pn]+'" target="_blank" rel="noopener" title="Abrir esta página" style="color:var(--orange);text-decoration:none">↗</a>':'';}

function renderSources(so){
  var hint=document.getElementById("sourcesHint"), box=document.getElementById("sourcesList");
  if(!so.length){box.innerHTML='<div class="empty">Nenhum lead com origem no período.</div>';hint.textContent="";return}
  var total=so.reduce(function(a,x){return a+(x.n||0)},0);
  var max=Math.max.apply(null,so.map(function(x){return x.n||0}));
  hint.textContent=total+(total===1?" lead":" leads");
  box.innerHTML=barList(so.map(function(x){return {lbl:x.source||"direto",val:x.n,sub:total?Math.round(x.n/total*100)+"%":"",w:max?x.n/max:0};}));
}

function renderPagesSummary(pages){
  var box=document.getElementById("pagesSummary");
  if(!pages.length){box.innerHTML='<div class="empty">Sem acessos no período.</div>';return}
  var html='<table class="sumtable"><thead><tr><th>Página</th><th>Views</th><th>Únicos</th><th>Forms</th></tr></thead><tbody>';
  pages.forEach(function(p){
    html+='<tr><td>'+label(p.page_name)+pageLink(p.page_name)+'</td><td class="num">'+p.views+'</td><td class="num">'+p.uniques+'</td><td class="num">'+p.forms+'</td></tr>';
  });
  box.innerHTML=html+'</tbody></table>';
}

function renderClicksByPage(pages,clicks){
  var box=document.getElementById("pages");
  if(!pages.length){box.innerHTML='<div class="empty">Sem dados ainda. Assim que houver acessos, aparece aqui.</div>';return}
  box.innerHTML=pages.map(function(p){
    var rows=clicks.filter(function(c){return c.page_name===p.page_name}).slice(0,6);
    var head='<div class="head"><span class="pname">'+label(p.page_name)+pageLink(p.page_name)+'</span><span class="pstats">'+p.views+' views · '+p.uniques+' únicos</span></div>';
    if(!rows.length)return '<div class="pagecard">'+head+'<div class="empty" style="padding:12px 0">Sem cliques registrados.</div></div>';
    var max=Math.max.apply(null,rows.map(function(c){return c.clicks}));
    return '<div class="pagecard">'+head+barList(rows.map(function(c){return {lbl:(c.element_text||c.element_id||"(sem identificação)"),val:c.clicks,sub:"",w:max?c.clicks/max:0};}))+'</div>';
  }).join("");
}

function currentLeadFilter(){var el=document.getElementById("leadEventFilter");return el?el.value:"all";}
function leadMatchesFilter(l,filter){
  var k=l.lead_kind||"sem_classificacao";
  if(filter==="all")return true;
  if(filter==="nao_qualificado")return k==="baixo_valor"||k==="descarte";
  return k===filter;
}
function leadKindPill(k){
  var lb=LEAD_KIND_LABELS[k]||pretty(k);
  var cls=k==="home_equity_mql"?"orange":(k==="home_equity"||k==="auto"?"blue":(k==="baixo_valor"||k==="descarte"?"wait":"green"));
  return '<span class="pill '+cls+'">'+esc(lb)+'</span>';
}
function leadHasMetaLead(l){
  return (l.lead_kind==="home_equity"||l.lead_kind==="home_equity_mql"||l.lead_kind==="auto")&&l.meta_status==="ok";
}
function leadHasMql(l){return l.lead_kind==="home_equity_mql"&&l.meta_status==="ok";}
function eventDot(label,state,title){
  var ok={sent:1,skip:1,err:1,bot:1,off:1};
  var cls=ok[state]?state:"off";
  return '<span class="event-dot '+cls+'"'+(title?' title="'+esc(title)+'"':'')+'>'+label+'</span>';
}
/* Traduz o status cru gravado no D1 pro selo colorido. Cada cor tem UM significado:
   verde = entregue · laranja = não enviado de propósito (regra) · roxo = robô barrado
   antes de sujar o Pixel · vermelho = FALHA de verdade (a API recusou/deu erro) ·
   cinza = não se aplica a este tipo de lead. O status cru vai no title (hover). */
function statusDot(label,status,applies,skipWhy){
  if(!applies)return eventDot(label,"off","Não se aplica a este tipo de lead");
  if(status==="ok")return eventDot(label,"sent","Entregue com sucesso");
  if(status==="nao_enviado")return eventDot(label,"skip",skipWhy||"Não enviado por regra de qualificação");
  if(status==="bot_skip")return eventDot(label,"bot","Acesso identificado como robô — não enviado de propósito");
  if(status==null||status==="")return eventDot(label,"off",skipWhy||"Sem registro de envio");
  return eventDot(label,"err","Falha no envio — resposta da API: "+status);
}
function leadEventDot(l,type){
  var kind=l.lead_kind||"";
  if(type==="rd"){
    // descarte (sem imóvel e sem veículo) nunca é enviado: é decisão de arquitetura,
    // não erro — por isso laranja "por regra" e não cinza/vermelho.
    if(kind==="descarte")return statusDot("RD",l.rd_status||"nao_enviado",true,"Sem imóvel e sem veículo — fica só no nosso banco");
    return statusDot("RD",l.rd_status,true);
  }
  if(type==="lead"){
    var appliesLead=kind==="home_equity"||kind==="home_equity_mql"||kind==="auto";
    return statusDot("Lead",l.meta_status,appliesLead||!!l.meta_status,
      appliesLead?null:"Lead desqualificado não dispara evento de conversão no Meta");
  }
  if(type==="mql"){
    if(kind!=="home_equity_mql")return eventDot("MQL","off","Só leads qualificados disparam MQL");
    return statusDot("MQL",l.meta_status,true);
  }
  return eventDot(type,"off");
}
function eventLegend(){
  return '<div class="event-legend">'+
    eventDot("entregue","sent","Chegou no destino")+
    eventDot("não enviado por regra","skip","De propósito: o lead não se qualifica para esse envio")+
    eventDot("robô barrado","bot","Crawler detectado — bloqueado antes de sujar o Pixel")+
    eventDot("falha no envio","err","A API respondeu com erro — vale investigar")+
    eventDot("não se aplica","off","Esse envio não existe para este tipo de lead")+
  '</div>';
}
/* Critérios de qualificação — os MESMOS números do formulário, da landing, da Home
   Equity e do servidor. Ficam escritos na tela pra ninguém precisar adivinhar por que
   um lead entrou como qualificado ou não. Se a regra mudar no código, muda aqui. */
var MIN_IMOVEL=400000, MIN_CREDITO=200000, MQL_IMOVEL=1000000, MQL_CREDITO=500000;
function valorCell(v,minimo,kind){
  if(v==null||v==="")return '<span class="val-na">—</span>';
  // automóvel e descarte não são avaliados pela régua do imóvel: mostra neutro
  if(kind==="auto"||kind==="descarte")return '<span class="val-na">'+brl(v)+'</span>';
  var ok=Number(v)>=minimo;
  return '<span class="val-'+(ok?'ok':'no')+'" title="'+(ok?'atende ao mínimo de ':'abaixo do mínimo de ')+brl(minimo)+'">'+brl(v)+'</span>';
}
function criteriaBox(){
  return '<div class="criteria">'+
    '<b>Como um lead vira qualificado</b>'+
    '<ul>'+
      '<li><span class="val-ok">Imóvel a partir de '+brl(MIN_IMOVEL)+'</span> <b>E</b> <span class="val-ok">crédito a partir de '+brl(MIN_CREDITO)+'</span> → conta como <b>Lead</b> no Meta e vai pro RD.</li>'+
      '<li>Imóvel a partir de '+brl(MQL_IMOVEL)+' <b>E</b> crédito a partir de '+brl(MQL_CREDITO)+' → <b>Lead qualificado</b> (MQL).</li>'+
      '<li><span class="val-no">Abaixo de qualquer um dos dois</span> → <b>vai pro RD Station do mesmo jeito</b>, mas <b>não</b> dispara evento de conversão no Meta.</li>'+
      '<li>Sem imóvel <b>e</b> sem veículo → fica só no nosso banco (não vai pro RD).</li>'+
    '</ul>'+
    '<small>As duas condições valem juntas (E, não OU): imóvel de R$ 1 milhão pedindo R$ 100 mil <b>não</b> é qualificado, porque o crédito está abaixo do mínimo.</small>'+
  '</div>';
}
function pageLeadLink(source){
  var u=PAGE_URLS[source], txt=label(source);
  return u?'<a class="page-chip" href="'+u+'" target="_blank" rel="noopener">'+esc(txt)+' ↗</a>':'<span class="page-chip">'+esc(txt)+'</span>';
}
function renderLeads(d){
  if(d) lastAllLeads=d.leads||[];
  var filter=currentLeadFilter();
  lastLeads=lastAllLeads.filter(function(l){return leadMatchesFilter(l,filter);});
  var n=lastLeads.length, totalAll=lastAllLeads.length;
  var filterLabel=document.getElementById("leadEventFilter")?document.getElementById("leadEventFilter").selectedOptions[0].textContent:"Todas";
  document.getElementById("leadsTitle").textContent="Leads ("+n+(filter==="all"?"":" de "+totalAll)+")";
  var totalCredit=0, rdOk=0, metaOk=0;
  lastLeads.forEach(function(l){totalCredit+=Number(l.credit_value||0);if(l.rd_status==="ok")rdOk++;if(l.meta_status==="ok")metaOk++;});
  var lk=[["Filtro ativo",filterLabel,pretty(n)+" registro(s)"],["Valor total solicitado",brl(totalCredit),"em crédito"],["Ticket médio",n?brl(Math.round(totalCredit/n)):"-","por lead"],["Entrega RD Station",rdOk+"/"+n,pct(rdOk,n)+"% no CRM"],["Entrega Meta CAPI",metaOk+"/"+n,pct(metaOk,n)+"% no Pixel"]];
  document.getElementById("leadKpis").innerHTML=lk.map(function(k){return '<div class="kpi"><div class="label">'+k[0]+'</div><div class="val">'+k[1]+'</div><div class="sub">'+k[2]+'</div></div>'}).join("");
  renderLeadVisuals(lastLeads);
  if(!n){document.getElementById("leads").innerHTML='<div class="empty">Nenhum lead para este filtro.</div>';return}
  var html=criteriaBox()+eventLegend();
  html+='<table><thead><tr><th>Data</th><th>Nome</th><th>Classificação</th><th>Página</th><th>Imóvel</th><th>Crédito</th><th>RD</th><th>Meta Lead</th><th>MQL</th><th></th></tr></thead><tbody>';
  lastLeads.forEach(function(l,i){
    html+='<tr><td>'+(l.created_at||"").slice(0,16)+'</td>'+
      '<td><button class="lead-name-btn" onclick="showLead('+i+')">'+esc(l.name||"Lead sem nome")+'</button><div class="hint">'+esc(l.phone||"")+'</div></td>'+
      '<td>'+leadKindPill(l.lead_kind)+'</td><td>'+pageLeadLink(l.source)+'</td>'+
      '<td>'+valorCell(l.property_value,MIN_IMOVEL,l.lead_kind)+'</td>'+
      '<td>'+valorCell(l.credit_value,MIN_CREDITO,l.lead_kind)+'</td>'+
      '<td>'+leadEventDot(l,"rd")+'</td><td>'+leadEventDot(l,"lead")+'</td><td>'+leadEventDot(l,"mql")+'</td>'+
      '<td><button class="btn-sm" onclick="showLead('+i+')">Ver ficha</button></td></tr>';
  });
  document.getElementById("leads").innerHTML=html+'</tbody></table>';
}

function renderLeadVisuals(rows){
  rows=rows||[];
  var counts={}, rd=0, metaLead=0, mql=0;
  rows.forEach(function(l){
    var k=l.lead_kind||"sem_classificacao";
    counts[k]=(counts[k]||0)+1;
    if(l.rd_status==="ok")rd++;
    if(leadHasMetaLead(l))metaLead++;
    if(leadHasMql(l))mql++;
  });
  var keys=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a];});
  var labels=keys.map(function(k){return LEAD_KIND_LABELS[k]||k});
  var vals=keys.map(function(k){return counts[k]});
  var total=rows.length;
  document.getElementById("leadTypeHint").textContent=total?(total+(total===1?" lead":" leads")):"";
  drawDonut("leadTypeChart",labels,vals);
  document.getElementById("leadTypeLegend").innerHTML=keys.length?keys.map(function(k,i){
    var color=CHART_PALETTE[i%CHART_PALETTE.length];
    return '<div class="legend-item"><span class="legend-dot" style="background:'+color+'"></span><span class="name">'+esc(LEAD_KIND_LABELS[k]||k)+'</span><span class="num">'+counts[k]+' · '+pct(counts[k],total)+'%</span></div>';
  }).join(""):'<div class="empty">Nenhum lead para este filtro.</div>';
  document.getElementById("leadDeliveryBars").innerHTML=eventBars([
    {name:"RD Station",n:rd},
    {name:"Meta Lead",n:metaLead},
    {name:"Lead qualificado",n:mql},
    {name:"Sem Lead no Meta",n:Math.max(0,total-metaLead)}
  ], Math.max(total,1), "Nenhum lead para este filtro.");
}

function showLead(i,list){
  var l=(list||lastLeads)[i]; if(!l)return;
  document.getElementById("modalName").textContent=l.name||"Lead sem nome";
  document.getElementById("modalDate").textContent=(l.created_at||"").slice(0,16);
  // Ficha em seções: row(label,val) sempre mostra; opt(label,val) só se tiver valor
  // (evita parede de "-" nos formulários que não coletam aquele campo).
  var h="";
  function row(lb,v){h+='<dt>'+lb+'</dt><dd>'+v+'</dd>';}
  function opt(lb,v){if(v!=null&&v!=="")h+='<dt>'+lb+'</dt><dd>'+esc(v)+'</dd>';}
  function sec(t){h+='<div class="sec">'+t+'</div>';}
  sec("Contato");
  row("Telefone",pretty(l.phone)); row("E-mail",pretty(l.email)); opt("Cidade",l.city);
  opt("Classificação",l.lead_kind?(LEAD_KIND_LABELS[l.lead_kind]||l.lead_kind):null);
  var isAutoLead=l.lead_kind==="auto";
  sec("Bem & simulação");
  row("Tipo de bem",isAutoLead?"Automóvel":"Imóvel");
  if(!isAutoLead) row("Tipo de imóvel",pretty(l.property_type));
  // mesmo código de cor da tabela: verde atende ao mínimo, vermelho está abaixo
  opt(isAutoLead?"Valor do automóvel":"Valor do imóvel",l.property_value?valorCell(l.property_value,MIN_IMOVEL,l.lead_kind):null);
  row("Crédito desejado",valorCell(l.credit_value,MIN_CREDITO,l.lead_kind));
  opt("Faixa de crédito",l.faixa_credito);
  opt("Imóvel quitado?",l.imovel_quitado);
  opt(isAutoLead?"Situação do automóvel":"Situação do imóvel",l.situacao_imovel);
  opt("Documentação ok?",l.documentacao_ok);
  opt("Possui imóvel?",l.possui_imovel);
  opt("Possui matrícula?",l.possui_matricula);
  opt("Saldo devedor",l.saldo_devedor?brl(l.saldo_devedor):null);
  sec("Origem & campanha");
  row("Origem (página)",pageLeadLink(l.source));
  row("Origem (utm_source)",pretty(l.utm_source));
  row("Mídia (utm_medium)",pretty(l.utm_medium));
  row("Campanha (utm_campaign)",pretty(l.utm_campaign));
  row("Criativo (utm_content)",pretty(l.utm_content));
  opt("Termo (utm_term)",l.utm_term);
  sec("Entrega");
  // Baixo valor também segue para RD; descarte fica só no banco.
  row("RD Station", badge(l.rd_status));
  row("Meta CAPI",badge(l.meta_status));
  if(l.fbp_source||l.fbc_source) row("Origem fbp/fbc", pretty(l.fbp_source)+" / "+pretty(l.fbc_source));
  document.getElementById("modalBody").innerHTML=h;
  var jb=document.getElementById("journeyBtn");
  document.getElementById("journey").innerHTML="";
  if(l.session_id){jb.style.display="";jb.disabled=false;jb.textContent="Ver jornada ↓";jb.onclick=function(){loadJourney(l.session_id)};}
  else{jb.style.display="none";}
  document.getElementById("leadModal").classList.add("show");
}
function closeModal(){document.getElementById("leadModal").classList.remove("show")}

/* ---- Jornada do lead (timeline) ---- */
var JK={page_view:"Página",click:"Clique",event:"Evento",form:"Formulário",lead:"Lead"};
function jTime(t){return (t||"").slice(11,16)}
function jDate(t){return (t||"").slice(0,10)}
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function jLine(it){
  var main="", sub="";
  if(it.kind==="page_view"){main="Viu "+label(it.page_name);sub=esc(it.b||it.a||"");}
  else if(it.kind==="click"){main="Clicou "+esc(it.b||it.a||"algo");sub=esc(it.c||"");}
  else if(it.kind==="event"){var nm=it.a||"evento";main=(nm==="simulation_start"?"Iniciou simulação":nm==="simulation_complete"?"Concluiu simulação":esc(nm));var pr="";try{pr=it.b&&it.b!=="{}"?JSON.stringify(JSON.parse(it.b)):"";}catch(e){pr=esc(it.b||"")}sub=pr;}
  else if(it.kind==="form"){main="Enviou formulário "+esc(it.a||"");sub=(it.b==="1"||it.b===1)?"sucesso":"falha";}
  return '<li class="tl-item k-'+it.kind+'"><span class="tl-dot"></span>'+
    '<div class="tl-time">'+jTime(it.t)+'</div>'+
    '<div class="tl-main"><span class="tl-kind">'+(JK[it.kind]||it.kind)+'</span>'+main+'</div>'+
    (sub?'<div class="tl-sub">'+sub+'</div>':'')+'</li>';
}
function loadJourney(sid){
  var box=document.getElementById("journey");
  var jb=document.getElementById("journeyBtn");
  jb.disabled=true;jb.textContent="Carregando…";
  box.innerHTML='<div class="empty">Montando a linha do tempo…</div>';
  fetch("${API}/journey?session_id="+encodeURIComponent(sid)+"&_="+Date.now()).then(function(r){return r.json()}).then(function(d){
    jb.style.display="none";
    var tl=d.timeline||[];
    if(!tl.length){box.innerHTML='<div class="empty">Sem eventos registrados para esta sessão.</div>';return}
    var out='', lastDate='';
    tl.forEach(function(it){var dt=jDate(it.t);if(dt!==lastDate){out+='<div class="tl-time" style="margin:8px 0 4px;font-weight:700;color:var(--blue)">'+dt+'</div>';lastDate=dt;}out+=jLine(it);});
    box.innerHTML='<ul class="tl">'+out+'</ul>';
  }).catch(function(e){console.error(e);jb.disabled=false;jb.textContent="Ver jornada ↓";box.innerHTML='<div class="empty">Erro ao carregar a jornada.</div>';});
}

var CSV_COLS=["created_at","name","phone","email","lead_kind","property_type","property_value","credit_value","faixa_credito","imovel_quitado","situacao_imovel","documentacao_ok","possui_imovel","possui_matricula","saldo_devedor","city","source","utm_source","utm_medium","utm_campaign","utm_content","utm_term","rd_status","meta_status"];
function downloadCSV(rows,cols,filename){
  if(!rows.length){alert("Sem leads para exportar.");return}
  var head=cols.join(",");
  var lines=rows.map(function(l){return cols.map(function(c){var v=l[c]==null?"":String(l[c]).replace(/"/g,'""');return '"'+v+'"'}).join(",")});
  var csv=head+"\\n"+lines.join("\\n");
  var url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  var a=document.createElement("a"); a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}
function exportCSV(){
  downloadCSV(lastLeads,CSV_COLS,"leads-"+currentPage()+"-"+currentLeadFilter()+"-"+new Date().toISOString().slice(0,10)+".csv");
}

function drawLine(id,labels,visitors,leads){
  var ctx=document.getElementById(id);
  if(dailyChart)dailyChart.destroy();
  dailyChart=new Chart(ctx,{type:"line",data:{labels:labels,datasets:[
    {label:"Visitas",data:visitors,borderColor:"rgba(11,45,114,.32)",backgroundColor:"rgba(11,45,114,.06)",fill:true,tension:.38,pointRadius:0,borderWidth:3},
    {label:"Leads",data:leads||[],borderColor:"#f97316",backgroundColor:"rgba(249,115,22,.10)",fill:false,tension:.38,pointRadius:2,pointBackgroundColor:"#f97316",borderWidth:3}
  ]},options:{maintainAspectRatio:false,interaction:{intersect:false,mode:"index"},plugins:{legend:{display:true,position:"bottom",labels:{boxWidth:22,usePointStyle:true,pointStyle:"line",color:"#6b7280",font:{family:"Inter",size:12,weight:"600"}}}},scales:{x:{ticks:{color:"#9ca3af"},grid:{display:false}},y:{beginAtZero:true,ticks:{color:"#9ca3af"},grid:{color:"#eef0f3"}}}}})
}
// cada canvas guarda a própria instância do Chart (senão um destrói o gráfico do outro)
var donutCharts={};
function drawDonut(id,labels,data){
  var ctx=document.getElementById(id);
  if(!ctx)return;
  if(donutCharts[id]){try{donutCharts[id].destroy()}catch(e){}}
  donutCharts[id]=new Chart(ctx,{type:"doughnut",data:{labels:labels,datasets:[{data:data,backgroundColor:CHART_PALETTE,borderColor:"#fff",borderWidth:4,hoverOffset:4}]},options:{maintainAspectRatio:false,cutout:"66%",plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){var total=(c.dataset.data||[]).reduce(function(a,n){return a+Number(n||0)},0);return " "+c.label+": "+c.raw+" ("+pct(c.raw,total)+"%)";}}}}}});
}

/* ---- Mapa de calor ---- */
// Paths same-origin (as 3 páginas existem no projeto Pages inspira-cred) → dá pra
// medir a altura real do iframe sem esbarrar em CORS.
var HM_PATHS={link_bio:"/links/",landing_page:"/",home_equity_lp:"/homeequity/",home_equity_form:"/formulario/"};
var hmRamp=null;
function heatRamp(){
  if(hmRamp)return hmRamp;
  var c=document.createElement("canvas");c.width=256;c.height=1;var g=c.getContext("2d");
  var grd=g.createLinearGradient(0,0,256,0);
  grd.addColorStop(0.0,"#0b2d72");grd.addColorStop(0.35,"#22d3ee");grd.addColorStop(0.55,"#10b981");
  grd.addColorStop(0.75,"#f59e0b");grd.addColorStop(1.0,"#ef4444");
  g.fillStyle=grd;g.fillRect(0,0,256,1);
  hmRamp=g.getImageData(0,0,256,1).data;return hmRamp;
}
// Estado do render: viewport FIXO (vh/svh estável dentro do iframe) + scroll externo
// controla qual "fatia" da página aparece. Isso evita (1) o feedback de vh que estoura
// a altura, (2) canvas gigante acima do limite do navegador, (3) travar com backdrop-filter.
var hmLast=null, hmH0=0, hmW=390, hmVH=812, hmObs=null, hmTick=false;
// dimensões de render representativas por device (largura do iframe + altura de viewport
// pra vh/svh ficar estável). Os DADOS já vêm filtrados por device pela API (bucket de vw).
function hmDeviceDims(dev){
  if(dev==="desktop")return {w:1280,vh:800};
  if(dev==="tablet")return {w:768,vh:1024};
  return {w:390,vh:812}; // mobile
}

/* O canvas é a MESMA superfície pros modos visuais; o que muda é o que ele pinta:
   manchas de clique (clicks) ou faixa de profundidade (depth). Nos modos elementos e
   etapas o canvas fica limpo e quem fala são as etiquetas ancoradas nos elementos. */
function drawSlice(){
  hmTick=false;
  if(!hmH0)return;
  var vp=document.getElementById("hmViewport");
  var fr=document.getElementById("hmFrame");
  var st=vp.scrollTop;
  try{ if(fr.contentWindow) fr.contentWindow.scrollTo(0, st); }catch(e){}
  var cv=document.getElementById("hmCanvas");
  if(cv.width!==hmW||cv.height!==hmVH){cv.width=hmW;cv.height=hmVH;}
  var ctx=cv.getContext("2d");ctx.clearRect(0,0,hmW,hmVH);
  if(hmMode==="clicks")drawClickHeat(ctx,st);
  else if(hmMode==="depth")drawDepthOverlay(ctx,st);
  positionBadges(st);
}

function drawClickHeat(ctx,st){
  if(!hmLast)return;
  var radius=hmW>=1000?30:22;
  var pts=hmLast.points||[], any=false;
  pts.forEach(function(p){
    var yy=p.y_pct*hmH0 - st;            // posição no viewport atual
    if(yy<-radius||yy>hmVH+radius)return;
    var x=p.x_pct*hmW;any=true;
    var g=ctx.createRadialGradient(x,yy,0,x,yy,radius);
    g.addColorStop(0,"rgba(0,0,0,0.18)");g.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,yy,radius,0,6.2832);ctx.fill();
  });
  if(!any)return;
  var img=ctx.getImageData(0,0,hmW,hmVH),d=img.data,ramp=heatRamp();
  for(var i=0;i<d.length;i+=4){var a=d[i+3];if(!a)continue;var idx=(a>255?255:a)*4;d[i]=ramp[idx];d[i+1]=ramp[idx+1];d[i+2]=ramp[idx+2];d[i+3]=Math.min(200,a+40);}
  ctx.putImageData(img,0,0);
}

/* Profundidade PINTADA NA PÁGINA (estilo Clarity): cada faixa horizontal recebe a cor
   correspondente ao % de gente que chegou até ali — quente em cima (todo mundo viu),
   esfriando pro azul conforme menos gente desce. Entre os marcos 25/50/75/100 a gente
   interpola, e desenha a linha de cada marco com o número real por cima. */
function depthReachAt(frac){
  var d=hmPageData, s=(d&&d.sessions)||0;
  if(!s)return 0;
  var m=scrollReach(d);
  var stops=[[0,1],[0.25,m[25]/s],[0.5,m[50]/s],[0.75,m[75]/s],[1,m[100]/s]];
  if(frac<=0)return stops[0][1];
  for(var i=1;i<stops.length;i++){
    if(frac<=stops[i][0]){
      var a=stops[i-1],b=stops[i];
      var t=(frac-a[0])/((b[0]-a[0])||1);
      return a[1]+(b[1]-a[1])*t;
    }
  }
  return stops[stops.length-1][1];
}
function rampColor(v,alpha){
  var ramp=heatRamp();
  var idx=Math.max(0,Math.min(255,Math.round(v*255)))*4;
  return "rgba("+ramp[idx]+","+ramp[idx+1]+","+ramp[idx+2]+","+alpha+")";
}
function drawDepthOverlay(ctx,st){
  var d=hmPageData, s=(d&&d.sessions)||0;
  if(!s){
    ctx.fillStyle="rgba(11,45,114,.06)";ctx.fillRect(0,0,hmW,hmVH);
    return;
  }
  var STEP=6;
  for(var y=0;y<hmVH;y+=STEP){
    var frac=(st+y)/hmH0;
    if(frac>1)frac=1;
    ctx.fillStyle=rampColor(depthReachAt(frac),.42);
    ctx.fillRect(0,y,hmW,STEP);
  }
  // marcos com o número real
  var m=scrollReach(d);
  [[0.25,m[25]],[0.5,m[50]],[0.75,m[75]],[1,m[100]]].forEach(function(mk){
    var y=mk[0]*hmH0-st;
    if(y<12||y>hmVH-2)return;
    ctx.strokeStyle="rgba(255,255,255,.85)";ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(hmW,y);ctx.stroke();
    var txt=Math.round(mk[0]*100)+"% da página · "+Math.round(mk[1]/s*100)+"% das pessoas chegaram aqui";
    ctx.font="700 12px Inter, sans-serif";
    var w=ctx.measureText(txt).width+16;
    ctx.fillStyle="rgba(6,26,66,.86)";
    roundRect(ctx,8,y-24,w,20,7);ctx.fill();
    ctx.fillStyle="#fff";ctx.fillText(txt,16,y-10);
  });
}
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
}

/* ---- Etiquetas ancoradas nos elementos reais da página ----
   Acha o elemento dentro do iframe (por id, senão pelo texto do botão/link), guarda a
   posição no documento e desenha uma pílula com a contagem. Clicar abre o balão com o
   detalhe. É isto que responde "quantos cliques esse botão levou?" na própria página. */
var hmBadgeList=[], hmPop=null;
function hmFindEl(doc,row){
  if(row.id){ var byId=null; try{byId=doc.getElementById(row.id);}catch(e){} if(byId)return byId; }
  var txt=String(row.k||"").trim().toLowerCase();
  if(!txt||txt.charAt(0)==="(")return null;
  var cands=doc.querySelectorAll("a,button,[role=button],input[type=submit]");
  for(var i=0;i<cands.length;i++){
    var t=(cands[i].textContent||cands[i].value||"").trim().toLowerCase();
    if(!t)continue;
    if(t===txt||t.indexOf(txt)===0||txt.indexOf(t)===0)return cands[i];
  }
  return null;
}
function badgeRows(){
  if(!hmPageData)return [];
  if(hmMode==="steps"){
    var st=hmStepList[hmStepIdx];
    if(!st)return [];
    return (hmPageData.choices||[]).filter(function(c){return c.step_id===st.id&&c.k})
      .map(function(c){return {k:c.k,id:"",n:c.n,s:null,tipo:"resposta"};});
  }
  return (hmPageData.elements||[]).slice(0,14);
}
function computeBadges(){
  hmBadgeList=[];
  closeHmPop();
  var box=document.getElementById("hmBadges");
  if(!box)return;
  if(hmMode!=="elements"&&hmMode!=="steps"){box.innerHTML="";return;}
  var fr=document.getElementById("hmFrame"), doc=null, win=null;
  try{doc=fr.contentDocument;win=fr.contentWindow;}catch(e){}
  if(!doc){box.innerHTML="";return;}
  var rows=badgeRows(), max=Math.max.apply(null,rows.map(function(r){return r.n||0}).concat([1]));
  rows.forEach(function(r,i){
    var el=hmFindEl(doc,r);
    if(!el)return;
    var rect=el.getBoundingClientRect();
    if(!rect.width&&!rect.height)return;
    hmBadgeList.push({
      x:rect.left+(win.scrollX||0)+rect.width-6,
      y:rect.top+(win.scrollY||0)+8,
      n:r.n,label:r.k,sub:r.s,tipo:r.tipo,hot:(r.n||0)>=max*0.5,i:i
    });
  });
  box.innerHTML=hmBadgeList.map(function(b,i){
    var unidade=(b.tipo==="resposta"?"escolha":"clique")+(b.n===1?"":"s");
    return '<button class="hm-badge'+(b.hot?'':' cool')+'" data-i="'+i+'" title="'+esc(b.label)+' — '+b.n+' '+unidade+'">'+b.n+'</button>';
  }).join("");
  [].forEach.call(box.querySelectorAll(".hm-badge"),function(el){
    el.addEventListener("click",function(e){e.stopPropagation();openHmPop(Number(el.dataset.i));});
  });
  positionBadges(document.getElementById("hmViewport").scrollTop);
}
function positionBadges(st){
  var box=document.getElementById("hmBadges");
  if(!box)return;
  var els=box.querySelectorAll(".hm-badge");
  for(var i=0;i<els.length;i++){
    var b=hmBadgeList[Number(els[i].dataset.i)];
    if(!b)continue;
    var y=b.y-st;
    if(y<-20||y>hmVH+20){els[i].style.display="none";continue;}
    els[i].style.display="";
    els[i].style.left=Math.max(18,Math.min(hmW-18,b.x))+"px";
    els[i].style.top=y+"px";
  }
  if(hmPop)positionHmPop(st);
}
function openHmPop(i){
  var b=hmBadgeList[i];
  if(!b)return;
  closeHmPop();
  var box=document.getElementById("hmBadges");
  var el=document.createElement("div");
  el.className="hm-pop";
  el.innerHTML='<span class="x">&times;</span><b>'+esc(b.label)+'</b>'+
    '<span class="n">'+b.n+'</span> '+(b.tipo==="resposta"?"escolhas":"cliques")+
    (b.sub!=null?'<div style="margin-top:6px">'+b.sub+' sessões diferentes</div>':'')+
    (b.tipo&&b.tipo!=="resposta"?'<div style="margin-top:4px">tipo: '+esc(b.tipo)+'</div>':'');
  el.addEventListener("click",function(e){e.stopPropagation();if(e.target.className==="x")closeHmPop();});
  box.appendChild(el);
  hmPop={el:el,b:b};
  positionHmPop(document.getElementById("hmViewport").scrollTop);
}
function positionHmPop(st){
  if(!hmPop)return;
  var w=hmPop.el.offsetWidth||190, h=hmPop.el.offsetHeight||90;
  var x=Math.max(6,Math.min(hmW-w-6,hmPop.b.x-w/2));
  var y=hmPop.b.y-st+14;
  if(y+h>hmVH-6)y=Math.max(6,hmPop.b.y-st-h-14);
  hmPop.el.style.left=x+"px";hmPop.el.style.top=y+"px";
}
function closeHmPop(){ if(hmPop){try{hmPop.el.remove()}catch(e){} hmPop=null;} }
function measureAndLayout(){
  var fr=document.getElementById("hmFrame");
  var H0=0;
  try{H0=fr.contentDocument.documentElement.scrollHeight||fr.contentDocument.body.scrollHeight;}catch(e){H0=0;}
  if(!H0){document.getElementById("hmNote").innerHTML='<span style="color:var(--red-ink)">Não consegui medir a página (CORS). Abra o dashboard em nova.inspiracred.com.br (mesma origem das páginas).</span>';return;}
  hmH0=H0;
  document.getElementById("hmInner").style.height=H0+"px";
  var vp=document.getElementById("hmViewport");
  vp.style.height=Math.min(hmVH,H0)+"px";
  drawSlice();
  computeBadges();
  detectSteps();
}
function loadHeatmap(){
  var page=document.getElementById("hmPageSel").value;
  var dev=document.getElementById("hmDevice").value;
  var dims=hmDeviceDims(dev), W=dims.w;
  var days=document.getElementById("rangeSel").value;
  var fr=document.getElementById("hmFrame"), cv=document.getElementById("hmCanvas");
  hmW=W; hmVH=dims.vh; hmH0=0;
  if(hmObs){try{hmObs.disconnect()}catch(e){}hmObs=null;}
  document.getElementById("hmNote").textContent="Carregando página e cliques…";
  // dimensiona o palco fixo (W × VH); vh dentro do iframe fica preso a VH.
  var vp=document.getElementById("hmViewport"), sticky=document.getElementById("hmSticky");
  vp.style.width=W+"px"; vp.scrollTop=0;
  sticky.style.width=W+"px"; sticky.style.height=hmVH+"px";
  cv.width=W; cv.height=hmVH; cv.getContext("2d").clearRect(0,0,W,hmVH);
  document.getElementById("hmInner").style.height=hmVH+"px";
  fr.src=location.origin+(HM_PATHS[page]||"/");
  var qs="?page="+encodeURIComponent(page)+"&device="+dev+"&start="+daysAgo(parseInt(days)-1)+"&end="+new Date().toISOString().slice(0,10);
  var pdata=fetch("${API}/heatmap"+qs+"&_="+Date.now()).then(function(r){return r.json()});
  var pframe=new Promise(function(res){fr.onload=function(){res();};});
  Promise.all([pdataGuard(pdata),pframe]).then(function(r){
    hmLast=r[0]||{points:[],count:0,page:page,range:{start:"",end:""}};
    hmStageNote();
    try{
      var doc=fr.contentDocument;
      if(doc){
        // força imagens lazy (same-origin) → altura estabiliza sem depender de scroll
        doc.querySelectorAll('img[loading="lazy"]').forEach(function(im){im.loading="eager";});
        // esconde a barra do iframe (o scroll é controlado pelo viewport externo via scrollTo)
        if(!doc.getElementById("__ic_hm_style")){var st=doc.createElement("style");st.id="__ic_hm_style";st.textContent="html{scrollbar-width:none}html::-webkit-scrollbar,body::-webkit-scrollbar{width:0;height:0;display:none}";(doc.head||doc.documentElement).appendChild(st);}
      }
      if(doc&&"ResizeObserver"in window){hmObs=new ResizeObserver(function(){measureAndLayout();});hmObs.observe(doc.documentElement);}
    }catch(e){}
    measureAndLayout();
    [200,700,1600].forEach(function(ms){setTimeout(measureAndLayout,ms);});
  });
}
function pdataGuard(p){return p.then(function(d){return d}).catch(function(){return null});}

/* ---- Mapa de calor: os outros 3 modos ----
   Tudo sai do /api/pagemap, que lê o que já gravamos: evento scroll_depth (marcos
   25/50/75/100), section_view (blocos com data-section), tabela clicks (elementos)
   e os eventos form_step/form_step_choice do formulário multi-step. */
var hmMode="clicks", hmPageData=null, hmPageLoaded="";
var HM_VIEWS=["clicks","depth","elements","steps"];
var hmStepList=[], hmStepIdx=0;
var HM_TITLE={
  clicks:["Onde as pessoas clicam","quanto mais quente, mais toques naquele ponto"],
  depth:["Até onde a página é vista","a cor esfria conforme menos gente chega"],
  elements:["O que foi clicado","clique numa etiqueta para ver o detalhe"],
  steps:["Etapa por etapa","navegue pelas perguntas e veja o que respondem"]
};
var HM_PANEL={
  clicks:["Elementos mais clicados","o mesmo dado, em lista"],
  depth:["Quem chega em cada trecho","marcos e seções lidas"],
  elements:["Ranking de cliques","botões e links da página"],
  steps:["Funil pergunta a pergunta","onde as pessoas desistem"]
};

function setHmMode(mode){
  hmMode=mode;
  ["clicks","depth","elements","steps"].forEach(function(m){
    var b=document.getElementById("hmmode-"+m);
    if(b)b.classList.toggle("active",m===mode);
  });
  document.getElementById("hmStageTitle").textContent=HM_TITLE[mode][0];
  document.getElementById("hmStageHint").textContent=HM_TITLE[mode][1];
  document.getElementById("hmPanelTitle").textContent=HM_PANEL[mode][0];
  document.getElementById("hmPanelHint").textContent=HM_PANEL[mode][1];
  var pageNow=document.getElementById("hmPageSel").value;
  if(hmPageLoaded!==pageNow)loadPageMap();
  if(!hmH0)loadHeatmap(); else {drawSlice();computeBadges();}
  renderHmPanel(); hmStageNote(); hmLegend();
}

// Nota acima do palco: muda com o modo, sempre dizendo de onde vem o número.
function hmStageNote(){
  var el=document.getElementById("hmNote");
  if(!el)return;
  var d=hmPageData||{}, page=document.getElementById("hmPageSel").value;
  var dev=document.getElementById("hmDevice").value;
  var DEVN={mobile:"Mobile",tablet:"Tablet",desktop:"Desktop"};
  if(hmMode==="clicks"){
    var bd=(hmLast&&hmLast.by_device)||{mobile:0,tablet:0,desktop:0};
    el.innerHTML='<b>'+((hmLast&&hmLast.count)||0)+'</b> toques em <b>'+label(page)+'</b> · '+(DEVN[dev]||dev)+
      ' <span style="color:var(--muted)">(no período: mobile '+bd.mobile+' · tablet '+bd.tablet+' · desktop '+bd.desktop+')</span>';
  }else if(hmMode==="depth"){
    el.innerHTML='Faixa colorida por cima da página: <b>quente</b> onde quase todo mundo chegou, <b>azul</b> onde quase ninguém desceu. '+
      'Base: <b>'+((d.sessions)||0)+'</b> sessões · rolagem média <b>'+(d.sessions?avgDepth(d):0)+'%</b>.';
  }else if(hmMode==="elements"){
    el.innerHTML='As etiquetas laranja/azul ficam em cima dos botões e links reais. <b>Clique numa etiqueta</b> para ver quantos cliques e quantas sessões.';
  }else{
    el.innerHTML=hmStepList.length
      ? 'Escolha a etapa acima: a página abaixo pula para aquela pergunta e as etiquetas mostram <b>quantas pessoas escolheram cada resposta</b>.'
      : 'Esta página não tem etapas — é uma página única. Use os outros modos.';
  }
}
function hmLegend(){
  var el=document.getElementById("hmLegend");
  if(!el)return;
  if(hmMode==="clicks"||hmMode==="depth"){
    var txt=hmMode==="clicks"?["poucos cliques","muitos cliques"]:["quase ninguém chegou","todo mundo viu"];
    el.style.display="";
    el.innerHTML='<span>'+txt[0]+'</span>'+
      '<span class="ramp" style="background:linear-gradient(90deg,#0b2d72,#22d3ee,#10b981,#f59e0b,#ef4444)"></span>'+
      '<span>'+txt[1]+'</span>';
  }else{ el.style.display="none"; el.innerHTML=""; }
}

/* Páginas com etapas (hoje o formulário) expõem window.inspiraFormPreview no iframe.
   Se existir, montamos a barra de etapas — ela vale pra TODOS os modos, pra dar pra
   ver clique, profundidade e respostas em cada pergunta. */
function detectSteps(){
  var bar=document.getElementById("hmSteps");
  var fr=document.getElementById("hmFrame"), api=null;
  try{ api=fr.contentWindow&&fr.contentWindow.inspiraFormPreview; }catch(e){}
  if(!api||!api.steps){ hmStepList=[]; bar.innerHTML=""; bar.style.display="none"; return; }
  try{ hmStepList=api.steps()||[]; }catch(e){ hmStepList=[]; }
  if(!hmStepList.length){ bar.innerHTML=""; bar.style.display="none"; return; }
  if(hmStepIdx>hmStepList.length-1)hmStepIdx=0;
  bar.style.display="";
  bar.innerHTML='<span class="am-tag" style="align-self:center">Etapas</span>'+hmStepList.map(function(s,i){
    return '<button class="hm-step-btn'+(i===hmStepIdx?' active':'')+'" data-i="'+i+'" title="'+esc(s.title||s.id)+'">'+(i+1)+'. '+esc(s.title||s.id)+'</button>';
  }).join("");
  [].forEach.call(bar.querySelectorAll(".hm-step-btn"),function(b){
    b.addEventListener("click",function(){ goHmStep(Number(b.dataset.i)); });
  });
}
function goHmStep(i){
  hmStepIdx=i;
  var fr=document.getElementById("hmFrame");
  try{ fr.contentWindow.inspiraFormPreview.goTo(i); }catch(e){}
  var bar=document.getElementById("hmSteps");
  [].forEach.call(bar.querySelectorAll(".hm-step-btn"),function(b){
    b.classList.toggle("active",Number(b.dataset.i)===i);
  });
  setTimeout(function(){ measureAndLayout(); computeBadges(); renderHmPanel(); },90);
}

function renderHmPanel(){
  var box=document.getElementById("hmPanel");
  if(!box)return;
  var d=hmPageData;
  if(!d){box.innerHTML='<div class="empty">Clique em <b>Carregar</b> para trazer os dados desta página.</div>';return;}
  if(hmMode==="depth"){ box.innerHTML=depthPanelHTML(d); return; }
  if(hmMode==="steps"){ box.innerHTML=stepsPanelHTML(d); return; }
  box.innerHTML=elementsPanelHTML(d);
}

function loadPageMap(){
  var page=document.getElementById("hmPageSel").value;
  var days=document.getElementById("rangeSel").value;
  var qs="?page="+encodeURIComponent(page)+"&start="+daysAgo(parseInt(days)-1)+"&end="+new Date().toISOString().slice(0,10);
  document.getElementById("hmKpis").innerHTML='<div class="kpi"><div class="label">Carregando…</div><div class="val">—</div><div class="sub"></div></div>';
  fetch("${API}/pagemap"+qs+"&_="+Date.now()).then(function(r){return r.json()}).then(function(d){
    hmPageData=d; hmPageLoaded=page;
    renderPageMapKpis(d); renderHmPanel(); hmStageNote(); hmLegend();
    drawSlice(); computeBadges();
  }).catch(function(){
    document.getElementById("hmKpis").innerHTML='<div class="kpi"><div class="label">Erro</div><div class="val">—</div><div class="sub">não consegui carregar</div></div>';
  });
}

function scrollReach(d){
  var m={25:0,50:0,75:0,100:0};
  (d.scroll||[]).forEach(function(r){ if(m[r.pct]!==undefined)m[r.pct]=Number(r.n||0); });
  return m;
}
function avgDepth(d){
  // aproximação honesta: cada pessoa conta pelo marco MAIS FUNDO que atingiu.
  var m=scrollReach(d), s=d.sessions||0;
  if(!s)return 0;
  var only25=Math.max(0,m[25]-m[50]), only50=Math.max(0,m[50]-m[75]), only75=Math.max(0,m[75]-m[100]);
  var nunca=Math.max(0,s-m[25]);
  var soma=nunca*12+only25*37+only50*62+only75*87+m[100]*100;
  return Math.round(soma/s);
}

function renderPageMapKpis(d){
  var m=scrollReach(d), s=d.sessions||0;
  var clicks=(d.elements||[]).reduce(function(a,x){return a+Number(x.n||0)},0);
  var steps=(d.steps||[]).length;
  var kpis=[
    ["Sessões na página",pretty(s),pretty(d.views)+" acessos"],
    ["Rolagem média",s?avgDepth(d)+"%":"—","da altura da página"],
    ["Chegaram ao fim",s?pct(m[100],s)+"%":"—",pretty(m[100])+" pessoas"],
    ["Cliques registrados",pretty(clicks),(d.elements||[]).length+" elementos diferentes"],
    [steps?"Etapas medidas":"Seções lidas",steps?String(steps):String((d.sections||[]).length),steps?"perguntas do formulário":"blocos com data-section"]
  ];
  document.getElementById("hmKpis").innerHTML=kpis.map(function(k){
    return '<div class="kpi"><div class="label">'+k[0]+'</div><div class="val">'+k[1]+'</div><div class="sub"><b>'+k[2]+'</b></div></div>';
  }).join("");
}

function depthPanelHTML(d){
  var s=d.sessions||0, m=scrollReach(d);
  if(!s)return '<div class="empty">Sem acessos nesta página no período.</div>';
  var bands=[
    ["Primeira dobra (topo)",s,"todo mundo que abriu a página"],
    ["Passou de 25%",m[25],"rolou para além do início"],
    ["Chegou na metade",m[50],"metade da página"],
    ["Chegou em 75%",m[75],"trecho final"],
    ["Chegou ao fim",m[100],"viu o rodapé"]
  ];
  var html='<div class="depth-scale">'+bands.map(function(b){
    var p=pct(b[1],s);
    // a barra de fundo É o dado: quanto mais larga e quente, mais gente chegou ali
    var color=p>=70?"#10b981":(p>=40?"#f59e0b":"#ef4444");
    return '<div class="depth-band">'+
      '<span class="bg" style="background:linear-gradient(90deg,'+color+' '+p+'%,transparent '+p+'%)"></span>'+
      '<span class="row"><span class="who">'+esc(b[0])+'</span><span class="pc">'+p+'%</span></span>'+
      '<div class="sub">'+pretty(b[1])+' de '+s+' sessões · '+esc(b[2])+'</div>'+
    '</div>';
  }).join("")+'</div>';
  var perdaTopo=100-pct(m[25],s);
  html+='<div class="fold-note"><b>Leitura rápida:</b> '+perdaTopo+'% das pessoas não passam do topo — '+
    'é o trecho que precisa segurar a atenção. Rolagem média: <b>'+avgDepth(d)+'%</b> da altura total.</div>';
  var secs=(d.sections||[]).filter(function(r){return r.k});
  html+='<div class="h2row" style="margin-top:18px"><h2>Seções realmente lidas</h2><span class="hint">bloco a bloco</span></div>';
  if(!secs.length)html+='<div class="empty">Esta página não tem blocos marcados com <b>data-section</b>.</div>';
  else{
    var mx=Math.max.apply(null,secs.map(function(r){return r.n}).concat([1]));
    html+=barList(secs.map(function(r){return {lbl:r.k,val:r.n,sub:s?pct(r.n,s)+"%":"",w:r.n/mx};}));
  }
  return html;
}

function elementsPanelHTML(d){
  var rows=d.elements||[];
  if(!rows.length)return '<div class="empty">Nenhum clique registrado nesta página no período.</div>';
  var total=rows.reduce(function(a,r){return a+Number(r.n||0)},0);
  var max=Math.max.apply(null,rows.map(function(r){return r.n}).concat([1]));
  return '<div class="hint" style="display:block;margin:0 0 12px">'+total+' cliques em '+rows.length+' elementos · o rótulo é o texto do botão/link</div>'+
    barList(rows.map(function(r){
      var extra=(r.tipo?r.tipo:(r.id?"#"+r.id:""));
      return {lbl:r.k+(extra?"  ("+extra+")":""),val:r.n,sub:r.s+" sessões",w:r.n/max};
    }));
}

function stepsPanelHTML(d){
  var steps=(d.steps||[]).filter(function(r){return r.k});
  if(!steps.length){
    return '<div class="empty">'+((d.page==="home_equity_form")
      ? 'Ainda sem dados de etapa. O rastreio pergunta a pergunta entrou agora — os números aparecem conforme as pessoas usarem o formulário.'
      : 'Esta página não tem etapas: é uma página única, sem perguntas em sequência. Use os outros modos.')+'</div>';
  }
  var first=Number(steps[0].n||0);
  var html=steps.map(function(st,i){
    var n=Number(st.n||0);
    var prev=i?Number(steps[i-1].n||0):n;
    var drop=prev?Math.max(0,prev-n):0;
    return '<div class="step-row">'+
      '<span class="step-n">'+(i+1)+'</span>'+
      '<span><span class="step-q" title="'+esc(st.title||st.k)+'">'+esc(st.title||st.k)+'</span>'+
        '<span class="step-bar"><span style="width:'+Math.max(3,pct(n,first||1))+'%"></span></span>'+
        (drop?'<div class="step-drop">−'+drop+' pessoa'+(drop===1?'':'s')+' desistiram aqui ('+pct(drop,prev)+'%)</div>':'')+
      '</span>'+
      '<span class="step-side"><b>'+n+'</b><small>'+pct(n,first||1)+'% do início</small></span>'+
    '</div>';
  }).join("");

  var byStep={};
  (d.choices||[]).forEach(function(c){ if(!c.k)return; (byStep[c.step_id]=byStep[c.step_id]||[]).push(c); });
  var keys=steps.map(function(s){return s.k}).filter(function(k){return byStep[k]});
  html+='<div class="h2row" style="margin-top:18px"><h2>Respostas escolhidas</h2><span class="hint">o que respondem em cada pergunta</span></div>';
  if(!keys.length){ html+='<div class="empty">Ainda sem respostas registradas neste período.</div>'; return html; }
  html+=keys.map(function(k){
    var st=steps.filter(function(s){return s.k===k})[0]||{};
    var list=byStep[k].sort(function(a,b){return b.n-a.n});
    var tot=list.reduce(function(a,c){return a+Number(c.n||0)},0);
    return '<div style="margin-bottom:14px">'+
      '<div class="step-q" title="'+esc(st.title||k)+'">'+esc(st.title||k)+'</div>'+
      '<div class="choice-chips">'+list.map(function(c){
        return '<span class="choice-chip">'+esc(c.k)+' <b>'+c.n+'</b> <small>('+pct(c.n,tot)+'%)</small></span>';
      }).join("")+'</div>'+
    '</div>';
  }).join("");
  return html;
}

document.getElementById("refresh").addEventListener("click",loadAll);
document.getElementById("rangeSel").addEventListener("change",loadAll);
document.getElementById("pageSel").addEventListener("change",loadAll);
document.getElementById("openPage").addEventListener("click",function(){var u=PAGE_URLS[currentPage()];if(u)window.open(u,"_blank","noopener");});
document.getElementById("csvBtn").addEventListener("click",exportCSV);
document.getElementById("leadEventFilter").addEventListener("change",function(){renderLeads();});
document.getElementById("srcSel").addEventListener("change",function(){
  campSel={camp:null,med:null}; campLevel="campaign"; // troca de origem reinicia a navegação
  loadAll();
});
document.getElementById("hmLoad").addEventListener("click",function(){loadHeatmap();loadPageMap();});
document.getElementById("hmDevice").addEventListener("change",function(){if(hmMode==="clicks")loadHeatmap();});
document.getElementById("hmPageSel").addEventListener("change",function(){
  hmPageLoaded="";
  if(hmMode==="clicks")loadHeatmap(); else loadPageMap();
});
document.getElementById("hmViewport").addEventListener("scroll",function(){if(!hmTick){hmTick=true;requestAnimationFrame(drawSlice);}},{passive:true});
// Roda do mouse controla EXPLICITAMENTE o scroll do viewport (não depende do iframe
// deixar o evento passar). Só "prende" o scroll enquanto ainda dá pra rolar o mapa;
// nas pontas deixa a página rolar normalmente.
document.getElementById("hmViewport").addEventListener("wheel",function(e){
  var m=this.scrollHeight-this.clientHeight;
  if(m<=0)return;
  if((e.deltaY<0&&this.scrollTop>0)||(e.deltaY>0&&this.scrollTop<m-1)){e.preventDefault();this.scrollTop+=e.deltaY;}
},{passive:false});
document.getElementById("modalClose").addEventListener("click",closeModal);
document.getElementById("leadModal").addEventListener("click",function(e){if(e.target.id==="leadModal")closeModal()});
setHmMode("clicks");
showTab("overview");
loadAll();
</script>
</body>
</html>`;
