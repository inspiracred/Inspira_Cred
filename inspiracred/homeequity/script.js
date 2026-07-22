/* InspiraCred — Home Equity landing
   Interações + animações de entrada. Integrações (envio de lead + tracking)
   estão DESATIVADAS por enquanto — ver ./INTEGRACOES.md para religar. */
(function () {
  "use strict";
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ============================================================
     FORMULÁRIO — máscaras, validação e sucesso
     ============================================================ */
  var form = document.getElementById("lead-form");
  if (form) {
    var formSuccess = document.getElementById("form-success");
    var formMessage = document.getElementById("form-message");
    var submitBtn = form.querySelector("button[type='submit']");

    // Máscara de VALOR INTEIRO em reais: dígitos digitados = reais (ninguém pede
    // centavo de empréstimo). ",00" fixo/decorativo; a regex remove esse sufixo de
    // centavos antes de reler os dígitos. Ex.: 800000 -> "R$ 800.000,00".
    function formatMoney(value) {
      var digits = value.replace(/,\d*$/, "").replace(/\D/g, "");
      if (!digits) return "";
      return "R$ " + Number(digits).toLocaleString("pt-BR") + ",00";
    }
    function parseMoney(value) {
      var digits = value.replace(/\D/g, "");
      return digits ? Number(digits) / 100 : 0;
    }
    document.querySelectorAll(".money").forEach(function (input) {
      input.addEventListener("input", function () {
        input.value = formatMoney(input.value);
        // cursor antes do ",00" fixo pra novos dígitos entrarem no valor inteiro
        if (input.value) { var p = input.value.length - 3; try { input.setSelectionRange(p, p); } catch (e) {} }
        clearError(input.name);
      });
    });

    var celular = document.getElementById("f-celular");
    celular.addEventListener("input", function () {
      var d = celular.value.replace(/\D/g, "").slice(0, 11);
      if (!d) { celular.value = ""; }
      else if (d.length <= 2) celular.value = "(" + d;
      else if (d.length <= 6) celular.value = "(" + d.slice(0, 2) + ") " + d.slice(2);
      else if (d.length <= 10) celular.value = "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
      else celular.value = "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
      clearError("celular");
    });

    document.querySelectorAll(".select").forEach(function (sel) {
      sel.addEventListener("change", function () {
        sel.classList.toggle("filled", !!sel.value);
        clearError(sel.name);
      });
    });
    form.querySelectorAll("input").forEach(function (i) {
      i.addEventListener("input", function () { clearError(i.name); });
    });

    function setError(name, msg) {
      var el = form.querySelector('[data-error="' + name + '"]');
      var input = form.querySelector('[name="' + name + '"]');
      if (el) { el.textContent = msg; el.classList.add("is-visible"); }
      if (input) input.classList.add("is-invalid");
    }
    function clearError(name) {
      var el = form.querySelector('[data-error="' + name + '"]');
      var input = form.querySelector('[name="' + name + '"]');
      if (el) { el.textContent = ""; el.classList.remove("is-visible"); }
      if (input) input.classList.remove("is-invalid");
    }

    function getUtmParams() {
      var params = new URLSearchParams(window.location.search);
      return {
        utm_source: params.get("utm_source") || null,
        utm_medium: params.get("utm_medium") || null,
        utm_campaign: params.get("utm_campaign") || null,
        utm_content: params.get("utm_content") || null,
        utm_term: params.get("utm_term") || null
      };
    }

    var MIN_EMP = 100000, MIN_IMOVEL = 450000;

    function validate(data) {
      var ok = true;
      if (!data.nome) { setError("nome", "Informe seu nome completo."); ok = false; }
      var celDigits = data.celular.replace(/\D/g, "");
      if (!celDigits) { setError("celular", "Informe seu celular."); ok = false; }
      else if (celDigits.length < 10) { setError("celular", "Número inválido."); ok = false; }
      if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) { setError("email", "E-mail inválido."); ok = false; }
      if (!data.valor_emprestimo || parseMoney(data.valor_emprestimo) <= 0) { setError("valor_emprestimo", "Informe o valor do empréstimo."); ok = false; }
      if (!data.tipo_imovel) { setError("tipo_imovel", "Selecione o tipo de imóvel."); ok = false; }
      if (!data.situacao_imovel) { setError("situacao_imovel", "Selecione a situação do imóvel."); ok = false; }
      if (!data.valor_imovel || parseMoney(data.valor_imovel) <= 0) { setError("valor_imovel", "Informe o valor do imóvel."); ok = false; }
      return ok;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (formMessage) formMessage.className = "form-message";

      var data = {
        nome: document.getElementById("f-nome").value.trim(),
        celular: document.getElementById("f-celular").value.trim(),
        email: document.getElementById("f-email").value.trim(),
        valor_emprestimo: document.getElementById("f-valor-emp").value.trim(),
        tipo_imovel: document.getElementById("f-tipo").value,
        situacao_imovel: document.getElementById("f-situacao").value,
        valor_imovel: document.getElementById("f-valor-imovel").value.trim()
      };

      if (!validate(data)) return;

      submitBtn.disabled = true;
      submitBtn.textContent = "Enviando...";

      // Envio do lead: nosso analytics D1 grava o lead e dispara pro RD Station
      // server-side (Pages Function /analytics/track, ver inspiracred/functions/analytics/_app.js).
      try {
        if (window.inspiraTrack) {
          // Antes valor abaixo de MIN_EMP/MIN_IMOVEL travava o envio. Agora sempre vira
          // lead — só muda a classificação: abaixo do antigo limite (que era o corte de
          // "lead bom") = baixo_valor, não dispara conversão padrão de Lead pro Meta.
          var isLowValue = parseMoney(data.valor_emprestimo) < MIN_EMP || parseMoney(data.valor_imovel) < MIN_IMOVEL;
          window.inspiraTrack.lead(Object.assign({
            name: data.nome,
            phone: "+55" + data.celular.replace(/\D/g, ""),
            email: data.email || null,
            property_type: data.tipo_imovel.toLowerCase(),
            property_value: parseMoney(data.valor_imovel),
            credit_value: parseMoney(data.valor_emprestimo),
            situacao_imovel: data.situacao_imovel || null, // "Quitado"/"Financiado" -> normalizado p/ Sim/Não no RD cf_imovel_quitado (Negociação "Imóvel Quitado?")
            source: "home_equity_lp",
            lead_kind: isLowValue ? "baixo_valor" : "home_equity",
            meta_events: isLowValue ? ["LeadBaixoValor"] : ["Lead"]
          }, getUtmParams()));
        }
      } catch (e) {}

      // Mostra o sucesso inline por um instante e redireciona pra página de obrigado.
      // O atraso deixa o beacon do lead + Pixel dispararem antes da navegação; a
      // conversão já foi enviada acima (a página de obrigado não dispara evento).
      form.classList.add("is-hidden");
      formSuccess.classList.remove("is-hidden");
      setTimeout(function () { window.location.href = "/obrigado/home-equity/"; }, 900);
    });
  }

  /* ============================================================
     REVEAL + STAGGER — animações de entrada ao rolar
     ============================================================ */
  // índices para o efeito escalonado (um card de cada vez)
  document.querySelectorAll("[data-stagger]").forEach(function (group) {
    Array.prototype.forEach.call(group.children, function (child, i) {
      child.style.setProperty("--i", i);
    });
  });

  if (reduceMotion) {
    document.querySelectorAll("[data-reveal], [data-stagger]").forEach(function (el) {
      el.classList.add("is-visible");
    });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll("[data-reveal], [data-stagger]").forEach(function (el) {
      revealObserver.observe(el);
    });
  }

  /* ============================================================
     COMPARATIVO — barras entram uma a uma, carregam e contam
     ============================================================ */
  var chart = document.querySelector(".chart");
  if (chart) {
    function countUp(el) {
      var raw = el.getAttribute("data-value") || "0";
      var target = parseFloat(raw.replace(",", "."));
      var decimals = raw.indexOf(",") >= 0 ? raw.split(",")[1].length : 0;
      if (reduceMotion) { el.textContent = raw + "%"; return; }
      var dur = 1000, start = null;
      function tick(now) {
        if (!start) start = now;
        var t = Math.min(1, (now - start) / dur);
        var eased = 1 - Math.pow(1 - t, 3);
        el.textContent = (target * eased).toFixed(decimals).replace(".", ",") + "%";
        if (t < 1) requestAnimationFrame(tick);
        else el.textContent = raw + "%";
      }
      requestAnimationFrame(tick);
    }

    function runChart() {
      var rows = chart.querySelectorAll(".bar-row");
      rows.forEach(function (row, i) {
        var delay = reduceMotion ? 0 : i * 180;
        setTimeout(function () {
          row.classList.add("is-in");
          var fill = row.querySelector(".bar-fill");
          if (fill) fill.style.width = fill.getAttribute("data-w") + "%";
          var val = row.querySelector(".bar-value");
          if (val) countUp(val);
        }, delay);
      });
    }

    if (reduceMotion) {
      chart.querySelectorAll(".bar-row").forEach(function (r) { r.classList.add("is-in"); });
      runChart();
    } else {
      var chartObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { runChart(); chartObserver.disconnect(); }
        });
      }, { threshold: 0.25 });
      chartObserver.observe(chart);
    }
  }

  /* ============================================================
     CARDS FLUTUANTES — convergem para o centro conforme o scroll
     (movimento suave, com "física": lerp do progresso alvo)
     ============================================================ */
  var stage = document.querySelector("[data-floating]");
  if (stage) {
    var cards = Array.prototype.slice.call(stage.querySelectorAll(".float-card"));
    var canFloat = !reduceMotion && window.matchMedia("(min-width: 1024px)").matches;

    if (canFloat) {
      var cur = 0, target = 0, running = false;
      function measure() {
        var r = stage.getBoundingClientRect();
        var vh = window.innerHeight || document.documentElement.clientHeight;
        var center = r.top + r.height / 2;
        var dist = Math.abs(center - vh / 2);
        var range = vh * 0.65 + r.height * 0.28;
        target = Math.max(0, Math.min(1, 1 - dist / range));
      }
      function applyCards() {
        for (var i = 0; i < cards.length; i++) {
          var c = cards[i];
          var inv = 1 - cur;
          var dx = parseFloat(c.getAttribute("data-dx")) || 0;
          var dy = parseFloat(c.getAttribute("data-dy")) || 0;
          var rot = parseFloat(c.getAttribute("data-rot")) || 0;
          c.style.transform =
            "translate3d(" + (dx * inv).toFixed(1) + "px," + (dy * inv).toFixed(1) + "px,0) " +
            "rotate(" + (rot * inv).toFixed(2) + "deg) scale(" + (0.82 + 0.18 * cur).toFixed(3) + ")";
          c.style.opacity = (0.06 + cur * 0.94).toFixed(3);
        }
      }
      function tick() {
        cur += (target - cur) * 0.08; // lerp → sensação de "jogado e assentando"
        var settled = Math.abs(target - cur) < 0.001;
        if (settled) cur = target;
        applyCards();
        if (settled) { running = false; } // pausa quando assenta (renderer volta a ficar ocioso)
        else { requestAnimationFrame(tick); }
      }
      function kick() { if (!running) { running = true; requestAnimationFrame(tick); } }
      window.addEventListener("scroll", function () { measure(); kick(); }, { passive: true });
      window.addEventListener("resize", function () { measure(); kick(); });
      measure(); applyCards(); kick();
    } else {
      stage.classList.add("no-float");
      // Mobile: cada card entra inclinado, vindo de um lado, ao rolar (simula o desktop, mas em lista)
      if (!reduceMotion && window.matchMedia("(max-width: 1023px)").matches && "IntersectionObserver" in window) {
        var mObs = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) { e.target.classList.add("is-in"); mObs.unobserve(e.target); }
          });
        }, { threshold: 0.25, rootMargin: "0px 0px -12% 0px" });
        cards.forEach(function (c) { mObs.observe(c); });
      } else {
        cards.forEach(function (c) { c.classList.add("is-in"); });
      }
    }
  }

  /* ============================================================
     FAQ — acordeão
     ============================================================ */
  document.querySelectorAll(".faq-q").forEach(function (q) {
    q.addEventListener("click", function () {
      var item = q.closest(".faq-item");
      var answer = item.querySelector(".faq-a");
      var isOpen = item.classList.contains("open");
      document.querySelectorAll(".faq-item.open").forEach(function (openItem) {
        openItem.classList.remove("open");
        openItem.querySelector(".faq-a").style.maxHeight = null;
      });
      if (!isOpen) {
        item.classList.add("open");
        answer.style.maxHeight = answer.scrollHeight + "px";
      }
    });
  });

  window.addEventListener("load", function () { document.body.classList.remove("loading"); });
})();
