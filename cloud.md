# Cloudflare Analytics - InspiraCred

## 📋 Descrição Geral

Este documento contém o mapeamento completo de todas as páginas e elementos clicáveis do site InspiraCred para implementação de analytics e tracking no Cloudflare.

**Objetivo:** Rastrear todas as interações dos usuários, cliques em botões/links e cadastros de formulários para análise de comportamento e conversão.

---

## 🗺️ Mapa Completo de Páginas

### 1. **Página Principal** (`index.html`)
**URL:** `nova.inspiracred.com.br/` e `inspiracred.com.br/`
**Objetivo:** Landing page de simulação de Home Equity

#### Elementos Clicáveis - Header/Navegação
| ID/Nome | Tipo | Destino | Descrição |
|---------|------|---------|-----------|
| `nav-logo` | Link | `links/` | Logo InspiraCred no header |
| `nav-produtos` | Link | `#produtos` | Âncora para seção de produtos |
| `nav-simulador` | Link | `#simulador` | Âncora para seção de simulador |
| `nav-duvidas` | Link | `#duvidas` | Âncora para seção de dúvidas |
| `nav-simular-agora-btn` | Botão | `#simulador` | Botão "Simular agora" no header |

#### Elementos Clicáveis - Hero Section
| ID/Nome | Tipo | Destino | Descrição |
|---------|------|---------|-----------|
| `hero-simular-btn` | Botão | `#simulador` | Botão CTA "Simular agora" |

#### Elementos Clicáveis - Formulário de Simulação
| ID/Nome | Tipo | Destino | Descrição |
|---------|------|---------|-----------|
| `property-type-casa` | Botão Radio | Seleção | Tipo de imóvel: Casa |
| `property-type-apartamento` | Botão Radio | Seleção | Tipo de imóvel: Apartamento |
| `property-type-comercial` | Botão Radio | Seleção | Tipo de imóvel: Comercial |
| `paid-sim` | Botão Toggle | Seleção | Imóvel quitado: Sim |
| `paid-nao` | Botão Toggle | Seleção | Imóvel quitado: Não |
| `docs-sim` | Botão Toggle | Seleção | Documentação regularizada: Sim |
| `docs-nao` | Botão Toggle | Seleção | Documentação regularizada: Não |
| `simulation-submit` | Botão Submit | Formulário | Botão "Ver minha simulação" |

#### Elementos Clicáveis - Seção de Resultados
| ID/Nome | Tipo | Destino | Descrição |
|---------|------|---------|-----------|
| `lead-form-submit` | Botão Submit | Formulário | Botão "Seguir com a análise →" |
| `new-simulation-btn` | Botão | Reload | Botão "Fazer nova simulação" |

#### Elementos Clicáveis - Benefícios
| ID/Nome | Tipo | Destino | Descrição |
|---------|------|---------|-----------|
| `whatsapp-specialist-btn` | Link | WhatsApp | Botão "Falar com especialista" |

#### Elementos Clicáveis - Footer
| ID/Nome | Tipo | Destino | Descrição |
|---------|------|---------|-----------|
| `footer-privacy-link` | Link | `ref/fe3ad243-8f41-4056-939b-fe087b3244cc~/pages/politica-de-privacidade.html` | Política de Privacidade |
| `footer-terms-link` | Link | `ref/fe3ad243-8f41-4056-939b-fe087b3244cc~/pages/termos-de-uso.html` | Termos de Uso |

---

### 2. **Página de Links** (`links/index.html`)
**URL:** `links.inspiracred.com.br/`
**Objetivo:** Link na bio para Instagram/redes sociais

#### Elementos Clicáveis - Header
| ID/Nome | Tipo | Destino | Descrição |
|---------|------|---------|-----------|
| `links-logo` | Imagem | - | Logo InspiraCred (não clicável) |

#### Elementos Clicáveis - CTA Principal
| ID/Nome | Tipo | Destino | Descrição |
|---------|------|---------|-----------|
| `links-simular-cta` | Link | `https://simulacao.inspiracred.com.br/` | Botão "Simule seu Crédito" |

#### Elementos Clicáveis - Cards de Produtos
| ID/Nome | Tipo | Destino | Descrição |
|---------|------|---------|-----------|
| `links-home-equity-card` | Link | `https://simulacao.inspiracred.com.br/` | Card Home Equity |
| `links-auto-card` | Link | `https://app.creditas.com/auto-refi/solicitacao/informacoes-pessoais?...` | Card Auto (Creditas) |

#### Elementos Clicáveis - Links Sociais
| ID/Nome | Tipo | Destino | Descrição |
|---------|------|---------|-----------|
| `links-whatsapp` | Link | `https://wa.me/5521977340731?text=Ol%C3%A1,%20vim%20do%20Instagram` | WhatsApp |
| `links-site-oficial` | Link | `https://inspiracred.com.br/` | Site Oficial |
| `links-reclame-aqui` | Link | `https://www.reclameaqui.com.br/empresa/inspira-solucoes-e-negocios-ltda/` | Reclame Aqui |
| `links-instagram` | Link | `https://www.instagram.com/inspiracred/` | Instagram |
| `links-linkedin` | Link | `https://www.linkedin.com/company/inspiracred/` | LinkedIn |

---

### 3. **Página Bio** (`bio/index.html`)
**URL:** `nova.inspiracred.com.br/bio/` (temporário - versão de teste)
**Objetivo:** Versão de teste da página de links

#### Elementos Clicáveis - MESMA ESTRUTURA DA PÁGINA LINKS
(Ver seção anterior - mapeamento idêntico)

---

### 4. **Páginas Legais** (Docs)
**URL:** `ref/fe3ad243-8f41-4056-939b-fe087b3244cc~/pages/`

#### Política de Privacidade
| ID/Nome | Tipo | Descrição |
|---------|------|-----------|
| `privacy-page` | Página | Política de Privacidade |

#### Termos de Uso
| ID/Nome | Tipo | Descrição |
|---------|------|-----------|
| `terms-page` | Página | Termos de Uso |

---

## 📊 Eventos de Tracking

### Eventos de Página View
```javascript
// Página Principal
trackPageView('landing_page', {
  url: '/index.html',
  title: 'InspiraCred | Simulação Home Equity'
});

// Página de Links
trackPageView('link_bio', {
  url: '/links/',
  title: 'InspiraCred | Link na bio'
});

// Página Bio (Teste)
trackPageView('bio_test', {
  url: '/bio/',
  title: 'InspiraCred | Link na bio (Teste)'
});
```

### Eventos de Interação
```javascript
// Clique em botões de simulação
trackClick('simulation_start', {
  element_id: 'simulation-submit',
  element_text: 'Ver minha simulação',
  page: 'landing_page'
});

// Conclusão de simulação
trackEvent('simulation_complete', {
  property_value: 500000,
  credit_value: 200000,
  property_type: 'apartamento',
  installment: 2543.50
});

// Captura de lead
trackEvent('lead_captured', {
  name: 'João Silva',
  phone: '+5521977340731',
  property_type: 'apartamento',
  credit_value: 200000,
  page: 'landing_page'
});

// Cliques na página de links
trackClick('link_click', {
  element_id: 'links-whatsapp',
  destination: 'https://wa.me/5521977340731',
  link_type: 'whatsapp',
  page: 'link_bio'
});
```

### Eventos de Formulário
```javascript
// Início de preenchimento
trackFormStart('simulation_form', {
  page: 'landing_page'
});

// Validação de campos
trackFieldValidation('property_value_field', {
  valid: true,
  value: 500000
});

// Submissão bem-sucedida
trackFormSubmit('simulation_form', {
  success: true,
  completion_time: 45000, // ms
  page: 'landing_page'
});

// Captura de lead
trackFormSubmit('lead_form', {
  success: true,
  name_provided: true,
  phone_provided: true,
  page: 'landing_page'
});
```

---

## 🆕 Instruções para IA: Adicionando Novas Páginas

**Quando uma nova página for criada, siga este processo:**

### 1. Atualize este documento
Adicione a nova página na seção "🗺️ Mapa Completo de Páginas" com:
- Nome do arquivo HTML
- URL de acesso
- Objetivo da página
- Todos os elementos clicáveis (tabela)

### 2. Adicione tracking à página
Inclua o seguinte código antes de fechar `</body>`:

```html
<!-- Cloudflare Analytics -->
<script>
  // Page View
  window.trackPageView('page_name', {
    url: window.location.pathname,
    title: document.title
  });

  // Click Tracking para todos os links
  document.querySelectorAll('a, button').forEach(el => {
    el.addEventListener('click', (e) => {
      const linkData = {
        element_id: e.target.id || e.target.closest('[id]')?.id || null,
        element_text: e.target.textContent.trim(),
        destination: e.target.href || null,
        page: 'page_name'
      };
      window.trackClick('link_click', linkData);
    });
  });

  // Form Tracking
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', (e) => {
      const formData = new FormData(form);
      window.trackFormSubmit(form.id, {
        success: true,
        form_data: Object.fromEntries(formData),
        page: 'page_name'
      });
    });
  });
</script>
```

### 3. Atualize o dashboard
Adicione os novos eventos ao painel Cloudflare Analytics:
- Criar novo widget para a página
- Configurar funis se aplicável
- Adicionar alertas para conversões

### 4. Teste e valide
- Verifique se todos os eventos estão sendo enviados
- Confirme que os dados aparecem no dashboard
- Documente quaisquer problemas encontrados

---

## 🔧 Configuração Cloudflare

### Necessário para implementação:
1. **Cloudflare Analytics/Web Analytics** - Ativo
2. **Cloudflare Workers** - Para processamento de eventos
3. **KV Storage** - Para armazenamento de dados
4. **D1 Database** - Banco de dados relacional
5. **R2 Bucket** - Armazenamento de eventos brutos (opcional)

### Permissões necessárias:
- Acesso ao Cloudflare Dashboard do cliente
- Permissão para criar/editar Workers
- Permissão para criar/editar D1 Database
- Permissão para configurar Analytics

---

## 📈 Métricas Principais

### KPIs a Monitorar:
1. **Taxa de Conversão da Landing Page**
   - Visitas únicas → Início de simulação
   - Início de simulação → Conclusão
   - Conclusão → Captura de lead

2. **Engajamento na Página de Links**
   - Cliques por link
   - Taxa de cliques vs visualizações
   - Origem do tráfego (Instagram, etc.)

3. **Performance do Simulador**
   - Tempo médio de preenchimento
   - Taxa de abandono por campo
   - Valores mais simulados

4. **Qualidade de Leads**
   - Taxa de lead → Contato WhatsApp
   - Origem do lead (orgânico, social, etc.)
   - Perfil demográfico

---

## 🚀 Próximos Passos

1. ⏳ Implementar tracking em todas as páginas
2. ⏳ Configurar Cloudflare Workers para coleta de eventos
3. ⏳ Criar dashboard customizado no Cloudflare
4. ⏳ Configurar alertas e notificações
5. ⏳ Integrar com CRM externo (Supabase já configurado)
6. ⏳ Criar relatórios automáticos

---

**Última atualização:** 06/07/2026  
**Responsável:** IA Assistant  
**Status:** Em implementação