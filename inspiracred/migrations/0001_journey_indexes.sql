-- InspiraCred Analytics — índices p/ reconstruir a jornada por session_id (Fase 1)
-- Aplicar: bash .claude/cf.sh d1 execute inspiracred-analytics --remote --file=inspiracred/migrations/0001_journey_indexes.sql
-- Idempotente (IF NOT EXISTS). Não é segredo — versionado no git.

CREATE INDEX IF NOT EXISTS idx_page_views_session   ON page_views(session_id);
CREATE INDEX IF NOT EXISTS idx_clicks_session        ON clicks(session_id);
CREATE INDEX IF NOT EXISTS idx_events_session        ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_form_subs_session     ON form_submissions(session_id);
