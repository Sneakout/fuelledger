ALTER TABLE "products" ADD COLUMN "pack_size_litres" DECIMAL(10,3);
ALTER TABLE "products" ADD CONSTRAINT "positive_pack_size" CHECK ("pack_size_litres" IS NULL OR "pack_size_litres" > 0);
