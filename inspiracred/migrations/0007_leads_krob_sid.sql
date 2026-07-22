-- InspiraCred Analytics — liga cada lead à linha `sessions` (Fase A do plano de tracking).
-- `krob_sid` = cookie _krob_sid do visitante (setado no edge por functions/_middleware.js).
-- Permite o JOIN leads -> sessions pra puxar a origem CRUA (fbclid/gclid/UTMs) capturada
-- no primeiro acesso, e alimenta o painel de saúde do tracking (Fase B).
--
-- O código (_app.js, case "lead") grava isto num UPDATE próprio com try/catch: se a
-- coluna ainda não existir, só isso é ignorado — o resto do lead grava normal.
--
-- ⚠️ ALTER TABLE ADD COLUMN não aceita "IF NOT EXISTS" no SQLite/D1 — RODAR UMA VEZ SÓ.
-- Aplicar: bash .claude/cf.sh d1 execute inspiracred-analytics --remote --file=inspiracred/migrations/0007_leads_krob_sid.sql
-- (ou colar no Console SQL do painel Cloudflare > D1 > inspiracred-analytics)

ALTER TABLE leads ADD COLUMN krob_sid TEXT;
