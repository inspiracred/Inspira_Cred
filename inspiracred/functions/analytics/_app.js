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
  if (sub === "/api/journey" && request.method === "GET") return handleJourney(request, env);
  if (sub === "/api/heatmap" && request.method === "GET") return handleHeatmap(request, env);
  if (sub === "/api/campaigns" && request.method === "GET") return handleCampaigns(request, env);
  if (sub === "/api/health" && request.method === "GET") return handleHealth(request, env);
  if (sub === "/api/meta-test" && request.method === "GET") return handleMetaTest(request, env);
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
              event.imovel_quitado || null, event.documentacao_ok || null, event.situacao_imovel || null,
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
        }
        if (leadId && context) {
          // TODO lead vai pro RD agora (pivô 2026-07-22 — antes baixo_valor/descarte
          // ficavam só no D1). A classificação vai junto no campo cf_classificacao_lead
          // pra equipe filtrar/despriorizar dentro do próprio RD. Ainda passam pela CAPI
          // (que naturalmente não faz nada pros kinds sem evento — ver META_EVENTS no
          // formulario/script.js).
          context.waitUntil(sendLeadToRD(event, env, leadId));
          // Filtro de bot (Fase B): crawler (WhatsApp/Slack/Facebook/curl/headless…) NÃO
          // vai pra CAPI — não polui o Pixel/otimização. O lead já foi salvo no D1 com
          // is_bot=1 (métrica de saúde correta). O RD NÃO é gateado por bot de propósito:
          // dropar um lead real por falso-positivo de UA no CRM custa mais que um bot raro.
          if (!bot.isBot) {
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
  landing_page: { identificador: "landing-nova-raiz" },
  home_equity_lp: { identificador: "home-equity-lp" },
  home_equity_form: { identificador: "home-equity-typeform" },
};

// Rótulo legível da classificação — vai no campo de Lead cf_classificacao_lead (pivô
// 2026-07-22: todo lead vai pro RD agora, inclusive baixo_valor/descarte; a equipe
// filtra/despriorização DENTRO do RD por este campo, em vez de ficarem só no nosso D1).
const LEAD_KIND_LABEL = {
  home_equity: "Qualificado",
  home_equity_mql: "Qualificado (MQL)",
  auto: "Qualificado (garantia de veículo)",
  baixo_valor: "Não qualificado — valor baixo",
  descarte: "Não qualificado — sem imóvel/veículo",
};

// Identificador do RD por TIPO de lead do formulário (event.lead_kind). Home equity
// (inclusive MQL, baixo_valor, descarte) mantém o identificador base — que JÁ é gatilho
// do fluxo "Form nativo > pipe" do cliente. Auto ganha identificador próprio pra NÃO
// cair no mesmo funil de vendas (o dado é preservado no RD; se o cliente quiser roteá-lo,
// adiciona o identificador a um fluxo dele, igual fez com os 3 atuais).
function rdIdentificador(cfg, kind) {
  if (kind === "auto") return cfg.identificador + "-auto";
  return cfg.identificador; // home_equity / home_equity_mql / baixo_valor / descarte / indefinido
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
    if (n < 100000) return "Menos de R$ 100 mil";
    if (n < 300000) return "De R$ 100 mil a R$ 300 mil";
    if (n < 600000) return "De R$ 300 mil a R$ 600 mil";
    if (n < 900000) return "De R$ 600 mil a R$ 900 mil";
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
    if (event.situacao_imovel === "Quitado") return "Sim";
    if (event.situacao_imovel === "Financiado") return "Não";
    return undefined;
  })();
  const payload = {
    token_rdstation: env.RD_STATION_TOKEN,
    identificador: rdIdentificador(cfg, event.lead_kind),
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
    // ⚠️ cf_formulario_origem NÃO EXISTE na conta (conferido 2026-07-23: busca por
    // "formul"/"origem" nos campos personalizados não retorna nada). Enquanto o campo de
    // Lead não for criado, o RD descarta isto em silêncio e "Formulário de Origem" da
    // Negociação segue vazio. Mantido pra funcionar assim que o campo existir.
    cf_formulario_origem: str(event.source),
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
  // kind=nao_qualificado -> aba "Leads não qualificados" (lead_kind IN baixo_valor/
  // descarte — ficam só no nosso D1, nunca vão pro RD). kind=<valor específico> filtra
  // por um lead_kind exato, se algum dia precisar.
  const kind = p.get("kind");
  // Colunas base + qualificadores (migration 0003). Se as colunas novas ainda não
  // existirem no D1, o 1º SELECT falha e caímos no fallback com as colunas antigas —
  // o dashboard nunca quebra por causa de migration pendente.
  const BASE = `id, session_id, name, phone, email, property_type, property_value, credit_value, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, rd_status, meta_status, created_at`;
  const QUAL = `, imovel_quitado, documentacao_ok, situacao_imovel, saldo_devedor, possui_imovel, possui_matricula, faixa_credito, city, lead_kind, fbp_source, fbc_source`;
  const conds = [];
  const binds = [];
  if (page) { conds.push(`source = ?`); binds.push(page); }
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

/* ---- CAMPANHAS (de onde vêm os leads: origem, mídia, campanha, criativo) ----
 * Tudo sai da tabela `leads`, agrupado pelos utm_*. `utm_content` é onde Meta/Google
 * costumam mandar o criativo/anúncio — só aparece se o anúncio enviar o parâmetro.
 * `valor` = soma do crédito solicitado, pra saber qual campanha traz ticket maior.
 */
async function handleCampaigns(request, env) {
  const { start, end, page } = params(request.url);
  const sc = page ? " AND source = ?" : "";
  const b = page ? [start, end, page] : [start, end];
  const many = async (sql) => (await env.DB.prepare(sql).bind(...b).all()).results || [];

  const SRC = "COALESCE(NULLIF(utm_source,''),'direto')";
  const CAMP = "COALESCE(NULLIF(utm_campaign,''),'(sem campanha)')";
  const CONT = "COALESCE(NULLIF(utm_content,''),'(sem criativo)')";
  const MED = "COALESCE(NULLIF(utm_medium,''),'(sem mídia)')";
  const WHERE = `WHERE DATE(created_at) BETWEEN ? AND ?${sc}`;
  const AGG = "COUNT(*) leads, SUM(COALESCE(credit_value,0)) valor";

  const [by_source, by_medium, by_campaign, by_content, totals] = await Promise.all([
    many(`SELECT ${SRC} k, ${AGG} FROM leads ${WHERE} GROUP BY k ORDER BY leads DESC`),
    many(`SELECT ${MED} k, ${AGG} FROM leads ${WHERE} GROUP BY k ORDER BY leads DESC`),
    many(`SELECT ${CAMP} k, ${SRC} src, ${MED} med, ${AGG} FROM leads ${WHERE} GROUP BY k, src, med ORDER BY leads DESC`),
    many(`SELECT ${CONT} k, ${CAMP} camp, ${SRC} src, ${AGG} FROM leads ${WHERE} GROUP BY k, camp, src ORDER BY leads DESC`),
    env.DB.prepare(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN COALESCE(utm_source,'')<>'' THEN 1 ELSE 0 END) com_utm,
              SUM(COALESCE(credit_value,0)) valor
       FROM leads ${WHERE}`
    ).bind(...b).first(),
  ]);

  const t = totals || {};
  const total = t.total || 0, com_utm = t.com_utm || 0;
  return json({
    range: { start, end }, page: page || "all",
    totals: { total, com_utm, direto: total - com_utm, valor: t.valor || 0 },
    by_source, by_medium, by_campaign, by_content,
  });
}

/* ---- SAÚDE DO TRACKING (Fase B) ----
 * Agrega as colunas de diagnóstico da tabela `leads` (migration 0008): quanto do
 * tráfego o cookie de edge resgatou (itp), quantos bots foram barrados, cobertura de
 * PII pro Advanced Matching, distribuição de origem do fbp e de navegador. Se as
 * colunas ainda não existirem (0008 pendente), volta um aviso em vez de quebrar.
 */
async function handleHealth(request, env) {
  const { start, end, page } = params(request.url);
  const sc = page ? " AND source = ?" : "";
  const b = page ? [start, end, page] : [start, end];
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
  body{margin:0;font-family:"Inter",-apple-system,Segoe UI,Roboto,sans-serif;background:var(--surface);color:var(--text);-webkit-font-smoothing:antialiased}
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
  .btn-sm{padding:6px 12px;font-size:12px;border-radius:9px}
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
  @media(max-width:760px){.grid,.traffic-top{grid-template-columns:1fr}.tabs{top:auto}}
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
      <option value="home_equity_form">Formulário Home Equity</option>
      <option value="link_bio">Link na bio</option>
      <option value="obrigado_simulacao">Obrigado · Simulação</option>
      <option value="obrigado_home_equity">Obrigado · Home Equity</option>
      <option value="obrigado_formulario">Obrigado · Formulário</option>
      <option value="obrigado_auto">Obrigado · Auto</option>
      <option value="obrigado_nao_elegivel">Obrigado · Não elegível</option>
    </select>
    <select id="rangeSel"><option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select>
    <button id="refresh" class="primary">Atualizar</button>
    <button id="openPage" title="Abrir a página selecionada em nova aba">Abrir página ↗</button>
  </div>
</header>
<div class="tabs">
  <button class="tab" id="tabbtn-overview" onclick="showTab('overview')">Visão geral</button>
  <button class="tab" id="tabbtn-leads" onclick="showTab('leads')">Leads</button>
  <button class="tab" id="tabbtn-naoqual" onclick="showTab('naoqual')">Não qualificados</button>
  <button class="tab" id="tabbtn-campaigns" onclick="showTab('campaigns')">Campanhas</button>
  <button class="tab" id="tabbtn-traffic" onclick="showTab('traffic')">Tráfego</button>
  <button class="tab" id="tabbtn-heatmap" onclick="showTab('heatmap')">Mapa de calor</button>
  <button class="tab" id="tabbtn-health" onclick="showTab('health')">Saúde do tracking</button>
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

  <section class="tab-section" id="tab-naoqual">
    <div class="kpis" id="naoQualKpis"></div>
    <div class="card">
      <div class="h2row">
        <h2 id="naoQualTitle">Leads não qualificados</h2>
        <button class="btn-sm" id="naoQualCsvBtn">Baixar CSV</button>
      </div>
      <p class="hint" style="display:block;margin:-6px 0 14px">
        Imóvel com crédito abaixo de R$ 100 mil, ou sem imóvel e sem veículo — também
        vão pro RD Station (marcados como não qualificados no card), mas ficam
        agrupados aqui pra facilitar filtrar/ver de uma vez.
      </p>
      <div class="table-scroll"><div id="naoQual"></div></div>
    </div>
  </section>

  <section class="tab-section" id="tab-campaigns">
    <div class="kpis" id="campKpis"></div>
    <div class="traffic-top">
      <div class="card">
        <div class="h2row"><h2>Origem</h2><span class="hint">utm_source</span></div>
        <div id="campSources"></div>
      </div>
      <div class="card">
        <div class="h2row"><h2>Mídia</h2><span class="hint">utm_medium</span></div>
        <div id="campMediums"></div>
      </div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="h2row"><h2>Campanhas</h2><span class="hint">utm_campaign · leads e crédito solicitado</span></div>
      <div class="table-scroll" id="campTable"></div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="h2row"><h2>Criativos / anúncios</h2><span class="hint">utm_content — só aparece se o anúncio enviar esse parâmetro</span></div>
      <div class="table-scroll" id="campContent"></div>
    </div>
  </section>

  <section class="tab-section" id="tab-traffic">
    <div class="traffic-top">
      <div class="card">
        <div class="h2row"><h2>Origem dos leads</h2><span class="hint" id="sourcesHint"></span></div>
        <div id="sourcesList"></div>
      </div>
      <div class="card">
        <div class="h2row"><h2>Resumo por página</h2></div>
        <div id="pagesSummary"></div>
      </div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="h2row"><h2>Cliques por página</h2><span class="hint">os elementos mais clicados em cada página</span></div>
      <div class="pages" id="pages"></div>
    </div>
  </section>

  <section class="tab-section" id="tab-heatmap">
    <div class="card">
      <div class="h2row">
        <h2>Mapa de calor de cliques</h2>
        <div class="controls">
          <select id="hmPageSel">
            <option value="link_bio">Link na bio</option>
            <option value="landing_page">Landing / Simulação</option>
            <option value="home_equity_lp">Home Equity</option>
            <option value="home_equity_form">Formulário Home Equity</option>
          </select>
          <select id="hmDevice"><option value="mobile" selected>Mobile</option><option value="tablet">Tablet</option><option value="desktop">Desktop</option></select>
          <button id="hmLoad" class="primary">Carregar</button>
        </div>
      </div>
      <div class="hm-note" id="hmNote">Escolha a página e clique em <b>Carregar</b>. As manchas mostram onde as pessoas mais clicaram/tocaram. Role a página para ver o mapa inteiro.</div>
      <div class="hm-stage" id="hmStage">
        <div class="hm-viewport" id="hmViewport">
          <div class="hm-inner" id="hmInner">
            <div class="hm-sticky" id="hmSticky">
              <iframe id="hmFrame" title="Página"></iframe>
              <canvas id="hmCanvas"></canvas>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="tab-section" id="tab-health">
    <div class="kpis" id="healthKpis"></div>
    <p class="hint" style="display:block;margin:-4px 0 16px">
      Diagnóstico do rastreamento dos leads no período. Mostra quanto o nosso cookie de
      edge (400 dias) resgatou do que o Safari/ITP teria cortado, quantos bots foram
      barrados antes de sujar o Pixel, e a cobertura de dados que o Meta usa pra casar o
      lead (Advanced Matching). Só vale pra leads capturados depois do deploy da Fase B.
    </p>
    <div class="traffic-top">
      <div class="card">
        <div class="h2row"><h2>Origem do fbp</h2><span class="hint">de onde veio o identificador do Meta</span></div>
        <div id="healthFbp"></div>
      </div>
      <div class="card">
        <div class="h2row"><h2>Navegador</h2><span class="hint">dos leads do período</span></div>
        <div id="healthBrowser"></div>
      </div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="h2row"><h2>Bots barrados</h2><span class="hint">crawlers que NÃO foram enviados à CAPI</span></div>
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
var dailyChart=null, lastLeads=[], lastNaoQual=[], activeTab="overview";
var PAGE_LABELS={landing_page:"Landing / Simulação",home_equity_lp:"Home Equity",home_equity_form:"Formulário Home Equity",link_bio:"Link na bio",bio_test:"Bio (teste)",obrigado_simulacao:"Obrigado · Simulação",obrigado_home_equity:"Obrigado · Home Equity",obrigado_formulario:"Obrigado · Formulário",other:"Outras"};
var LEAD_KIND_LABELS={home_equity:"Home Equity",home_equity_mql:"Home Equity · MQL",baixo_valor:"Baixo valor (não qualificado)",auto:"Garantia de veículo",descarte:"Sem imóvel/veículo (não qualificado)"};
var PAGE_URLS={landing_page:"https://nova.inspiracred.com.br/",home_equity_lp:"https://nova.inspiracred.com.br/homeequity/",home_equity_form:"https://nova.inspiracred.com.br/formulario/",link_bio:"https://links.inspiracred.com.br/",obrigado_simulacao:"https://nova.inspiracred.com.br/obrigado/simulacao/",obrigado_home_equity:"https://nova.inspiracred.com.br/obrigado/home-equity/",obrigado_formulario:"https://nova.inspiracred.com.br/obrigado/formulario/"};
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
  ["overview","leads","naoqual","campaigns","traffic","heatmap","health"].forEach(function(t){
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
  var pageQ=(page&&page!=="all")?"&page="+encodeURIComponent(page):"";
  var qs="?start="+daysAgo(parseInt(days)-1)+"&end="+new Date().toISOString().slice(0,10);
  updateOpenBtn();
  setLoading(true);
  var scopeTxt="Exibindo: <b>"+(page==="all"?"Todas as páginas":label(page))+"</b> · últimos "+days+" dias";
  document.getElementById("scope").innerHTML=scopeTxt+' · <span style="color:var(--muted)">carregando…</span>';
  var p1=fetch("${API}/overview"+qs+pageQ+"&_="+Date.now()).then(function(r){return r.json()}).then(function(d){render(d);renderTraffic(d);});
  var p2=fetch("${API}/leads?limit=500"+pageQ+"&_="+Date.now()).then(function(r){return r.json()}).then(renderLeads);
  var p3=fetch("${API}/campaigns"+qs+pageQ+"&_="+Date.now()).then(function(r){return r.json()}).then(renderCampaigns);
  // Não qualificados: sempre TODAS as páginas (ignora o filtro pageQ) — é um balde
  // à parte, não faz sentido "zerar" ao filtrar por uma página específica no topo.
  var p4=fetch("${API}/leads?limit=500&kind=nao_qualificado&_="+Date.now()).then(function(r){return r.json()}).then(renderNaoQual);
  var p5=fetch("${API}/health"+qs+pageQ+"&_="+Date.now()).then(function(r){return r.json()}).then(renderHealth);
  Promise.all([p1,p2,p3,p4,p5]).then(function(){
    document.getElementById("scope").innerHTML=scopeTxt+' · <span style="color:var(--green-ink)">atualizado às '+new Date().toLocaleTimeString("pt-BR")+'</span>';
  }).catch(function(e){console.error(e);document.getElementById("scope").innerHTML=scopeTxt+' · <span style="color:var(--red-ink)">erro ao carregar</span>';})
  .then(function(){setLoading(false);});
}

function render(d){
  var t=d.totals, r=d.rates;
  var kpis=[["Visitantes únicos",pretty(t.visitors),r.visitor_to_lead+"% viram lead"],["Simulações concluídas",pretty(t.sim_complete),r.start_to_complete+"% de conclusão"],["Leads capturados",pretty(t.leads),r.complete_to_lead+"% dos que concluíram"],["Conversão visitante→lead",r.visitor_to_lead+"%",pretty(t.leads)+" de "+pretty(t.visitors)]];
  document.getElementById("kpis").innerHTML=kpis.map(function(k){return '<div class="kpi"><div class="label">'+k[0]+'</div><div class="val">'+k[1]+'</div><div class="sub"><b>'+k[2]+'</b></div></div>'}).join("");
  renderFunnel([["Visitantes",t.visitors],["Simulação iniciada",t.sim_start],["Simulação concluída",t.sim_complete],["Lead",t.leads]]);
  var dl=d.daily||[]; drawLine("dailyChart",dl.map(function(x){return x.d.slice(5)}),dl.map(function(x){return x.v}));
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
function renderHealth(d){
  var t=(d&&d.totals)||{}, total=t.total||0;
  var fbp=document.getElementById("healthFbp"), br=document.getElementById("healthBrowser"), bots=document.getElementById("healthBots");
  if(d&&d.pendente){
    document.getElementById("healthKpis").innerHTML='<div class="kpi"><div class="label">Aguardando migration 0008</div><div class="val">—</div><div class="sub"><b>rode o SQL 0008 no Console do D1 pra ligar o painel</b></div></div>';
    fbp.innerHTML=br.innerHTML=bots.innerHTML='';
    return;
  }
  var kpis=[
    ["Leads no período",pretty(total),""],
    ["Resgatados pelo cookie de edge",pretty(t.itp_recuperado),pct(t.itp_recuperado,total)+"% — fbp/fbc que o ITP teria cortado"],
    ["Bots barrados",pretty(t.bots),"não foram enviados à CAPI"],
    ["Enviados ao Meta (ok)",pretty(t.meta_ok),pct(t.meta_ok,total)+"% dos leads"],
    ["Cobertura e-mail",pct(t.com_email,total)+"%",pretty(t.com_email)+" de "+pretty(total)],
    ["Cobertura telefone",pct(t.com_telefone,total)+"%",pretty(t.com_telefone)+" de "+pretty(total)],
    ["Cobertura nome",pct(t.com_nome,total)+"%",pretty(t.com_nome)+" de "+pretty(total)],
    ["Com fbclid (atribuição)",pct(t.com_fbclid,total)+"%",pretty(t.com_fbclid)+" leads"]
  ];
  document.getElementById("healthKpis").innerHTML=kpis.map(function(k){return '<div class="kpi"><div class="label">'+k[0]+'</div><div class="val">'+k[1]+'</div><div class="sub"><b>'+k[2]+'</b></div></div>'}).join("");
  fbp.innerHTML=kvBars(d.by_fbp_source, total, "Sem dados no período.");
  br.innerHTML=kvBars(d.by_browser, total, "Sem dados no período.");
  bots.innerHTML=kvBars(d.by_bot, total, "Nenhum bot registrado no período.");
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

/* ---- Campanhas: de onde vêm os leads (origem, mídia, campanha, criativo) ---- */
function renderCampaigns(d){
  var t=d.totals||{total:0,com_utm:0,direto:0,valor:0};
  var kpis=[
    ["Total de leads",pretty(t.total),""],
    ["Vindos de campanha",pretty(t.com_utm),pct(t.com_utm,t.total)+"% do total"],
    ["Diretos / sem UTM",pretty(t.direto),pct(t.direto,t.total)+"% do total"],
    ["Crédito solicitado",brl(t.valor),"soma dos leads do período"]
  ];
  document.getElementById("campKpis").innerHTML=kpis.map(function(k){
    return '<div class="kpi"><div class="label">'+k[0]+'</div><div class="val">'+k[1]+'</div><div class="sub">'+k[2]+'</div></div>';
  }).join("");

  barsInto("campSources", d.by_source||[], "Nenhum lead no período.");
  barsInto("campMediums", d.by_medium||[], "Nenhum lead no período.");

  // Campanhas: campanha | origem | mídia | leads | crédito | ticket
  var camps=d.by_campaign||[];
  document.getElementById("campTable").innerHTML = !camps.length
    ? '<div class="empty">Nenhuma campanha no período.</div>'
    : '<table class="sumtable"><thead><tr><th>Campanha</th><th style="text-align:left">Origem</th><th style="text-align:left">Mídia</th><th>Leads</th><th>Crédito</th><th>Ticket médio</th></tr></thead><tbody>'+
      camps.map(function(c){
        return '<tr><td title="'+esc(c.k)+'">'+esc(c.k)+'</td>'+
          '<td style="text-align:left;font-weight:500;color:var(--text)">'+esc(c.src)+'</td>'+
          '<td style="text-align:left;font-weight:500;color:var(--muted)" title="'+esc(c.med)+'">'+esc(c.med)+'</td>'+
          '<td class="num">'+c.leads+'</td><td class="num">'+brl(c.valor)+'</td>'+
          '<td class="num">'+(c.leads?brl(Math.round(c.valor/c.leads)):"-")+'</td></tr>';
      }).join("")+'</tbody></table>';

  // Criativos (utm_content)
  var conts=d.by_content||[];
  var semCriativo=conts.length===1&&conts[0].k==="(sem criativo)";
  document.getElementById("campContent").innerHTML = (!conts.length||semCriativo)
    ? '<div class="empty">Nenhum criativo identificado. Os anúncios precisam enviar <b>utm_content</b> no link para essa quebra funcionar.</div>'
    : '<table class="sumtable"><thead><tr><th>Criativo</th><th style="text-align:left">Campanha</th><th style="text-align:left">Origem</th><th>Leads</th><th>Crédito</th></tr></thead><tbody>'+
      conts.map(function(c){
        return '<tr><td title="'+esc(c.k)+'">'+esc(c.k)+'</td>'+
          '<td style="text-align:left;font-weight:500;color:var(--muted)" title="'+esc(c.camp)+'">'+esc(c.camp)+'</td>'+
          '<td style="text-align:left;font-weight:500;color:var(--text)">'+esc(c.src)+'</td>'+
          '<td class="num">'+c.leads+'</td><td class="num">'+brl(c.valor)+'</td></tr>';
      }).join("")+'</tbody></table>';
}
// lista de barras a partir de [{k, leads, valor}]
function barsInto(id, rows, emptyMsg){
  var box=document.getElementById(id);
  if(!rows.length){box.innerHTML='<div class="empty">'+emptyMsg+'</div>';return}
  var total=rows.reduce(function(a,x){return a+(x.leads||0)},0);
  var max=Math.max.apply(null,rows.map(function(x){return x.leads||0}));
  box.innerHTML=barList(rows.map(function(x){
    return {lbl:x.k, val:x.leads, sub:total?Math.round(x.leads/total*100)+"%":"", w:max?x.leads/max:0};
  }));
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

// Leads que NÃO vão pro RD Station (baixo_valor / descarte) — ficam só no nosso D1.
// Mesma ficha/modal de renderLeads (showLead aceita a lista), mas sem colunas de
// entrega RD/Meta (não fazem sentido aqui: por design, nunca são enviados ao RD).
function renderNaoQual(d){
  lastNaoQual=d.leads||[];
  var n=lastNaoQual.length;
  document.getElementById("naoQualTitle").textContent="Leads não qualificados ("+n+")";
  var porTipo={};
  lastNaoQual.forEach(function(l){var k=l.lead_kind||"?";porTipo[k]=(porTipo[k]||0)+1;});
  var kk=[["Total",pretty(n),"também vão pro RD, marcados"],["Baixo valor",pretty(porTipo.baixo_valor||0),"imóvel, crédito < R$ 100 mil"],["Sem imóvel/veículo",pretty(porTipo.descarte||0),"não qualificam pra nenhum funil"]];
  document.getElementById("naoQualKpis").innerHTML=kk.map(function(k){return '<div class="kpi"><div class="label">'+k[0]+'</div><div class="val">'+k[1]+'</div><div class="sub">'+k[2]+'</div></div>'}).join("");
  if(!n){document.getElementById("naoQual").innerHTML='<div class="empty">Nenhum lead não qualificado no período.</div>';return}
  var html='<table><thead><tr><th>Data</th><th>Nome</th><th>Telefone</th><th>Tipo</th><th>Origem</th><th></th></tr></thead><tbody>';
  lastNaoQual.forEach(function(l,i){
    html+='<tr><td>'+(l.created_at||"").slice(0,16)+'</td><td>'+pretty(l.name)+'</td><td>'+pretty(l.phone)+'</td><td>'+(LEAD_KIND_LABELS[l.lead_kind]||pretty(l.lead_kind))+'</td><td>'+pretty(l.utm_source||l.source||"direto")+'</td><td><button class="btn-sm" onclick="showLead('+i+',lastNaoQual)">Ver ficha</button></td></tr>';
  });
  document.getElementById("naoQual").innerHTML=html+'</tbody></table>';
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
  sec("Imóvel & simulação");
  row("Tipo de imóvel",pretty(l.property_type));
  opt("Valor do imóvel",l.property_value?brl(l.property_value):null);
  row("Crédito desejado",brl(l.credit_value));
  opt("Faixa de crédito",l.faixa_credito);
  opt("Imóvel quitado?",l.imovel_quitado);
  opt("Situação do imóvel",l.situacao_imovel);
  opt("Documentação ok?",l.documentacao_ok);
  opt("Possui imóvel?",l.possui_imovel);
  opt("Possui matrícula?",l.possui_matricula);
  opt("Saldo devedor",l.saldo_devedor?brl(l.saldo_devedor):null);
  sec("Origem & campanha");
  row("Origem (página)",label(l.source));
  row("Origem (utm_source)",pretty(l.utm_source));
  row("Mídia (utm_medium)",pretty(l.utm_medium));
  row("Campanha (utm_campaign)",pretty(l.utm_campaign));
  row("Criativo (utm_content)",pretty(l.utm_content));
  opt("Termo (utm_term)",l.utm_term);
  sec("Entrega");
  // Desde 2026-07-22 todo lead vai pro RD (inclusive baixo_valor/descarte) — a
  // classificação vai junto no campo cf_classificacao_lead pra equipe filtrar lá dentro.
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
  downloadCSV(lastLeads,CSV_COLS,"leads-"+currentPage()+"-"+new Date().toISOString().slice(0,10)+".csv");
}
function exportNaoQualCSV(){
  downloadCSV(lastNaoQual,CSV_COLS,"leads-nao-qualificados-"+new Date().toISOString().slice(0,10)+".csv");
}

function drawLine(id,labels,data){var ctx=document.getElementById(id);if(dailyChart)dailyChart.destroy();dailyChart=new Chart(ctx,{type:"line",data:{labels:labels,datasets:[{data:data,borderColor:"#f97316",backgroundColor:"rgba(249,115,22,.12)",fill:true,tension:.3,pointRadius:2,pointBackgroundColor:"#f97316"}]},options:{maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#6b7280"},grid:{color:"#eef0f3"}},y:{ticks:{color:"#6b7280"},grid:{color:"#eef0f3"}}}}})}

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

function drawSlice(){
  hmTick=false;
  if(!hmLast||!hmH0)return;
  var vp=document.getElementById("hmViewport");
  var fr=document.getElementById("hmFrame");
  var st=vp.scrollTop;
  try{ if(fr.contentWindow) fr.contentWindow.scrollTo(0, st); }catch(e){}
  var radius=hmW>=1000?30:22;
  var cv=document.getElementById("hmCanvas");
  if(cv.width!==hmW||cv.height!==hmVH){cv.width=hmW;cv.height=hmVH;}
  var ctx=cv.getContext("2d");ctx.clearRect(0,0,hmW,hmVH);
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
    var DEVN={mobile:"Mobile",tablet:"Tablet",desktop:"Desktop"};
    var bd=hmLast.by_device||{mobile:0,tablet:0,desktop:0};
    document.getElementById("hmNote").innerHTML=
      '<b>'+hmLast.count+'</b> toque'+(hmLast.count===1?"":"s")+' em <b>'+label(hmLast.page||page)+'</b> · '+(DEVN[dev]||dev)+
      ' <span style="color:var(--muted)">(distribuição no período: mobile '+bd.mobile+' · tablet '+bd.tablet+' · desktop '+bd.desktop+')</span>'+
      ' · <span style="color:var(--muted)">role para ver o mapa inteiro</span>';
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

document.getElementById("refresh").addEventListener("click",loadAll);
document.getElementById("rangeSel").addEventListener("change",loadAll);
document.getElementById("pageSel").addEventListener("change",loadAll);
document.getElementById("openPage").addEventListener("click",function(){var u=PAGE_URLS[currentPage()];if(u)window.open(u,"_blank","noopener");});
document.getElementById("csvBtn").addEventListener("click",exportCSV);
document.getElementById("naoQualCsvBtn").addEventListener("click",exportNaoQualCSV);
document.getElementById("hmLoad").addEventListener("click",loadHeatmap);
document.getElementById("hmDevice").addEventListener("change",loadHeatmap);
document.getElementById("hmPageSel").addEventListener("change",loadHeatmap);
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
showTab("overview");
loadAll();
</script>
</body>
</html>`;
