import { z } from 'zod';
import { requireOwner } from '../lib/station-access.js';
import { approveCustomerReminder, previewCustomerReminder, reminderProfile, saveReminderProfile } from '../modules/notifications/customer-reminders.js';
import { safeSaveContext } from '../lib/safe-save.js';
import { Router } from 'express';import { customerInputSchema,customerReceiptInputSchema,vehicleInputSchema } from '@fuelledger/shared';import { AppError } from '../lib/errors.js';import { assertStationAccess,permittedStationIds } from '../lib/station-access.js';import { authenticate } from '../middleware/authenticate.js';import * as service from '../modules/customers/service.js';
export const customersRouter=Router();customersRouter.use(authenticate);customersRouter.use(safeSaveContext);customersRouter.get('/bootstrap',async(req,res)=>res.json(await service.bootstrap(req.user!.organization.id,permittedStationIds(req.user!))));customersRouter.post('/',async(req,res)=>{const parsed=customerInputSchema.safeParse(req.body);if(!parsed.success)throw new AppError(400,'CUSTOMER_INVALID','Please review the customer details.',parsed.error.flatten());res.status(201).json({customer:await service.createCustomer(req.user!.organization.id,parsed.data)});});customersRouter.put('/:id',async(req,res)=>{const parsed=customerInputSchema.safeParse(req.body);if(!parsed.success)throw new AppError(400,'CUSTOMER_INVALID','Please review the customer details.',parsed.error.flatten());res.json({customer:await service.updateCustomer(req.user!.organization.id,req.params.id!,parsed.data)});});customersRouter.delete('/:id',async(req,res)=>res.json(await service.removeCustomer(req.user!.organization.id,req.params.id!)));customersRouter.post('/:id/vehicles',async(req,res)=>{const parsed=vehicleInputSchema.safeParse(req.body);if(!parsed.success)throw new AppError(400,'VEHICLE_INVALID','Please review the vehicle details.',parsed.error.flatten());res.status(201).json({vehicle:await service.addVehicle(req.user!.organization.id,req.params.id!,parsed.data)});});customersRouter.post('/:id/receipts',async(req,res)=>{const parsed=customerReceiptInputSchema.safeParse(req.body);if(!parsed.success)throw new AppError(400,'RECEIPT_INVALID','Please review the receipt details.',parsed.error.flatten());assertStationAccess(req.user!,parsed.data.stationId);res.status(201).json({receipt:await service.receivePayment(req.user!.organization.id,req.params.id!,req.user!.id,parsed.data)});});

const reminderProfileSchema = z.object({
  destination: z.string().trim().transform(value => value.replace(/[\s()+-]/g, '')).pipe(z.string().regex(/^(?:[1-9]\d{7,14})?$/)),
  consentSource: z.string().trim().max(200),
  recordConsent: z.boolean(),
  revokeConsent: z.boolean(),
  paused: z.boolean(),
}).refine(value => !value.recordConsent || Boolean(value.destination && value.consentSource && !value.revokeConsent), {
  message: 'Enter the customer’s WhatsApp number and how they consented.',
});
const reminderStationSchema = z.object({ stationId: z.string().cuid() });
const reminderApprovalSchema = reminderStationSchema.extend({ snapshot: z.string().regex(/^[a-f0-9]{64}$/) });

customersRouter.get('/:id/reminders', async (req, res) => {
  const user = req.user!;
  requireOwner(user);
  res.json(await reminderProfile(user.organization.id, req.params.id, permittedStationIds(user)));
});
customersRouter.put('/:id/reminders', async (req, res) => {
  const user = req.user!;
  requireOwner(user);
  const parsed = reminderProfileSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'REMINDER_PROFILE_INVALID', 'Review the WhatsApp number and consent details.');
  res.json({ profile: await saveReminderProfile(user.organization.id, req.params.id, user.id, parsed.data) });
});
customersRouter.post('/:id/reminders/preview', async (req, res) => {
  const user = req.user!;
  requireOwner(user);
  const parsed = reminderStationSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'REMINDER_STATION_REQUIRED', 'Choose a fuel station.');
  assertStationAccess(user, parsed.data.stationId);
  res.json({ draft: await previewCustomerReminder({ organizationId: user.organization.id, customerId: req.params.id, ...parsed.data }) });
});
customersRouter.post('/:id/reminders/approve', async (req, res) => {
  const user = req.user!;
  requireOwner(user);
  const parsed = reminderApprovalSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'REMINDER_REVIEW_REQUIRED', 'Review the reminder before queuing it.');
  const { stationId, snapshot } = parsed.data;
  assertStationAccess(user, stationId);
  const job = await approveCustomerReminder({ organizationId: user.organization.id, customerId: req.params.id, stationId }, user.id, snapshot);
  res.status(202).json({ id: job.id, status: job.status });
});
