-- InspiraCred Analytics — colunas de SAÚDE DO TRACKING na tabela `leads` (Fase B).
-- Diagnóstico por lead, inspirado no event_log do krob-tracking-stack (tracker.js):
--   fbclid_source        = 'url' (veio da URL do lead) | 'session' (recuperado da
--                          linha sessions do 1º acesso) | 'none'
--   pixel_was_blocked    = 1 se o navegador não mandou NENHUM _fbp/_fbc no lead
--                          (Meta cookie ausente no submit — 1ª visita sem cookie / bloqueio)
--   itp_cookie_extended  = 1 se o fbp/fbc usado na CAPI veio do cookie de edge OU da
--                          sessão (NÃO do body do navegador) — prova o resgate ITP-safe
--                          do nosso middleware 400d (o Safari teria cortado o do Pixel)
--   is_bot / bot_reason  = crawler barrado (WhatsApp/Slack/Facebook/curl/headless…):
--                          lead salvo aqui pra estatística mas NÃO enviado à CAPI
--   browser / os / is_mobile = UA parseado
--   has_email/phone/name = cobertura de PII (o Meta usa no Advanced Matching)
--
-- O código (_app.js, case "lead") grava num UPDATE próprio com try/catch: se as colunas
-- ainda não existirem, só isso é ignorado — o resto do lead grava normal.
--
-- ⚠️ ALTER TABLE ADD COLUMN não aceita "IF NOT EXISTS" no SQLite/D1 — RODAR UMA VEZ SÓ.
-- Aplicar: colar no Console SQL do painel Cloudflare > D1 > inspiracred-analytics
-- (o cf.sh é bloqueado pelo classificador do harness pra SQL de escrita).

ALTER TABLE leads ADD COLUMN fbclid_source TEXT;
ALTER TABLE leads ADD COLUMN pixel_was_blocked INTEGER;
ALTER TABLE leads ADD COLUMN itp_cookie_extended INTEGER;
ALTER TABLE leads ADD COLUMN is_bot INTEGER;
ALTER TABLE leads ADD COLUMN bot_reason TEXT;
ALTER TABLE leads ADD COLUMN browser TEXT;
ALTER TABLE leads ADD COLUMN os TEXT;
ALTER TABLE leads ADD COLUMN is_mobile INTEGER;
ALTER TABLE leads ADD COLUMN has_email INTEGER;
ALTER TABLE leads ADD COLUMN has_phone INTEGER;
ALTER TABLE leads ADD COLUMN has_name INTEGER;
