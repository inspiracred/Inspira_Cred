-- InspiraCred Analytics — tabela de toques/cliques p/ o mapa de calor (Fase 3)
-- Coordenadas em PERCENTUAL do documento inteiro (responsivo).
-- Aplicar: bash .claude/cf.sh d1 execute inspiracred-analytics --remote --file=inspiracred/migrations/0002_heatmap_taps.sql

CREATE TABLE IF NOT EXISTS heatmap_taps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  page_name   TEXT NOT NULL,
  x_pct       REAL NOT NULL,   -- clientX / innerWidth        (0..1)
  y_pct       REAL NOT NULL,   -- (scrollY+clientY)/docHeight (0..1 do doc inteiro)
  vw          INTEGER,         -- innerWidth no momento (referência)
  doc_h       INTEGER,         -- scrollHeight do doc (referência)
  element_id  TEXT,            -- id do alvo, se houver (correlação com clicks)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_heatmap_page_created ON heatmap_taps(page_name, created_at);
