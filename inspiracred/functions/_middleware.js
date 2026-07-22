/**
 * InspiraCred — middleware de identidade + atribuição (Fases 1 e A do plano de tracking).
 * Roda em TODA página do site (Cloudflare Pages Functions). Duas responsabilidades:
 *
 * 1) COOKIES DE IDENTIDADE (first-party, 400 dias, setados no edge):
 *    - `_krob_sid` (UUID): id de SESSÃO server-side. Fonte de verdade do visitante —
 *      o case "lead" do _app.js lê a linha `sessions` por este id pra enriquecer.
 *    - `_krob_eid` (UUID): external_id estável do Meta Advanced Matching (por-pessoa,
 *      não some se o localStorage for limpo — diferente do sha256(ic_sid) de antes).
 *    - `_fbp`/`_fbc`: cookie próprio do Meta que sobrevive 400d (o Pixel JS no Safari
 *      vira cookie particionado que o ITP corta pra 7 dias). O `_fbc` deriva do
 *      `fbclid` da URL do clique e sobrevive à navegação interna (landing -> /formulario).
 *
 * 2) LINHA `sessions` (UPSERT no D1, em waitUntil, não bloqueia a página): grava os
 *    identificadores de atribuição CRUS (fbclid/gclid/msclkid) + UTMs + ip/ua/referrer/
 *    landing_url NO PRIMEIRO ACESSO — antes de o navegador "limpar" a query string.
 *    UPSERT com guard CASE-WHEN-empty: visita de retorno SEM parâmetro não apaga a
 *    origem já capturada; visita COM parâmetro diferente sobrescreve.
 *
 * Baseado em github.com/gustavokrob/krob-tracking-stack (ver CLAUDE.md "Referência de
 * tracking"). Todos os nossos domínios são .com.br -> sub_domain_index do Meta é
 * sempre 2 (fb.{index}.{ts}.{valor}); hardcoded, sem lógica genérica de TLD.
 *
 * `ic_sid` (localStorage, client) segue existindo e chaveando as tabelas de
 * produto-analytics (page_views/clicks/journey/heatmap) — NÃO migradas pra cá.
 */
const SUB_DOMAIN_INDEX = 2;
const COOKIE_MAX_AGE = 34560000; // 400 dias, em segundos

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // Só intercepta requisições de página (HTML). Deixa passar direto:
  // assets estáticos, /analytics/* (tracking próprio + dashboard, já cuida de si
  // mesmo — e NÃO queremos cookie de tracking quando o admin abre o dashboard) e
  // as demais rotas de function existentes.
  const isPageRequest =
    !url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|webp|avif|woff2?|ttf|eot|map|json|xml|txt|pdf|mp4|webm)$/i) &&
    !url.pathname.startsWith("/analytics");

  if (!isPageRequest) return next();

  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const existingSid = cookies["_krob_sid"] || "";
  const existingEid = cookies["_krob_eid"] || "";
  const existingFbp = cookies["_fbp"] || "";
  const existingFbc = cookies["_fbc"] || "";

  // Gera identidade se faltar.
  const sessionId = existingSid || crypto.randomUUID();
  const externalId = existingEid || crypto.randomUUID();

  // Identificadores de clique CRUS da query string (não url.searchParams.get(), que
  // decodifica — o Meta espera o valor exatamente como veio na URL do anúncio).
  const fbclid = rawParam(url.search, "fbclid");
  const gclid = rawParam(url.search, "gclid");
  const msclkid = rawParam(url.search, "msclkid");

  const utmSource = url.searchParams.get("utm_source") || "";
  const utmMedium = url.searchParams.get("utm_medium") || "";
  const utmCampaign = url.searchParams.get("utm_campaign") || "";
  const utmContent = url.searchParams.get("utm_content") || "";
  const utmTerm = url.searchParams.get("utm_term") || "";

  const fbp = existingFbp || `fb.${SUB_DOMAIN_INDEX}.${Date.now()}.${Math.floor(Math.random() * 9000000000) + 1000000000}`;

  let fbc = existingFbc;
  if (fbclid) {
    const existingPayload = existingFbc.split(".")[3] || "";
    if (existingPayload !== fbclid) fbc = `fb.${SUB_DOMAIN_INDEX}.${Date.now()}.${fbclid}`;
  }

  const clientIp = request.headers.get("cf-connecting-ip") || "";
  const userAgent = request.headers.get("user-agent") || "";
  const referrer = request.headers.get("referer") || "";
  const now = Math.floor(Date.now() / 1000);

  // Serve a página PRIMEIRO; cookies e D1 vêm depois (não bloqueia o HTML).
  const response = await next();

  const newHeaders = new Headers(response.headers);
  const cookieBase = `Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; Secure`;
  if (!existingSid) newHeaders.append("Set-Cookie", `_krob_sid=${sessionId}; ${cookieBase}`);
  if (!existingEid) newHeaders.append("Set-Cookie", `_krob_eid=${externalId}; ${cookieBase}`);
  if (!existingFbp) newHeaders.append("Set-Cookie", `_fbp=${fbp}; ${cookieBase}`);
  if (fbc && fbc !== existingFbc) newHeaders.append("Set-Cookie", `_fbc=${fbc}; ${cookieBase}`);

  // UPSERT da sessão em background (não bloqueia). Se o binding DB não existir (ou a
  // tabela sessions ainda não tiver sido criada pela migration 0006), o try/catch
  // engole — a página e os cookies já foram entregues.
  if (env && env.DB) {
    context.waitUntil(
      (async () => {
        try {
          await env.DB.prepare(
            `INSERT INTO sessions (session_id, external_id, fbclid, gclid, msclkid, fbc, fbp, ip_address, user_agent, referrer, landing_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(session_id) DO UPDATE SET
               fbclid = CASE WHEN excluded.fbclid != '' THEN excluded.fbclid ELSE sessions.fbclid END,
               gclid = CASE WHEN excluded.gclid != '' THEN excluded.gclid ELSE sessions.gclid END,
               msclkid = CASE WHEN excluded.msclkid != '' THEN excluded.msclkid ELSE sessions.msclkid END,
               fbc = CASE WHEN excluded.fbc != '' THEN excluded.fbc ELSE sessions.fbc END,
               utm_source = CASE WHEN excluded.utm_source != '' THEN excluded.utm_source ELSE sessions.utm_source END,
               utm_medium = CASE WHEN excluded.utm_medium != '' THEN excluded.utm_medium ELSE sessions.utm_medium END,
               utm_campaign = CASE WHEN excluded.utm_campaign != '' THEN excluded.utm_campaign ELSE sessions.utm_campaign END,
               utm_content = CASE WHEN excluded.utm_content != '' THEN excluded.utm_content ELSE sessions.utm_content END,
               utm_term = CASE WHEN excluded.utm_term != '' THEN excluded.utm_term ELSE sessions.utm_term END,
               updated_at = excluded.updated_at`
          ).bind(
            sessionId, externalId, fbclid, gclid, msclkid, fbc, fbp,
            clientIp, userAgent, referrer, url.toString(),
            utmSource, utmMedium, utmCampaign, utmContent, utmTerm, now, now
          ).run();
        } catch (e) {
          // sessions ainda não existe (migration 0006 pendente) ou falha transitória — ok.
        }
      })()
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

function parseCookies(header) {
  const out = {};
  header.split(";").forEach((c) => {
    const i = c.indexOf("=");
    if (i > -1) out[c.slice(0, i).trim()] = c.slice(i + 1).trim();
  });
  return out;
}

// Valor CRU de um parâmetro da query (sem decodificar — Meta quer o fbclid como veio).
function rawParam(search, name) {
  const m = (search || "").match(new RegExp("[?&]" + name + "=([^&]*)"));
  return m ? m[1] : "";
}
