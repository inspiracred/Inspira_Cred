(function () {
  "use strict";

  var form = document.getElementById("typeform-home-equity");
  var shell = document.getElementById("question-shell");
  var nextButton = document.getElementById("next-button");
  var backButton = document.getElementById("back-button");
  var progressLabel = document.getElementById("progress-label");
  var progressFill = document.getElementById("progress-fill");

  if (!form || !shell || !nextButton || !backButton) return;

  var answers = {};
  var stepIndex = 0;
  var started = false;
  var submitting = false;

  var steps = [
    {
      id: "possui_imovel",
      type: "choice",
      kicker: "Início",
      title: "Você possui imóvel?",
      options: [
        { label: "Sim", value: "sim" },
        { label: "Não", value: "nao" }
      ]
    },
    {
      id: "tipo_imovel",
      type: "choice",
      kicker: "Imóvel",
      title: "Qual o tipo do seu imóvel?",
      options: [
        { label: "Imóvel residencial", value: "residencial" },
        { label: "Imóvel comercial", value: "comercial" },
        { label: "Imóvel industrial", value: "industrial" },
        { label: "Outro", value: "outro" }
      ],
      showIf: function () { return answers.possui_imovel === "sim"; }
    },
    {
      id: "possui_matricula",
      type: "choice",
      kicker: "Documentação",
      title: "Seu imóvel possui matrícula?",
      options: [
        { label: "Sim", value: "sim" },
        { label: "Não", value: "nao" }
      ],
      showIf: function () { return answers.possui_imovel === "sim"; }
    },
    {
      id: "faixa_credito",
      type: "choice",
      kicker: "Crédito desejado",
      title: "Qual valor do crédito você está buscando?",
      options: [
        { label: "Menos de R$ 100 mil", value: "menos_100k", amount: 75000, detail: "A gente confere alternativas disponíveis." },
        { label: "De R$ 100 mil a R$ 300 mil", value: "100k_300k", amount: 200000 },
        { label: "De R$ 300 mil a R$ 600 mil", value: "300k_600k", amount: 450000 },
        { label: "De R$ 600 mil a R$ 900 mil", value: "600k_900k", amount: 750000 },
        { label: "Acima de R$ 900 mil", value: "acima_900k", amount: 1000000 }
      ]
    },
    {
      id: "contato",
      type: "fields",
      kicker: "Informações de contato",
      title: "Como falamos com você?",
      subtitle: "A InspiraCred pode entrar em contato com você para acompanhamento.",
      fields: [
        { id: "nome", label: "Nome completo", type: "text", autocomplete: "name", placeholder: "Insira sua resposta.", required: true },
        { id: "email", label: "E-mail", type: "email", autocomplete: "email", placeholder: "Insira sua resposta.", required: false },
        { id: "whatsapp", label: "Número do WhatsApp", type: "tel", autocomplete: "tel", inputmode: "tel", placeholder: "Insira sua resposta.", required: true },
        { id: "cidade", label: "Cidade", type: "text", autocomplete: "address-level2", placeholder: "Insira sua resposta.", required: true }
      ]
    }
  ];

  function visibleSteps() {
    return steps.filter(function (step) {
      return !step.showIf || step.showIf();
    });
  }

  function currentStep() {
    var visible = visibleSteps();
    if (stepIndex > visible.length - 1) stepIndex = visible.length - 1;
    return visible[stepIndex];
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"]/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char];
    });
  }

  function startTracking() {
    if (started) return;
    started = true;
    try {
      if (window.inspiraTrack) window.inspiraTrack.event("simulation_start", { source: "home_equity_form" });
    } catch (e) {}
  }

  function setHiddenInputs() {
    form.querySelectorAll('[data-answer-input="true"]').forEach(function (el) { el.remove(); });
    Object.keys(answers).forEach(function (key) {
      var input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = answers[key] || "";
      input.setAttribute("data-answer-input", "true");
      form.appendChild(input);
    });
  }

  function normalizeAnswers(changedId) {
    if (changedId === "possui_imovel" && answers.possui_imovel !== "sim") {
      delete answers.tipo_imovel;
      delete answers.possui_matricula;
    }
  }

  function updateProgress() {
    var visible = visibleSteps();
    var total = visible.length;
    var current = Math.min(stepIndex + 1, total);
    progressLabel.textContent = current + " de " + total;
    progressFill.style.width = Math.round((current / total) * 100) + "%";
    backButton.hidden = stepIndex === 0;
    nextButton.textContent = stepIndex === total - 1 ? "Enviar respostas" : "Continuar";
  }

  function renderChoice(step) {
    var selected = answers[step.id] || "";
    return '<div class="options">' + step.options.map(function (option) {
      var isSelected = selected === option.value;
      return '<button class="option' + (isSelected ? " is-selected" : "") + '" type="button" data-value="' + escapeHtml(option.value) + '">' +
        '<span class="option-text"><strong>' + escapeHtml(option.label) + '</strong>' +
        (option.detail ? '<small>' + escapeHtml(option.detail) + '</small>' : '') +
        '</span><span class="option-dot" aria-hidden="true"></span></button>';
    }).join("") + '</div><p class="error" id="step-error">Escolha uma opção para continuar.</p>';
  }

  function renderFields(step) {
    return '<div class="fields">' + step.fields.map(function (field) {
      var value = answers[field.id] || "";
      return '<div class="field">' +
        '<label for="field-' + field.id + '">' + escapeHtml(field.label) + (field.required ? "" : " (opcional)") + '</label>' +
        '<input class="input" id="field-' + field.id + '" name="' + field.id + '" type="' + field.type + '" ' +
        (field.inputmode ? 'inputmode="' + field.inputmode + '" ' : '') +
        (field.autocomplete ? 'autocomplete="' + field.autocomplete + '" ' : '') +
        'placeholder="' + escapeHtml(field.placeholder) + '" value="' + escapeHtml(value) + '" />' +
        (field.id === "email" ? '<p class="helper">Se preferir, você pode seguir só com WhatsApp.</p>' : '') +
        '<p class="error" data-error-for="' + field.id + '"></p>' +
        '</div>';
    }).join("") + '</div>';
  }

  function render() {
    var step = currentStep();
    if (!step) return;
    updateProgress();
    shell.innerHTML = '<section class="question">' +
      '<p class="question-kicker">' + escapeHtml(step.kicker) + '</p>' +
      '<h2 class="question-title">' + escapeHtml(step.title) + '</h2>' +
      (step.subtitle ? '<p class="question-subtitle">' + escapeHtml(step.subtitle) + '</p>' : '') +
      (step.type === "choice" ? renderChoice(step) : renderFields(step)) +
      '</section>';

    if (step.type === "choice") {
      shell.querySelectorAll(".option").forEach(function (button) {
        button.addEventListener("click", function () {
          startTracking();
          answers[step.id] = button.getAttribute("data-value");
          normalizeAnswers(step.id);
          setHiddenInputs();
          render();
          setTimeout(function () { goNext(); }, 140);
        });
      });
    } else {
      step.fields.forEach(function (field) {
        var input = document.getElementById("field-" + field.id);
        if (!input) return;
        input.addEventListener("input", function () {
          startTracking();
          if (field.id === "whatsapp") input.value = formatPhone(input.value);
          answers[field.id] = input.value.trim();
          setHiddenInputs();
          clearFieldError(field.id);
        });
      });
      var firstInput = shell.querySelector(".input");
      if (firstInput) setTimeout(function () { firstInput.focus(); }, 60);
    }
  }

  function formatPhone(value) {
    var digits = value.replace(/\D/g, "").slice(0, 11);
    if (!digits) return "";
    if (digits.length <= 2) return "(" + digits;
    if (digits.length <= 6) return "(" + digits.slice(0, 2) + ") " + digits.slice(2);
    if (digits.length <= 10) return "(" + digits.slice(0, 2) + ") " + digits.slice(2, 6) + "-" + digits.slice(6);
    return "(" + digits.slice(0, 2) + ") " + digits.slice(2, 7) + "-" + digits.slice(7);
  }

  function clearFieldError(id) {
    var input = document.getElementById("field-" + id);
    var error = form.querySelector('[data-error-for="' + id + '"]');
    if (input) input.classList.remove("is-invalid");
    if (error) {
      error.textContent = "";
      error.classList.remove("is-visible");
    }
  }

  function setFieldError(id, message) {
    var input = document.getElementById("field-" + id);
    var error = form.querySelector('[data-error-for="' + id + '"]');
    if (input) input.classList.add("is-invalid");
    if (error) {
      error.textContent = message;
      error.classList.add("is-visible");
    }
  }

  function validateStep(step) {
    if (step.type === "choice") {
      var error = document.getElementById("step-error");
      var ok = !!answers[step.id];
      if (error) error.classList.toggle("is-visible", !ok);
      return ok;
    }

    var okFields = true;
    step.fields.forEach(function (field) {
      var input = document.getElementById("field-" + field.id);
      var value = input ? input.value.trim() : "";
      answers[field.id] = value;
      clearFieldError(field.id);

      if (field.required && !value) {
        setFieldError(field.id, "Informe este campo.");
        okFields = false;
      }
      if (field.id === "whatsapp" && value.replace(/\D/g, "").length < 10) {
        setFieldError(field.id, "Informe um WhatsApp válido.");
        okFields = false;
      }
      if (field.id === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        setFieldError(field.id, "Informe um e-mail válido.");
        okFields = false;
      }
    });
    setHiddenInputs();
    return okFields;
  }

  function creditOption() {
    var step = steps.filter(function (item) { return item.id === "faixa_credito"; })[0];
    return step.options.filter(function (option) { return option.value === answers.faixa_credito; })[0] || null;
  }
  function creditAmount() { var o = creditOption(); return o ? o.amount : null; }
  function creditLabel() { var o = creditOption(); return o ? o.label : null; }

  // rótulos legíveis pra mandar pro RD (em vez de slugs tipo "sim"/"100k_300k")
  function labelFor(stepId, value) {
    if (!value) return null;
    var step = steps.filter(function (item) { return item.id === stepId; })[0];
    if (!step || !step.options) return value;
    var opt = step.options.filter(function (o) { return o.value === value; })[0];
    return opt ? opt.label : value;
  }

  function complete() {
    if (submitting) return;
    submitting = true;
    nextButton.disabled = true;
    nextButton.textContent = "Enviando...";

    var phoneDigits = (answers.whatsapp || "").replace(/\D/g, "");
    var payload = {
      name: answers.nome || null,
      phone: phoneDigits ? "+55" + phoneDigits : null,
      email: answers.email || null,
      property_type: labelFor("tipo_imovel", answers.tipo_imovel),          // "Imóvel residencial" etc.
      property_value: null,
      credit_value: creditAmount(),
      source: "home_equity_form",
      possui_imovel: labelFor("possui_imovel", answers.possui_imovel),      // "Sim" / "Não"
      possui_matricula: labelFor("possui_matricula", answers.possui_matricula),
      faixa_credito: creditLabel(),                                          // "De R$ 100 mil a R$ 300 mil"
      city: answers.cidade || null
    };

    try {
      if (window.inspiraTrack) {
        window.inspiraTrack.event("simulation_complete", {
          source: "home_equity_form",
          possui_imovel: answers.possui_imovel || null,
          tipo_imovel: answers.tipo_imovel || null,
          possui_matricula: answers.possui_matricula || null,
          faixa_credito: answers.faixa_credito || null,
          city: answers.cidade || null
        });
        window.inspiraTrack.lead(payload);
      }
    } catch (e) {}

    setTimeout(function () {
      progressLabel.textContent = "Concluído";
      progressFill.style.width = "100%";
      shell.innerHTML = '<section class="success">' +
        '<div class="success-inner">' +
        '<span class="success-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>' +
        '<h2>Muito obrigada por suas respostas!</h2>' +
        '<p>Nossa equipe vai analisar o seu perfil e entrar em contato em breve para falar sobre as melhores condições para você.</p>' +
        '</div></section>';
      document.querySelector(".nav-actions").hidden = true;
    }, 420);
  }

  function goNext() {
    var step = currentStep();
    if (!step || !validateStep(step)) return;

    var visible = visibleSteps();
    if (stepIndex >= visible.length - 1) {
      form.requestSubmit();
      return;
    }
    stepIndex += 1;
    render();
  }

  nextButton.addEventListener("click", function () {
    startTracking();
    goNext();
  });

  backButton.addEventListener("click", function () {
    if (stepIndex <= 0) return;
    stepIndex -= 1;
    render();
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    startTracking();
    if (validateStep(currentStep())) complete();
  });

  form.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    var tag = event.target && event.target.tagName;
    if (tag === "TEXTAREA") return;
    event.preventDefault();
    goNext();
  });

  render();
})();
