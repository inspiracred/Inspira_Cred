# Requisitos de Acesso Cloudflare - InspiraCred

## 🎯 Objetivo

Implementar um sistema completo de analytics e tracking no site InspiraCred através da Cloudflare, permitindo monitorar todas as interações dos usuários, cliques e conversões em tempo real.

---

## 📋 Checklist de Acesso Necessário

### 1. **Acesso ao Cloudflare Dashboard**

Preciso que o cliente forneça acesso à conta Cloudflare com as seguintes permissões:

#### Nível de Acesso Recomendado: **Administrator** ou **Developer**

**Permissões Específicas Necessárias:**
- ✅ **Workers Scripts** - Full Access
  - Criar/editar/deletar Workers
  - Configurar variáveis de ambiente
  - Deploy de novos Workers
  
- ✅ **D1 Database** - Full Access
  - Criar/editar databases
  - Executar queries SQL
  - Gerenciar schemas
  
- ✅ **KV Storage** - Full Access
  - Criar/editar namespaces
  - Ler/gravar dados
  - Gerenciar TTL
  
- ✅ **R2 Storage** (opcional) - Full Access
  - Criar buckets
  - Upload/download arquivos
  - Gerenciar ciclo de vida
  
- ✅ **Analytics** - Read Access
  - Visualizar métricas
  - Criar dashboards customizados
  - Exportar dados
  
- ✅ **Pages** - Full Access
  - Gerenciar projetos
  - Configurar domínios
  - Deploy automático
  
- ✅ **DNS** - Edit Access
  - Criar/editar registros DNS
  - Configurar subdomínios

---

## 🔐 Como Conceder Acesso

### Opção 1: Convite por Email (RECOMENDADO)

**Passo a passo para o cliente:**

1. **Acessar Cloudflare Dashboard**
   - Ir para: https://dash.cloudflare.com/
   - Login com a conta do cliente

2. **Navegar até configurações de equipe**
   - Clique no domínio principal (inspiracred.com.br)
   - Vá para "Manage Account" → "Members"

3. **Adicionar novo membro**
   - Clique em "Add a member"
   - Email para adicionar: `[SEU_EMAIL]`
   - Selecione role: "Administrator" ou "Developer"
   - Marque as permissões específicas acima
   - Enviar convite

4. **Confirmar acesso**
   - Aceitar o email de convite
   - Configurar autenticação de 2 fatores
   - Verificar acesso aos recursos necessários

### Opção 2: API Token (Alternativa)

Se preferir, o cliente pode criar um API Token com permissões específicas:

**Token template necessário:**
```json
{
  "name": "InspiraCred Analytics Token",
  "permissions": {
    "Workers Scripts": ["Edit", "Create", "Delete"],
    "D1 Database": ["Edit", "Create", "Delete"],
    "KV Storage": ["Edit", "Create", "Delete"],
    "Analytics": ["Read"],
    "Pages": ["Edit"],
    "DNS": ["Edit"]
  },
  "resources": {
    "com.cloudflare.api.account.zone.123456": "*" 
  }
}
```

---

## 🛠️ Tecnologias Cloudflare que Serão Usadas

### 1. **Cloudflare Workers** 
**Objetivo:** Processar e rotear eventos de analytics

**Estrutura do Worker:**
```javascript
// analytics-worker.js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname === '/track') {
      // Processar evento de tracking
      const event = await request.json();
      await saveEvent(event, env);
      return Response.json({ success: true });
    }
    
    if (url.pathname === '/dashboard') {
      // Servir dashboard
      return renderDashboard(env);
    }
  }
}
```

### 2. **Cloudflare D1 Database**
**Objetivo:** Armazenar eventos de analytics de forma estruturada

**Schema do Banco:**
```sql
-- Tabela de page_views
CREATE TABLE page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  page_name TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  referrer TEXT,
  user_agent TEXT,
  ip_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session (session_id),
  INDEX idx_page (page_name),
  INDEX idx_created (created_at)
);

-- Tabela de events
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  event_type TEXT NOT NULL,
  event_name TEXT NOT NULL,
  properties TEXT, -- JSON
  page_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_event_type (event_type),
  INDEX idx_session (session_id),
  INDEX idx_created (created_at)
);

-- Tabela de clicks
CREATE TABLE clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  element_id TEXT,
  element_text TEXT,
  destination TEXT,
  link_type TEXT,
  page_name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session (session_id),
  INDEX idx_page (page_name),
  INDEX idx_element (element_id)
);

-- Tabela de form_submissions
CREATE TABLE form_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  form_id TEXT NOT NULL,
  form_data TEXT, -- JSON
  success BOOLEAN,
  completion_time_ms INTEGER,
  page_name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session (session_id),
  INDEX idx_form (form_id),
  INDEX idx_page (page_name)
);

-- Tabela de leads
CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  name TEXT,
  phone TEXT,
  email TEXT,
  property_type TEXT,
  property_value REAL,
  credit_value REAL,
  source TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session (session_id),
  INDEX idx_source (source),
  INDEX idx_created (created_at)
);
```

### 3. **Cloudflare KV Storage**
**Objetivo:** Cache de métricas agregadas e sessões

**Uso:**
- `session:{session_id}` - Dados da sessão do usuário
- `metrics:{date}` - Métricas agregadas do dia
- `funnel:{step}` - Dados do funil de conversão

### 4. **Cloudflare Analytics**
**Objetivo:** Visualização de métricas em tempo real

**Widgets a criar:**
- Page Views por página
- Taxa de conversão
- Mapa de calor de cliques
- Funil de conversão completo
- Métricas de formulários
- Origem de tráfego

---

## 📊 Arquitetura do Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                     USUÁRIO NAVEGA                          │
│                  (inspiracred.com.br)                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ 1. Page View / Click / Form Submit
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              FRONTEND TRACKING SCRIPT                       │
│  - Captura eventos de usuário                             │
│  - Envia para Cloudflare Worker                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ POST /track
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              CLOUDFLARE WORKER                             │
│  - Valida e processa eventos                              │
│  - Enrichment com dados de sessão                         │
│  - Roteia para armazenamento                              │
└──────┬───────────────────────────────────────────┬──────────┘
       │                                           │
       ▼                                           ▼
┌──────────────────┐                    ┌──────────────────────┐
│  D1 DATABASE     │                    │   KV STORAGE          │
│  - page_views    │                    │   - Sessions         │
│  - events       │                    │   - Metrics Cache     │
│  - clicks       │                    │   - Real-time counters│
│  - forms        │                    └──────────────────────┘
│  - leads        │
└──────┬──────────┘
       │
       │ Queries SQL
       ▼
┌─────────────────────────────────────────────────────────────┐
│              DASHBOARD DE ANALYTICS                         │
│  - Métricas em tempo real                                  │
│  - Funis de conversão                                      │
│  - Mapas de calor                                          │
│  - Relatórios automáticos                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Plano de Implementação

### Fase 1: Setup e Configuração (1-2 horas)
1. ✅ Receber acesso Cloudflare
2. ✅ Criar D1 Database
3. ✅ Executar schema SQL
4. ✅ Criar KV namespace
5. ✅ Deploy do Analytics Worker

### Fase 2: Integração Frontend (2-3 horas)
1. ✅ Adicionar script de tracking em todas as páginas
2. ✅ Implementar captura de eventos
3. ✅ Testar eventos de page view
4. ✅ Testar eventos de clique
5. ✅ Testar eventos de formulário

### Fase 3: Dashboard Creation (3-4 horas)
1. ✅ Criar widgets principais
2. ✅ Configurar funis de conversão
3. ✅ Criar alertas automáticos
4. ✅ Configurar relatórios agendados

### Fase 4: Testing e Optimization (1-2 horas)
1. ✅ Validar todos os eventos
2. ✅ Verificar qualidade de dados
3. ✅ Otimizar performance
4. ✅ Documentar processo

---

## 📧 Informações para Contato

### Para o Cliente:

**Por favor, forneça:**
1. ✅ Acesso ao Cloudflare Dashboard (conforme instruções acima)
2. ✅ Email do contato principal
3. ✅ Preferência de nível de acesso (Administrator ou Developer)
4. ✅ Restrições ou preocupações específicas

**Dúvidas sobre segurança?**
- Todos os dados são armazenados em conformidade com LGPD
- IPs são hasheados para privacidade
- Dados sensíveis são criptografados
- Retenção de dados pode ser configurada

---

## 📞 Próximos Passos

1. **Cliente concede acesso** → Recebo confirmação
2. **Recebo credenciais** → Valido acesso
3. **Implemento sistema** → Realizo deploy
4. **Testo integração** → Valido funcionamento
5. **Entrego dashboard** → Cliente começa a usar

---

**Tempo estimado total:** 6-10 horas
**Custo estimado Cloudflare:** $0-20/mês (plano gratuito)

---

**Última atualização:** 06/07/2026  
**Status:** Aguardando acesso Cloudflare  
**Responsável:** IA Assistant