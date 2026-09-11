/* InspiraCred — Home institucional
   Header (fundo ao rolar, menu mobile, link ativo), formulário (máscaras, validação,
   cidades do IBGE, envio do lead) e animações de entrada. O lead vai pelo mesmo
   caminho das outras páginas: window.inspiraTrack (assets/js/track.js) -> D1 -> RD
   Station + Meta CAPI (functions/analytics/_app.js, source "home_institucional"). */
(function () {
  "use strict";
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var PAGE_SOURCE = "home_institucional";

  /* ============================================================
     HEADER — fundo ao rolar, menu mobile e link da seção ativa
     ============================================================ */
  var header = document.getElementById("site-header");
  var nav = document.getElementById("main-nav");
  var toggle = header.querySelector(".nav-toggle");

  function onScroll() { header.classList.toggle("is-scrolled", (window.scrollY || window.pageYOffset) > 24); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  function setMenu(open) {
    header.classList.toggle("nav-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
  }
  toggle.addEventListener("click", function () { setMenu(!header.classList.contains("nav-open")); });
  nav.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && header.classList.contains("nav-open")) { setMenu(false); toggle.focus(); }
  });
  document.addEventListener("click", function (e) {
    if (header.classList.contains("nav-open") && !header.contains(e.target)) setMenu(false);
  });
  var desktopMq = window.matchMedia("(min-width: 1024px)");
  var onMq = function (m) { if (m.matches) setMenu(false); };
  if (desktopMq.addEventListener) desktopMq.addEventListener("change", onMq);
  else if (desktopMq.addListener) desktopMq.addListener(onMq);

  // Link ativo: a seção que cruza o meio da tela acende o item do menu. Seções fora do
  // menu (primeira dobra, formulário) apagam todos.
  var navLinks = Array.prototype.slice.call(nav.querySelectorAll("a[data-nav]"));
  if ("IntersectionObserver" in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var id = en.target.id || "";
        navLinks.forEach(function (a) {
          var on = a.getAttribute("data-nav") === id;
          a.classList.toggle("is-active", on);
          if (on) a.setAttribute("aria-current", "true");
          else a.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    document.querySelectorAll("main > section").forEach(function (s) { spy.observe(s); });
  }

  /* ============================================================
     FORMULÁRIO — máscaras, cidades, validação e envio
     ============================================================ */
  var form = document.getElementById("home-lead-form");
  if (form) {
    var formSuccess = document.getElementById("form-success");
    var submitBtn = form.querySelector("button[type='submit']");
    var MIN_CREDITO = 100000;
    // value do <select> -> rótulo legível (vai pro RD como tag e pro D1 como evento)
    var SOLUCOES = {
      home_equity: "Empréstimo com garantia de imóvel",
      capital_giro: "Capital de giro",
      financiamento_imoveis: "Financiamento de imóveis",
      veiculos: "Financiamento e refinanciamento de veículos"
    };

    function setError(name, msg) {
      var el = form.querySelector('[data-error="' + name + '"]');
      var input = form.querySelector('[name="' + name + '"]');
      if (el) { el.textContent = msg; el.classList.add("is-visible"); }
      if (input) { input.classList.add("is-invalid"); input.setAttribute("aria-invalid", "true"); }
    }
    function clearError(name) {
      var el = form.querySelector('[data-error="' + name + '"]');
      var input = form.querySelector('[name="' + name + '"]');
      if (el) { el.textContent = ""; el.classList.remove("is-visible"); }
      if (input) { input.classList.remove("is-invalid"); input.removeAttribute("aria-invalid"); }
    }

    // Valor INTEIRO em reais (mesma máscara da Home Equity): dígitos = reais, ",00" fixo.
    function formatMoney(value) {
      var digits = value.replace(/,\d*$/, "").replace(/\D/g, "");
      if (!digits) return "";
      return "R$ " + Number(digits).toLocaleString("pt-BR") + ",00";
    }
    function parseMoney(value) {
      var digits = (value || "").replace(/\D/g, "");
      return digits ? Number(digits) / 100 : 0;
    }
    form.querySelectorAll(".money").forEach(function (input) {
      input.addEventListener("input", function () {
        input.value = formatMoney(input.value);
        if (input.value) { var p = input.value.length - 3; try { input.setSelectionRange(p, p); } catch (e) {} }
      });
    });

    var celular = document.getElementById("f-celular");
    celular.addEventListener("input", function () {
      var d = celular.value.replace(/\D/g, "");
      // DDI digitado na frente (+55) sai ANTES do corte em 11 — senão os 2 últimos
      // dígitos do número caem fora (bug já visto na Home Equity).
      if (d.length > 11 && d.slice(0, 2) === "55") d = d.slice(2);
      d = d.slice(0, 11);
      if (!d) celular.value = "";
      else if (d.length <= 2) celular.value = "(" + d;
      else if (d.length <= 6) celular.value = "(" + d.slice(0, 2) + ") " + d.slice(2);
      else if (d.length <= 10) celular.value = "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
      else celular.value = "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
    });

    form.querySelectorAll("input, select").forEach(function (el) {
      var ev = el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(ev, function () {
        if (el.tagName === "SELECT") el.classList.toggle("filled", !!el.value);
        clearError(el.name);
      });
    });

    // Cidades do estado escolhido (API pública do IBGE). É só SUGESTÃO no <datalist>:
    // a pessoa pode digitar livre, e se a API cair o formulário segue funcionando.
    var ufSelect = document.getElementById("f-estado");
    var cityList = document.getElementById("cidades-list");
    var cityCache = {};
    function fillCities(names) {
      var frag = document.createDocumentFragment();
      names.forEach(function (n) { var o = document.createElement("option"); o.value = n; frag.appendChild(o); });
      cityList.innerHTML = "";
      cityList.appendChild(frag);
    }
    ufSelect.addEventListener("change", function () {
      var uf = ufSelect.value;
      cityList.innerHTML = "";
      if (!uf) return;
      if (cityCache[uf]) { fillCities(cityCache[uf]); return; }
      if (!window.fetch) return;
      fetch("https://servicodados.ibge.gov.br/api/v1/localidades/estados/" + uf + "/municipios?orderBy=nome")
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (list) {
          var names = (list || []).map(function (m) { return m && m.nome; }).filter(Boolean);
          cityCache[uf] = names;
          if (ufSelect.value === uf) fillCities(names);
        })
        .catch(function () {});
    });

    // "Simulação iniciada": 1x, no primeiro toque em qualquer campo (mesmo evento das
    // outras páginas -> InitiateCheckout no Meta), pro funil existir no dashboard.
    var simStarted = false;
    function markSimStart() {
      if (simStarted) return;
      simStarted = true;
      try { if (window.inspiraTrack) window.inspiraTrack.event("simulation_start", { source: PAGE_SOURCE }); } catch (e) {}
    }
    form.addEventListener("input", markSimStart, true);
    form.addEventListener("change", markSimStart, true);

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

    function validate(data) {
      var ok = true;
      if (!data.nome) { setError("nome", "Informe seu nome completo."); ok = false; }
      if (!data.email) { setError("email", "Informe seu e-mail."); ok = false; }
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) { setError("email", "E-mail inválido."); ok = false; }
      var cel = data.celular.replace(/\D/g, "");
      if (!cel) { setError("celular", "Informe seu celular."); ok = false; }
      else if (cel.length < 10) { setError("celular", "Número inválido. Use DDD + número."); ok = false; }
      if (!data.estado) { setError("estado", "Selecione seu estado."); ok = false; }
      if (!data.cidade) { setError("cidade", "Informe sua cidade."); ok = false; }
      var credito = parseMoney(data.valor_credito);
      if (!credito) { setError("valor_credito", "Informe o valor do crédito."); ok = false; }
      else if (credito < MIN_CREDITO) { setError("valor_credito", "O valor mínimo é R$ 100.000."); ok = false; }
      if (!data.solucao) { setError("solucao", "Selecione o tipo de solução."); ok = false; }
      return ok;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = {
        nome: document.getElementById("f-nome").value.trim(),
        email: document.getElementById("f-email").value.trim(),
        celular: celular.value.trim(),
        estado: ufSelect.value,
        cidade: document.getElementById("f-cidade").value.trim(),
        valor_credito: document.getElementById("f-valor").value.trim(),
        solucao: document.getElementById("f-solucao").value
      };
      if (!validate(data)) {
        var firstInvalid = form.querySelector(".is-invalid");
        if (firstInvalid) firstInvalid.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Enviando...";

      try {
        if (window.inspiraTrack) {
          var solucaoLabel = SOLUCOES[data.solucao] || data.solucao;
          // Veículos entra como "auto" (mesma classificação/tag das outras páginas);
          // o resto é "institucional" — o servidor não aplica a régua do Home Equity
          // (imóvel ≥ 400 mil), porque aqui não se pergunta valor de imóvel.
          // Todo lead daqui já passou pelo mínimo de R$ 100 mil -> conta como Lead no Meta.
          window.inspiraTrack.lead(Object.assign({
            name: data.nome,
            email: data.email,
            phone: "+55" + data.celular.replace(/\D/g, ""),
            city: data.cidade,
            state: data.estado,
            credit_value: parseMoney(data.valor_credito),
            solucao: solucaoLabel,
            source: PAGE_SOURCE,
            lead_kind: data.solucao === "veiculos" ? "auto" : "institucional",
            meta_events: ["Lead"]
          }, getUtmParams()));
          // A tabela `leads` não tem coluna de solução/UF: registra num evento (coluna
          // JSON `properties`, sem migration) pra dar pra analisar por solução depois.
          window.inspiraTrack.event("lead_solucao", { solucao: solucaoLabel, uf: data.estado, source: PAGE_SOURCE });
        }
      } catch (err) {}

      form.classList.add("is-hidden");
      formSuccess.classList.remove("is-hidden");
      try { formSuccess.focus({ preventScroll: true }); } catch (err) { formSuccess.focus(); }
      var top = formSuccess.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.6) {
        formSuccess.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      }
    });
  }

  /* ============================================================
     REVEAL + STAGGER — animações de entrada ao rolar
     ============================================================ */
  document.querySelectorAll("[data-stagger]").forEach(function (group) {
    Array.prototype.forEach.call(group.children, function (child, i) { child.style.setProperty("--i", i); });
  });
  var revealEls = document.querySelectorAll("[data-reveal], [data-stagger]");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("is-visible"); revealObserver.unobserve(entry.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ============================================================
     FAQ — acordeão (um aberto por vez)
     ============================================================ */
  document.querySelectorAll(".faq-q").forEach(function (q) {
    q.addEventListener("click", function () {
      var item = q.closest(".faq-item");
      var isOpen = item.classList.contains("open");
      document.querySelectorAll(".faq-item.open").forEach(function (openItem) {
        openItem.classList.remove("open");
        openItem.querySelector(".faq-a").style.maxHeight = null;
        openItem.querySelector(".faq-q").setAttribute("aria-expanded", "false");
      });
      if (!isOpen) {
        var answer = item.querySelector(".faq-a");
        item.classList.add("open");
        answer.style.maxHeight = answer.scrollHeight + "px";
        q.setAttribute("aria-expanded", "true");
      }
    });
  });

  window.addEventListener("load", function () { document.body.classList.remove("loading"); });
})();
