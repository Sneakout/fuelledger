# FuelNerve local shadow testing

This bridge is deliberately limited to one configured non-production organization and station. It exposes only signed reads, stores shadow output outside FuelNerve, and has no proposal or execution route.

## Start FuelNerve

Configure the same `NERVE_LOCAL_*` values in the FuelNerve `.env` and in the shell used to run Nerve. Then start FuelNerve locally:

```bash
cd "/Users/nandalalsivadas/Desktop/FuelNerve"
pnpm --filter @fuelledger/api dev
```

## Run the hidden shadow review

In another terminal:

```bash
cd "/Users/nandalalsivadas/Desktop/FuelNerve/nerve-agent-platform"
set -a
source "/Users/nandalalsivadas/Desktop/FuelNerve/.env"
set +a
npm run shadow:fuelnerve
```

The command runs Shift Review, Stock Watch, and month-to-date Profit Insight, resolves every evidence reference, tests cross-organization and cross-station denial, and simulates FuelNerve being offline. Its complete local report is written to `.local-shadow/latest.json` with owner-only file permissions.

## Manual comparison

Sign in to FuelNerve and use the evidence paths in the report to compare each result with the selected station's Reconciliation, Inventory, Purchases, Customers, and Reports screens. Record mismatches before enabling any visible finding. Do not enable proposals or actions during this stage.
