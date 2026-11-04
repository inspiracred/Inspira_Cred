# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Contadores e escritórios contábeis avaliando a compra de uma carteira ou de outro escritório e buscando capital para a aquisição.
- Contadores, advogados, consultores financeiros e correspondentes bancários que já atendem pessoas ou empresas e podem indicar oportunidades de crédito com garantia de imóvel.

## Product Purpose

As duas landing pages devem transformar interesse em um pedido de avaliação ou cadastro, explicando de forma clara como a InspiraCred participa da operação e quais condições e ressalvas se aplicam. Sucesso significa o visitante compreender a proposta, confiar na condução da equipe e concluir o formulário correspondente.

## Positioning

A InspiraCred combina análise do caso, busca de alternativas em diferentes instituições financeiras e acompanhamento do início ao fim. Na página de parceiros, a equipe pode assumir o atendimento e a condução da operação indicada; na página de contadores, o imóvel pode viabilizar capital para uma aquisição contábil elegível.

## Operating Context

- Decisões financeiras de alta consideração, normalmente avaliadas no celular e retomadas no desktop.
- Aquisição de carteira ou escritório contábil, necessidade de entrada e negociação com o vendedor.
- Indicação de clientes por profissionais que precisam preservar a própria reputação e o relacionamento existente.
- Formulários com encaminhamento e integrações já implementadas no projeto.

## Capabilities and Constraints

- Preservar integralmente a copy aprovada, as ressalvas, as condições financeiras e a semântica dos formulários.
- Não inventar endpoints, taxas, promessas, instituições, provas ou condições comerciais.
- Preservar rastreamento, validações, D1 e integrações existentes.
- O cadastro de parceiros permanece sem fan-out ao RD ou Meta até que identificador, fluxo e campo de atuação sejam confirmados.
- A experiência deve funcionar em desktop e celular, respeitar teclado e `prefers-reduced-motion`.

## Brand Commitments

- Nome e logos oficiais da InspiraCred.
- Paleta reconhecível de azul-marinho, azul institucional, branco e laranja.
- Instrument Sans para títulos e Inter para texto, conforme a identidade existente.
- Tom direto, profissional e seguro; sem linguagem que transforme possibilidade em garantia.
- A copy visível das duas páginas é imutável neste redesign.

## Evidence on Hand

- Briefings aprovados e conteúdo implementado em `inspiracred/contadores/index.html` e `inspiracred/parceiros/index.html`.
- Logos, selos e imagens de marca em `inspiracred/assets/img/`.
- Fotografia real da equipe usada na seção de confiança.
- Imagens de Hero geradas para as duas propostas; elas são material de produção, não prova documental.
- Testes automatizados que protegem copy, condições, formulários, rastreamento e integrações em `tests/`.
- Não há depoimentos, logos de clientes ou números adicionais autorizados para serem inventados.

## Product Principles

- Confiança antes de espetáculo: movimento e composição devem esclarecer o caminho e reforçar credibilidade.
- Cada seção precisa entregar uma razão nova para continuar, sem repetir a mesma geometria.
- A ação principal deve permanecer óbvia sem pressionar ou prometer aprovação.
- Mobile é uma composição própria, não uma redução do desktop.
- Qualquer elemento visual deve sobreviver sem animação e sem JavaScript.

## Accessibility & Inclusion

Navegação por teclado, foco visível, alvos de toque confortáveis, contraste adequado, conteúdo presente no primeiro frame e redução de movimento para quem solicitar.

## Direction contract

**THESIS:** Um dossiê de crédito que ganha clareza à medida que o visitante avança. As páginas recusam a sequência comum de cartões idênticos e faixas de cores alternadas.

**OWN-WORLD:** Azul-marinho InspiraCred, branco-papel e laranja controlado; Instrument Sans nos títulos, Inter no texto, fotografia real de negócios, camadas de pasta, listas editoriais abertas e campos financeiros planos, sem gradientes ou sombras decorativas.

**STORY:** Contadores acompanham uma aquisição da oportunidade à avaliação de crédito. Parceiros veem relacionamentos profissionais existentes se tornarem indicações qualificadas. Os dois caminhos terminam em um formulário claro e de baixa fricção.

**FIRST VIEWPORT:** Contadores abre com um dossiê escuro: proposta à esquerda, conversa natural e cartão de estado à direita. Parceiros abre em um split editorial branco: proposta à esquerda e conversa de equipe em altura integral à direita. A ação laranja permanece imediatamente visível.

**FORM:** Direção fundamentada 4, “Dossiê em movimento / rotas de capital”, code-led para este site já integrado. Seed reference: `seed:e10fad59a7b020d1`.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
