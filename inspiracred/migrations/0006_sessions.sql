-- InspiraCred Analytics — tabela `sessions` (Fase A do plano de tracking).
-- Identidade de sessão SERVER-SIDE: uma linha por visitante, chaveada pelo
-- cookie `_krob_sid` (setado no edge por functions/_middleware.js). O middleware
-- faz UPSERT nesta linha em TODO acesso de página, capturando os identificadores
-- de atribuição CRUS (fbclid/gclid/msclkid) e as UTMs já no primeiro acesso —
-- antes de o navegador "limpar" a URL. O case "lead" do _app.js depois lê esta
-- linha por `_krob_sid` pra enriquecer o lead com a origem crua (fonte de verdade).
-- Espelha o essencial de github.com/gustavokrob/krob-tracking-stack (docs/schema.md
-- seção `sessions`), SEM as colunas de venda/checkout que não usamos (lead-gen).
--
-- CREATE TABLE IF NOT EXISTS -> idempotente, seguro rodar mais de uma vez.
-- Aplicar: bash .claude/cf.sh d1 execute inspiracred-analytics --remote --file=inspiracred/migrations/0006_sessions.sql
-- (ou colar no Console SQL do painel Cloudflare > D1 > inspiracred-analytics)

CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT PRIMARY KEY,   -- = cookie _krob_sid (UUID)
  external_id  TEXT,               -- = cookie _krob_eid (UUID) -> Meta Advanced Matching external_id
  fbclid       TEXT,               -- valor CRU da URL (não decodificado)
  gclid        TEXT,               -- Google Ads click id
  msclkid      TEXT,               -- Microsoft Ads click id
  fbc          TEXT,               -- fb.{subdomainIndex}.{ts}.{fbclid}
  fbp          TEXT,               -- fb.{subdomainIndex}.{ts}.{random}
  ip_address   TEXT,               -- cf-connecting-ip
  user_agent   TEXT,
  referrer     TEXT,               -- header Referer
  landing_url  TEXT,               -- URL completa do primeiro acesso
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  utm_content  TEXT,
  utm_term     TEXT,
  created_at   INTEGER,            -- Unix seconds, primeiro acesso
  updated_at   INTEGER             -- Unix seconds, último acesso
);

CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions (created_at);
