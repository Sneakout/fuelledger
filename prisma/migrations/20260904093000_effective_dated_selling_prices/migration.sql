CREATE TABLE "product_selling_prices" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "effective_from" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_selling_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_selling_prices_product_id_effective_from_key"
  ON "product_selling_prices"("product_id", "effective_from");
CREATE INDEX "product_selling_prices_product_id_effective_from_idx"
  ON "product_selling_prices"("product_id", "effective_from");
ALTER TABLE "product_selling_prices"
  ADD CONSTRAINT "product_selling_prices_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "product_selling_prices" ("id", "product_id", "price", "effective_from")
SELECT CONCAT('price_', "id"), "id", "selling_price", "created_at"
FROM "products";
