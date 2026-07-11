-- Schema do banco de analytics InspiraCred (Cloudflare D1 / SQLite)
-- Aplicar com: wrangler d1 execute inspiracred-analytics --remote --file=analytics/schema.sql

CREATE TABLE IF NOT EXISTS page_views (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  page_name   TEXT NOT NULL,
  url         TEXT,
  title       TEXT,
  referrer    TEXT,
  user_agent  TEXT,
  ip_hash     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views (created_at);
CREATE INDEX IF NOT EXISTS idx_page_views_page    ON page_views (page_name);

CREATE TABLE IF NOT EXISTS clicks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL,
  element_id    TEXT,
  element_text  TEXT,
  destination   TEXT,
  link_type     TEXT,
  page_name     TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_clicks_created ON clicks (created_at);
CREATE INDEX IF NOT EXISTS idx_clicks_page    ON clicks (page_name);

CREATE TABLE IF NOT EXISTS form_submissions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id         TEXT NOT NULL,
  form_id            TEXT,
  form_data          TEXT,
  success            INTEGER DEFAULT 1,
  completion_time_ms INTEGER,
  page_name          TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_forms_created ON form_submissions (created_at);

CREATE TABLE IF NOT EXISTS leads (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT,
  name           TEXT,
  phone          TEXT,
  email          TEXT,
  property_type  TEXT,
  property_value REAL,
  credit_value   REAL,
  source         TEXT,
  utm_source     TEXT,
  utm_medium     TEXT,
  utm_campaign   TEXT,
  utm_content    TEXT,
  utm_term       TEXT,
  -- Atribuição + status de entrega (RD Station / Meta CAPI) — adicionadas out-of-band
  -- em produção via ALTER TABLE; aqui só pra ambientes novos partirem já corretos.
  fbp            TEXT,
  fbc            TEXT,
  fbclid         TEXT,
  gclid          TEXT,
  event_id       TEXT,
  rd_status      TEXT,
  meta_status    TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  event_type  TEXT,
  event_name  TEXT NOT NULL,
  properties  TEXT,
  page_name   TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events (created_at);
CREATE INDEX IF NOT EXISTS idx_events_name    ON events (event_name);
