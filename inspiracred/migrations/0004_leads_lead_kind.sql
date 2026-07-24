-- InspiraCred Analytics — coluna `lead_kind` na tabela `leads`.
-- Classifica cada lead do formulário Home Equity pelo que foi respondido:
--   home_equity      -> tem imóvel + matrícula + crédito >= R$ 200 mil + imóvel >= R$ 400 mil
--   home_equity_mql  -> tem imóvel + matrícula + crédito >= R$ 500 mil + imóvel >= R$ 1 milhão
--   baixo_valor      -> crédito < R$ 200 mil, imóvel < R$ 400 mil ou documentação fora do padrão
--   auto             -> não tem imóvel, mas tem automóvel (garantia de veículo, funil separado)
-- (quem não tem imóvel nem automóvel é descarte: salva no D1, mas não vai ao RD/Meta.)
--
-- O código (_app.js, case "lead") grava isto num UPDATE PRÓPRIO com try/catch: se a
-- coluna ainda não existir, só o lead_kind é ignorado — o resto do lead é gravado
-- normalmente. Dá pra deployar o código antes ou depois desta migration.
--
-- ⚠️ ALTER TABLE ADD COLUMN não aceita "IF NOT EXISTS" no SQLite/D1 — RODAR UMA VEZ SÓ.
-- Aplicar: bash .claude/cf.sh d1 execute inspiracred-analytics --remote --file=inspiracred/migrations/0004_leads_lead_kind.sql
-- (ou colar no Console SQL do painel Cloudflare > D1 > inspiracred-analytics)

ALTER TABLE leads ADD COLUMN lead_kind TEXT;  -- home_equity | home_equity_mql | baixo_valor | auto
