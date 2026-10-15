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

### Eventos permitidos

Somente eventos padrão e não seletivos chegam à Meta: `Lead`, `InitiateCheckout` e
`SubmitApplication`. Qualificação financeira, valores, dívida, documentação e motivo de
descarte ficam no D1/RD e nunca em `custom_data`.

### GA4 e Google Ads

A referência suporta ambos, mas eles são opcionais no próprio projeto. A InspiraCred ainda
não os habilitou; os identificadores de campanha continuam sendo capturados para permitir
ativação posterior.

## Regra rural

`property_type = rural` é descarte, não conversão. A proteção existe no formulário, no
coletor compartilhado e no servidor. Portanto um cliente antigo ou payload manipulado não
consegue transformar imóvel rural em `Lead`, nem enviá-lo ao RD Station.
