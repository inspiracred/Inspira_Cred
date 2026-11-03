(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function qs(selector, root) { return (root || document).querySelector(selector); }
  function qsa(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  var menuButton = qs("[data-menu-button]");
  var navLinks = qs("[data-nav-links]");
  if (menuButton && navLinks) {
    menuButton.addEventListener("click", function () {
      var open = menuButton.getAttribute("aria-expanded") !== "true";
      menuButton.setAttribute("aria-expanded", String(open));
      navLinks.classList.toggle("is-open", open);
      document.body.classList.toggle("is-locked", open);
    });
    qsa("a", navLinks).forEach(function (link) {
      link.addEventListener("click", function () {
        menuButton.setAttribute("aria-expanded", "false");
        navLinks.classList.remove("is-open");
        document.body.classList.remove("is-locked");
      });
    });
  }

  qsa(".faq-question").forEach(function (button) {
    button.addEventListener("click", function () {
      var open = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!open));
    });
  });

  if (!reduceMotion && "IntersectionObserver" in window) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: .12 });
    qsa("[data-reveal]").forEach(function (item) { revealObserver.observe(item); });
  } else {
    qsa("[data-reveal]").forEach(function (item) { item.classList.add("is-visible"); });
  }

  function formatPhone(input) {
    var digits = input.value.replace(/\D/g, "");
    while (digits.length > 11 && digits.slice(0, 2) === "55") digits = digits.slice(2);
    digits = digits.slice(0, 11);
    if (!digits) input.value = "";
    else if (digits.length <= 2) input.value = "(" + digits;
    else if (digits.length <= 6) input.value = "(" + digits.slice(0, 2) + ") " + digits.slice(2);
    else if (digits.length <= 10) input.value = "(" + digits.slice(0, 2) + ") " + digits.slice(2, 6) + "-" + digits.slice(6);
    else input.value = "(" + digits.slice(0, 2) + ") " + digits.slice(2, 7) + "-" + digits.slice(7);
  }

  function formatMoney(input) {
    var digits = input.value.replace(/,\d*$/, "").replace(/\D/g, "").slice(0, 8);
    input.value = digits ? "R$ " + Number(digits).toLocaleString("pt-BR") + ",00" : "";
    if (input.value) {
      var position = input.value.length - 3;
      try { input.setSelectionRange(position, position); } catch (_) {}
    }
  }

  function moneyValue(value) {
    var normalized = String(value || "").replace(/,\d*$/, "").replace(/\D/g, "");
    return normalized ? Number(normalized) : 0;
  }

  function phoneIsValid(value) {
    return /^\d{10,11}$/.test(String(value || "").replace(/\D/g, ""));
  }

  qsa("[data-phone]").forEach(function (input) {
    input.addEventListener("input", function () { formatPhone(input); clearField(input); });
  });
  qsa("[data-money]").forEach(function (input) {
    input.addEventListener("input", function () { formatMoney(input); clearField(input); });
  });

  function errorNode(input) {
    return input && qs('[data-error-for="' + input.name + '"]', input.form);
  }
  function showError(input, message) {
    if (!input) return;
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    var node = errorNode(input);
    if (node) node.textContent = message;
  }
  function clearField(input) {
    if (!input) return;
    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");
    var node = errorNode(input);
    if (node) node.textContent = "";
  }
  function requireField(form, name, message) {
    var input = form.elements[name];
    if (!input || String(input.value || "").trim()) return true;
    showError(input, message);
    return false;
  }

  function sendLead(payload) {
    if (window.inspiraTrack && typeof window.inspiraTrack.leadConfirmed === "function") {
      try { return window.inspiraTrack.leadConfirmed(payload); } catch (_) {}
    }
    var body = Object.assign({
      type: "lead",
      event_id: (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : "e_" + Date.now().toString(36),
      session_id: "srv_" + Date.now().toString(36),
      page_name: window.IC_PAGE || payload.source,
      url: "https://nova.inspiracred.com.br/"
    }, payload);
    return fetch("/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
      keepalive: true
    }).then(function (response) { return response.ok; }, function () { return false; });
  }

  function track(name, properties) {
    try {
      if (window.inspiraTrack && typeof window.inspiraTrack.event === "function") {
        window.inspiraTrack.event(name, properties || {});
      }
    } catch (_) {}
  }

  function setSubmitting(form, submitting) {
    var button = qs('[type="submit"]', form);
    if (!button) return;
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = submitting;
    button.textContent = submitting ? "Enviando…" : button.dataset.label;
    form.setAttribute("aria-busy", String(submitting));
  }

  function showSuccess(form) {
    var success = qs("[data-form-success]", form.parentNode);
    form.hidden = true;
    if (success) {
      success.hidden = false;
      success.setAttribute("tabindex", "-1");
      success.focus();
    }
  }

  function formStatus(form, message) {
    var status = qs("[data-form-status]", form);
    if (status) status.textContent = message || "";
  }

  function collectUtm() {
    var query = new URLSearchParams(window.location.search);
    var output = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "meta_campaign_id", "meta_adset_id", "meta_ad_id"].forEach(function (key) {
      if (query.get(key)) output[key] = query.get(key);
    });
    return output;
  }

  var countersForm = qs('[data-form="contadores"]');
  if (countersForm) {
    var propertyStatus = countersForm.elements.situacao_imovel;
    var debtField = qs("[data-debt-field]", countersForm);
    function updateDebt() {
      var financed = propertyStatus.value === "Financiado";
      debtField.hidden = !financed;
      countersForm.elements.saldo_devedor.required = financed;
      if (!financed) countersForm.elements.saldo_devedor.value = "";
    }
    propertyStatus.addEventListener("change", function () { clearField(propertyStatus); updateDebt(); });
    updateDebt();

    qsa("input, select", countersForm).forEach(function (input) {
      input.addEventListener("input", function () { clearField(input); formStatus(countersForm, ""); });
      input.addEventListener("change", function () { clearField(input); formStatus(countersForm, ""); });
    });
    var counterStarted = false;
    countersForm.addEventListener("input", function () {
      if (!counterStarted) { counterStarted = true; track("simulation_start", { source: "contador_aquisicao_lp" }); }
    }, true);

    countersForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (countersForm.getAttribute("aria-busy") === "true") return;
      formStatus(countersForm, "");
      var valid = true;
      valid = requireField(countersForm, "name", "Informe seu nome completo.") && valid;
      valid = requireField(countersForm, "phone", "Informe seu número de celular.") && valid;
      if (countersForm.elements.phone.value && !phoneIsValid(countersForm.elements.phone.value)) { showError(countersForm.elements.phone, "Use um número com DDD."); valid = false; }
      valid = requireField(countersForm, "property_type", "Selecione o tipo de imóvel.") && valid;
      valid = requireField(countersForm, "property_value", "Informe o valor aproximado do imóvel.") && valid;
      valid = requireField(countersForm, "situacao_imovel", "Informe a situação do imóvel.") && valid;
      valid = requireField(countersForm, "documentacao_ok", "Informe a situação da documentação.") && valid;
      valid = requireField(countersForm, "credit_value", "Informe o valor desejado.") && valid;
      if (propertyStatus.value === "Financiado") valid = requireField(countersForm, "saldo_devedor", "Informe o saldo devedor aproximado.") && valid;

      var propertyValue = moneyValue(countersForm.elements.property_value.value);
      var creditValue = moneyValue(countersForm.elements.credit_value.value);
      if (propertyValue && (propertyValue < 400000 || propertyValue > 20000000)) { showError(countersForm.elements.property_value, "Use um valor entre R$ 400 mil e R$ 20 milhões."); valid = false; }
      if (creditValue && (creditValue < 200000 || creditValue > 12000000)) { showError(countersForm.elements.credit_value, "Use um valor entre R$ 200 mil e R$ 12 milhões."); valid = false; }
      if (!valid) {
        formStatus(countersForm, "Revise os campos destacados para continuar.");
        var firstInvalid = qs(".is-invalid", countersForm);
        if (firstInvalid) firstInvalid.focus();
        return;
      }

      var payload = Object.assign({
        source: "contador_aquisicao_lp",
        name: countersForm.elements.name.value.trim(),
        phone: countersForm.elements.phone.value,
        property_type: countersForm.elements.property_type.value,
        property_value: propertyValue,
        credit_value: creditValue,
        situacao_imovel: countersForm.elements.situacao_imovel.value,
        documentacao_ok: countersForm.elements.documentacao_ok.value,
        saldo_devedor: moneyValue(countersForm.elements.saldo_devedor.value) || null,
        acquisition_type: "carteira_ou_escritorio_contabil"
      }, collectUtm());

      setSubmitting(countersForm, true);
      sendLead(payload).then(function (ok) {
        setSubmitting(countersForm, false);
        if (!ok) {
          formStatus(countersForm, "Não foi possível registrar agora. Tente novamente em instantes.");
          return;
        }
        track("simulation_complete", { source: "contador_aquisicao_lp" });
        var successLink = qs("[data-whatsapp-success]", countersForm.parentNode);
        if (successLink) {
          var message = [
            "Olá! Solicitei uma avaliação pela página para contadores.",
            "Quero avaliar crédito para comprar uma carteira ou escritório contábil.",
            "Valor desejado: R$ " + creditValue.toLocaleString("pt-BR") + "."
          ].join("\n");
          successLink.href = "https://wa.me/5521977340731?text=" + encodeURIComponent(message);
        }
        showSuccess(countersForm);
      });
    });
  }

  var partnersForm = qs('[data-form="parceiros"]');
  if (partnersForm) {
    var role = partnersForm.elements.partner_role;
    var otherField = qs("[data-other-role]", partnersForm);
    function updateOtherRole() {
      var other = role.value === "Outra";
      otherField.hidden = !other;
      partnersForm.elements.partner_role_other.required = other;
      if (!other) partnersForm.elements.partner_role_other.value = "";
    }
    role.addEventListener("change", function () { clearField(role); updateOtherRole(); });
    updateOtherRole();
    qsa("input, select", partnersForm).forEach(function (input) {
      input.addEventListener("input", function () { clearField(input); formStatus(partnersForm, ""); });
      input.addEventListener("change", function () { clearField(input); formStatus(partnersForm, ""); });
    });

    partnersForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (partnersForm.getAttribute("aria-busy") === "true") return;
      var valid = true;
      valid = requireField(partnersForm, "name", "Informe seu nome completo.") && valid;
      valid = requireField(partnersForm, "email", "Informe seu e-mail.") && valid;
      valid = requireField(partnersForm, "phone", "Informe seu celular.") && valid;
      valid = requireField(partnersForm, "partner_role", "Selecione sua área de atuação.") && valid;
      if (partnersForm.elements.email.value && !partnersForm.elements.email.validity.valid) { showError(partnersForm.elements.email, "Informe um e-mail válido."); valid = false; }
      if (partnersForm.elements.phone.value && !phoneIsValid(partnersForm.elements.phone.value)) { showError(partnersForm.elements.phone, "Use um número com DDD."); valid = false; }
      if (role.value === "Outra") valid = requireField(partnersForm, "partner_role_other", "Conte qual é sua atuação.") && valid;
      if (!valid) {
        formStatus(partnersForm, "Revise os campos destacados para continuar.");
        var firstInvalid = qs(".is-invalid", partnersForm);
        if (firstInvalid) firstInvalid.focus();
        return;
      }

      var roleValue = role.value === "Outra" ? partnersForm.elements.partner_role_other.value.trim() : role.value;
      var payload = Object.assign({
        source: "parceiros_lp",
        lead_kind: "parceiro",
        name: partnersForm.elements.name.value.trim(),
        email: partnersForm.elements.email.value.trim(),
        phone: partnersForm.elements.phone.value,
        partner_role: roleValue
      }, collectUtm());

      setSubmitting(partnersForm, true);
      sendLead(payload).then(function (ok) {
        setSubmitting(partnersForm, false);
        if (!ok) {
          formStatus(partnersForm, "Não foi possível registrar agora. Tente novamente em instantes.");
          return;
        }
        track("partner_signup_complete", { source: "parceiros_lp", partner_role: roleValue });
        showSuccess(partnersForm);
      });
    });
  }
})();
