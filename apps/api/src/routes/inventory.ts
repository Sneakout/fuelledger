import { densityReadingInputSchema, inventoryAdjustmentSchema, tankReadingInputSchema } from '@fuelledger/shared';
import { Router } from 'express';
import { AppError } from '../lib/errors.js';
import { safeSaveContext } from '../lib/safe-save.js';
import { assertStationAccess, permittedStationIds } from '../lib/station-access.js';
import { authenticate } from '../middleware/authenticate.js';
import { adjust, bootstrap, recordDensity, recordTankReading } from '../modules/inventory/service.js';

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);
inventoryRouter.use(safeSaveContext);

inventoryRouter.get('/bootstrap', async (req, res) => res.json(await bootstrap(req.user!.organization.id, permittedStationIds(req.user!))));

inventoryRouter.post('/adjustments', async (req, res) => {
  const parsed = inventoryAdjustmentSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'ADJUSTMENT_INVALID', 'Please enter a valid stock adjustment.', parsed.error.flatten());
  assertStationAccess(req.user!, parsed.data.stationId);
  res.status(201).json({ entry: await adjust(req.user!.organization.id, req.user!.id, parsed.data) });
});

inventoryRouter.post('/tank-readings', async (req, res) => {
  const parsed = tankReadingInputSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'READING_INVALID', 'Please enter a valid physical tank reading.', parsed.error.flatten());
  assertStationAccess(req.user!, parsed.data.stationId);
  res.status(201).json({ reading: await recordTankReading(req.user!.organization.id, req.user!.id, parsed.data) });
});

inventoryRouter.post('/density-readings', async (req, res) => {
  const parsed = densityReadingInputSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'DENSITY_INVALID', 'Enter a valid fuel density.', parsed.error.flatten());
  assertStationAccess(req.user!, parsed.data.stationId);
  res.status(201).json({ reading: await recordDensity(req.user!.organization.id, req.user!.id, parsed.data) });
});
