(function () {
  "use strict";

  var form = document.getElementById("typeform-home-equity");
  var shell = document.getElementById("question-shell");
  var page = document.querySelector(".form-page");
  var nextButton = document.getElementById("next-button");
  var backButton = document.getElementById("back-button");
  var progressSteps = document.getElementById("progress-steps");
  var progressLabel = document.getElementById("progress-label");

  if (!form || !shell || !nextButton || !backButton) return;

  var answers = {};
  var stepIndex = 0;
  var stepSeen = {};
  var previewMode = false;
  var started = false;
  var submitting = false;
  var MIN_CREDIT_VALUE = 200000;
  var MIN_RD_CREDIT_VALUE = 200000;
  var MIN_RD_PROPERTY_VALUE = 400000;
  var MQL_CREDIT_VALUE = 500000;
  var MQL_PROPERTY_VALUE = 1000000;

  // Destinos das páginas de obrigado por tipo de lead.
  var WHATSAPP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.149-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.334.101 11.892c0 2.096.549 4.14 1.595 5.945L0 24l6.335-1.652a12.062 12.062 0 005.71 1.447h.006c6.585 0 11.946-5.336 11.949-11.896 0-3.176-1.24-6.165-3.487-8.4"/></svg>';

  var THANK_YOU = {
    qualified: {
      tone: "qualified",
      eyebrow: "Etapa concluída",
      title: "Muito obrigada por suas respostas!",
      lead: "",
      ctaNudge: "Quer acelerar o processo? Mande uma mensagem",
      steps: [
        ["Análise do seu perfil", "Revisamos tipo de imóvel, documentação e valor buscado."],
        ["Contato pelo WhatsApp", "Entramos em contato para entender melhor a sua necessidade."],
        ["Proposta personalizada", "Você recebe as condições disponíveis, sem compromisso."]
      ],
      whatsapp: "https://wa.me/5521977340731?text=Ol%C3%A1%2C%20acabei%20de%20fazer%20uma%20simula%C3%A7%C3%A3o%20no%20site%20da%20InspiraCred%20e%20gostaria%20de%20falar%20com%20um%20consultor%20sobre%20meu%20cr%C3%A9dito%20com%20garantia%20de%20im%C3%B3vel."
    },
    auto: {
      tone: "qualified",
      eyebrow: "Etapa concluída",
      title: "Muito obrigada por suas respostas!",
      lead: "",
      ctaNudge: "Quer acelerar o processo? Mande uma mensagem",
      steps: [
        ["Análise do seu perfil", "Revisamos o valor do veículo e o crédito buscado."],
        ["Contato pelo WhatsApp", "Um especialista entra em contato para entender o seu momento."],
        ["Condições sob medida", "Você recebe as opções disponíveis, sem compromisso."]
      ],
      whatsapp: "https://wa.me/5521977340731?text=Ol%C3%A1%2C%20fiz%20uma%20simula%C3%A7%C3%A3o%20no%20site%20da%20InspiraCred%20e%20gostaria%20de%20falar%20com%20um%20consultor%20sobre%20cr%C3%A9dito%20com%20garantia%20de%20ve%C3%ADculo."
    },
    notQualified: {
      tone: "not-qualified",
      eyebrow: "Respostas recebidas",
      title: "Obrigada por responder!",
      lead: "Pelo perfil que você indicou, talvez este não seja o momento ideal para esta modalidade. Se quiser, você ainda pode falar com nossa equipe pelo WhatsApp para verificar outras possibilidades.",
      steps: [],
      whatsapp: "https://wa.me/5521977340731?text=Ol%C3%A1%2C%20respondi%20o%20formul%C3%A1rio%20da%20InspiraCred%20e%20gostaria%20de%20verificar%20outras%20possibilidades%20com%20a%20equipe."
    }
  };

  // Eventos do Meta (Pixel + CAPI) por tipo de lead:
  // Sem evento = não conta como Lead no Meta; Lead = Lead; MQL = Lead + LeadQualificado.
  var META_EVENTS = {
    home_equity: ["Lead"],
    home_equity_mql: ["Lead", "LeadQualificado"],
    auto: ["Lead"],
    baixo_valor: [],
    descarte: [],
  };

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

    /* ---- Ramo IMÓVEL (possui_imovel = sim) ---- */
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
      id: "valor_imovel",
      type: "fields",
      kicker: "Valor do imóvel",
      title: "Qual é o valor aproximado do seu imóvel?",
      subtitle: "O crédito disponível pode chegar a até 50% do valor do bem.",
      fields: [
        { id: "valor_imovel", label: "Valor aproximado do imóvel", type: "text", inputmode: "numeric", placeholder: "Ex.: R$ 200.000", required: true }
      ],
      showIf: function () { return answers.possui_imovel === "sim"; }
    },
    {
      id: "imovel_quitado",
      type: "choice",
      kicker: "Situação do imóvel",
      title: "Seu imóvel está quitado?",
      options: [
        { label: "Sim", value: "sim" },
        { label: "Não", value: "nao" }
      ],
      // Responder "Não" abre a caixa do saldo devedor NA MESMA tela (sem etapa extra).
      // É esse valor que separa Financiado50Mais de Financiado50Menos no Meta e que vai
      // pro RD no campo cf_saldo_devedor. Financiado NÃO desqualifica o lead.
      conditional: {
        when: "nao",
        id: "saldo_devedor",
        label: "Quanto ainda falta pagar?",
        placeholder: "Ex.: R$ 150.000"
      },
      showIf: function () { return answers.possui_imovel === "sim"; }
    },
    {
      id: "faixa_credito",
      type: "choice",
      kicker: "Crédito desejado",
      title: "Qual valor do crédito você está buscando?",
      options: [
        { label: "Menos de R$ 200 mil", value: "menos_200k", amount: 150000 },
        { label: "De R$ 200 mil a R$ 500 mil", value: "200k_500k", amount: 350000 },
        { label: "De R$ 500 mil a R$ 900 mil", value: "500k_900k", amount: 700000 },
        { label: "Acima de R$ 900 mil", value: "acima_900k", amount: 1000000 }
      ],
      showIf: function () { return answers.possui_imovel === "sim"; }
    },

    /* ---- Ramo AUTO (não possui imóvel -> garantia de veículo) ---- */
    {
      id: "possui_automovel",
      type: "choice",
      kicker: "Veículo",
      title: "Você possui um automóvel?",
      options: [
        { label: "Sim", value: "sim" },
        // "Não" segue até a etapa de contato (mesmo sem imóvel nem veículo) — vira lead
        // "descarte": salvo no nosso banco pra contato futuro, mas NÃO vai pro RD nem
        // conta como conversão de ads (ver classifyLead/META_EVENTS).
        { label: "Não", value: "nao" }
      ],
      showIf: function () { return answers.possui_imovel === "nao"; }
    },
    {
      id: "automovel_quitado",
      type: "choice",
      kicker: "Veículo",
      title: "Seu automóvel está quitado?",
      options: [
        { label: "Sim", value: "sim" },
        { label: "Não", value: "nao" }
      ],
      showIf: function () { return answers.possui_imovel === "nao" && answers.possui_automovel === "sim"; }
    },
    {
      id: "valor_automovel",
      type: "fields",
      kicker: "Valor do veículo",
      title: "Qual é o valor aproximado do seu automóvel?",
      subtitle: "O crédito disponível pode chegar a até 50% do valor do bem.",
      fields: [
        { id: "valor_automovel", label: "Valor aproximado do automóvel", type: "text", inputmode: "numeric", placeholder: "Ex.: R$ 120.000", required: true }
      ],
      showIf: function () { return answers.possui_imovel === "nao" && answers.possui_automovel === "sim"; }
    },
    {
      id: "faixa_emprestimo_auto",
      type: "choice",
      kicker: "Crédito desejado",
      title: "Qual valor de crédito você está buscando?",
      options: [
        { label: "Menos de R$ 200 mil", value: "auto_menos_200k", amount: 150000 },
        { label: "De R$ 200 mil a R$ 500 mil", value: "auto_200k_500k", amount: 350000 },
        { label: "Acima de R$ 500 mil", value: "auto_acima_500k", amount: 600000 }
      ],
      showIf: function () { return answers.possui_imovel === "nao" && answers.possui_automovel === "sim"; }
    },

    /* ---- Contato: compartilhado pelos dois ramos que geram lead ---- */
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
      ],
      // Etapa comum a TODOS os ramos que terminam em lead (inclusive "descarte" —
      // sem imóvel e sem automóvel), pra sempre capturar o contato antes de finalizar.
      showIf: function () { return !!answers.possui_imovel; }
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

  // Etapa vista (1x por pergunta/sessão) — vira o funil "pergunta a pergunta" do
  // dashboard: quanta gente chega em cada pergunta e onde desiste. Vai pela tabela
  // `events` (coluna properties), sem precisar de coluna nova no D1.
  function trackStepView(step) {
    if (previewMode) return;              // navegação do dashboard não vira dado
    if (!step || stepSeen[step.id]) return;
    stepSeen[step.id] = true;
    try {
      if (window.inspiraTrack) {
        window.inspiraTrack.event("form_step", {
          step: stepIndex + 1,
          id: step.id,
          title: step.title,
          total: Math.max(visibleSteps().length, 6)
        });
      }
    } catch (e) {}
  }

  // Opção escolhida numa pergunta de múltipla escolha — mostra QUAL resposta cada
  // etapa recebeu (ex.: quantos responderam "não" em "possui imóvel").
  function trackStepChoice(step, value) {
    if (previewMode) return;
    try {
      if (window.inspiraTrack) {
        window.inspiraTrack.event("form_step_choice", {
          step: stepIndex + 1,
          id: step.id,
          value: value,
          label: (labelFor(step.id, value) || value)
        });
      }
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
    if (changedId === "possui_imovel") {
      // Trocar de ramo limpa as respostas do ramo que deixou de valer.
      if (answers.possui_imovel !== "sim") {
        delete answers.tipo_imovel;
        delete answers.possui_matricula;
        delete answers.valor_imovel;
        delete answers.imovel_quitado;
        delete answers.saldo_devedor;
        delete answers.faixa_credito;
      }
      if (answers.possui_imovel !== "nao") {
        delete answers.possui_automovel;
        delete answers.automovel_quitado;
        delete answers.valor_automovel;
        delete answers.faixa_emprestimo_auto;
      }
    }
    // Voltou pra "quitado" -> o saldo devedor que tinha sido digitado não vale mais.
    if (changedId === "imovel_quitado" && answers.imovel_quitado !== "nao") {
      delete answers.saldo_devedor;
    }
    if (changedId === "possui_automovel" && answers.possui_automovel !== "sim") {
      delete answers.automovel_quitado;
      delete answers.valor_automovel;
      delete answers.faixa_emprestimo_auto;
    }
  }

  // Barra segmentada (5 pedaços) embaixo do botão: enche um pedaço por etapa concluída,
  // com o rótulo "Pergunta X de Y" em cima.
  function setProgress(current, total) {
    if (progressLabel && total) progressLabel.textContent = "Pergunta " + current + " de " + total;
    if (!progressSteps) return;
    // Os segmentos acompanham o total do ramo (imóvel tem 7 perguntas, automóvel 6) —
    // o HTML nasce com 6, então acrescenta/remove conforme o caminho escolhido.
    while (total && progressSteps.children.length < total) {
      var seg = document.createElement("span");
      seg.className = "pstep";
      progressSteps.appendChild(seg);
    }
    while (total && progressSteps.children.length > total) {
      progressSteps.removeChild(progressSteps.lastChild);
    }
    var segs = progressSteps.children;
    for (var i = 0; i < segs.length; i++) {
      segs[i].classList.toggle("is-done", i < current);
    }
  }

  function updateProgress() {
    var visible = visibleSteps();
    // Os ramos que geram lead têm até 6 passos. Projeta 6 pra barra não pular nem
    // encher no passo 1 enquanto o ramo ainda não foi escolhido (showIf esconde os demais).
    var total = Math.max(visible.length, 6);
    var current = Math.min(stepIndex + 1, total);
    setProgress(current, total);
    backButton.hidden = stepIndex === 0;
    nextButton.textContent = stepIndex === total - 1 ? "Enviar respostas" : "Continuar";
  }

  function renderChoice(step) {
    var selected = answers[step.id] || "";
    var html = '<div class="options">' + step.options.map(function (option) {
      var isSelected = selected === option.value;
      return '<button class="option' + (isSelected ? " is-selected" : "") + '" type="button" data-value="' + escapeHtml(option.value) + '">' +
        '<span class="option-text"><strong>' + escapeHtml(option.label) + '</strong>' +
        (option.detail ? '<small>' + escapeHtml(option.detail) + '</small>' : '') +
        '</span><span class="option-dot" aria-hidden="true"></span></button>';
    }).join("") + '</div>';

    // Caixa condicional: aparece embaixo das opções, na MESMA etapa, quando a resposta
    // escolhida é a que a pergunta marcou como gatilho (ex.: imóvel não quitado).
    var cond = step.conditional;
    if (cond && selected === cond.when) {
      html += '<div class="fields">' +
        '<div class="field">' +
        '<label for="field-' + cond.id + '">' + escapeHtml(cond.label) + '</label>' +
        '<input class="input" id="field-' + cond.id + '" name="' + cond.id + '" type="text" inputmode="numeric" ' +
        'placeholder="' + escapeHtml(cond.placeholder) + '" value="' + escapeHtml(answers[cond.id] || "") + '" />' +
        '<p class="error" data-error-for="' + cond.id + '"></p>' +
        '</div></div>';
    }

    return html + '<p class="error" id="step-error">Escolha uma opção para continuar.</p>';
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

  // Liga a caixa condicional de um passo de múltipla escolha (máscara de dinheiro +
  // gravação da resposta), do mesmo jeito que os campos de um passo "fields".
  function bindConditionalInput(step) {
    var cond = step.conditional;
    if (!cond || answers[step.id] !== cond.when) return;
    var input = document.getElementById("field-" + cond.id);
    if (!input) return;
    input.addEventListener("input", function () {
      startTracking();
      input.value = formatMoney(input.value);
      if (input.value) {
        var pos = input.value.length - 3;
        try { input.setSelectionRange(pos, pos); } catch (e) {}
      }
      answers[cond.id] = input.value.trim();
      setHiddenInputs();
      clearFieldError(cond.id);
    });
    setTimeout(function () { input.focus(); }, 60);
  }

  function render() {
    var step = currentStep();
    if (!step) return;
    updateProgress();
    trackStepView(step);
    shell.innerHTML = '<section class="question">' +
      '<h2 class="question-title">' + escapeHtml(step.title) + '</h2>' +
      (step.subtitle ? '<p class="question-subtitle">' + escapeHtml(step.subtitle) + '</p>' : '') +
      (step.type === "choice" ? renderChoice(step) : renderFields(step)) +
      '</section>';

    if (step.type === "choice") {
      shell.querySelectorAll(".option").forEach(function (button) {
        button.addEventListener("click", function () {
          startTracking();
          var value = button.getAttribute("data-value");
          trackStepChoice(step, value);
          answers[step.id] = value;
          normalizeAnswers(step.id);
          setHiddenInputs();
          render();
          // Se a resposta abriu a caixa condicional, NÃO avança sozinho — a pessoa ainda
          // precisa digitar o valor e clicar em Continuar.
          if (step.conditional && value === step.conditional.when) return;
          setTimeout(function () { goNext(); }, 140);
        });
      });
      bindConditionalInput(step);
    } else {
      step.fields.forEach(function (field) {
        var input = document.getElementById("field-" + field.id);
        if (!input) return;
        input.addEventListener("input", function () {
          startTracking();
          if (field.id === "whatsapp") input.value = formatPhone(input.value);
          if (field.id === "valor_imovel" || field.id === "valor_automovel") {
            input.value = formatMoney(input.value);
            if (input.value) {
              var pos = input.value.length - 3;
              try { input.setSelectionRange(pos, pos); } catch (e) {}
            }
          }
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

  function parseMoney(value) {
    var digits = String(value || "").replace(/\D/g, "");
    return digits ? Number(digits) / 100 : 0;
  }

  function formatMoney(value) {
    var digits = String(value || "").replace(/,\d*$/, "").replace(/\D/g, "").slice(0, 10);
    if (!digits) return "";
    return "R$ " + Number(digits).toLocaleString("pt-BR") + ",00";
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
      // Antes o formulário TRAVAVA aqui quando o crédito passava de 50% do valor do
      // bem — a pessoa não conseguia terminar e a gente perdia o contato inteiro.
      // Decisão do cliente (24/07/2026): pedir mais que 50% não é impeditivo; segue o
      // fluxo e a classificação normal (imóvel >= 400 mil E crédito >= 200 mil) decide
      // se é qualificado ou não.
      if (error) error.textContent = "Escolha uma opção para continuar.";
      if (error) error.classList.toggle("is-visible", !ok);
      if (!ok) return false;

      // Caixa condicional aberta (ex.: imóvel não quitado -> saldo devedor): o valor é
      // obrigatório porque é ele que separa Financiado50Mais de Financiado50Menos.
      // Não é trava de perfil — qualquer valor passa, só não pode ficar vazio.
      var cond = step.conditional;
      if (cond && answers[step.id] === cond.when) {
        var condInput = document.getElementById("field-" + cond.id);
        var condValue = condInput ? condInput.value.trim() : (answers[cond.id] || "");
        answers[cond.id] = condValue;
        clearFieldError(cond.id);
        if (parseMoney(condValue) <= 0) {
          setFieldError(cond.id, "Informe quanto ainda falta pagar.");
          setHiddenInputs();
          return false;
        }
      }
      setHiddenInputs();
      return true;
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
      if ((field.id === "valor_imovel" || field.id === "valor_automovel") && parseMoney(value) <= 0) {
        setFieldError(field.id, "Informe um valor válido.");
        okFields = false;
      }
    });
    setHiddenInputs();
    return okFields;
  }

  // Busca a opção escolhida num passo de choice (pra ler amount/label).
  function optionFor(stepId, value) {
    var step = steps.filter(function (item) { return item.id === stepId; })[0];
    if (!step || !step.options) return null;
    return step.options.filter(function (o) { return o.value === value; })[0] || null;
  }

  // rótulos legíveis pra mandar pro RD (em vez de slugs tipo "sim"/"200k_500k")
  function labelFor(stepId, value) {
    if (!value) return null;
    var opt = optionFor(stepId, value);
    return opt ? opt.label : value;
  }
  function amountFor(stepId, value) {
    var opt = optionFor(stepId, value);
    return opt ? opt.amount : null;
  }

  function selectedCreditValue() {
    if (answers.possui_imovel === "sim") return amountFor("faixa_credito", answers.faixa_credito);
    return amountFor("faixa_emprestimo_auto", answers.faixa_emprestimo_auto);
  }

  function selectedAssetValue() {
    if (answers.possui_imovel === "sim") return parseMoney(answers.valor_imovel);
    return parseMoney(answers.valor_automovel);
  }

  // Classifica o lead pelo que foi respondido.
  //  baixo_valor      = RD como lead não qualificado, mas sem evento Lead no Meta
  //  home_equity      = imóvel + matrícula + crédito >= 200 mil + imóvel >= 400 mil
  //  home_equity_mql  = imóvel + matrícula + crédito >= 500 mil + imóvel >= 1M
  //  auto             = não tem imóvel, mas tem automóvel (garantia de veículo)
  function classifyLead() {
    if (answers.possui_imovel === "sim") {
      var creditValue = selectedCreditValue();
      var propertyValue = selectedAssetValue();
      if (creditValue < MIN_CREDIT_VALUE || propertyValue < MIN_RD_PROPERTY_VALUE) return "baixo_valor";
      if (answers.possui_matricula !== "sim") return "baixo_valor";
      if (creditValue >= MQL_CREDIT_VALUE && propertyValue >= MQL_PROPERTY_VALUE) return "home_equity_mql";
      if (creditValue >= MIN_RD_CREDIT_VALUE && propertyValue >= MIN_RD_PROPERTY_VALUE) return "home_equity";
      return "baixo_valor";
    }
    if (answers.possui_automovel === "sim") return "auto";
    // sem imóvel e sem automóvel — não qualificado pra nenhum funil: contato fica só
    // no nosso banco, ver META_EVENTS/_app.js.
    return "descarte";
  }

  function thankYouConfig(kind) {
    if (kind === "baixo_valor" || kind === "descarte") return THANK_YOU.notQualified;
    if (kind === "auto") return THANK_YOU.auto;
    return THANK_YOU.qualified;
  }

  function renderThankYou(kind) {
    var cfg = thankYouConfig(kind);
    var steps = "";
    if (cfg.steps && cfg.steps.length) {
      steps = '<ol class="thank-you-steps">' + cfg.steps.map(function (item, index) {
        return '<li><span class="step-index">' + String(index + 1).padStart(2, "0") + '</span><div>' +
          '<strong>' + escapeHtml(item[0]) + '</strong>' +
          '<span>' + escapeHtml(item[1]) + '</span>' +
          '</div></li>';
      }).join("") + '</ol>';
    }

    var cta = "";
    if (cfg.whatsapp) {
      if (cfg.ctaNudge) {
        cta += '<p class="thank-you-nudge">' + escapeHtml(cfg.ctaNudge) + '</p>';
      }
      cta += '<a class="thank-you-btn thank-you-btn-whatsapp" id="formulario-obrigado-whatsapp" href="' + cfg.whatsapp + '" target="_blank" rel="noopener noreferrer">' +
        WHATSAPP_ICON + 'Falar com um consultor no WhatsApp</a>';
      cta += '<a class="thank-you-btn thank-you-btn-ghost" id="formulario-obrigado-nova" href="/formulario/">Fazer uma nova simulação</a>';
    } else {
      cta += '<a class="thank-you-btn thank-you-btn-ghost" id="formulario-obrigado-site" href="/">Voltar para o site</a>';
    }

    if (page) {
      page.classList.add("is-complete");
      page.classList.toggle("is-not-qualified", cfg.tone === "not-qualified");
    }
    form.classList.add("is-complete");
    shell.innerHTML = '<section class="thank-you thank-you-' + cfg.tone + '" aria-label="Respostas enviadas">' +
      '<div class="thank-you-splash" aria-hidden="true"><div class="thank-you-splash-mark">' +
      '<svg viewBox="0 0 56 56" width="132" height="132"><circle class="splash-ring" cx="28" cy="28" r="24"></circle><path class="splash-check" d="M17 29.5 24.3 36.5 39.5 20"></path></svg>' +
      '</div></div>' +
      '<span class="thank-you-mark" aria-hidden="true"><svg viewBox="0 0 56 56" width="30" height="30"><circle class="ring" cx="28" cy="28" r="24"></circle><path class="check" d="M17 29.5 24.3 36.5 39.5 20"></path></svg></span>' +
      '<span class="thank-you-eyebrow">' + escapeHtml(cfg.eyebrow) + '</span>' +
      '<h2>' + escapeHtml(cfg.title) + '</h2>' +
      (cfg.lead ? '<p class="thank-you-lead">' + escapeHtml(cfg.lead) + '</p>' : '') +
      steps +
      '<div class="thank-you-cta">' + cta + '</div>' +
      '<p class="thank-you-fine"><a href="/politica-de-privacidade.html" target="_blank" rel="noopener noreferrer">Política de Privacidade</a> · <a href="/termos-de-uso.html" target="_blank" rel="noopener noreferrer">Termos de Uso</a></p>' +
      '</section>';

    try {
      if (window.inspiraTrack) window.inspiraTrack.event("thank_you_view", { source: "home_equity_form", lead_kind: kind, tone: cfg.tone });
    } catch (e) {}
  }

  function complete() {
    if (submitting) return;
    submitting = true;
    nextButton.disabled = true;
    nextButton.textContent = "Enviando...";

    var kind = classifyLead();
    var isAutoBranch = answers.possui_imovel === "nao" && answers.possui_automovel === "sim";
    var phoneDigits = (answers.whatsapp || "").replace(/\D/g, "");
    var assetValue = selectedAssetValue();
    var creditValue = selectedCreditValue();
    var metaEvents = META_EVENTS[kind] || [];
    if (kind === "auto") {
      metaEvents = creditValue >= MIN_CREDIT_VALUE ? ["Lead"] : [];
    }
    // Marcador: acompanha o Lead, nunca vai sozinho. Imóvel financiado NÃO desqualifica
    // (quem decide a faixa é o valor) — só ganha a marcação, pra dar pra separar ou
    // excluir esse público depois. (decisão do cliente, 28/07/2026)
    var saldoValue = parseMoney(answers.saldo_devedor || "");
    if (metaEvents.length && answers.imovel_quitado === "nao") {
      metaEvents = metaEvents.concat(saldoValue > assetValue * 0.5 ? "Financiado50Menos" : "Financiado50Mais");
    }

    var payload = {
      name: answers.nome || null,
      phone: phoneDigits ? "+55" + phoneDigits : null,
      email: answers.email || null,
      property_type: isAutoBranch ? null : labelFor("tipo_imovel", answers.tipo_imovel),
      property_value: assetValue || null,
      credit_value: creditValue,
      source: "home_equity_form",
      lead_kind: kind,
      possui_imovel: labelFor("possui_imovel", answers.possui_imovel),      // "Sim" / "Não"
      possui_matricula: labelFor("possui_matricula", answers.possui_matricula),
      // "Quitado"/"Financiado" (mesmo vocabulário da Home Equity) — o servidor normaliza
      // pra Sim/Não no cf_imovel_quitado do RD.
      situacao_imovel: isAutoBranch || !answers.imovel_quitado
        ? null
        : (answers.imovel_quitado === "sim" ? "Quitado" : "Financiado"),
      saldo_devedor: answers.imovel_quitado === "nao" ? saldoValue : null,
      valor_imovel: isAutoBranch ? null : assetValue,
      faixa_credito: isAutoBranch ? null : labelFor("faixa_credito", answers.faixa_credito),
      // ramo auto (garantia de veículo)
      possui_automovel: labelFor("possui_automovel", answers.possui_automovel),
      automovel_quitado: labelFor("automovel_quitado", answers.automovel_quitado),
      valor_automovel: isAutoBranch ? assetValue : null,
      faixa_emprestimo: isAutoBranch ? labelFor("faixa_emprestimo_auto", answers.faixa_emprestimo_auto) : null,
      city: answers.cidade || null,
      // nomes dos eventos do Meta pra este lead (o track.js gera 1 event_id por nome)
      meta_events: metaEvents,
    };

    try {
      if (window.inspiraTrack) {
        window.inspiraTrack.event("simulation_complete", {
          source: "home_equity_form",
          lead_kind: kind,
          possui_imovel: answers.possui_imovel || null,
          tipo_imovel: answers.tipo_imovel || null,
          possui_matricula: answers.possui_matricula || null,
          imovel_quitado: answers.imovel_quitado || null,
          saldo_devedor: answers.imovel_quitado === "nao" ? saldoValue : null,
          valor_imovel: isAutoBranch ? null : assetValue,
          faixa_credito: answers.faixa_credito || null,
          possui_automovel: answers.possui_automovel || null,
          automovel_quitado: answers.automovel_quitado || null,
          valor_automovel: isAutoBranch ? assetValue : null,
          faixa_emprestimo_auto: answers.faixa_emprestimo_auto || null,
          city: answers.cidade || null
        });
        window.inspiraTrack.lead(payload);
      }
    } catch (e) {}

    var totalSteps = Math.max(visibleSteps().length, 6);
    setProgress(totalSteps, totalSteps);
    var nav = document.querySelector(".nav-actions");
    if (nav) nav.hidden = true;
    renderThankYou(kind);
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

  /* Ponte de PREVIEW pro dashboard (mapa de calor). O painel abre esta página num
     iframe de mesma origem e precisa navegar pelas etapas pra mostrar o mapa de cada
     pergunta. Só muda a tela: `previewMode` desliga o rastreio, nada é enviado e
     nenhum lead é criado (o submit continua exigindo interação real do visitante). */
  window.inspiraFormPreview = {
    steps: function () {
      previewMode = true;
      var out = [], guard = 0, saved = { a: answers, i: stepIndex };
      answers = {}; stepIndex = 0;
      while (guard++ < 20) {
        var vis = visibleSteps(), st = vis[stepIndex];
        if (!st) break;
        out.push({ id: st.id, title: st.title });
        if (st.type === "choice" && st.options && st.options[0]) {
          answers[st.id] = st.options[0].value;
          normalizeAnswers(st.id);
        }
        if (stepIndex >= visibleSteps().length - 1) break;
        stepIndex += 1;
      }
      answers = saved.a; stepIndex = saved.i;
      return out;
    },
    goTo: function (n) {
      previewMode = true;
      answers = {}; stepIndex = 0;
      for (var i = 0; i < n; i++) {
        var st = currentStep();
        if (!st) break;
        if (st.type === "choice" && st.options && st.options[0]) {
          answers[st.id] = st.options[0].value;
          normalizeAnswers(st.id);
        }
        if (stepIndex >= visibleSteps().length - 1) break;
        stepIndex += 1;
      }
      setHiddenInputs();
      render();
      return stepIndex;
    }
  };

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
