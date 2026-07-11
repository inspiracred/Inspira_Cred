# Integrações da landing Home Equity — estado atual

Este arquivo documenta como o lead sai da página e chega no CRM do cliente, e o que ainda
falta pra qualidade de anúncio (Meta CAPI / GA4).

## Estado (Fase 1 — RD Station + nosso analytics, ativos)

Client-side (`script.js` + `index.html`), no submit do form:
1. `window.inspiraTrack.lead({...})` — grava o lead no nosso D1 (`inspiracred-analytics`,
   tabela `leads`, aparece no dashboard `/analytics/dashboard`) e dispara
   `POST /analytics/track` (`type: "lead"`).
2. `assets/js/track.js` também cobre `page_view`/`click`/`form_submit` nesta página — antes
   da Fase 1 essa página **não tinha nenhum tracking** carregado.

Server-side (`inspiracred/functions/analytics/_app.js`, `case "lead"` de `handleTrack`):
1. Insere em `leads` (como sempre).
2. Em `context.waitUntil` (não trava a resposta), `sendLeadToRD(...)` monta o payload e
   manda pro **RD Station** (`POST https://www.rdstation.com.br/api/1.3/conversions`) —
   token público **da mesma conta onde os leads de hoje já caem** (páginas antigas do
   cliente seguem funcionando, não foram tocadas). Grava o resultado em `leads.rd_status`.

**Importante — contexto do cliente:** o RD Station já está em produção com outras páginas
do site (antigas) alimentando ele. Esta página (redesign, rodando A/B contra a antiga) usa
o **mesmo token/conta**, mas um `identificador` de conversão **próprio** —
`home-equity-lp` — pra não misturar relatório com as páginas antigas. Também manda um
campo fixo `cf_variante_pagina = "redesign-2026"`, pra dar pro cliente um jeito de filtrar
"leads da página nova" no RD Station mesmo se o tráfego chegar sem UTM.

### Mapeamento de campos → RD Station

| Campo no `data` do form | Campo enviado ao RD | Observação |
|---|---|---|
| `nome` | `nome` | |
| `celular` | `telefone` (`+55…`) | |
| `email` (opcional no form) | `email` | se vazio, servidor sintetiza `<telefone>@lead.inspiracred.com.br` |
| `tipo_imovel` | `cf_tipo_imovel` | |
| `valor_imovel` | `cf_valor_imovel` | |
| `valor_emprestimo` | `cf_valor_emprestimo_desejado` | |
| UTM da URL | `traffic_source/medium/campaign` | capturados no client, repassados no payload |
| — | `cf_variante_pagina` | fixo, `"redesign-2026"` |

**Pendência conhecida**: os campos `cf_*` precisam existir na conta RD Station do cliente
— se não existirem, o RD ignora silenciosamente o que não reconhece (não quebra o envio).
Confirmar com o cliente/agência que já cuida do RD Station se esses `cf_*` já existem ou
se algum tem nome diferente do que as páginas antigas usam.

## O que falta (Fase 2/3 — Meta CAPI + GA4, ainda não ligado)

- **Meta Pixel** (client, ID `588064149882794`, compartilhado com a página raiz) — ainda
  não carregado no `<head>`.
- **Meta CAPI** (server-side, hash de e-mail/nome/telefone, dedup por `event_id` com o
  pixel do navegador) — precisa de `META_ACCESS_TOKEN` (System User token gerado no
  Business Manager do cliente) como secret no Cloudflare Pages.
- **GA4** (client, `G-JH0P2VY5SR`, compartilhado) — ainda não carregado.
- Middleware de atribuição (`_middleware.js`) pra capturar `fbclid`/`gclid` e manter
  `_fbp`/`_fbc` mesmo com bloqueador de anúncio ativo.

Ver o plano completo em `.claude/` (sessão de implementação) pra sequência exata.

## Limpeza feita

- Removida a chamada direta `sendToRD` client-side (o token não fica mais em view-source;
  RD Station agora é sempre server-side, com a mesma atribuição enriquecida que o Meta
  CAPI vai usar).
