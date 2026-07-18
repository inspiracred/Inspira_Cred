-- InspiraCred Analytics — colunas qualificadoras na tabela `leads`.
-- Guarda no NOSSO D1 os campos que hoje só iam pro RD (para o dado "bater" entre
-- formulário / Meta / D1 / RD). O código (_app.js, case "lead") faz um UPDATE
-- resiliente (try/catch): se estas colunas ainda não existirem, ele ignora sem
-- quebrar a captura do lead — então dá pra deployar o código antes ou depois desta
-- migration. Depois de aplicada, os campos passam a ser gravados nos leads NOVOS.
--
-- ⚠️ ALTER TABLE ADD COLUMN não aceita "IF NOT EXISTS" no SQLite/D1 — RODAR UMA VEZ SÓ.
-- Aplicar: bash .claude/cf.sh d1 execute inspiracred-analytics --remote --file=inspiracred/migrations/0003_leads_qualificadores.sql
-- (ou colar no Console SQL do painel Cloudflare > D1 > inspiracred-analytics)

ALTER TABLE leads ADD COLUMN imovel_quitado   TEXT;  -- landing "está quitado?" / HE "situação" -> Sim/Não
ALTER TABLE leads ADD COLUMN documentacao_ok  TEXT;  -- landing "documentação regularizada?" (Sim/Não)
ALTER TABLE leads ADD COLUMN situacao_imovel  TEXT;  -- HE "situação do imóvel" (Quitado/Financiado)
ALTER TABLE leads ADD COLUMN saldo_devedor    TEXT;  -- landing (quando não quitado)
ALTER TABLE leads ADD COLUMN possui_imovel    TEXT;  -- multi-step (Sim/Não)
ALTER TABLE leads ADD COLUMN possui_matricula TEXT;  -- multi-step (Sim/Não)
ALTER TABLE leads ADD COLUMN faixa_credito    TEXT;  -- multi-step (faixa legível)
ALTER TABLE leads ADD COLUMN city             TEXT;  -- multi-step (cidade)
