ALTER TABLE "organizations"
  ADD COLUMN "intelligence_enabled_at" TIMESTAMP(3),
  ADD COLUMN "intelligence_expires_at" TIMESTAMP(3),
  ADD COLUMN "subscription_plan" TEXT,
  ADD COLUMN "subscription_billing_period" TEXT,
  ADD COLUMN "subscription_price_paise" INTEGER,
  ADD COLUMN "subscription_activated_at" TIMESTAMP(3),
  ADD COLUMN "subscription_expires_at" TIMESTAMP(3);
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_subscription_plan_check" CHECK ("subscription_plan" IS NULL OR "subscription_plan" IN ('CORE', 'CORE_INTELLIGENCE')),
  ADD CONSTRAINT "organizations_subscription_billing_period_check" CHECK ("subscription_billing_period" IS NULL OR "subscription_billing_period" IN ('MONTHLY', 'YEARLY', 'LIFETIME', 'FOUNDING_YEARLY')),
  ADD CONSTRAINT "organizations_subscription_price_check" CHECK ("subscription_price_paise" IS NULL OR "subscription_price_paise" >= 0);
