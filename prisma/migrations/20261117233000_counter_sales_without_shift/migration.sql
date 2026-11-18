ALTER TABLE "sales" ALTER COLUMN "shift_id" DROP NOT NULL;
ALTER TABLE "sales" ADD CONSTRAINT "metered_sale_requires_shift"
  CHECK ("kind" <> 'METERED' OR "shift_id" IS NOT NULL);
