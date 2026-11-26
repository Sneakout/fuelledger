import { tankReceiptHistory } from '../modules/shifts/receipt-history.js';
import { safeSaveContext } from '../lib/safe-save.js';
import { Router } from 'express';import { shiftClosingTimeSchema,cancelShiftSchema,closeShiftSchema,nozzleCustodySchema,openShiftSchema } from '@fuelledger/shared';import { AppError } from '../lib/errors.js';import { assertShiftAccess,assertStationAccess,permittedStationIds } from '../lib/station-access.js';import { authenticate } from '../middleware/authenticate.js';import { bootstrap,cancelShift,closeShift,openShift,shiftClosingPreview,shiftDetails,updateNozzleCustody } from '../modules/shifts/service.js';
export const shiftsRouter=Router();shiftsRouter.use(authenticate);shiftsRouter.use(safeSaveContext);shiftsRouter.get('/bootstrap',async(req,res)=>res.json({ ...await bootstrap(req.user!.organization.id,permittedStationIds(req.user!)), canCancelShift: req.user!.role === 'OWNER' }));shiftsRouter.post('/open',async(req,res)=>{const parsed=openShiftSchema.safeParse(req.body);if(!parsed.success)throw new AppError(400,'SHIFT_INVALID','Please complete the opening details.',parsed.error.flatten());assertStationAccess(req.user!,parsed.data.stationId);res.status(201).json({shift:await openShift(req.user!.organization.id,parsed.data,req.user!.id)});});shiftsRouter.post('/:id/close',async(req,res)=>{const parsed=closeShiftSchema.safeParse(req.body);if(!parsed.success)throw new AppError(400,'SHIFT_INVALID','Please complete the closing details.',parsed.error.flatten());await assertShiftAccess(req.user!,req.params.id!);res.json({shift:await closeShift(req.user!.organization.id,req.params.id!,parsed.data,req.user!.id)});});shiftsRouter.put('/:id/nozzle-assignments',async(req,res)=>{const parsed=nozzleCustodySchema.safeParse(req.body);if(!parsed.success)throw new AppError(400,'CUSTODY_INVALID','Choose valid optional nozzle assignments.',parsed.error.flatten());await assertShiftAccess(req.user!,req.params.id!);res.json({shift:await updateNozzleCustody(req.user!.organization.id,req.params.id!,parsed.data)});});

shiftsRouter.get('/stations/:stationId/receipts', async (req, res) => {
  const stationId = req.params.stationId!;
  const before = req.query.before;
  if (before !== undefined && (typeof before !== 'string' || !before || before.length > 128))
    throw new AppError(400, 'RECEIPT_CURSOR_INVALID', 'Refresh the receipt history to continue.');
  assertStationAccess(req.user!, stationId);
  res.json(await tankReceiptHistory(req.user!.organization.id, stationId, before));
});

shiftsRouter.get('/:id', async (req, res) => {
  const id = req.params.id!;
  await assertShiftAccess(req.user!, id);
  res.json(await shiftDetails(req.user!.organization.id, id));
});

shiftsRouter.post('/:id/cancel', async (req, res) => {
  const parsed = cancelShiftSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'CANCELLATION_REASON_REQUIRED', 'Explain why this shift was opened by mistake (5–500 characters).');
  await assertShiftAccess(req.user!, req.params.id!);
  res.json({ shift: await cancelShift(req.user!.organization.id, req.user!.id, req.params.id!, parsed.data.reason) });
});

shiftsRouter.get('/:id/closing-preview', async (req, res) => {
  const parsed = shiftClosingTimeSchema.optional().safeParse(req.query.closedAt);
  if (!parsed.success) throw new AppError(400, 'SHIFT_CLOSING_TIME_INVALID', 'Choose a valid closing date and time.');
  await assertShiftAccess(req.user!, req.params.id!);
  res.json(await shiftClosingPreview(req.user!.organization.id, req.params.id!, parsed.data));
});
