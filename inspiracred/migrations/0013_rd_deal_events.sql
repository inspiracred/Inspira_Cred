-- Eventos mínimos do webhook crm_deal_created.
-- Sem payload bruto, contato, telefone, e-mail, imóvel, crédito ou valor financeiro.
-- Aplicar: bash .claude/cf.sh d1 execute inspiracred-analytics --remote --file=inspiracred/migrations/0013_rd_deal_events.sql

CREATE TABLE IF NOT EXISTS rd_deal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_uuid TEXT NOT NULL UNIQUE,
  deal_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  origin_field_id TEXT,
  origin_field_label TEXT,
  origin_value TEXT,
  pipeline_id TEXT,
  stage_id TEXT,
  eligible INTEGER NOT NULL DEFAULT 0,
  action_status TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  error_code TEXT,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  annotated_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_rd_deal_events_deal ON rd_deal_events(deal_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_rd_deal_events_status ON rd_deal_events(action_status, received_at DESC);
