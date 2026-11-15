import { Router } from 'express';
import { z } from 'zod';
import { historicalSalesImportSchema } from '@fuelledger/shared';
import { AppError } from '../lib/errors.js';
import { assertStationAccess, requireOwner } from '../lib/station-access.js';
import { authenticate } from '../middleware/authenticate.js';
import { createHistoricalImport, historicalImportSetup, historicalImportSource, listHistoricalImports, validateHistoricalRows } from '../modules/historical-sales/service.js';
import { classifyFuelDocument, extractHistoricalDsr } from '../modules/historical-sales/extractor.js';
import { requireIntelligenceAccess } from '../modules/intelligence/daily-briefing.js';

export const historicalSalesRouter = Router();
historicalSalesRouter.use(authenticate);

historicalSalesRouter.get('/setup', async (req, res) => {
  const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : '';
  if (!stationId) throw new AppError(400, 'STATION_REQUIRED', 'Choose a fuel station.');
  assertStationAccess(req.user!, stationId);
  res.json(await historicalImportSetup(req.user!.organization.id, stationId));
});

historicalSalesRouter.get('/', async (req, res) => {
  const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : '';
  if (!stationId) throw new AppError(400, 'STATION_REQUIRED', 'Choose a fuel station.');
  assertStationAccess(req.user!, stationId);
  res.json({ imports: await listHistoricalImports(req.user!.organization.id, stationId) });
});

historicalSalesRouter.post('/extract', async (req, res) => {
  requireOwner(req.user!);
  await requireIntelligenceAccess(req.user!.organization.id);
  const parsed = z.object({
    stationId: z.string().cuid(), productId: z.string().cuid(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    sourceFileName: z.string().trim().min(1).max(180), sourceMimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    sourceSize: z.coerce.number().int().positive().max(5 * 1024 * 1024), sourceContentBase64: z.string().min(1),
  }).strict().safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'DSR_SOURCE_INVALID', parsed.error.issues[0]?.message ?? 'Attach a valid DSR scan.');
  assertStationAccess(req.user!, parsed.data.stationId);
  const bytes = Buffer.from(parsed.data.sourceContentBase64, 'base64');
  if (bytes.byteLength !== parsed.data.sourceSize) throw new AppError(400, 'DSR_SOURCE_INVALID', 'The DSR attachment could not be verified. Attach it again.');
  res.json(await extractHistoricalDsr({ organizationId: req.user!.organization.id, ...parsed.data }));
});

historicalSalesRouter.post('/classify-document', async (req, res) => {
  requireOwner(req.user!);
  await requireIntelligenceAccess(req.user!.organization.id);
  const parsed = z.object({ sourceFileName: z.string().trim().min(1).max(180), sourceMimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']), sourceSize: z.coerce.number().int().positive().max(5 * 1024 * 1024), sourceContentBase64: z.string().min(1) }).strict().safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'DOCUMENT_SOURCE_INVALID', parsed.error.issues[0]?.message ?? 'Attach a valid document.');
  const bytes = Buffer.from(parsed.data.sourceContentBase64, 'base64');
  if (bytes.byteLength !== parsed.data.sourceSize) throw new AppError(400, 'DOCUMENT_SOURCE_INVALID', 'The document could not be verified. Attach it again.');
  res.json(await classifyFuelDocument({ organizationId: req.user!.organization.id, ...parsed.data }));
});

historicalSalesRouter.get('/:id/source', async (req, res) => {
  const source = await historicalImportSource(req.user!.organization.id, req.params.id!);
  res.setHeader('Content-Type', source.sourceMimeType);
  res.setHeader('Content-Disposition', `inline; filename="${source.sourceFileName.replaceAll(/["\\\r\n]/g, '_')}"`);
  res.send(source.sourceContent);
});

historicalSalesRouter.post('/validate', async (req, res) => {
  requireOwner(req.user!);
  const parsed = historicalSalesImportSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'HISTORICAL_IMPORT_INVALID', parsed.error.issues[0]?.message ?? 'Review the historical sales data.', parsed.error.flatten());
  assertStationAccess(req.user!, parsed.data.stationId);
  res.json({ issues: validateHistoricalRows(parsed.data.rows) });
});

historicalSalesRouter.post('/', async (req, res) => {
  requireOwner(req.user!);
  const parsed = historicalSalesImportSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'HISTORICAL_IMPORT_INVALID', parsed.error.issues[0]?.message ?? 'Review the historical sales data.', parsed.error.flatten());
  assertStationAccess(req.user!, parsed.data.stationId);
  res.status(201).json(await createHistoricalImport(req.user!.organization.id, req.user!.id, parsed.data));
});
