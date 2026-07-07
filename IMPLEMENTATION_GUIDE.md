# Guia de Implementação - Sistema Analytics InspiraCred

## 📋 Visão Geral

Este guia fornece instruções passo a passo para implementar o sistema completo de analytics no site InspiraCred usando Cloudflare.

---

## 🎯 Arquivos Criados

1. **[`cloud.md`](cloud.md)** - Documentação de mapeamento de páginas e elementos
2. **[`CLOUDFLARE_ACCESS_REQUIREMENTS.md`](CLOUDFLARE_ACCESS_REQUIREMENTS.md)** - Requisitos de acesso Cloudflare
3. **[`analytics-worker.js`](analytics-worker.js)** - Cloudflare Worker para processamento de eventos
4. **Este arquivo** - Guia de implementação

---

## 🚀 Passo a Passo de Implementação

### FASE 1: Setup Cloudflare (Requer Acesso do Cliente)

#### 1.1 Obter Acesso Cloudflare
- Seguir instruções em [`CLOUDFLARE_ACCESS_REQUIREMENTS.md`](CLOUDFLARE_ACCESS_REQUIREMENTS.md)
- Cliente deve conceder acesso com permissões necessárias

#### 1.2 Criar D1 Database
```bash
# Via Wrangler CLI
npx wrangler d1 create inspiracred-analytics

# Anotar o database_id retornado
```

#### 1.3 Executar Schema SQL
```bash
# Criar arquivo schema.sql com o conteúdo do CLOUDFLARE_ACCESS_REQUIREMENTS.md
npx wrangler d1 execute inspiracred-analytics --file=schema.sql
```

#### 1.4 Criar KV Namespace
```bash
npx wrangler kv:namespace create "INSPIRACRED_METRICS"

# Anotar o namespace_id retornado
```

#### 1.5 Deploy do Worker
```bash
# Instalar Wrangler se não tiver
npm install -g wrangler

# Deploy do worker
npx wrangler deploy analytics-worker.js
```

#### 1.6 Configurar Variáveis de Ambiente
```bash
npx wrangler secret put DB # Colocar database_id
npx wrangler secret put KV # Colocar namespace_id
```

---

### FASE 2: Integração Frontend

#### 2.1 Adicionar Script de Tracking

**Inserir antes de `</body>` em todas as páginas:**

```html
<!-- InspiraCred Analytics -->
<script>
(function() {
  'use strict';
  
  // Configuração
  const ANALYTICS_ENDPOINT = '/track'; // Alterar para URL do Worker se necessário
  const SESSION_ID = localStorage.getItem('inspiracred_session') || generateSessionId();
  localStorage.setItem('inspiracred_session', SESSION_ID);
  
  // Gerar ID de sessão único
  function generateSessionId() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
  
  // Hash de IP para privacidade
  async function getIpHash() {
    try {
      const response = await fetch('https://api.cloudflare.com/cdn-cgi/trace');
      const text = await response.text();
      const ip = text.split('ip=')[1].split('\n')[0];
      // Simples hash (produção usar crypto.subtle)
      return btoa(ip).substring(0, 16);
    } catch {
      return null;
    }
  }
  
  // Função principal de tracking
  async function track(type, data) {
    const payload = {
      type: type,
      session_id: SESSION_ID,
      created_at: new Date().toISOString(),
      ...data
    };
    
    // Adicionar informações de contexto
    if (!payload.ip_hash) {
      payload.ip_hash = await getIpHash();
    }
    
    if (!payload.user_agent) {
      payload.user_agent = navigator.userAgent;
    }
    
    // Enviar de forma assíncrona (não bloquear)
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(ANALYTICS_ENDPOINT, blob);
    } else {
      fetch(ANALYTICS_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(console.error);
    }
  }
  
  // Page View automático
  track('page_view', {
    page_name: getPageName(),
    url: window.location.href,
    title: document.title,
    referrer: document.referrer
  });
  
  // Tracking de cliques
  document.addEventListener('click', function(e) {
    const target = e.target.closest('a, button');
    if (!target) return;
    
    const linkData = {
      page_name: getPageName(),
      element_id: target.id || null,
      element_text: target.textContent.trim().substring(0, 100) || null,
      destination: target.href || null,
      link_type: guessLinkType(target)
    };
    
    track('click', linkData);
  }, true); // Capture phase para pegar todos os cliques
  
  // Tracking de formulários
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (!form.id) return;
    
    const formData = new FormData(form);
    const formObj = {};
    formData.forEach((value, key) => {
      // Não enviar dados sensíveis
      if (!key.toLowerCase().includes('password') && !key.toLowerCase().includes('cpf')) {
        formObj[key] = value;
      }
    });
    
    track('form_submit', {
      page_name: getPageName(),
      form_id: form.id,
      form_data: formObj,
      success: true
    });
  });
  
  // Funções auxiliares
  function getPageName() {
    const path = window.location.pathname;
    if (path === '/' || path === '/index.html') return 'landing_page';
    if (path.includes('links')) return 'link_bio';
    if (path.includes('bio')) return 'bio_test';
    return 'other';
  }
  
  function guessLinkType(el) {
    const href = el.href || '';
    const text = el.textContent.toLowerCase();
    
    if (href.includes('wa.me') || text.includes('whatsapp')) return 'whatsapp';
    if (href.includes('instagram')) return 'instagram';
    if (href.includes('linkedin')) return 'linkedin';
    if (href.includes('creditas')) return 'external_partner';
    if (el.closest('.cta')) return 'cta';
    if (el.closest('.button')) return 'button';
    return 'link';
  }
  
  // Expor funções globalmente para uso manual
  window.inspiracredAnalytics = {
    track: track,
    sessionId: SESSION_ID,
    
    // Tracking manual de eventos
    trackEvent: function(name, data) {
      track('event', { event_name: name, properties: data });
    },
    
    // Tracking manual de leads
    trackLead: function(data) {
      track('lead', data);
    }
  };
})();
</script>
```

#### 2.2 Adicionar Tracking Específico para Simulação

**No formulário de simulação (index.html), adicionar após a linha 494:**

```javascript
// Na função trackComplete, adicionar tracking
const trackComplete = (propertyValue, creditValue) => {
  if (hasCompletedSimulation) return;
  hasCompletedSimulation = true;
  
  // Enviar para analytics
  if (window.inspiracredAnalytics) {
    window.inspiracredAnalytics.trackEvent('simulation_complete', {
      valor_credito: creditValue,
      valor_imovel: propertyValue,
      tipo_imovel: state.propertyType.toLowerCase()
    });
  }
  
  // ... código existente
};
```

#### 2.3 Adicionar Tracking de Captura de Lead

**Na função submitLead (linha 649), adicionar após linha 683:**

```javascript
// Após enviar para CRM, enviar para analytics
await submitLead({ name, phone });

if (window.inspiracredAnalytics) {
  window.inspiracredAnalytics.trackLead({
    name: name,
    phone: phone,
    property_type: lastSimulation.propertyType,
    property_value: lastSimulation.propertyValue,
    credit_value: lastSimulation.creditValue,
    source: 'landing_page',
    ...getUtmParams()
  });
}
```

---

### FASE 3: Testes e Validação

#### 3.1 Testar Page Views
1. Abrir cada página do site
2. Verificar no navegador (Network tab) se requests para `/track` estão sendo enviados
3. Verificar no D1 Database se dados foram salvos

```bash
# Via Wrangler CLI
npx wrangler d1 execute inspiracred-analytics --command="SELECT * FROM page_views ORDER BY created_at DESC LIMIT 10"
```

#### 3.2 Testar Cliques
1. Clicar em vários botões/links
2. Verificar se eventos de clique estão sendo registrados
3. Validar se element_id e destination estão corretos

```bash
npx wrangler d1 execute inspiracred-analytics --command="SELECT * FROM clicks ORDER BY created_at DESC LIMIT 10"
```

#### 3.3 Testar Formulários
1. Preencher e submeter formulário de simulação
2. Verificar se evento de form_submit foi registrado
3. Validar se form_data contém informações esperadas

```bash
npx wrangler d1 execute inspiracred-analytics --command="SELECT * FROM form_submissions ORDER BY created_at DESC LIMIT 10"
```

#### 3.4 Testar Leads
1. Completar simulação e preencher lead form
2. Verificar se lead foi salvo corretamente
3. Validar todas as propriedades

```bash
npx wrangler d1 execute inspiracred-analytics --command="SELECT * FROM leads ORDER BY created_at DESC LIMIT 10"
```

---

### FASE 4: Dashboard e Monitoramento

#### 4.1 Criar Dashboard Cloudflare

**Opção A: Cloudflare Analytics Built-in**
- Ir para: https://dash.cloudflare.com/
- Selecionar domínio
- Navegar para "Analytics" → "Dashboard"
- Criar widgets customizados

**Opção B: Dashboard Customizado**
- Deploy do worker já expõe endpoint `/dashboard`
- Acessar: `https://seu-worker.workers.dev/dashboard`
- Integrar com visualização de dados (Chart.js, D3.js, etc.)

#### 4.2 Configurar Alertas

```bash
# Via Wrangler ou Cloudflare Dashboard
# Criar alertas para:
- Taxa de conversão < 5%
- Leads por dia = 0
- Error rate > 1%
```

#### 4.3 Criar Relatórios Agendados

- Configurar cron job para exportar métricas diárias
- Enviar resumo por email/Slack
- Gerar relatório semanal automático

---

## 🔒 Segurança e Privacidade

### LGPD Compliance
- ✅ IPs são hasheados (não armazenados em texto)
- ✅ Dados sensíveis não são coletados
- ✅ TTL configurável para retenção de dados
- ✅ Os dados podem ser excluídos sob solicitação

### Retenção de Dados
- **Page views**: 90 dias
- **Cliques**: 90 dias  
- **Formulários**: 365 dias
- **Leads**: Retenção permanente (CRM)

### Exclusão de Dados
```sql
-- Excluir sessão específica
DELETE FROM page_views WHERE session_id = 'sess_xxx';
DELETE FROM clicks WHERE session_id = 'sess_xxx';
DELETE FROM leads WHERE session_id = 'sess_xxx';
```

---

## 📊 Queries Úteis

### Visitantes Últimos 7 Dias
```sql
SELECT 
  DATE(created_at) as date,
  COUNT(DISTINCT session_id) as unique_visitors
FROM page_views
WHERE created_at >= datetime('now', '-7 days')
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

### Funil de Conversão Completo
```sql
WITH 
visitors AS (SELECT COUNT(DISTINCT session_id) as total FROM page_views),
sim_start AS (SELECT COUNT(DISTINCT session_id) as total FROM events WHERE event_name = 'simulation_start'),
sim_complete AS (SELECT COUNT(DISTINCT session_id) as total FROM events WHERE event_name = 'simulation_complete'),
leads AS (SELECT COUNT(DISTINCT session_id) as total FROM leads)
SELECT 
  visitors.total as visitors,
  sim_start.total as simulation_started,
  sim_complete.total as simulation_completed,
  leads.total as leads_captured,
  ROUND((sim_start.total * 100.0 / visitors.total), 2) as visitor_to_sim_rate,
  ROUND((sim_complete.total * 100.0 / sim_start.total), 2) as sim_to_complete_rate,
  ROUND((leads.total * 100.0 / sim_complete.total), 2) as complete_to_lead_rate,
  ROUND((leads.total * 100.0 / visitors.total), 2) as overall_conversion_rate
FROM visitors, sim_start, sim_complete, leads;
```

### Top Páginas por Views
```sql
SELECT 
  page_name,
  COUNT(*) as views,
  COUNT(DISTINCT session_id) as unique_visitors
FROM page_views
WHERE created_at >= datetime('now', '-7 days')
GROUP BY page_name
ORDER BY views DESC;
```

### Leads por Origem
```sql
SELECT 
  COALESCE(source, 'direct') as source,
  COUNT(*) as leads,
  AVG(property_value) as avg_property_value,
  AVG(credit_value) as avg_credit_value
FROM leads
WHERE created_at >= datetime('now', '-30 days')
GROUP BY source
ORDER BY leads DESC;
```

---

## 🆕 Adicionando Novas Páginas

Quando uma nova página for adicionada ao site, seguir processo em [`cloud.md`](cloud.md) seção "🆕 Instruções para IA: Adicionando Novas Páginas".

**Resumo:**
1. Adicionar tracking script à nova página
2. Atualizar `cloud.md` com mapeamento da página
3. Testar eventos de tracking
4. Adicionar widgets ao dashboard (se necessário)

---

## 🐛 Troubleshooting

### Eventos não aparecem no dashboard
- Verificar se Worker está deployado
- Validar se endpoints estão corretos
- Checar logs do Worker: `npx wrangler tail`

### Dados incorretos no D1
- Validar schema do banco
- Verificar tipos de dados
- Revisar lógica do Worker

### Performance impactada
- Usar KV cache para métricas agregadas
- Implementar rate limiting se necessário
- Considerar batch inserts para alto volume

---

## 📞 Suporte

**Documentação Cloudflare:**
- Workers: https://developers.cloudflare.com/workers/
- D1: https://developers.cloudflare.com/d1/
- KV: https://developers.cloudflare.com/kv/

**Repositório do Projeto:**
- GitHub: [link para repositório]
- Issues: [link para issues]

---

**Última atualização:** 06/07/2026  
**Status:** Pronto para implementação  
**Próximos passos:** Obter acesso Cloudflare do cliente