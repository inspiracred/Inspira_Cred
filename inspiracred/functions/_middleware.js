/**
 * InspiraCred — middleware de identidade (Fase 1 do plano de tracking).
 * Roda em TODA página do site (Cloudflare Pages Functions). Garante que
 * `_fbp`/`_fbc` existam num cookie PRÓPRIO, first-party, 400 dias — setado
 * no edge, não depende do Pixel do navegador carregar. Resolve dois gaps:
 *   1. Hoje só teríamos _fbp/_fbc se o Pixel JS do Meta os setasse; no
 *      Safari isso é cookie de storage particionado e o ITP corta pra 7
 *      dias. Com o cookie setado aqui, sobrevive 400 dias.
 *   2. `fbclid` só existe na URL da página em que o anúncio caiu — se o
 *      visitante navega (ex.: landing -> /formulario/) o parâmetro some da
 *      URL. Persistindo o `_fbc` derivado dele num cookie, sobrevive a
 *      navegação entre páginas até o lead ser enviado.
 * Baseado no padrão de github.com/gustavokrob/krob-tracking-stack (ver
 * CLAUDE.md "Referência de tracking"). O `case "lead"` em
 * functions/analytics/_app.js já lê `_fbp`/`_fbc` do header Cookie — não
 * precisa mudar nada lá além de registrar a origem (fbp_source/fbc_source).
 *
 * Todos os nossos domínios são .com.br -> sub_domain_index do Meta é
 * sempre 2 (fb.{index}.{ts}.{valor}); hardcoded, sem lógica genérica de
 * TLD (não temos outro domínio pra suportar).
 */
const SUB_DOMAIN_INDEX = 2;
const COOKIE_MAX_AGE = 34560000; // 400 dias, em segundos

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // Só intercepta requisições de página (HTML). Deixa passar direto:
  // assets estáticos, /analytics/* (tracking próprio + dashboard, já cuida
  // de si mesmo) e as demais rotas de function existentes.
  const isPageRequest =
    !url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|webp|avif|woff2?|ttf|eot|map|json|xml|txt|pdf|mp4|webm)$/i) &&
    !url.pathname.startsWith("/analytics");

  if (!isPageRequest) return next();

  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const existingFbp = cookies["_fbp"] || "";
  const existingFbc = cookies["_fbc"] || "";

  // fbclid CRU da query string (não url.searchParams.get(), que decodifica —
  // o Meta espera o valor exatamente como veio na URL do clique do anúncio).
  const fbclidMatch = url.search.match(/[?&]fbclid=([^&]*)/);
  const fbclid = fbclidMatch ? fbclidMatch[1] : "";

  const fbp = existingFbp || `fb.${SUB_DOMAIN_INDEX}.${Date.now()}.${Math.floor(Math.random() * 9000000000) + 1000000000}`;

  let fbc = existingFbc;
  if (fbclid) {
    const existingPayload = existingFbc.split(".")[3] || "";
    if (existingPayload !== fbclid) fbc = `fb.${SUB_DOMAIN_INDEX}.${Date.now()}.${fbclid}`;
  }

  const response = await next();

  const newHeaders = new Headers(response.headers);
  const cookieBase = `Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; Secure`;
  if (!existingFbp) newHeaders.append("Set-Cookie", `_fbp=${fbp}; ${cookieBase}`);
  if (fbc && fbc !== existingFbc) newHeaders.append("Set-Cookie", `_fbc=${fbc}; ${cookieBase}`);

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
