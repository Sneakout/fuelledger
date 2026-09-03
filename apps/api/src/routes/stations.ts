import { Router } from 'express';
import { stationEquipmentSchema, stationProfileSchema, stationSetupDraftSchema, stationSetupSchema } from '@fuelledger/shared';
import { AppError } from '../lib/errors.js';
import { permittedStationIds, requireOwner } from '../lib/station-access.js';
import { authenticate } from '../middleware/authenticate.js';
import { createStation, getStationEquipment, getStationSetupDraft, listStations, saveStationSetupDraft, updateStationEquipment, updateStationProfile } from '../modules/stations/service.js';

export const stationsRouter = Router();
stationsRouter.use(authenticate);
stationsRouter.get('/', async (req, res) => res.json({ stations: await listStations(req.user!.organization.id, permittedStationIds(req.user!)) }));
stationsRouter.post('/', async (req, res) => {
  requireOwner(req.user!);
  const parsed = stationSetupSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'CONFIGURATION_INVALID', 'Please resolve the highlighted configuration issues.', parsed.error.flatten());
  res.status(201).json({ station: await createStation(req.user!.organization.id, parsed.data) });
});
stationsRouter.get('/:id/draft', async (req, res) => {
  requireOwner(req.user!);
  res.json({ draft: await getStationSetupDraft(req.user!.organization.id, req.params.id!) });
});
stationsRouter.put('/:id/draft', async (req, res) => {
  requireOwner(req.user!);
  const parsed = stationSetupDraftSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'DRAFT_INVALID', 'This draft could not be saved.');
  res.json({ draft: await saveStationSetupDraft(req.user!.organization.id, req.params.id!, parsed.data.setup) });
});
stationsRouter.get('/:id/equipment', async (req, res) => {
  requireOwner(req.user!);
  res.json(await getStationEquipment(req.user!.organization.id, req.params.id!));
});
stationsRouter.put('/:id/equipment', async (req, res) => {
  requireOwner(req.user!);
  const parsed = stationEquipmentSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'EQUIPMENT_INVALID', parsed.error.issues[0]?.message ?? 'Please review the equipment details.', parsed.error.flatten());
  res.json({ station: await updateStationEquipment(req.user!.organization.id, req.params.id!, parsed.data) });
});
stationsRouter.put('/:id', async (req, res) => {
  requireOwner(req.user!);
  const parsed = stationProfileSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'STATION_PROFILE_INVALID', 'Please complete the petrol pump details.', parsed.error.flatten());
  res.json({ station: await updateStationProfile(req.user!.organization.id, req.params.id!, parsed.data) });
});
