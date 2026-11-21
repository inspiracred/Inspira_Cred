-- Chave opaca da tentativa do formulário de Parceiros. Mantém cadastros antigos válidos.
ALTER TABLE leads ADD COLUMN partner_submission_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_partner_submission_id
  ON leads(partner_submission_id) WHERE partner_submission_id IS NOT NULL;
