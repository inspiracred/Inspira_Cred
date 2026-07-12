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

## Fase 2 (Meta Pixel + CAPI) — JÁ CONSTRUÍDA, DORMINDO (código pronto, não ligada)

Pixel (navegador) e CAPI (servidor) já estão no código, disparando o **mesmo evento
`Lead` com o mesmo `event_id`** (Meta deduplica). Fica **inerte** até ligar.

- **Pixel** — `assets/js/track.js`: carrega o Pixel só se a constante `META_PIXEL_ID`
  (topo do arquivo) estiver preenchida. Hoje **vazia = desligado**. Dispara `PageView`,
  `Lead` (com `value`=valor do empréstimo, `currency`=BRL, `content_category`=tipo de
  imóvel) e eventos custom `SimulacaoIniciada`/`SimulacaoCompleta`.
- **CAPI** — `functions/analytics/_app.js` `sendLeadToMeta`: server-side, hash SHA-256 de
  e-mail/telefone/nome, `external_id`=hash do session_id, `fbp`/`fbc` lidos do cookie do
  Pixel. Só dispara se os secrets `META_PIXEL_ID` + `META_ACCESS_TOKEN` existirem. Grava
  `leads.meta_status`.

**Passo a passo pra LIGAR (segunda, depois de confirmar o Pixel ID):**
1. Preencher `META_PIXEL_ID` no topo de `inspiracred/assets/js/track.js` com o ID confirmado.
2. Setar secrets no Pages `inspira-cred`: `META_PIXEL_ID` (mesmo ID) + `META_ACCESS_TOKEN`
   (System User token do Business Manager). Opcional: `META_TEST_EVENT_CODE` p/ testar.
3. `git push` + retriggar o deploy (secret novo não pega em deploy antigo).
4. Validar na aba **Testar eventos** do Meta: um Lead de teste deve aparecer 1x (pixel e
   CAPI deduplicados pelo `event_id`), com e-mail/telefone casados por Advanced Matching.

⚠️ **Pixel ID a confirmar**: doc antigo dizia `588064149882794`; cliente enviou depois
`3021870508000260`. Confirmar qual antes de ligar.

## O que ainda falta (fases seguintes)

- **GA4** (client `G-JH0P2VY5SR` + Measurement Protocol server-side) — cliente quer só
  Pixel no começo; GA4 depois.
- **Google Ads** — depois.
- **Loop de venda**: webhook do RD CRM quando a Negociação é ganha → Meta `Purchase` com
  valor (fecha o funil pro Meta otimizar por venda, não só lead). Ver `TRACKING-FUNIL-PLANO.md`.
- **Middleware de atribuição** (`_middleware.js`) pra cookie 1st-party 400d ITP-safe — hoje
  o `fbp`/`fbc` vêm do próprio Pixel (suficiente pra v1); o middleware é um upgrade.

Ver o plano completo em `.claude/` (sessão de implementação) pra sequência exata.

## Limpeza feita

- Removida a chamada direta `sendToRD` client-side (o token não fica mais em view-source;
  RD Station agora é sempre server-side, com a mesma atribuição enriquecida que o Meta
  CAPI vai usar).
