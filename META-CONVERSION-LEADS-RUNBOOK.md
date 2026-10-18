# Meta Conversion Leads - RD Station CRM

## Diagnostico

O Pixel e a CAPI do site estao ativos. A Cloudflare classifica o formulario e envia
`Lead` na faixa minima e `Lead` + `LeadQualificado` na faixa superior. Rural,
desqualificado ou abaixo da faixa minima continua no D1 e no RD, sem evento Meta.

O dataset mostrou que o evento `Schedule` ja existiu, mas nao recebeu eventos nos
ultimos sete dias. A cobertura de leads do CRM esta em 0%, abaixo dos 60% indicados
pela Meta para otimizacao de leads de conversao.

## Contrato do webhook

Endpoint:

```text
https://nova.inspiracred.com.br/analytics/rd-webhook?token=<RD_WEBHOOK_TOKEN>&meta_crm=1
```

O parametro `meta_crm=1` e um opt-in obrigatorio. A automacao deve chamar essa URL
quando uma negociacao mudar de etapa. O codigo so envia evento se a combinacao for
exatamente `Projeto Piloto` + `Credito Liberado` e a negociacao puder ser casada com
um lead elegivel do site cujo envio Meta original esteja confirmado no D1.

O webhook:

- casa a negociacao com o lead do D1 por e-mail ou telefone;
- reaproveita `fbp`, `fbc` e `external_id` originais quando disponiveis;
- usa e-mail e telefone com SHA-256 como chaves alternativas de correspondencia;
- envia somente `Purchase`, com `action_source=system_generated`;
- envia `custom_data` vazio: valor do imovel, credito, faixa e motivo nao saem do sistema;
- inclui um `event_id` estavel por negocio (`rd:<deal_id>:Purchase`) para deduplicacao;
- retorna o resultado em `meta_crm.status` sem expor dados pessoais ou credenciais.

## Configuracao no RD Station

1. Use o funil `Projeto Piloto` (ID `6a8c96abcbaeaf0020f79f42`).
2. Configure a automacao para disparar o webhook em mudancas de etapa.
3. A venda e a etapa final `Credito Liberado` (`CL`).
4. Confirme no retorno HTTP que `meta_crm.status` seja `ok` nessa etapa.
5. Repeticoes da mesma negociacao/etapa devem voltar como `duplicate_stage`.

Se o RD nao disponibilizar o `leadgen_id`, e-mail ou telefone ainda podem ser
usados, mas a correspondencia e a cobertura tendem a ser melhores com o ID nativo.

## Configuracao na Meta

1. Em Gerenciador de Eventos > dataset > Configuracoes, mantenha o funil coerente com
   `Lead`, `LeadQualificado` e `Purchase`.
2. Use `LeadQualificado` para a faixa financeira superior e `Purchase` apenas para
   `Credito Liberado` no CRM.
3. Publique mudancas de otimizacao somente depois de confirmar os testes no dataset.

O Gerenciador de Anuncios possui um rascunho preexistente. Nao descarte nem
publique esse rascunho sem confirmar a autoria e o conteudo com a gestora de trafego.

## Banco e validacao

A migration `inspiracred/migrations/0009_rd_sales.sql` cria o historico local das
etapas recebidas. Ela nao esta aplicada no D1 de producao. O envio para a Meta e
independente desse armazenamento, mas a migration e necessaria para o dashboard
interno de vendas e para auditoria local.

Antes de ativar em producao:

```powershell
node --test tests/*.test.cjs
```

Depois da ativacao, faca um teste com um lead de formulario da Meta e verifique:

- resposta `meta_crm.status: "ok"`;
- evento na aba **Testar eventos** do dataset;
- `action_source` como `system_generated`;
- `custom_data` vazio;
- nenhum valor financeiro, faixa ou motivo no payload;
- crescimento da cobertura de leads ao longo dos proximos recebimentos.

## Referencias oficiais

- https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration
- https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/crm-integration/3-implementing-the-crm-integration
