---
name: "InspiraCred B2B Landing Pages"
description: "Um dossiê editorial de crédito que transforma decisões complexas em caminhos claros e confiáveis."
colors:
  midnight-navy: "#04132f"
  dossier-navy: "#071b42"
  institutional-blue: "#0b2d72"
  interactive-blue: "#16458d"
  mist-blue: "#e5edf9"
  paper-blue: "#f2f6fb"
  action-orange: "#c74600"
  signal-orange: "#f46b16"
  soft-orange: "#fff0e6"
  ink: "#0b1933"
  muted-ink: "#44516a"
  paper: "#ffffff"
  success: "#18794e"
  danger: "#b42318"
typography:
  display:
    fontFamily: "Instrument Sans, sans-serif"
    fontSize: "clamp(3.55rem, 4.2vw, 3.85rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Instrument Sans, sans-serif"
    fontSize: "clamp(2rem, 8vw, 2.8rem)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Instrument Sans, sans-serif"
    fontSize: "1.35rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.62
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 800
    lineHeight: 1.4
rounded:
  control: "10px"
  sm: "12px"
  form: "14px"
  panel: "16px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "24px"
  xl: "34px"
  section-mobile: "72px"
  section-desktop: "96px"
components:
  button-primary:
    backgroundColor: "{colors.action-orange}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "13px 22px"
    height: "50px"
  button-dark:
    backgroundColor: "{colors.dossier-navy}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "13px 22px"
    height: "50px"
  input:
    backgroundColor: "{colors.paper-blue}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    height: "48px"
  form-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.form}"
    padding: "24px 18px"
  dossier-panel:
    backgroundColor: "{colors.dossier-navy}"
    textColor: "{colors.paper}"
    rounded: "{rounded.panel}"
    padding: "46px 22px"
  signal-chip:
    backgroundColor: "{colors.signal-orange}"
    textColor: "{colors.midnight-navy}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 10px"
---

# Design System: InspiraCred B2B Landing Pages

## Overview

**Creative North Star: "Dossiê em Movimento"**

O sistema se comporta como um dossiê de crédito que ganha clareza conforme a leitura avança. A autoridade vem de hierarquia editorial, dados legíveis, ressalvas visíveis e fotografia profissional real — nunca de espetáculo financeiro, promessas visuais ou excesso de decoração.

A composição alterna papel branco, névoa azul e âncoras de azul-marinho para organizar a narrativa sem cair em uma sequência de cartões idênticos. O laranja é um sinal controlado de ação, progresso e ênfase. Camadas de pasta, listas abertas, linhas de processo e campos planos dão ao conjunto uma linguagem própria, sóbria e direta.

**Key Characteristics:**

- Editorial, seguro e objetivo.
- Plano por padrão, com profundidade criada por cor, recorte e sobreposição.
- Fotografia humana e profissional como prova de presença, não como ornamento.
- Hierarquia tipográfica forte com texto regulatório sempre legível.
- Movimento curto e funcional, com experiência completa sem animação.
- Mobile recomposto como uma narrativa vertical própria.

## Colors

A paleta combina azuis de confiança, superfícies frias de papel e um laranja quente reservado a decisões e sinais importantes.

### Primary

- **Azul Dossiê** (`dossier-navy`): sustenta Hero escuro, painéis de evidência, formulários e chamadas finais de alta confiança.
- **Azul Institucional** (`institutional-blue`): reforça marca, indicadores e áreas internas dos painéis sem competir com a ação principal.
- **Azul Interativo** (`interactive-blue`): marca foco de campos e estados interativos escuros.

### Secondary

- **Laranja de Ação** (`action-orange`): pertence aos botões primários e a estados de seleção com contraste de texto branco.
- **Laranja de Sinal** (`signal-orange`): destaca palavras-chave, marcadores de processo, medidores, etiquetas e a faixa de CTA assumidamente promocional.
- **Laranja Suave** (`soft-orange`): cria ênfase editorial de baixa intensidade em badges e destaques de contexto.

### Neutral

- **Azul Meia-Noite** (`midnight-navy`): ancora os fundos mais profundos, modelos comparativos e fechamento institucional.
- **Tinta** (`ink`): texto principal sobre superfícies claras.
- **Tinta Suave** (`muted-ink`): texto explicativo, notas e parágrafos secundários.
- **Papel** (`paper`): canvas predominante, formulários e cartões de conteúdo.
- **Papel Azul** (`paper-blue`): campos, FAQ e grandes áreas de descanso visual.
- **Névoa Azul** (`mist-blue`): linhas de processo, medidores e superfícies de apoio.

### Semantic

- **Sucesso** (`success`): confirmação explícita após envio.
- **Perigo** (`danger`): validação e mensagens de erro; nunca como decoração.

**The Controlled Orange Rule.** O laranja pertence a ações decisivas, ênfases textuais, indicadores compactos e faixas de CTA intencionais; ele não alterna seções nem vira gradiente decorativo.

**The One Dark Anchor Rule.** Cada trecho de narrativa pode ter uma âncora azul-marinho forte, mas o entorno deve voltar ao papel ou à névoa para preservar ritmo e legibilidade.

## Typography

**Display Font:** Instrument Sans (com `sans-serif`)

**Body Font:** Inter (com `system-ui, sans-serif`)

**Character:** Instrument Sans traz presença compacta e contemporânea aos títulos; Inter mantém explicações, condições e formulários calmos e altamente legíveis. A hierarquia é firme, mas não transforma texto financeiro em slogan agressivo.

### Hierarchy

- **Display** (800, escala fluida de Hero, 0.98): títulos de primeira dobra; no mobile a escala reduz sem perder a quebra editorial.
- **Headline** (800, escala fluida de seção, 1.05): títulos de seção com largura controlada e balanço de linhas.
- **Title** (800, 1.25–1.45rem, 1.2): etapas, modelos, públicos e títulos internos.
- **Body** (400–500, 1rem, 1.62): narrativa principal com linhas geralmente limitadas a 52–68 caracteres tipográficos.
- **Label** (700–800, 0.82–0.92rem): campos, badges, notas curtas e navegação; caixa normal por padrão.

**The Two-Family Rule.** Instrument Sans fala em títulos e números de destaque; Inter explica, orienta e coleta dados. Não introduza uma terceira família para criar variedade.

**The Disclaimer Is Content Rule.** Ressalvas e condições podem ser menores, mas devem manter contraste, espaçamento e comprimento de linha suficientes para leitura real.

## Layout

O canvas usa um shell central de até 1184px. A margem lateral é de 18px no mobile e 32px a partir de 700px; seções respiram 72px no fluxo base e 96px em telas médias e grandes, com compactação específica abaixo de 430px. O sistema responde nos marcos observados de 430px, 700px, 980px e 1280px.

No desktop, a narrativa usa splits assimétricos, áreas editoriais abertas, fotografia em escala e painéis escuros concentrados. Linhas de processo atravessam colunas sem transformar cada etapa em card. A partir de 980px, navegação, Heros e formulários assumem grades de duas colunas; abaixo disso, a ordem vertical preserva o argumento antes da prova e a prova antes da ação.

**The Own Mobile Composition Rule.** Mobile não é o desktop espremido: imagens, dossiês, etapas, modelos e formulários são reordenados como uma leitura vertical contínua, com CTAs ocupando a largura disponível e alvos de toque confortáveis.

**The New Reason Rule.** Cada seção precisa introduzir uma nova razão para continuar — contexto, processo, evidência, confiança ou ação — e deve escolher uma geometria coerente com esse papel.

## Elevation & Depth

O sistema é plano por padrão e não usa `box-shadow`. Profundidade nasce do contraste tonal, de sobreposições controladas, de recortes de imagem, de abas de pasta e de um único deslocamento espacial quando ele explica hierarquia. Fundos escuros concentram dados e formulários; superfícies claras permanecem limpas.

**The Flat-by-Default Rule.** Não adicione sombras decorativas a botões, cards, FAQ ou campos. Use cor, borda implícita, recorte ou sobreposição somente quando houver uma relação espacial a explicar.

## Shapes

Retângulos suavizados de 12–16px formam botões, painéis e cartões de formulário. Campos usam 10px para parecerem precisos e acessíveis. Componentes editoriais especiais podem cortar um canto para 4px e manter os demais em 14–16px, evocando folhas e pastas sem virar ornamento temático. Círculos ficam restritos a ícones, marcadores de processo e estados; pills pertencem a badges compactos.

**The Folder Edge Rule.** A assimetria de canto é uma assinatura reservada a camadas editoriais, fotografia e dossiês; componentes utilitários continuam regulares.

## Components

### Buttons

- **Primary:** bloco laranja, texto branco em peso 800, altura mínima de 50px, padding de 13px por 22px e cantos de 12px.
- **Dark:** mesma geometria sobre azul Dossiê; usado quando a superfície ao redor já é laranja ou clara.
- **Secondary:** link textual aberto, sem contorno ou fundo; acompanha uma ação principal sem competir com ela.
- **States:** hover sobe 2px e muda o tom; active retorna e comprime levemente; `:focus-visible` recebe contorno laranja de 3px; disabled perde opacidade sem mover.

### Inputs / Fields

- **Style:** superfície Papel Azul, altura mínima de 48px, cantos de 10px, sem borda em repouso.
- **Focus:** fundo retorna ao Papel e contorno de 2px usa Azul Interativo.
- **Error:** contorno Perigo e fundo vermelho muito claro, acompanhado de mensagem textual; cor nunca é o único sinal.
- **Grouping:** formulário branco dentro de painel marinho, com rótulos fortes e respiro vertical regular.

### Navigation

- **Desktop:** logo oficial, links compactos e CTA primário; hover dos links revela uma linha laranja curta.
- **Sticky:** ao sair do Hero, vira barra branca compacta com logo colorido e entra por deslocamento vertical curto.
- **Mobile:** botão circular de 48px abre uma camada marinho em tela cheia, preserva foco e bloqueia o scroll do fundo.

### Dossier Panels

Painéis marinho agrupam números, modelos, formulários ou CTA final. Eles usam raio de 16px, títulos brancos, texto azul-claro e laranja apenas para decisão ou sinal. Não subdivida o painel em uma grade de cards iguais quando uma lista aberta ou divisão tonal resolver melhor.

### Dossier Status Card

O cartão branco sobre fotografia apresenta um estado, valor ou caminho resumido. A aba superior, o canto assimétrico e o medidor curto comunicam documento em andamento; conteúdo e números devem ser reais e já aprovados.

### Process Timeline

Marcadores laranja e linha Névoa Azul conectam etapas abertas. A linha é vertical no mobile e horizontal no desktop; títulos e explicações permanecem fora de caixas.

### FAQ

Itens brancos usam cantos de 12px sobre Papel Azul. O ícone `+` gira para formar o estado aberto, e a resposta expande em grade sem deslocamento abrupto.

**The State Must Explain Rule.** Todo movimento ou mudança visual deve explicar navegação, progresso, abertura, foco ou confirmação; a página precisa continuar completa no primeiro frame e com `prefers-reduced-motion`.

## Do's and Don'ts

### Do:

- Do preserve a presença dominante de papel branco e usar azul-marinho como âncora concentrada.
- Do usar fotografia real ou material de produção com proveniência para tornar confiança e contexto concretos.
- Do manter o CTA principal laranja imediatamente reconhecível e as ressalvas próximas da afirmação que qualificam.
- Do variar a geometria conforme a função: lista aberta para processo, painel para evidência, formulário para coleta e faixa para fechamento.
- Do verificar desktop e mobile, teclado, foco visível, primeiro frame e `prefers-reduced-motion`.

### Don't:

- Don't criar gradientes, sombras decorativas ou glow para simular sofisticação.
- Don't transformar todas as seções em cards arredondados repetidos ou alternar faixas de cor sem função narrativa.
- Don't inventar números, provas, logos, depoimentos, instituições ou estados de sucesso.
- Don't usar o laranja como preenchimento genérico quando ele não sinaliza ação, progresso ou ênfase aprovada.
- Don't aproximar o logo, substituir as famílias tipográficas ou esconder condições importantes em texto ornamental.
