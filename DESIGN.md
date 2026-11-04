---
name: "InspiraCred B2B Landing Pages"
description: "Arquitetura editorial de crédito em que a frase constrói o espaço e a fotografia se abre como passagem."
colors:
  warm-paper: "#f4f2ec"
  white: "#ffffff"
  navy: "#071b42"
  navy-soft: "#243858"
  orange: "#ff7a21"
  muted: "#657189"
  near-black: "#0b0c0f"
  footer-black: "#020817"
  success: "#0a7f4f"
  danger: "#b42318"
typography:
  display:
    fontFamily: "Instrument Sans, Arial, sans-serif"
    fontSize: "clamp(52px, 5vw, 72px)"
    fontWeight: 620
    lineHeight: 0.93
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Instrument Sans, Arial, sans-serif"
    fontSize: "clamp(40px, 5.2vw, 76px)"
    fontWeight: 590
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Instrument Sans, Arial, sans-serif"
    fontSize: "clamp(28px, 3vw, 46px)"
    fontWeight: 560
    lineHeight: 1
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Instrument Sans, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Instrument Sans, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.25
  footer-wordmark:
    fontFamily: "Instrument Sans, Arial, sans-serif"
    fontSize: "clamp(116px, 20vw, 295px)"
    fontWeight: 700
    lineHeight: 0.73
    letterSpacing: "-0.08em"
rounded:
  field: "1px"
  control: "2px"
  circle: "999px"
spacing:
  xs: "8px"
  sm: "14px"
  md: "24px"
  lg: "48px"
  xl: "80px"
  gutter: "clamp(20px, 4vw, 64px)"
  section: "clamp(100px, 12vw, 180px)"
components:
  button-primary:
    backgroundColor: "{colors.orange}"
    textColor: "{colors.navy}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "13px 22px"
    height: "50px"
  button-dark:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "13px 22px"
    height: "50px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.navy}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "11px 12px"
    height: "48px"
  form-surface:
    backgroundColor: "{colors.warm-paper}"
    textColor: "{colors.navy}"
    rounded: "{rounded.field}"
    padding: "clamp(28px, 4vw, 54px)"
  model-simple:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.white}"
    rounded: "{rounded.field}"
    padding: "clamp(40px, 6vw, 90px)"
  model-structured:
    backgroundColor: "{colors.orange}"
    textColor: "{colors.navy}"
    rounded: "{rounded.field}"
    padding: "clamp(40px, 6vw, 90px)"
---

# Design System: InspiraCred B2B Landing Pages

## Overview

**Creative North Star: "Arquitetura de Aberturas"**

O sistema transforma crédito e parceria em espaço editorial. A frase é o layout: grandes campos tipográficos organizam a leitura, e a fotografia entra por vãos inline, shutters e portais que tornam a oportunidade visível sem recorrer a mockups, cards flutuantes ou decoração financeira.

Cada mudança de papel ganha uma composição própria. Processo vira escada ou relay; simulação vira ledger; modelos viram territórios completos de cor; confiança aparece no encontro entre retrato, afirmação e linhas de evidência. A direção aprovada usa o seed `af46343b95cb4b52` e está liberada para ship.

**Key Characteristics:**

- A frase ocupa o campo e determina a composição.
- Fotografias naturais funcionam como aberturas, não como fundos decorativos.
- Papel quente e branco arquitetônico dominam; navy e near-black criam territórios.
- Laranja sinaliza ação, passagem ou contraste estrutural.
- Linhas, vazios e recortes substituem cards, sombras e ornamentos.
- Desktop e mobile preservam o gesto editorial com composições próprias.

## Colors

A paleta é curta e arquitetônica: papel quente, branco luminoso, navy institucional, laranja de ação e pretos profundos para fechamento.

### Primary

- **Navy Institucional** (`navy`): tinta principal, ledger, território escuro, botão secundário e linhas de estrutura.
- **Navy Suave** (`navy-soft`): explicações e texto secundário que ainda precisam pertencer ao mesmo campo cromático.

### Secondary

- **Laranja de Passagem** (`orange`): CTA primário, numerais financeiros, filetes de travessia e um dos territórios de modelo.

### Neutral

- **Papel Quente** (`warm-paper`): canvas principal e superfície dos formulários.
- **Branco Arquitetônico** (`white`): seções abertas, respiros e contraste com o papel.
- **Cinza de Apoio** (`muted`): notas, placeholders e texto de baixa hierarquia.
- **Quase Preto** (`near-black`): campo de fechamento editorial.
- **Preto de Rodapé** (`footer-black`): base institucional e wordmark monumental.

### Semantic

- **Sucesso** (`success`): confirmação após envio e único círculo preenchido além do ícone de informação.
- **Perigo** (`danger`): validação textual e borda de erro; nunca decoração.

**The Orange Is a Passage Rule.** O laranja marca ação, valor ou travessia entre territórios; ele não cria gradientes, badges, eyebrows ou alternância cosmética de seções.

**The Paper Has Two Temperatures Rule.** Papel Quente sustenta a narrativa e Branco abre pausas arquitetônicas. A diferença é estrutural e deve permanecer sutil.

## Typography

**Display, Body and Label Font:** Instrument Sans (com `Arial, sans-serif`)

**Character:** Uma única família carrega da informação regulatória ao pôster. A variedade vem de escala, peso, medida, linha e posição — não de trocar fontes ou adicionar categorias visuais artificiais.

### Hierarchy

- **Display** (620, escala fluida de 52–72px, 0.93): frases de Hero que ocupam toda a largura e recebem uma abertura fotográfica inline.
- **Headline** (590, escala fluida de 40–76px, 0.98): grandes campos de seção, fechamentos e territórios.
- **Title** (560–590, escala fluida de 28–46px, 1): etapas, perguntas, linhas de audiência e estruturas editoriais.
- **Body** (400, 16–23px, 1.42–1.55): narrativa, explicações e conteúdo de formulário.
- **Label** (650–700, 13–16px): navegação, rótulos, notas e ações.
- **Footer Wordmark** (700, escala fluida de 116–295px, 0.73): palavra decorativa recortada; pode usar tracking de -0.08em porque não carrega conteúdo essencial.

**The Minus Four Ceiling Rule.** Títulos legíveis não apertam além de -0.04em. O único desvio é o wordmark decorativo de rodapé em -0.08em.

**The No Eyebrow Rule.** Não crie microtítulos em caixa alta para fabricar hierarquia. A própria frase, sua posição e a mudança de escala devem orientar a leitura.

## Layout

O shell chega a 1280px com gutter fluido de 20–64px. Grandes frases trabalham sobre uma grade de 12 colunas com gap de 24px; imagens podem atravessar colunas, sair parcialmente do gutter ou ocupar uma faixa inteira. O vazio é ativo: separa argumentos e permite que cada abertura fotográfica funcione como pausa ou passagem.

Os breakpoints são 980px para recompor grades editoriais, 860px para trocar a navegação e 760px para a composição móvel. No mobile, o gutter fixa em 20px, seções respiram 84px, CTAs ocupam a largura e a ordem argumento → imagem → prova → ação permanece clara. Alvos interativos têm pelo menos 44px.

**The Sentence Is the Layout Rule.** Não encaixe o título em uma coluna ao lado de uma imagem. Faça a frase ocupar o campo e use a fotografia como palavra, interrupção ou abertura dentro dela.

**The Role Changes the Geometry Rule.** Processo, ledger, confiança, modelos e formulário não compartilham o mesmo container. Cada papel pede uma estrutura própria, mas todos obedecem à mesma grade e às mesmas linhas.

**The Mobile Is Reauthored Rule.** Mobile preserva o gesto, não a miniatura do desktop: shutters estreitam, territórios empilham, linhas viram rails verticais e imagens podem romper um único lado do gutter.

## Elevation & Depth

Não há gradientes nem `box-shadow`. Profundidade vem do shutter fotográfico, do parallax contido dentro de recortes, da alternância sutil entre Papel Quente e Branco e do encontro entre territórios planos de cor. Nenhuma superfície precisa parecer suspensa.

**The Flat Architecture Rule.** Se uma relação não puder ser explicada por linha, vazio, recorte, contraste ou posição, não tente resolvê-la com sombra, glow ou glassmorphism.

## Shapes

O sistema é quase ortogonal. Campos usam raio de 1px; botões e controles, 2px. Imagens são shutters e portais de canto reto. Círculos aparecem somente no botão de informação e no estado de sucesso. Pills, chips e cantos generosos não pertencem a esta direção.

**The One-or-Two Pixel Rule.** Toda superfície funcional permanece entre 1px e 2px de raio; arredondamento maior exige uma função circular explícita de informação ou sucesso.

## Components

### Buttons

- **Primary:** retângulo laranja, texto navy, peso 700, altura mínima de 50px, padding de 13px por 22px e raio de 2px.
- **Dark:** mesma geometria em navy com texto branco.
- **Text link:** sublinhado legível com seta laranja; acompanha a ação principal sem virar ghost button.
- **States:** hover desloca 2px e escurece a cor; foco usa outline laranja translúcido de 3px; alvos móveis nunca ficam abaixo de 44px.

### Inputs / Fields

- **Style:** branco, borda navy translúcida de 1px, raio de 1px, altura mínima de 48px e padding de 11px por 12px.
- **Focus / hover:** a borda ganha autoridade e o outline permanece visível; não há glow ou sombra.
- **Error:** borda Perigo acompanhada de mensagem de 13px; cor nunca é o único sinal.
- **Grouping:** formulário é uma superfície plana de Papel Quente ou Branco dentro de um território, nunca um card elevado.

### Navigation

- **Desktop:** logo oficial à esquerda, links compactos, sublinhado horizontal e CTA laranja à direita.
- **Sticky:** Papel Quente quase opaco com blur discreto; a mudança serve apenas à persistência de navegação, sem efeito decorativo adicional.
- **Mobile:** menu de 44px e painel plano sob o header, dividido por linhas; não abre um modal arredondado.

### Sentence Aperture

Uma faixa fotográfica substitui parte da frase no Hero. O recorte acompanha a altura de cap, abre por `clip-path` e contém um zoom/parallax leve. A imagem precisa acrescentar significado ao texto, não apenas preencher um vão.

### Process Stair / Relay

Contadores usa três degraus deslocados com número laranja; Parceiros usa quatro passes em linhas de largura total. Ambos permanecem abertos, sem cards, e só recebem reveal curto na entrada.

### Financial Ledger

Simulações vivem em território navy com valores laranja, numerais tabulares e linhas horizontais. Cada caso é uma linha de ledger, não um pricing card. Ressalvas ficam no mesmo território e continuam legíveis.

### Model Territories

Os dois modelos de parceria são territórios completos: navy/branco para indicação simples e laranja/navy para operação estruturada. Não são cards e não recebem container externo, sombra ou raio promocional.

### FAQ

Perguntas e respostas usam linhas de 2px, tipografia grande e `+` laranja. A expansão acontece no próprio fluxo e não cria caixa, fundo ou acordeão arredondado.

### Footer Wordmark

Uma palavra monumental e decorativa é recortada pelo fundo `footer-black`. Tracking de -0.08em é permitido somente aqui; o conteúdo institucional e legal permanece separado e plenamente legível.

**The Motion Has a Job Rule.** Movimento é limitado ao Hero, ao processo e ao shutter/parallax fotográfico. Tudo continua presente no primeiro frame, e `prefers-reduced-motion` remove reveal, clip e transformação.

## Do's and Don'ts

### Do:

- Do usar a frase como estrutura e inserir fotografia somente quando ela completar o sentido.
- Do tratar imagens como shutters, portais, faixas ou travessias com proveniência registrada.
- Do usar linha, vazio, escala e territórios planos para criar hierarquia.
- Do manter tracking mínimo de -0.04em em títulos legíveis e reservar -0.08em ao wordmark decorativo.
- Do garantir alvos de 44px no mobile, foco visível, primeiro frame completo e redução de movimento.

### Don't:

- Don't usar gradientes, sombras, glow, glassmorphism ou cards genéricos.
- Don't criar eyebrows, pills, badges ou cantos arredondados para fabricar variedade.
- Don't repetir o mesmo Hero, timeline, container ou formulário entre superfícies com papéis diferentes.
- Don't transformar ledger ou modelos em pricing cards.
- Don't inventar provas, números, instituições, logos, depoimentos ou estados de sucesso.
