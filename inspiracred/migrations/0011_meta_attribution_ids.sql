-- Atribuicao estavel Meta Ads.
--
-- Os nomes de campanha/conjunto/anuncio podem mudar. Estes IDs atravessam o clique
-- do anuncio, a sessao, o lead e o dashboard sem depender do rotulo atual.
-- Aplicar ANTES do deploy do codigo que passa a gravar as novas colunas.

ALTER TABLE sessions ADD COLUMN meta_campaign_id TEXT;
ALTER TABLE sessions ADD COLUMN meta_adset_id TEXT;
ALTER TABLE sessions ADD COLUMN meta_ad_id TEXT;

ALTER TABLE leads ADD COLUMN meta_campaign_id TEXT;
ALTER TABLE leads ADD COLUMN meta_adset_id TEXT;
ALTER TABLE leads ADD COLUMN meta_ad_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_meta_campaign
  ON sessions (meta_campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_meta_campaign
  ON leads (meta_campaign_id);

-- Ponte somente para dados historicos que nasceram antes da captura dos IDs.
-- A UTM original continua intacta; a tabela serve apenas para conciliacao visual.
CREATE TABLE IF NOT EXISTS meta_campaign_aliases (
  raw_name       TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  campaign_id    TEXT,
  note           TEXT,
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

INSERT INTO meta_campaign_aliases (raw_name, canonical_name, note)
VALUES (
  '[Leads_LP]_03/09',
  '[Leads_LP]_04/09',
  'Campanha renomeada; conciliacao historica solicitada em 2026-10-07'
)
ON CONFLICT(raw_name) DO UPDATE SET
  canonical_name = excluded.canonical_name,
  note = excluded.note,
  updated_at = strftime('%Y-%m-%d %H:%M:%S','now');
