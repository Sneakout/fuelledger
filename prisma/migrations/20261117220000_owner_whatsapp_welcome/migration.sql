ALTER TYPE "OwnerNotificationType" ADD VALUE 'OWNER_WELCOME';
ALTER TABLE "organizations" ADD COLUMN "whatsapp_welcome_pending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ALTER COLUMN "whatsapp_welcome_pending" SET DEFAULT true;
