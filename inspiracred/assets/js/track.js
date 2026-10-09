/**
 * InspiraCred — tracking leve (page views, cliques, formulários) + Meta CAPI.
 * Envia eventos para o Worker de analytics. Configurar a página assim,
 * ANTES de carregar este arquivo:
 *   <script>window.IC_PAGE="landing_page";</script>
 *   <script src="assets/js/track.js" defer></script>
 *
 * META: conversões são encaminhadas apenas pelo servidor (CAPI). A restrição
 * básica aplicada pela Meta a este dataset proíbe parâmetros personalizados e
 * conteúdo de URL após o domínio; por isso este arquivo não carrega nem chama o
 * Pixel no navegador. A qualificação financeira permanece só no tracking interno.
 */
(function () {
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


  // Valor CRU de um parâmetro da query — MESMA regex do functions/_middleware.js.
  // Obrigatório pra fbclid/gclid: URLSearchParams decodifica percent-encoding E
  // converte "+" em espaço, e a Meta rejeita o fbc quando o fbclid chega alterado
  // ("valor fbclid modificado no parâmetro fbc"). Só usar pra identificador de
  // clique — pra UTM o decode é o comportamento certo.
  function rawParam(name) {
    try {
      var m = (window.location.search || "").match(new RegExp("[?&]" + name + "=([^&]*)"));
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  // Lê um cookie por nome, CRU (sem decodeURIComponent) — usado pra mandar o
  // _fbp/_fbc que o Pixel/edge setaram junto no payload do lead. Dá ao servidor a
  // fonte "pixel_js" no fallback e permite calcular pixel_was_blocked na Fase B.
  // ⚠️ NÃO decodificar: o _middleware.js grava fb.2.{ts}.{fbclid CRU}; decodificar
  // aqui altera o fbclid e a Meta acusa "valor fbclid modificado no parâmetro fbc".
  function cookieVal(name) {
    try {
      var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  // Atribuição da URL (first-touch: guarda na sessão pra não perder em cliques
  // posteriores nem em navegação interna que chegue sem os parâmetros). Os IDs Meta
  // são a chave estável; as UTMs continuam como rótulo humano/auditoria.
  var UTM_KEYS = [
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "meta_campaign_id", "meta_adset_id", "meta_ad_id"
  ];
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

  // Nomes de evento internos -> evento PADRÃO do Meta.
  // ⚠️ Precisa ser padrão: a conta está sob "Restrições de compartilhamento de dados —
  // configuração básica" (categoria serviço financeiro), e nessa configuração evento
  // PERSONALIZADO não é registrado nem utilizável — a Meta responde 200 e descarta.
  // Antes eram SimulacaoIniciada/SimulacaoCompleta (custom) e não otimizavam nada.
  // Pra a gestora ver nome em português, criar Conversão Personalizada por cima.
  //   simulation_start    -> InitiateCheckout  ("entrou no fluxo de conversão")
  //   simulation_complete -> SubmitApplication (solicitação de crédito enviada — é o
  //                          evento que a própria Meta exemplifica com "cartão de crédito")
  var PIXEL_EVENT = {
    simulation_start: "InitiateCheckout",
    simulation_complete: "SubmitApplication",
  };

  // A URL usada na CAPI é somente o domínio. UTMs, caminho e IDs de anúncio ficam
  // no tracking interno e nunca seguem para a Meta dentro de event_source_url.
  function metaSourceUrl() {
    return "https://nova.inspiracred.com.br/";
  }

  function send(payload) {
    payload.session_id = sid;
    if (!payload.page_name) payload.page_name = PAGE;
    // Carimba a ORIGEM dentro das properties de todo evento (simulação iniciada,
    // scroll, seção…). A tabela `events` não tem coluna de UTM e é chaveada pelo id do
    // navegador, não pela sessão do edge — sem este carimbo não existe jeito de filtrar
    // o funil por origem no dashboard. Vai em `properties` de propósito: é coluna JSON,
    // então não precisa de migration. Cópia (não mutação) pra não mexer no objeto que o
    // Pixel já usou.
    if (payload.type === "event") {
      try {
        var uSrc = utmParams().utm_source;
        if (uSrc) {
          var props = payload.properties || {};
          if (props.utm_source == null) {
            var copia = {};
            for (var k in props) copia[k] = props[k];
            copia.utm_source = uSrc;
            payload.properties = copia;
          }
        }
      } catch (e) {}
    }
    try {
      var body = JSON.stringify(payload);
      // text/plain evita preflight CORS em requisições cross-subdomain (links -> nova)
      var blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) return true;
      return fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: body, keepalive: true, mode: "cors" })
        .then(function (response) { return response.ok; }, function () { return false; });
    } catch (e) { return false; }
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
  var HEATMAP_PAGES = { link_bio: 1, landing_page: 1, home_equity_lp: 1, home_equity_form: 1, home_institucional: 1 };
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
      props = props || {};
      var pixelName = PIXEL_EVENT[name] || null;
      var eventId = pixelName ? uuid() : null;
      // A Meta recebe via CAPI somente a ocorrência da ação. Propriedades de negócio ficam
      // no D1; valores, classificação, documentação e dívida nunca viram custom_data.
      var p = { type: "event", event_name: name, properties: props };
      // Eventos de funil mapeados pro Meta seguem server-side (CAPI).
      if (pixelName) {
        p.meta_event_name = pixelName;
        p.event_id = eventId;
        p.url = metaSourceUrl();
        p.fbclid = rawParam("fbclid") || null;
        p.gclid = rawParam("gclid") || null;
        p.fbp = cookieVal("_fbp") || null;
        p.fbc = cookieVal("_fbc") || null;
      }
      return send(withUtm(p));
    },
    lead: function (data) {
      data = data || {};
      // Conversão honesta e não selecionada: todo envio válido gera exatamente Lead.
      // MQL, faixas, dívida e documentação permanecem internos, nunca são codificados
      // em nomes alternativos nem em parâmetros enviados à Meta.
      var metaEvents = [{ name: "Lead", event_id: uuid() }];
      // Payload pro servidor: carrega os eventos (nome+id) + fbclid/gclid + url pra CAPI/atribuição.
      // Mantém event_id "solto" (1º evento) pra compatibilidade com a coluna leads.event_id —
      // null quando não há nenhum evento de Meta (metaEvents vazio não quebra mais aqui).
      var p = { type: "lead", meta_events: metaEvents, event_id: metaEvents[0].event_id, url: metaSourceUrl() };
      p.fbclid = rawParam("fbclid") || null;
      p.gclid = rawParam("gclid") || null;
      // _fbp/_fbc lidos pelo navegador (Pixel ou cookie de edge). O servidor usa como
      // 1ª opção da cadeia de fallback e pra saber se o Pixel foi bloqueado (Fase B).
      p.fbp = cookieVal("_fbp") || null;
      p.fbc = cookieVal("_fbc") || null;
      for (var k in data) if (k !== "meta_events") p[k] = data[k];
      // withUtm preenche utm_* de first-touch (localStorage) quando o payload não trouxe —
      // sem isso o lead perde a origem se a URL "limpou" as UTMs antes do envio (→ "direto").
      return send(withUtm(p));
    },
  };
})();
