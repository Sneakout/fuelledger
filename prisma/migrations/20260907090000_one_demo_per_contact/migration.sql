CREATE TABLE "demo_access_claims" (
  "contact" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "first_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "demo_access_claims_pkey" PRIMARY KEY ("contact")
);

INSERT INTO "demo_access_claims" ("contact", "kind", "first_used_at")
SELECT CASE
  WHEN "contact" LIKE '%@%' THEN LOWER(TRIM("contact"))
  WHEN LENGTH(REGEXP_REPLACE("contact", '\\D', '', 'g')) = 10 THEN '91' || REGEXP_REPLACE("contact", '\\D', '', 'g')
  ELSE REGEXP_REPLACE("contact", '\\D', '', 'g')
END, MIN("kind"), MIN("created_at")
FROM "demo_sessions"
GROUP BY CASE
  WHEN "contact" LIKE '%@%' THEN LOWER(TRIM("contact"))
  WHEN LENGTH(REGEXP_REPLACE("contact", '\\D', '', 'g')) = 10 THEN '91' || REGEXP_REPLACE("contact", '\\D', '', 'g')
  ELSE REGEXP_REPLACE("contact", '\\D', '', 'g')
END
ON CONFLICT ("contact") DO NOTHING;
