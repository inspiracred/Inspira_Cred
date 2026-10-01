-- Registra o resultado do envio de cada etapa para a Meta.
-- A deduplicacao considera somente linhas com meta_status='ok', permitindo que
-- uma tentativa antes bloqueada ou sem chave de correspondencia seja reenviada.

ALTER TABLE rd_sales ADD COLUMN meta_status TEXT;
CREATE INDEX IF NOT EXISTS idx_rd_sales_meta_stage
  ON rd_sales (deal_id, stage, meta_status);
