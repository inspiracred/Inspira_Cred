(function () {
  if (location.origin !== "https://nova.inspiracred.com.br" || location.pathname !== "/parceiros/" ||
      navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" ||
      window.doNotTrack === "1" || window.inspiraPartnerPageView) return;

  const pixelId = "3021870508000260";
  if (!window.fbq) {
    const queue = function () {
      if (queue.callMethod) queue.callMethod.apply(queue, arguments);
      else queue.queue.push(arguments);
    };
    queue.push = queue;
    queue.loaded = true;
    queue.version = "2.0";
    queue.queue = [];
    window.fbq = queue;
    if (!window._fbq) window._fbq = queue;

    const sdk = document.createElement("script");
    sdk.async = true;
    sdk.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(sdk);
  }

  window.fbq("set", "autoConfig", false, pixelId);
  window.fbq("init", pixelId);

  const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
  const sentLeads = new Set();
  window.inspiraPartnerLead = function (eventId) {
    if (typeof eventId !== "string" || !uuid.test(eventId) || sentLeads.has(eventId)) return;
    sentLeads.add(eventId);
    window.fbq("trackSingle", pixelId, "Lead", {}, { eventID: eventId });
  };

  window.inspiraPartnerPageView = async function (eventId) {
    if (typeof eventId !== "string" || !uuid.test(eventId)) return;
    try {
      const key = "parceiros-pageview:" + eventId.toLowerCase();
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
      const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      window.fbq("trackSingle", pixelId, "PageView", {}, { eventID: id });
    } catch (_) {
      // O servidor continua registrando a visita quando o Pixel não pode enviar.
    }
  };
})();
