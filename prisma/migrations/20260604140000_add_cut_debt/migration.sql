-- Add "deuda al corte" column
ALTER TABLE "accounts" ADD COLUMN "cutDebt" DECIMAL(15,2);

-- Backfill existing credit cards: assume current balance equals the cut debt
UPDATE "accounts" SET "cutDebt" = "currentBalance" WHERE "type" = 'CREDIT';
