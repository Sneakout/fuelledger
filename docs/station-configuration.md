# Station configuration

Milestone 1 models arbitrary products, tanks, dispensers, nozzles, and many-to-many physical mappings. Equipment counts and product types remain configurable. A nozzle can connect to one or more compatible tanks; validation prevents incompatible product mappings, duplicate IDs, capacity violations, and orphan references.

Configuration changes that alter historical meaning use effective-dated versions. The initial wizard publishes version 1; future editing will close the active version and create a successor rather than overwrite it. Transactions will reference the version active at the time rather than being reinterpreted after a station changes.

Milestone 12 treats each configured station as an independently secured outlet within its organization. Owners can assign managers and staff to any combination of active outlets; equipment, shifts, inventory, sales, and reconciliations remain station-owned and are filtered through those assignments.
