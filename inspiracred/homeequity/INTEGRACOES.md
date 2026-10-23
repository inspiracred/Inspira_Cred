# Integrações e tracking — estado atual

A arquitetura das páginas da InspiraCred adapta a metodologia do
[`gustavokrob/krob-tracking-stack`](https://github.com/gustavokrob/krob-tracking-stack)
para um funil de crédito. A descrição completa e as diferenças deliberadas estão em
[`../docs/tracking-metodologia.md`](../docs/tracking-metodologia.md).

## Fluxo do formulário

1. `assets/js/track.js` mantém a identidade local, preserva UTMs de primeira origem e
   envia o evento para `POST /analytics/track`.
2. `functions/_middleware.js` registra `_krob_sid`, `_krob_eid`, `_fbp` e `_fbc` como
   cookies first-party de 400 dias e faz UPSERT da atribuição na tabela `sessions`.
3. `functions/analytics/_app.js` grava o lead no D1, enriquece a atribuição pela sessão e
   encaminha o lead ao RD Station e à Meta CAPI em tarefas independentes.
4. Nome, e-mail e telefone só chegam à Meta após normalização e SHA-256. Os campos de
   qualificação financeira permanecem internos e no RD.
5. Imóvel rural entra completo em `leads` e segue ao RD com classificação própria, sem
   evento Meta.

## Meta

O projeto usa **CAPI server-side sem Pixel no navegador**. Essa é uma adaptação
deliberada ao dataset financeiro da InspiraCred e à política de compartilhamento de
dados: não há uma segunda cópia client-side para deduplicar. Cada conversão ainda recebe
um `event_id` UUID único para idempotência no destino.

Eventos externos permitidos:

- `PageView` para carregamento da página, via CAPI e com URL reduzida ao domínio;
- `Lead` quando imóvel >= R$ 400 mil **E** crédito >= R$ 200 mil;
- `Lead` e `LeadQualificado` quando imóvel >= R$ 700 mil **E** crédito >= R$ 350 mil.

Rural, descarte, abaixo da faixa mínima, `simulation_start` e `simulation_complete` não
geram evento Meta. `Purchase` é reservado para uma venda real informada pelo
CRM e não é disparado pelo formulário do site.

Classificação, valor, dívida, documentação e outros qualificadores não são enviados em
`custom_data` da Meta.

## RD Station

O servidor usa o mesmo token/conta já adotado pelo cliente, com identificadores por
origem. O envio é server-side; nenhum token fica no HTML ou no JavaScript público.
Falha no RD não impede a persistência do lead no D1 nem o envio independente à Meta.

## Integrações opcionais

GA4 Measurement Protocol e Google Ads fazem parte da referência Krob, mas permanecem
opcionais e não estão habilitados neste projeto. `gclid` e UTMs já são preservados para
uma ativação futura sem perder a origem dos leads.

## Regra de manutenção

As páginas raiz, `/homeequity/` e a home institucional devem carregar o mesmo
`assets/js/track.js`. Mudanças na arquitetura precisam manter os testes em
`tests/tracking-methodology.test.cjs` e `tests/meta-policy-boundary.test.cjs` passando.
