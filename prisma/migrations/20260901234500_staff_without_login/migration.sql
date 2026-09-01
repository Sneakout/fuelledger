ALTER TABLE "users" ADD COLUMN "login_enabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "users"
SET "login_enabled" = false
WHERE "role" = 'STAFF';
