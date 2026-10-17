# Metodologia de tracking da InspiraCred

Referência auditada: [`gustavokrob/krob-tracking-stack`](https://github.com/gustavokrob/krob-tracking-stack),
commit `112dfeed5447be8ddb2099fbe72e4ba6a3bbdfb7` (24/04/2026).

## Cobertura

| Página | Coletor central | CAPI server-side | UTMs e IDs de clique | Cookie edge + sessão D1 |
|---|---:|---:|---:|---:|
| `https://nova.inspiracred.com.br/` | Sim | Sim | Sim | Sim |
| `https://nova.inspiracred.com.br/homeequity/` | Sim | Sim | Sim | Sim |
| `https://inspiracred.com.br/` | Sim | Sim | Sim | Parcial |

O domínio oficial está hospedado como HTML estático na Hostinger. Ele carrega o mesmo
coletor hospedado em `nova`, preserva UTMs no navegador e envia ao mesmo endpoint CAPI,
mas a resposta HTML não passa pelo middleware Cloudflare que cria os cookies first-party
de 400 dias e a linha inicial de `sessions`. Para paridade completa nesse item, o domínio
oficial precisa passar pelo mesmo Worker/Pages ou expor um proxy first-party equivalente.

## O que segue a metodologia Krob

- Cookies `_krob_sid`, `_krob_eid`, `_fbp` e `_fbc` first-party por 400 dias nas páginas
  hospedadas no Cloudflare Pages.
- Captura de `fbclid`, `gclid` e `msclkid` sem alterar o valor cru do identificador.
- Persistência de UTMs e identificadores na tabela `sessions`, sem apagar a origem quando
  uma visita posterior chega sem parâmetros.
- Um `event_id` UUID por conversão.
- Enriquecimento servidor com fallback body -> cookie -> sessão D1.
- Normalização e SHA-256 de nome, e-mail e telefone antes da Meta.
- Filtro de bots, telemetria de saúde e fan-out não bloqueante com `waitUntil`.
- Dashboard próprio com jornada, origem, leads e estado das integrações.

## Adaptações deliberadas

### Meta CAPI sem Pixel no navegador

A referência dispara Pixel e CAPI com o mesmo `event_id`. A InspiraCred envia apenas pela
CAPI porque o dataset financeiro opera com restrições de compartilhamento de dados. Isso
elimina a deduplicação Pixel/CAPI, mas mantém o princípio principal da referência: a
conversão server-side não depende do JavaScript do Pixel nem de bloqueadores.

### Eventos de lead

A classificação é recalculada no servidor e permanece no D1, RD e dashboard. Toda
submissão válida gera os eventos padrão `Lead` e `QualifiedLead`, independentemente de
valor, faixa, tipo de imóvel ou classificação. Neste funil, qualificado significa que o
formulário válido foi concluído, não que atingiu uma faixa financeira. `simulation_start` e `simulation_complete` continuam
como etapas internas e não são convertidos em `InitiateCheckout` ou `SubmitApplication`.
Valores, faixas, dívida, documentação e motivo da classificação nunca entram no payload
da Meta. `PageView` é enviado via CAPI com a URL reduzida ao domínio.

### GA4 e Google Ads

A referência suporta ambos, mas eles são opcionais no próprio projeto. A InspiraCred ainda
não os habilitou; os identificadores de campanha continuam sendo capturados para permitir
ativação posterior.

## Regra rural

`property_type = rural` é preservado como classificação própria. O contato e seus dados
seguem para o D1 e o RD Station. Como a classificação não controla mais a Meta, a
submissão válida gera os mesmos `Lead` e `QualifiedLead` das demais, sem expor o tipo do imóvel.
