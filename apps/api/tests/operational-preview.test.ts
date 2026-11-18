import { beforeEach, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
const mock = vi.hoisted(() => ({ org:vi.fn(),tanks:vi.fn(),receipt:vi.fn(),shift:vi.fn(),settings:vi.fn(),daily:vi.fn(),credit:vi.fn(),stockFacts:vi.fn(),receiptFacts:vi.fn(),shiftFacts:vi.fn(),queue:vi.fn() }));
vi.mock('../src/lib/prisma.js',()=>({prisma:{organization:{findUnique:mock.org},tank:{findMany:mock.tanks},purchaseReceipt:{findFirst:mock.receipt},shift:{findFirst:mock.shift}}}));
vi.mock('../src/modules/notifications/service.js',()=>({getSettings:mock.settings,notifyDailySummary:mock.daily,notifyOverdueCustomers:mock.credit,prepareNotificationPreviews:(run:()=>Promise<unknown>)=>run()}));
vi.mock('../src/modules/notifications/message-facts.js',()=>({readTankAlertFacts:mock.stockFacts,readReceiptMessageFacts:mock.receiptFacts,readShiftMessageFacts:mock.shiftFacts}));
vi.mock('../src/modules/notifications/delivery-queue.js',()=>({queueOwnerWhatsApp:mock.queue}));
import { prepareOperationalPreview } from '../src/modules/notifications/operational-preview.js';
const now=new Date('2026-11-18T06:00:00Z');
const settings={whatsappNumber:'919999999999',whatsappOptedIn:true,lowStockEnabled:true,lowStockPercent:20,shiftSummaryEnabled:true,receiptSummaryEnabled:true,overdueCustomerEnabled:true,dailySummaryEnabled:true};
beforeEach(()=>{vi.resetAllMocks();mock.settings.mockResolvedValue(settings);mock.org.mockResolvedValue({intelligenceEnabledAt:new Date('2026-01-01')});mock.tanks.mockResolvedValue([{id:'tank-a',configuration:{stationId:'station-a'}}]);mock.queue.mockResolvedValue({id:'job',status:'PENDING'});});
it('uses a real low tank and preserves source guards without sending',async()=>{
  mock.stockFacts.mockResolvedValue({completeness:'COMPLETE',station:{name:'Real station'},bookStock:new Prisma.Decimal(100),tank:{code:'T1',workingCapacity:new Prisma.Decimal(1000),product:{code:'HSD',unit:'LITRE'}}});
  expect(await prepareOperationalPreview('org-a','LOW_STOCK',now)).toEqual({status:'QUEUED',id:'job'});
  expect(mock.queue).toHaveBeenCalledWith(expect.objectContaining({organizationId:'org-a',stationId:'station-a',type:'LOW_STOCK',message:expect.stringContaining('100 L'),guard:{sourceId:'tank-a',status:'LOW'}}));
  expect(mock.stockFacts).toHaveBeenCalledWith({organizationId:'org-a',stationId:'station-a'},'tank-a',now);
});
it('does not fabricate a low-stock event for a healthy tank',async()=>{
  mock.stockFacts.mockResolvedValue({completeness:'COMPLETE',bookStock:new Prisma.Decimal(900),tank:{workingCapacity:new Prisma.Decimal(1000)}});
  expect((await prepareOperationalPreview('org-a','LOW_STOCK',now)).status).toBe('SKIPPED');
  expect(mock.queue).not.toHaveBeenCalled();
});
it('keeps Core limited to its real daily summary',async()=>{
  mock.org.mockResolvedValue({intelligenceEnabledAt:null});mock.daily.mockResolvedValue({status:'QUEUED',id:'daily'});
  await expect(prepareOperationalPreview('org-a','LOW_STOCK',now)).rejects.toMatchObject({code:'PLAN_REQUIRED'});
  await prepareOperationalPreview('org-a','DAILY_SUMMARY',now);
  expect(mock.daily).toHaveBeenCalledWith('org-a','2026-11-18',now);
});
it('requires owner consent and the owner category preference',async()=>{
  mock.settings.mockResolvedValueOnce({...settings,whatsappOptedIn:false});
  await expect(prepareOperationalPreview('org-a','LOW_STOCK',now)).rejects.toMatchObject({code:'WHATSAPP_OPT_IN_REQUIRED'});
  mock.settings.mockResolvedValueOnce({...settings,lowStockEnabled:false});
  await expect(prepareOperationalPreview('org-a','LOW_STOCK',now)).rejects.toMatchObject({code:'CATEGORY_DISABLED'});
  expect(mock.queue).not.toHaveBeenCalled();
});
it('returns no preview when there is no recent receipt or reconciled shift',async()=>{
  mock.receipt.mockResolvedValue(null);mock.shift.mockResolvedValue(null);
  expect((await prepareOperationalPreview('org-a','PURCHASE_RECEIPT_SUMMARY',now)).status).toBe('SKIPPED');
  expect((await prepareOperationalPreview('org-a','SHIFT_CLOSED_SUMMARY',now)).status).toBe('SKIPPED');
  expect(mock.receipt.mock.calls[0]![0].where).toEqual(expect.objectContaining({organizationId:'org-a'}));
  expect(mock.shift.mock.calls[0]![0].where.station.organizationId).toBe('org-a');
  expect(mock.queue).not.toHaveBeenCalled();
});
