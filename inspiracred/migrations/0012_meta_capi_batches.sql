-- Auditoria técnica agregada. Sem payload, eventos sensíveis ou dados de contato.
CREATE TABLE IF NOT EXISTS meta_capi_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  sent_count INTEGER CHECK(sent_count BETWEEN 0 AND 1000),
  http_status INTEGER CHECK(http_status BETWEEN 100 AND 599),
  events_received INTEGER CHECK(events_received BETWEEN 0 AND 1000),
  error_code INTEGER CHECK(error_code BETWEEN 0 AND 2147483647),
  error_subcode INTEGER CHECK(error_subcode BETWEEN 0 AND 2147483647),
  outcome TEXT NOT NULL CHECK(outcome IN ('network_error','invalid_response','http_error','api_error','count_unknown','count_mismatch','batch_reported')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meta_capi_batches_lead ON meta_capi_batches(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_meta_capi_batches_retention ON meta_capi_batches(created_at);
