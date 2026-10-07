# IDs estaveis da Meta no tracking

## Objetivo

Fazer o dashboard e o CRM reconhecerem a mesma campanha mesmo quando o nome for
alterado no Gerenciador de Anuncios.

As UTMs continuam sendo gravadas para leitura humana e auditoria. A conciliacao
passa a usar estes campos estaveis:

- `meta_campaign_id`
- `meta_adset_id`
- `meta_ad_id`

## Parametros a adicionar na Meta

No nivel do anuncio, em **Rastreamento > Parametros da URL**, manter as UTMs que ja
existem e acrescentar:

```text
meta_campaign_id={{campaign.id}}&meta_adset_id={{adset.id}}&meta_ad_id={{ad.id}}
```

Nao substituir `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` ou
`utm_term`. Os tres parametros acima sao adicionais.

## Ordem segura de ativacao

1. Aplicar `inspiracred/migrations/0011_meta_attribution_ids.sql` no D1 remoto.
2. Publicar o codigo do site/dashboard.
3. Acrescentar os tres parametros nos anuncios ativos da Meta.
4. Abrir uma URL de teste contendo IDs ficticios e concluir um lead de QA.
5. Conferir no dashboard se campanha, conjunto e anuncio foram conciliados.
6. Conferir no D1 se os tres IDs chegaram em `sessions` e `leads`.

## Historico

A migration inclui a equivalencia historica:

```text
[Leads_LP]_03/09 -> [Leads_LP]_04/09
```

Ela nao reescreve UTMs antigas. Serve somente para reunir os dados no dashboard.

## RD Station

O payload passara a enviar `cf_meta_campaign_id`, `cf_meta_adset_id` e
`cf_meta_ad_id`. Para os valores aparecerem no CRM, precisam existir tres campos
personalizados de Lead do tipo texto com esses identificadores exatos e, se
necessario na Negociacao, a respectiva Combinacao de Campos.
