/**
 * InspiraCred — tracking leve (page views, cliques, formulários) + Meta Pixel.
 * Envia eventos para o Worker de analytics. Configurar a página assim,
 * ANTES de carregar este arquivo:
 *   <script>window.IC_PAGE="landing_page";</script>
 *   <script src="assets/js/track.js" defer></script>
 *
 * META PIXEL: preencha META_PIXEL_ID abaixo com o ID confirmado do cliente pra
 * LIGAR o Pixel (hoje vazio = desligado, seguro no ar). O Pixel dispara PageView
 * e Lead no navegador; o servidor dispara o MESMO Lead via CAPI com o mesmo
 * event_id (o Meta deduplica). O ID do Pixel é público (aparece no navegador),
 * então pode ficar aqui — o TOKEN da CAPI é que é secret, fica no Cloudflare.
 * ⚠️ Este ID (client) e o secret META_PIXEL_ID (server) precisam ser IGUAIS.
 */
(function () {
  var META_PIXEL_ID = "588064149882794"; // Pixel/Dataset ID — trocado a pedido do cliente (2026-07-15)

  var ENDPOINT = "https://nova.inspiracred.com.br/analytics/track";
  var PAGE = window.IC_PAGE || "other";
  var KEY = "ic_sid";

  var sid = null;
  try { sid = localStorage.getItem(KEY); } catch (e) {}
  if (!sid) {
    sid = "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
    try { localStorage.setItem(KEY, sid); } catch (e) {}
  }

  function uuid() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return "e_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 12);
  }

  function urlParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }

  // Lê um cookie por nome (usado pra mandar o _fbp/_fbc que o Pixel/edge setaram
  // junto no payload do lead — dá ao servidor a fonte "pixel_js" no fallback e
  // permite calcular pixel_was_blocked na Fase B).
  function cookieVal(name) {
    try {
      var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }

  // UTMs da URL (first-touch: guarda na sessão pra não perder em cliques posteriores
  // nem em navegação interna que chegue sem os parâmetros).
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  var UTM_STORE = "ic_utm";
  function utmParams() {
    var out = {};
    try {
      var q = new URLSearchParams(window.location.search);
      UTM_KEYS.forEach(function (k) { var v = q.get(k); if (v) out[k] = v.slice(0, 120); });
    } catch (e) {}
    try {
      if (Object.keys(out).length) {
        localStorage.setItem(UTM_STORE, JSON.stringify(out));
      } else {
        var saved = localStorage.getItem(UTM_STORE);
        if (saved) out = JSON.parse(saved);
      }
    } catch (e) {}
    return out;
  }
  function withUtm(payload) {
    var u = utmParams();
    for (var k in u) if (payload[k] == null) payload[k] = u[k];
    return payload;
  }

  /* ---- Meta Pixel (só carrega se META_PIXEL_ID estiver preenchido) ---- */
  if (META_PIXEL_ID) {
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", META_PIXEL_ID);
    window.fbq("track", "PageView");
  }
  // Eventos PADRÃO do Meta (fbq('track', ...)); qualquer outro nome (SimulacaoIniciada,
  // LeadQualificado, LeadBaixoValor, LeadAuto...) precisa de fbq('trackCustom', ...) —
  // chamar 'track' com nome não-padrão faz o Pixel SUPRIMIR o evento (confirmado no
  // console: "non-standard event... The event was suppressed").
  var STANDARD_PIXEL_EVENTS = {
    PageView: 1, AddPaymentInfo: 1, AddToCart: 1, AddToWishlist: 1, CompleteRegistration: 1,
    Contact: 1, CustomizeProduct: 1, Donate: 1, FindLocation: 1, InitiateCheckout: 1,
    Lead: 1, Purchase: 1, Schedule: 1, Search: 1, StartTrial: 1, SubmitApplication: 1,
    Subscribe: 1, ViewContent: 1,
  };
  function pixel(name, data, eventId) {
    try {
      if (typeof window.fbq === "function") {
        var method = STANDARD_PIXEL_EVENTS[name] ? "track" : "trackCustom";
        window.fbq(method, name, data || {}, eventId ? { eventID: eventId } : undefined);
      }
    } catch (e) {}
  }
  // nomes de evento internos -> evento do Pixel (custom p/ as etapas da simulação)
  var PIXEL_EVENT = {
    simulation_start: "SimulacaoIniciada",
    simulation_complete: "SimulacaoCompleta",
  };

  function send(payload) {
    payload.session_id = sid;
    if (!payload.page_name) payload.page_name = PAGE;
    try {
      var body = JSON.stringify(payload);
      // text/plain evita preflight CORS em requisições cross-subdomain (links/bio -> nova)
      var blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) return;
      fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: body, keepalive: true, mode: "cors" });
    } catch (e) {}
  }

  // Page view
  send(withUtm({ type: "page_view", url: location.pathname + location.search, title: document.title, referrer: document.referrer }));

  // Cliques em links e botões
  document.addEventListener("click", function (e) {
    var t = e.target.closest("a, button");
    if (!t) return;
    var withId = t.closest("[id]");
    send(withUtm({
      type: "click",
      element_id: t.id || (withId && withId.id) || null,
      element_text: (t.textContent || "").trim().slice(0, 80) || null,
      destination: t.href || null,
      link_type: guessType(t),
    }));
  }, true);

  /* ---- Mapa de calor: toque/clique com coordenadas percentuais do documento ---- */
  var HEATMAP_PAGES = { link_bio: 1, landing_page: 1, home_equity_lp: 1, home_equity_form: 1 };
  if (HEATMAP_PAGES[PAGE]) {
    document.addEventListener("click", function (e) {
      var docH = document.documentElement.scrollHeight || 1;
      var t = e.target;
      var idEl = t && t.closest ? t.closest("[id]") : null;
      send({
        type: "tap",
        x_pct: +((e.clientX) / (window.innerWidth || 1)).toFixed(4),
        y_pct: +(((window.scrollY || window.pageYOffset || 0) + e.clientY) / docH).toFixed(4),
        vw: window.innerWidth,
        doc_h: docH,
        element_id: (idEl && idEl.id) || null,
      });
    }, true);
  }

  /* ---- Scroll depth (marcos 25/50/75/100, 1x cada por página/sessão) ---- */
  var scrollMarks = [25, 50, 75, 100];
  var scrollHit = {};
  var scrollTick = false;
  function checkScroll() {
    scrollTick = false;
    var docH = document.documentElement.scrollHeight || 1;
    var pct = ((window.scrollY || window.pageYOffset || 0) + window.innerHeight) / docH * 100;
    scrollMarks.forEach(function (m) {
      if (pct >= m && !scrollHit[m]) {
        scrollHit[m] = 1;
        send({ type: "event", event_name: "scroll_depth", properties: { pct: m } });
      }
    });
  }
  window.addEventListener("scroll", function () {
    if (!scrollTick) { scrollTick = true; requestAnimationFrame(checkScroll); }
  }, { passive: true });

  /* ---- Seções lidas (data-section="nome") via IntersectionObserver ---- */
  try {
    if ("IntersectionObserver" in window) {
      var secObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            var name = en.target.getAttribute("data-section");
            secObs.unobserve(en.target);
            if (name) send({ type: "event", event_name: "section_view", properties: { section: name } });
          }
        });
      }, { threshold: 0.25 }); // baixo p/ seções altas (>2x viewport nunca atingiriam 0.5)
      var runObs = function () {
        document.querySelectorAll("[data-section]").forEach(function (el) { secObs.observe(el); });
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", runObs);
      else runObs();
    }
  } catch (e) {}

  // Envio de formulários (sem campos sensíveis)
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (!f || !f.id) return;
    var data = {};
    try {
      new FormData(f).forEach(function (v, k) {
        if (!/senha|password|cpf|token|nome|name|phone|tel|email|whats/i.test(k)) data[k] = String(v).slice(0, 120);
      });
    } catch (e) {}
    send({ type: "form_submit", form_id: f.id, form_data: data, success: true });
  }, true);

  function guessType(el) {
    var h = el.href || "";
    var x = (el.textContent || "").toLowerCase();
    if (h.indexOf("wa.me") > -1 || x.indexOf("whatsapp") > -1) return "whatsapp";
    if (h.indexOf("instagram") > -1) return "instagram";
    if (h.indexOf("linkedin") > -1) return "linkedin";
    if (h.indexOf("reclameaqui") > -1) return "reclame_aqui";
    if (h.indexOf("creditas") > -1) return "parceiro";
    if ((el.className || "").indexOf("cta") > -1) return "cta";
    if ((el.className || "").indexOf("button") > -1) return "button";
    return "link";
  }

  // API para eventos manuais (usada pela landing na simulação/lead)
  window.inspiraTrack = {
    event: function (name, props) {
      if (PIXEL_EVENT[name]) pixel(PIXEL_EVENT[name], props || {});
      send({ type: "event", event_name: name, properties: props || {} });
    },
    lead: function (data) {
      data = data || {};
      // Um lead pode disparar 1+ eventos do Meta (ex.: MQL = "Lead" + "LeadQualificado"),
      // ou ZERO (ex.: lead "descarte" — não conta como conversão de ads). Testa
      // `!== undefined` (não `.length`) pra um array VAZIO explícito não cair no
      // fallback ["Lead"] (um [].length é 0, que é falsy — bug já corrigido aqui).
      // Cada nome ganha um event_id próprio; o MESMO {name,event_id} vai no Pixel
      // (browser) e na CAPI (server) -> o Meta deduplica par a par.
      var names = data.meta_events !== undefined ? data.meta_events : ["Lead"];
      var metaEvents = names.map(function (name) { return { name: name, event_id: uuid() }; });
      var custom = {
        currency: "BRL",
        value: data.credit_value != null ? Number(data.credit_value) : undefined,
        content_category: data.property_type || undefined,
      };
      metaEvents.forEach(function (ev) { pixel(ev.name, custom, ev.event_id); });
      // Payload pro servidor: carrega os eventos (nome+id) + fbclid/gclid + url pra CAPI/atribuição.
      // Mantém event_id "solto" (1º evento) pra compatibilidade com a coluna leads.event_id —
      // null quando não há nenhum evento de Meta (metaEvents vazio não quebra mais aqui).
      var p = { type: "lead", meta_events: metaEvents, event_id: metaEvents.length ? metaEvents[0].event_id : null, url: location.href };
      p.fbclid = urlParam("fbclid") || null;
      p.gclid = urlParam("gclid") || null;
      // _fbp/_fbc lidos pelo navegador (Pixel ou cookie de edge). O servidor usa como
      // 1ª opção da cadeia de fallback e pra saber se o Pixel foi bloqueado (Fase B).
      p.fbp = cookieVal("_fbp") || null;
      p.fbc = cookieVal("_fbc") || null;
      for (var k in data) if (k !== "meta_events") p[k] = data[k];
      // withUtm preenche utm_* de first-touch (localStorage) quando o payload não trouxe —
      // sem isso o lead perde a origem se a URL "limpou" as UTMs antes do envio (→ "direto").
      send(withUtm(p));
    },
  };
})();
