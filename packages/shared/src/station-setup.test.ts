import { describe, expect, it } from 'vitest';
import { ownerNotificationSettingsSchema, restorePersistedEquipmentConnections, stationEquipmentSchema, stationProfileSchema, stationSetupSchema, type StationSetup } from './index.js';
import { closeShiftSchema, customerInputSchema, customerReceiptInputSchema, densityReadingInputSchema, expenseCategoryInputSchema, expenseInputSchema, inventoryAdjustmentSchema, openShiftSchema, paymentMethods, productInputSchema, purchaseInvoiceInputSchema, purchaseInvoiceUpdateSchema, receiptInputSchema, reconciliationInputSchema, saleInputSchema, supplierInputSchema, supplierPaymentInputSchema, tankReadingInputSchema, vehicleInputSchema } from './index.js';

const fuel = (code: string) => ({ name: code, code, category: 'FUEL' as const, unit: 'LITRE' as const, inventoryTracked: true, tankLinked: true, meterLinked: true, isService: false, active: true });
function setup(tanks: Array<[string, string]>, extras: StationSetup['products'] = []): StationSetup { const products = [fuel('MS'), fuel('HSD'), ...extras]; return { profile: { name: 'Test Station', code: 'TEST', addressLine1: '1 Main Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' }, products, tanks: tanks.map(([code, productCode]) => ({ code, productCode, nominalCapacity: 20000, workingCapacity: 19000, openingStock: 1000, tankType: 'UNDERGROUND', dipMethod: 'MANUAL', status: 'ACTIVE' })), dispensers: [{ code: 'D-1', location: 'Front', status: 'ACTIVE', nozzles: tanks.map(([code, productCode], index) => ({ code: `N-${index + 1}`, productCode, openingMeter: 0, status: 'ACTIVE', tankCodes: [code] })) }] }; }
describe('station setup validation', () => {
  const scenarios: Array<[string, Array<[string, string]>]> = [
    ['Station A', [['MS-1','MS'],['MS-2','MS'],['HSD-1','HSD'],['HSD-2','HSD']]],
    ['Station B', [['MS-1','MS'],['HSD-1','HSD']]],
    ['Station C', [['MS-1','MS'],['HSD-1','HSD'],['HSD-2','HSD'],['DEF-1','DEF']]],
  ];
  it.each(scenarios)('accepts %s', (_name, tanks) => { const extras = _name === 'Station C' ? [{ name: 'DEF', code: 'DEF', category: 'DEF' as const, unit: 'LITRE' as const, inventoryTracked: true, tankLinked: true, meterLinked: true, isService: false, active: true }] : []; expect(stationSetupSchema.safeParse(setup(tanks, extras)).success).toBe(true); });
  it('accepts Station D with services and multiple product types', () => { const result = setup([['MS-1','MS'],['HSD-1','HSD'],['DEF-1','DEF']], [{ name:'DEF',code:'DEF',category:'DEF',unit:'LITRE',inventoryTracked:true,tankLinked:true,meterLinked:true,isService:false,active:true }, { name:'Car wash',code:'CAR-WASH',category:'SERVICES',unit:'UNIT',inventoryTracked:false,tankLinked:false,meterLinked:false,isService:true,active:true }]); expect(stationSetupSchema.safeParse(result).success).toBe(true); });
  it('rejects an unsafe nozzle-to-tank product mapping', () => { const result = setup([['MS-1','MS'],['HSD-1','HSD']]); result.dispensers[0]!.nozzles[0]!.tankCodes = ['HSD-1']; expect(stationSetupSchema.safeParse(result).success).toBe(false); });
});

describe('station profile validation', () => {
  const valid = { name: 'ABC Fuels', code: 'ABC-1', addressLine1: '1 Main Road', city: 'Kochi', state: 'Kerala', postalCode: '682001', phone: '', gstin: '', openingTime: '06:00', closingTime: '22:00' };
  it('accepts an editable petrol pump profile', () => expect(stationProfileSchema.safeParse(valid).success).toBe(true));
  it('normalizes the petrol pump code', () => expect(stationProfileSchema.parse({ ...valid, code: 'abc-1' }).code).toBe('ABC-1'));
  it('rejects an invalid petrol pump code', () => expect(stationProfileSchema.safeParse({ ...valid, code: 'ABC 1' }).success).toBe(false));
});

describe('station equipment editing validation', () => {
  const id='ckshift000000000000000001';
  const productId='ckproduct0000000000000001';
  const valid={configurationId:id,tanks:[{key:'tank-1',id,code:'T-1',productId,nominalCapacity:20000,workingCapacity:19000,openingStock:1000,tankType:'UNDERGROUND' as const,dipMethod:'MANUAL' as const,status:'ACTIVE' as const}],dispensers:[{id,code:'D-1',location:'Main island',status:'ACTIVE' as const,nozzles:[{id,code:'N-1',productId,openingMeter:100,status:'ACTIVE' as const,tankKeys:['tank-1']}]}]};
  it('accepts safe tank and DU edits',()=>expect(stationEquipmentSchema.safeParse(valid).success).toBe(true));
  it('rejects active nozzles without a tank',()=>expect(stationEquipmentSchema.safeParse({...valid,dispensers:[{...valid.dispensers[0]!,nozzles:[{...valid.dispensers[0]!.nozzles[0]!,tankKeys:[]}]}]}).success).toBe(false));
  it('rejects an active nozzle connected to an inactive tank',()=>expect(stationEquipmentSchema.safeParse({...valid,tanks:[{...valid.tanks[0]!,status:'INACTIVE'}]}).success).toBe(false));
  it('restores a valid saved connection omitted by the browser',()=>{const submitted={...valid,dispensers:[{...valid.dispensers[0]!,nozzles:[{...valid.dispensers[0]!.nozzles[0]!,tankKeys:[]}]}]};const restored=restorePersistedEquipmentConnections(submitted,new Map([[id,[id]]]));expect(restored.dispensers[0]!.nozzles[0]!.tankKeys).toEqual(['tank-1']);expect(stationEquipmentSchema.safeParse(restored).success).toBe(true);});
  it('does not restore a saved connection to an incompatible tank',()=>{const submitted={...valid,tanks:[{...valid.tanks[0]!,status:'INACTIVE' as const}],dispensers:[{...valid.dispensers[0]!,nozzles:[{...valid.dispensers[0]!.nozzles[0]!,tankKeys:[]}]}]};const restored=restorePersistedEquipmentConnections(submitted,new Map([[id,[id]]]));expect(restored.dispensers[0]!.nozzles[0]!.tankKeys).toEqual([]);expect(stationEquipmentSchema.safeParse(restored).success).toBe(false);});
});

describe('owner WhatsApp alert validation', () => {
  const settings = { whatsappNumber: '+91 89775 06454', whatsappOptedIn: true, densityMissingEnabled: true, lowStockEnabled: true, shiftVarianceEnabled: true, unclosedShiftEnabled: true, dailySummaryEnabled: true, overdueCustomerEnabled: true, lowStockPercent: 20, varianceThreshold: 500, dailySummaryHour: 20 };
  it('accepts an opted-in WhatsApp number and normalizes it', () => expect(ownerNotificationSettingsSchema.parse(settings).whatsappNumber).toBe('918977506454'));
  it('requires a WhatsApp number when alerts are opted in', () => expect(ownerNotificationSettingsSchema.safeParse({ ...settings, whatsappNumber: '' }).success).toBe(false));
});

describe('shift validation', () => {
  const id='ckshift000000000000000001';
  it('accepts a complete opening shift',()=>expect(openShiftSchema.safeParse({stationId:id,managerId:id,userIds:[id],nozzleAssignments:[{nozzleId:id,userId:id}],openingCash:5000,tankReadings:[{id,value:100}],nozzleReadings:[{id,value:1000}]}).success).toBe(true));
  it('accepts a complete closing shift',()=>expect(closeShiftSchema.safeParse({closingCash:6200,tankReadings:[{id,value:90}],nozzleReadings:[{id,value:1120}]}).success).toBe(true));
  it('rejects negative readings or cash',()=>expect(closeShiftSchema.safeParse({closingCash:-1,tankReadings:[],nozzleReadings:[]}).success).toBe(false));
});

describe('product master validation', () => {
  const valid = (name: string, code: string, category: string) => ({ name, code, category, unit: 'LITRE', purchasePrice: 1, sellingPrice: 2, taxCategoryId: null, customCategoryId: null, inventoryTracked: true, tankLinked: category === 'FUEL' || category === 'DEF', meterLinked: category === 'FUEL' || category === 'DEF', isService: false, active: true });
  it.each([['MS','MS','FUEL'],['HSD','HSD','FUEL'],['DEF','DEF','DEF'],['Engine Oil','ENG-OIL','LUBRICANTS'],['Water','WATER','RETAIL'],['EV Charging','EV-CHARGE','EV_CHARGING'],['Advertising income','AD-INCOME','OTHER']])('accepts %s', (name,code,category) => expect(productInputSchema.safeParse(valid(name,code,category)).success).toBe(true));
  it('accepts non-inventory services such as car wash', () => expect(productInputSchema.safeParse({ ...valid('Car Wash','CAR-WASH','SERVICES'), unit:'UNIT', inventoryTracked:false, tankLinked:false, meterLinked:false, isService:true }).success).toBe(true));
  it('rejects a service linked to physical inventory', () => expect(productInputSchema.safeParse({ ...valid('Car Wash','CAR-WASH','SERVICES'), isService:true }).success).toBe(false));
});

describe('sales validation', () => {
  const id='ckshift000000000000000001';
  const sale = { stationId:id, shiftId:id, productId:id, employeeId:id, unitPrice:100, quantity:2 };
  it.each(['CASH','UPI','CARD'] as const)('accepts %s product collections', paymentMethod => expect(saleInputSchema.safeParse({ ...sale, paymentMethod }).success).toBe(true));
  it.each(['CREDIT','FLEET'] as const)('accepts %s collections with a customer', paymentMethod => expect(saleInputSchema.safeParse({ ...sale, paymentMethod, customerId:'cm12345678901234567890123' }).success).toBe(true));
  it('requires a customer for credit and fleet collections', () => expect(saleInputSchema.safeParse({ ...sale, paymentMethod:'CREDIT' }).success).toBe(false));
  it('accepts a meter sale with a positive measured movement', () => expect(saleInputSchema.safeParse({ ...sale, paymentMethod:'CASH', tankId:id, nozzleId:id, meterOpening:100, meterClosing:125 }).success).toBe(true));
  it('rejects an incomplete or backwards meter sale', () => { expect(saleInputSchema.safeParse({ ...sale, paymentMethod:'CASH', nozzleId:id, meterOpening:100, meterClosing:125 }).success).toBe(false); expect(saleInputSchema.safeParse({ ...sale, paymentMethod:'CASH', tankId:id, nozzleId:id, meterOpening:125, meterClosing:100 }).success).toBe(false); });
});

describe('inventory validation', () => {
  const id='ckshift000000000000000001';
  it('accepts a received fuel or retail stock line', () => expect(receiptInputSchema.safeParse({ stationId:id, supplierName:'Demo Oil Company', lines:[{ productId:id, tankId:id, quantity:1200, unitCost:96 }, { productId:id, quantity:12, unitCost:12 }] }).success).toBe(true));
  it('requires received quantities and meaningful adjustments', () => { expect(receiptInputSchema.safeParse({ stationId:id, supplierName:'Demo Oil', lines:[{productId:id,quantity:0,unitCost:0}] }).success).toBe(false); expect(inventoryAdjustmentSchema.safeParse({stationId:id,productId:id,quantityDelta:0,notes:'Count'}).success).toBe(false); });
  it('captures a physical tank reading independently of book stock', () => expect(tankReadingInputSchema.safeParse({stationId:id,tankId:id,physicalStock:1194.5,dipReading:234.2}).success).toBe(true));
  it('accepts a realistic daily fuel density', () => expect(densityReadingInputSchema.safeParse({stationId:id,tankId:id,density:742.5}).success).toBe(true));
  it('rejects an implausible density reading', () => expect(densityReadingInputSchema.safeParse({stationId:id,tankId:id,density:200}).success).toBe(false));
});

describe('shift reconciliation validation', () => {
  const collections=paymentMethods.map(paymentMethod=>({paymentMethod,actualAmount:100,adjustmentAmount:0}));
  it('accepts one actual collection for every payment method',()=>expect(reconciliationInputSchema.safeParse({collections}).success).toBe(true));
  it('requires a reason for every non-zero manual adjustment',()=>expect(reconciliationInputSchema.safeParse({collections:collections.map(row=>row.paymentMethod==='CASH'?{...row,adjustmentAmount:-10}:row)}).success).toBe(false));
  it('accepts a documented adjustment',()=>expect(reconciliationInputSchema.safeParse({collections:collections.map(row=>row.paymentMethod==='CASH'?{...row,adjustmentAmount:-10,adjustmentReason:'Bank deposit fee'}:row)}).success).toBe(true));
  it('rejects missing or duplicate payment rows',()=>expect(reconciliationInputSchema.safeParse({collections:collections.map(()=>collections[0])}).success).toBe(false));
});

describe('customer and fleet validation', () => {
  const customer={name:'Acme Logistics',code:'ACME',type:'FLEET' as const,creditLimit:100000,creditDays:30,active:true};
  it('accepts a fleet account with a credit policy',()=>expect(customerInputSchema.safeParse(customer).success).toBe(true));
  it('rejects negative limits and unsafe account codes',()=>expect(customerInputSchema.safeParse({...customer,code:'bad code',creditLimit:-1}).success).toBe(false));
  it('accepts a registered fleet vehicle',()=>expect(vehicleInputSchema.safeParse({number:'KL 07 AB 1234',label:'Delivery truck',active:true}).success).toBe(true));
  it('accepts positive customer receipts',()=>expect(customerReceiptInputSchema.safeParse({stationId:'ckshift000000000000000001',amount:5000,paymentMethod:'UPI'}).success).toBe(true));
  it('rejects zero receipts and credit as a receipt method',()=>{expect(customerReceiptInputSchema.safeParse({stationId:'ckshift000000000000000001',amount:0,paymentMethod:'UPI'}).success).toBe(false);expect(customerReceiptInputSchema.safeParse({stationId:'ckshift000000000000000001',amount:10,paymentMethod:'CREDIT'}).success).toBe(false);});
});

describe('purchases and expenses validation',()=>{const id='ckshift000000000000000001';const now=new Date().toISOString();
 it('accepts suppliers with payment terms',()=>expect(supplierInputSchema.safeParse({name:'Demo Oil Company',code:'DOC',paymentTerms:21,active:true}).success).toBe(true));
 it('accepts an inventory-linked purchase invoice',()=>expect(purchaseInvoiceInputSchema.safeParse({stationId:id,supplierId:id,invoiceNumber:'INV-1',invoiceDate:now,dueDate:now,taxAmount:18,receiveNow:true,lines:[{productId:id,tankId:id,description:'MS supply',quantity:1000,unitCost:96,taxRate:0}]}).success).toBe(true));
 it('requires products when stock is received',()=>expect(purchaseInvoiceInputSchema.safeParse({stationId:id,supplierId:id,invoiceNumber:'INV-2',invoiceDate:now,dueDate:now,taxAmount:0,receiveNow:true,lines:[{description:'Unknown',quantity:1,unitCost:10,taxRate:0}]}).success).toBe(false));
 it('accepts refreshing saved invoice prices',()=>expect(purchaseInvoiceUpdateSchema.safeParse({invoiceNumber:'INV-1',invoiceDate:now,dueDate:now,refreshPrices:true}).success).toBe(true));
 it('requires a payment method when marking a saved invoice paid',()=>{expect(purchaseInvoiceUpdateSchema.safeParse({invoiceNumber:'INV-1',invoiceDate:now,dueDate:now,markPaid:true}).success).toBe(false);expect(purchaseInvoiceUpdateSchema.safeParse({invoiceNumber:'INV-1',invoiceDate:now,dueDate:now,markPaid:true,paymentMethod:'UPI'}).success).toBe(true);});
 it('accepts supplier payments and expense categories',()=>{expect(supplierPaymentInputSchema.safeParse({stationId:id,invoiceId:id,amount:100,paymentMethod:'UPI'}).success).toBe(true);expect(expenseCategoryInputSchema.safeParse({name:'Utilities',code:'UTIL'}).success).toBe(true)});
 it('accepts a documented station expense',()=>expect(expenseInputSchema.safeParse({stationId:id,categoryId:id,description:'Electricity bill',amount:2500,paymentMethod:'UPI',incurredAt:now}).success).toBe(true));
});
