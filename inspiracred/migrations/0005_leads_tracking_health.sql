-- InspiraCred Analytics — colunas de "saúde do tracking" na tabela `leads`.
-- Registra de onde vieram o _fbp/_fbc usados na CAPI, pra diagnosticar sem
-- adivinhar (inspirado no padrão de github.com/gustavokrob/krob-tracking-stack,
-- ver CLAUDE.md "Referência de tracking"):
--   fbp_source / fbc_source = 'edge_cookie' (veio do cookie 400d setado pelo
--     nosso functions/_middleware.js) | 'none' (cookie ausente — bloqueado ou
--     1ª request antes do middleware existir)
--
-- O código (_app.js, case "lead") grava isto num UPDATE próprio com try/catch:
-- se a coluna ainda não existir, só isso é ignorado — o resto do lead grava normal.
--
-- ⚠️ ALTER TABLE ADD COLUMN não aceita "IF NOT EXISTS" no SQLite/D1 — RODAR UMA VEZ SÓ.
-- Aplicar: bash .claude/cf.sh d1 execute inspiracred-analytics --remote --file=inspiracred/migrations/0005_leads_tracking_health.sql
-- (ou colar no Console SQL do painel Cloudflare > D1 > inspiracred-analytics)

ALTER TABLE leads ADD COLUMN fbp_source TEXT;
ALTER TABLE leads ADD COLUMN fbc_source TEXT;
