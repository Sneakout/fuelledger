-- Additive only: existing cash balances and accounting records remain unchanged.
ALTER TABLE "shifts" ADD COLUMN "opening_cash_handover" JSONB;
