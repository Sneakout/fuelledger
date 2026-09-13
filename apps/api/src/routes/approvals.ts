import { inventoryAdjustmentSchema } from '@fuelledger/shared';
import { ApprovalStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { assertStationAccess, permittedStationIds, requireOwner } from '../lib/station-access.js';
import { authenticate } from '../middleware/authenticate.js';
import * as service from '../modules/approvals/service.js';

export const approvalsRouter = Router();
approvalsRouter.use(authenticate);

approvalsRouter.get('/', async (req, res) => {
  requireOwner(req.user!);
  const parsed = z.object({ status: z.nativeEnum(ApprovalStatus).optional() }).safeParse(req.query);
  if (!parsed.success) throw new AppError(400, 'APPROVAL_FILTER_INVALID', 'Choose a valid approval status.');
  res.json({ approvals: await service.list(req.user!.organization.id, permittedStationIds(req.user!), parsed.data.status) });
});

approvalsRouter.post('/inventory-adjustments', async (req, res) => {
  const parsed = z.object({ requestId: z.string().uuid(), adjustment: inventoryAdjustmentSchema }).safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'APPROVAL_REQUEST_INVALID', 'Enter the adjustment and a clear reason.', parsed.error.flatten());
  assertStationAccess(req.user!, parsed.data.adjustment.stationId);
  res.status(202).json({ approval: await service.requestInventoryAdjustment(req.user!.organization.id, req.user!.id, parsed.data.requestId, parsed.data.adjustment) });
});

approvalsRouter.post('/:id/decision', async (req, res) => {
  requireOwner(req.user!);
  const parsed = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(500).default(''), version: z.number().int().positive(), sellingPrice: z.coerce.number().positive().optional(), sellingPriceEffectiveFrom: z.string().datetime().optional() }).superRefine((value, ctx) => { if (value.decision === 'REJECT' && value.note.length < 3) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Explain why this request is being rejected.' }); }).safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'APPROVAL_DECISION_INVALID', 'Review the decision and note.', parsed.error.flatten());
  res.json({ approval: await service.decide(req.user!.organization.id, req.user!.id, req.params.id!, parsed.data, permittedStationIds(req.user!)) });
});
