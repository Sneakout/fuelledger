CREATE OR REPLACE FUNCTION validate_inventory_ledger_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  station_organization_id text;
  linked_tank_station_id text;
  linked_tank_product_id text;
  product_requires_tank boolean;
BEGIN
  SELECT organization_id INTO station_organization_id
  FROM stations
  WHERE id = NEW.station_id;

  IF station_organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'Inventory movement organization and fuel station do not match';
  END IF;

  SELECT tank_linked INTO product_requires_tank
  FROM products
  WHERE id = NEW.product_id AND organization_id = NEW.organization_id;

  IF product_requires_tank IS NULL THEN
    RAISE EXCEPTION 'Inventory movement product does not belong to the organization';
  END IF;

  IF product_requires_tank AND NEW.tank_id IS NULL THEN
    RAISE EXCEPTION 'Tank-linked inventory movement requires a tank';
  END IF;

  IF NEW.tank_id IS NOT NULL THEN
    SELECT c.station_id, t.product_id
      INTO linked_tank_station_id, linked_tank_product_id
    FROM tanks t
    JOIN station_configurations c ON c.id = t.configuration_id
    WHERE t.id = NEW.tank_id;

    IF linked_tank_station_id IS DISTINCT FROM NEW.station_id
       OR linked_tank_product_id IS DISTINCT FROM NEW.product_id THEN
      RAISE EXCEPTION 'Inventory movement tank, product and fuel station do not match';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_ledger_scope_guard
BEFORE INSERT OR UPDATE OF organization_id, station_id, product_id, tank_id
ON inventory_ledger
FOR EACH ROW
EXECUTE FUNCTION validate_inventory_ledger_scope();
