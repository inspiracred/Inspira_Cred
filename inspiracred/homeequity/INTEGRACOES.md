# Integrações da landing Home Equity — GUARDADO (desativado por enquanto)

Este arquivo guarda **todo o código de conexão** (envio do lead + rastreamento) que estava na
página `index.html`. Por enquanto ele está **DESLIGADO**: a página funciona, valida o form e
mostra a tela de sucesso, mas **não envia o lead pra lugar nenhum e não dispara nenhum pixel**.

Quando você confirmar as pendências (ver o fim do arquivo), é só seguir o passo a passo abaixo
para religar. Nada aqui é carregado pela página automaticamente — é só referência.

---

## O que cada integração faz

| # | Integração | Pra que serve | Chave / ID |
|---|-----------|----------------|-----------|
| 1 | **RD Station** (`api/1.3/conversions`) | Manda o lead pro CRM/marketing do cliente (mesmo lugar de hoje). Cria a pessoa como Lead. | token público `97c41d08ec55d8a13b94684b9e3f2b22` · identificador `home-equity-lp` |
| 2 | **Meta Pixel** (Facebook/Instagram Ads) | Conta a conversão pros anúncios otimizarem (evento `Lead`). | `588064149882794` |
| 3 | **Google Analytics 4** | Métrica de acesso/comportamento no Google. | `G-JH0P2VY5SR` |
| 4 | **Nosso analytics (D1 / dashboard)** | Registra page views, cliques e leads no nosso dashboard. | `../assets/js/track.js` |

> Observação: existe também um container **GTM `GTM-T7FL9FW`** e um **Google Ads `AW-11106880464`**
> no site antigo. Não foram instalados aqui pra evitar contagem dobrada com o GA4/Pixel diretos.
> Se quiser usar o GTM no lugar dos snippets diretos, a gente decide na hora de religar.

---

## Como o RD Station 1.3/conversions funciona (resumo)

POST em `https://www.rdstation.com.br/api/1.3/conversions` com um JSON contendo o `token_rdstation`
(público), um `identificador` (nome da conversão) e os dados da pessoa. O RD cria/atualiza o Lead
na conta do cliente. Funciona client-side (do navegador) porque usa só o token público — **testado,
retornou `200`**. Pendência: por ser público, o token fica visível no código da página.

---

## PASSO A PASSO PARA RELIGAR

### Passo 1 — Snippets no `<head>` (GA4 + Meta Pixel)
Colar logo depois de `<link rel="stylesheet" href="style.css" />` no `index.html`:

```html
<!-- Google Analytics 4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-JH0P2VY5SR"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-JH0P2VY5SR');
</script>

<!-- Meta Pixel -->
<script>
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '588064149882794');
  fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=588064149882794&ev=PageView&noscript=1" alt="" /></noscript>
```

### Passo 2 — Nosso analytics (D1/dashboard)
Colar logo antes de `</body>` no `index.html`:

```html
<script>window.IC_PAGE = "home_equity_lp";</script>
<script src="../assets/js/track.js" defer></script>
```

### Passo 3 — Funções de envio (RD Station + UTMs)
Colar dentro do `<script>` principal do `index.html`, logo acima da linha
`var form = document.getElementById("lead-form");`:

```js
// RD Station — token público (mesma conta onde os leads caem hoje)
var RD_TOKEN = "97c41d08ec55d8a13b94684b9e3f2b22";
var RD_IDENTIFICADOR = "home-equity-lp";

function getUtm() {
  var p = new URLSearchParams(location.search);
  return {
    utm_source: p.get("utm_source") || null,
    utm_medium: p.get("utm_medium") || null,
    utm_campaign: p.get("utm_campaign") || null,
    utm_content: p.get("utm_content") || null,
    utm_term: p.get("utm_term") || null
  };
}

// Envia a conversão para o RD Station (mesmo destino de hoje)
function sendToRD(data) {
  var utm = getUtm();
  var payload = {
    token_rdstation: RD_TOKEN,
    identificador: RD_IDENTIFICADOR,
    nome: data.nome,
    email: data.email || (data.celular.replace(/\D/g, "") + "@lead.inspiracred.com.br"),
    telefone: "+55" + data.celular.replace(/\D/g, ""),
    cf_valor_emprestimo_desejado: data.valor_emprestimo,
    cf_tipo_imovel: data.tipo_imovel,
    cf_situacao_imovel: data.situacao_imovel,
    cf_valor_imovel: data.valor_imovel,
    traffic_source: utm.utm_source,
    traffic_medium: utm.utm_medium,
    traffic_campaign: utm.utm_campaign
  };
  return fetch("https://www.rdstation.com.br/api/1.3/conversions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
```

### Passo 4 — Disparar no envio do form
No `index.html`, dentro do `form.addEventListener("submit", ...)`, existe este trecho marcador:

```js
        // ⚠️ INTEGRAÇÕES DESATIVADAS por enquanto (envio do lead + tracking).
        // Todo o código e as instruções para religar estão em ./INTEGRACOES.md
        // Quando ativar, chame aqui o envio do lead com o objeto `data`.
```

Substituir por:

```js
        // Conversão para RD Station (best-effort, não bloqueia o usuário)
        sendToRD(data).catch(function (err) { console.warn("[RD] falha ao enviar:", err); });

        // Tracking de anúncios + dashboard
        try { fbq("track", "Lead"); } catch (e) {}
        try { window.dataLayer.push({ event: "lead", produto: "home_equity" }); } catch (e) {}
        try {
          if (window.inspiraTrack) window.inspiraTrack.lead(Object.assign({
            name: data.nome,
            phone: "+55" + data.celular.replace(/\D/g, ""),
            email: data.email || null,
            property_type: data.tipo_imovel.toLowerCase(),
            property_status: data.situacao_imovel.toLowerCase(),
            credit_value: parseMoney(data.valor_emprestimo),
            property_value: parseMoney(data.valor_imovel),
            product: "home_equity",
            source: "home_equity_lp"
          }, getUtm()));
        } catch (e) {}
```

---

## Pendências para confirmar ANTES de religar

- [ ] **RD Station:** o token público pode ficar exposto no código? (era assim no WP). Confirmar o
      `identificador` de conversão certo (`home-equity-lp` ou outro que o time usa nos relatórios).
- [ ] **Campos custom (`cf_*`)** existem na conta RD? Se não, o RD ignora os que não existirem.
- [ ] **Pixel/GA4/GTM:** decidir entre snippets diretos (como acima) OU usar o GTM `GTM-T7FL9FW`
      pra gerenciar tudo — não os dois, pra não contar em dobro.
- [ ] Apagar o lead de teste **"Teste QA"** que ficou no RD Station durante a validação.
- [ ] Se quiser, mandar o lead **também** pro nosso Supabase (como o `index.html` faz) pra unificar
      no dashboard — hoje o plano é só RD Station.
