/**
 * InspiraCred — tracking leve (page views, cliques, formulários).
 * Envia eventos para o Worker de analytics. Configurar a página assim,
 * ANTES de carregar este arquivo:
 *   <script>window.IC_PAGE="landing_page";</script>
 *   <script src="assets/js/track.js" defer></script>
 */
(function () {
  var ENDPOINT = "https://inspiracred-analytics.huedsonneto.workers.dev/track";
  var PAGE = window.IC_PAGE || "other";
  var KEY = "ic_sid";

  var sid = null;
  try { sid = localStorage.getItem(KEY); } catch (e) {}
  if (!sid) {
    sid = "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
    try { localStorage.setItem(KEY, sid); } catch (e) {}
  }

  function send(payload) {
    payload.session_id = sid;
    if (!payload.page_name) payload.page_name = PAGE;
    try {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      } else {
        fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true });
      }
    } catch (e) {}
  }

  // Page view
  send({ type: "page_view", url: location.pathname + location.search, title: document.title, referrer: document.referrer });

  // Cliques em links e botões
  document.addEventListener("click", function (e) {
    var t = e.target.closest("a, button");
    if (!t) return;
    var withId = t.closest("[id]");
    send({
      type: "click",
      element_id: t.id || (withId && withId.id) || null,
      element_text: (t.textContent || "").trim().slice(0, 80) || null,
      destination: t.href || null,
      link_type: guessType(t),
    });
  }, true);

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
    event: function (name, props) { send({ type: "event", event_name: name, properties: props || {} }); },
    lead: function (data) { var p = { type: "lead" }; for (var k in (data || {})) p[k] = data[k]; send(p); },
  };
})();
