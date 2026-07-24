-- InspiraCred Analytics — tabela `rd_sales`: FATURAMENTO vindo do RD Station CRM.
-- Cada linha = um disparo do webhook do RD (Negociação mudou de etapa / foi ganha).
-- O endpoint /analytics/rd-webhook (functions/analytics/_app.js -> handleRdWebhook)
-- grava aqui, guardando SEMPRE o payload cru em `raw` (não sabemos o shape exato que o
-- RD manda até a 1ª venda real chegar) + os campos que conseguimos parsear best-effort.
--
--   deal_id/deal_name = identificador e nome da Negociação no RD
--   stage             = etapa/funil (ex.: "Ganha", "Vendido")
--   value             = valor da venda (best-effort; pode vir null e ser corrigido depois)
--   won               = 1 se a etapa/status indica venda ganha
--   contact_email/phone = contato da negociação (usado pra casar com nosso lead)
--   matched_lead_id   = id do lead no D1 que bateu por e-mail/telefone (pode ser null)
--   raw               = JSON cru do webhook (até 8000 chars) — fonte de verdade
--
-- CREATE TABLE IF NOT EXISTS -> idempotente, seguro rodar mais de uma vez.
-- Aplicar: colar no Console SQL do painel Cloudflare > D1 > inspiracred-analytics
-- (o cf.sh é bloqueado pelo classificador do harness pra SQL de escrita).

CREATE TABLE IF NOT EXISTS rd_sales (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id        TEXT,
  deal_name      TEXT,
  stage          TEXT,
  value          REAL,
  won            INTEGER DEFAULT 0,
  contact_email  TEXT,
  contact_phone  TEXT,
  matched_lead_id INTEGER,
  raw            TEXT,
  received_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

CREATE INDEX IF NOT EXISTS idx_rd_sales_received ON rd_sales (received_at);
CREATE INDEX IF NOT EXISTS idx_rd_sales_deal ON rd_sales (deal_id);
