# Meta Conversion Leads - RD Station CRM

## Diagnostico

O Pixel e a CAPI do site estao ativos e recebem eventos de `Lead`. O alerta do
Gerenciador de Eventos se refere a outra integracao: o retorno das etapas do CRM
para leads captados por Formularios Instantaneos do Facebook/Instagram.

O dataset mostrou que o evento `Schedule` ja existiu, mas nao recebeu eventos nos
ultimos sete dias. A cobertura de leads do CRM esta em 0%, abaixo dos 60% indicados
pela Meta para otimizacao de leads de conversao.

## Contrato do webhook

Endpoint:

```text
https://nova.inspiracred.com.br/analytics/rd-webhook?token=<RD_WEBHOOK_TOKEN>&meta_crm=1
```

O parametro `meta_crm=1` e um opt-in obrigatorio. Use esta URL somente em uma
automacao do RD limitada a leads vindos de Formularios Instantaneos da Meta.
Leads captados no site continuam no fluxo de Pixel/CAPI de website e nao devem
ser enviados por este endpoint como eventos de CRM.

O webhook:

- procura `lead_id`, `leadgen_id` e variantes, inclusive em campos personalizados;
- usa e-mail e telefone com SHA-256 como chaves alternativas de correspondencia;
- envia `action_source=system_generated`;
- envia `custom_data.event_source=crm` e `custom_data.lead_event_source`;
- converte etapas comuns em `Lead`, `QualifiedLead`, `Schedule` e `Converted`;
- inclui um `event_id` estavel por negocio, etapa e horario para deduplicacao;
- retorna o resultado em `meta_crm.status` sem expor dados pessoais ou credenciais.

## Configuracao no RD Station

1. Preserve o identificador `leadgen_id` recebido da Meta em um campo do contato ou da negociacao.
2. Crie uma automacao exclusiva para contatos cuja origem seja Facebook/Instagram Lead Ads.
3. Dispare o webhook na entrada do lead e em toda mudanca de etapa relevante.
4. Envie os eventos em tempo real. Eventos com mais de sete dias nao podem ser recuperados pela integracao.
5. Confirme no retorno HTTP que `meta_crm.status` seja `ok`.

Se o RD nao disponibilizar o `leadgen_id`, e-mail ou telefone ainda podem ser
usados, mas a correspondencia e a cobertura tendem a ser melhores com o ID nativo.

## Configuracao na Meta

1. Em Gerenciador de Eventos > dataset > Configuracoes, conclua **Configurar funil de vendas**.
2. Mantenha `Schedule` como etapa positiva se ela representar o lead qualificado real da operacao.
3. Selecione `Schedule` como evento de conversao no conjunto de anuncios que otimiza para leads qualificados.
4. Publique somente depois de confirmar que o conjunto correto foi selecionado e que os testes do webhook chegaram ao dataset.

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
- origem do evento como CRM;
- crescimento da cobertura de leads ao longo dos proximos recebimentos.

## Referencias oficiais

- https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration
- https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/crm-integration/3-implementing-the-crm-integration
