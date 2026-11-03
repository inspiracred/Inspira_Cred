# LPs Contadores e Parceiros

## Rotas

- `/contadores/`: financiamento para compra de carteira ou escritório contábil.
- `/parceiros/`: cadastro de profissionais interessados em indicar clientes.

## Formulários e rastreamento

As duas páginas carregam `assets/js/track.js` e usam o endpoint existente
`POST /analytics/track`. Page view, cliques, scroll, seções e envio do formulário
mantêm a mesma arquitetura das páginas atuais.

### Contadores

- `page_name` e origem: `contador_aquisicao_lp`.
- Reutiliza no RD o identificador confirmado `Home Equity`.
- Origem legível: `Contadores — Aquisição`.
- Tags: `lp contadores` e `aquisição carteira contábil`.
- Mantém os limites atuais: imóvel entre R$ 400 mil e R$ 20 milhões; crédito entre
  R$ 200 mil e R$ 12 milhões.
- A classificação financeira e a política Meta continuam autoritativas no servidor.

### Parceiros

- `page_name` e origem: `parceiros_lp`.
- `lead_kind`: `parceiro`; não é classificado por valores financeiros e não gera
  evento Meta de lead de crédito.
- Nome, e-mail e telefone entram no registro core do D1.
- A atuação usa a coluna `partner_role`, preparada pela migration
  `0014_partner_role.sql`.
- O envio ao RD permanece desativado de propósito. Ainda não há identificador/fluxo
  nem campo de atuação confirmados na conta. Não criar `cf_atuacao` por aproximação.

## Antes de publicar

1. Aplicar a migration `0014_partner_role.sql` no D1.
2. Confirmar no RD o identificador/fluxo do programa de parceiros e o campo real para
   atuação; só então habilitar o fan-out dessa origem.
3. Rodar o conjunto completo de testes.
4. Fazer QA real sem enviar formulário de teste para produção.
5. Publicação exige commit/push/deploy autorizados e validação pública das duas rotas.
