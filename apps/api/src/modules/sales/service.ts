import type { SaleInput } from '@fuelledger/shared';
import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { collectionAccount, postJournal } from '../accounting/service.js';
import { notifyLowStock } from '../notifications/service.js';

const saleInclude = { station: { select: { id: true, name: true, code: true } }, shift: { select: { id: true, shiftNumber: true, status: true } }, product: { select: { id: true, name: true, code: true, unit: true, meterLinked: true, isService: true } }, employee: { select: { id: true, name: true, role: true } }, tank: { select: { id: true, code: true } }, nozzle: { select: { id: true, code: true, dispenser: { select: { code: true } } } }, customer: { select: { id: true, name: true, code: true, type: true } }, vehicle: { select: { id: true, number: true, label: true } } } as const;
const sellingPriceAt=(product:{sellingPrice:Prisma.Decimal;sellingPriceHistory:Array<{price:Prisma.Decimal;effectiveFrom:Date}>},at=new Date())=>product.sellingPriceHistory.find(row=>row.effectiveFrom<=at)?.price??product.sellingPrice;

export async function bootstrap(organizationId: string,stationIds?:string[]) {
  const [openShifts, products, employees, sales, customers] = await Promise.all([
    prisma.shift.findMany({
      where: { status: 'OPEN', station: { organizationId,...(stationIds?{id:{in:stationIds}}:{}) } },
      include: {
        station: { select: { id: true, name: true, code: true } }, manager: { select: { id: true, name: true, role: true } }, users: { include: { user: { select: { id: true, name: true, role: true } } } }, nozzleAssignments:{include:{user:{select:{id:true,name:true,role:true}}}},
        tankReadings: { include: { tank: { include: { product: { select: { id: true, name: true, code: true } } } } } },
        nozzleReadings: { include: { nozzle: { include: { product: { select: { id: true, name: true, code: true } }, dispenser: { select: { code: true } }, tankMappings: { include: { tank: { select: { id: true, code: true } } } } } } } },
      },
    }),
    prisma.product.findMany({ where: { organizationId, active: true }, orderBy: [{ isService: 'asc' }, { name: 'asc' }], select: { id: true, name: true, code: true, unit: true, sellingPrice: true, sellingPriceHistory:{where:{effectiveFrom:{lte:new Date()}},orderBy:{effectiveFrom:'desc'},take:1,select:{price:true,effectiveFrom:true}},meterLinked: true, tankLinked: true, isService: true, category: true } }),
    prisma.user.findMany({ where: { organizationId, active: true,...(stationIds?{OR:[{role:{in:['OWNER','ACCOUNTANT']}},{stationAccess:{some:{stationId:{in:stationIds}}}}]}:{}) }, select: { id: true, name: true, role: true } }),
    prisma.sale.findMany({ where: { organizationId,...(stationIds?{stationId:{in:stationIds}}:{}) }, take: 100, orderBy: { occurredAt: 'desc' }, include: saleInclude }),
    prisma.customer.findMany({ where: { organizationId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, type: true, creditLimit: true, vehicles: { where: { active: true }, orderBy: { number: 'asc' }, select: { id: true, number: true, label: true } }, ledger: { select: { amount: true } } } }),
  ]);
  return { openShifts, products:products.map(product=>({...product,sellingPrice:sellingPriceAt(product)})), employees, sales, customers: customers.map(customer => ({ ...customer, outstanding: customer.ledger.reduce((sum, row) => sum + Number(row.amount), 0), ledger: undefined })) };
}

export async function createSale(organizationId: string, input: SaleInput) {
  const [shift, product] = await Promise.all([
    prisma.shift.findFirst({ where: { id: input.shiftId, stationId: input.stationId, status: 'OPEN', station: { organizationId } }, include: { users: true, nozzleReadings: true, nozzleAssignments:true } }),
    prisma.product.findFirst({ where: { id: input.productId, organizationId, active: true },include:{sellingPriceHistory:{where:{effectiveFrom:{lte:new Date()}},orderBy:{effectiveFrom:'desc'},take:1}} }),
  ]);
  if (!shift) throw new AppError(409, 'SHIFT_NOT_OPEN', 'Choose an open shift for this station.');
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Choose an active product.');
  const applicablePrice=sellingPriceAt(product);if(Math.abs(input.unitPrice-Number(applicablePrice))>.005)throw new AppError(409,'SELLING_PRICE_CHANGED',`The current price is ${Number(applicablePrice).toLocaleString('en-IN',{style:'currency',currency:'INR'})} per ${product.unit.toLowerCase()}. Refresh before recording this sale.`);
  const permittedEmployees = new Set([shift.managerId, ...shift.users.map(user => user.userId)]);
  if (!permittedEmployees.has(input.employeeId)) throw new AppError(400, 'EMPLOYEE_NOT_ON_SHIFT', 'Choose a team member assigned to this shift.');
  if (['CREDIT', 'FLEET'].includes(input.paymentMethod) && !input.customerId) throw new AppError(400, 'CUSTOMER_REQUIRED', 'Choose a customer account for this payment type.');
  const metered = product.meterLinked;
  if (metered) {
    const sale = await createMeteredSale(organizationId, input, shift, {...product,sellingPrice:applicablePrice});
    if (sale.tank?.id) await notifyLowStock(organizationId, sale.tank.id).catch(() => undefined);
    return sale;
  }
  if (input.tankId || input.nozzleId || input.meterOpening !== null && input.meterOpening !== undefined || input.meterClosing !== null && input.meterClosing !== undefined) throw new AppError(400, 'EQUIPMENT_NOT_APPLICABLE', 'This product is not sold from a meter. Record the quantity directly.');
  const quantity = input.quantity;
  if (!quantity) throw new AppError(400, 'QUANTITY_REQUIRED', 'Enter a quantity for this sale.');
  const sale = await persistSale({ organizationId, input, kind: product.isService ? 'SERVICE' : 'PRODUCT', quantity, product:{...product,sellingPrice:applicablePrice} });
  if (sale.tank?.id) await notifyLowStock(organizationId, sale.tank.id).catch(() => undefined);
  return sale;
}

async function createMeteredSale(organizationId: string, input: SaleInput, shift: { id: string; configurationId: string; nozzleReadings: Array<{ nozzleId: string; openingMeter: Prisma.Decimal }>;nozzleAssignments:Array<{nozzleId:string;userId:string}> }, product: { id: string; inventoryTracked: boolean; isService: boolean; purchasePrice: Prisma.Decimal;sellingPrice:Prisma.Decimal }) {
  if (!input.tankId || !input.nozzleId || input.meterOpening === null || input.meterOpening === undefined || input.meterClosing === null || input.meterClosing === undefined) throw new AppError(400, 'METER_DETAILS_REQUIRED', 'Choose the tank and nozzle, then enter the opening and closing meter readings.');
  const nozzle = await prisma.nozzle.findFirst({ where: { id: input.nozzleId, productId: product.id, status: 'ACTIVE', dispenser: { configurationId: shift.configurationId, status: 'ACTIVE' }, tankMappings: { some: { tankId: input.tankId, tank: { productId: product.id, status: 'ACTIVE', configurationId: shift.configurationId } } } }, include: { tankMappings: { where: { tankId: input.tankId } } } });
  if (!nozzle) throw new AppError(400, 'EQUIPMENT_MAPPING_INVALID', 'The selected active nozzle and tank must be mapped to the selected product.');
  const custodian=shift.nozzleAssignments.find(row=>row.nozzleId===nozzle.id);if(custodian&&custodian.userId!==input.employeeId)throw new AppError(403,'NOZZLE_CUSTODY_REQUIRED','Record this sale under the attendant assigned to this nozzle.');
  const openingReading = shift.nozzleReadings.find(reading => reading.nozzleId === nozzle.id);
  if (!openingReading) throw new AppError(400, 'NOZZLE_NOT_ON_SHIFT', 'This nozzle is not part of the current shift.');
  const previous = await prisma.sale.findFirst({ where: { shiftId: shift.id, nozzleId: nozzle.id }, orderBy: { occurredAt: 'desc' }, select: { meterClosing: true } });
  const expectedOpening = Number(previous?.meterClosing ?? openingReading.openingMeter);
  if (Math.abs(input.meterOpening - expectedOpening) > 0.001) throw new AppError(400, 'METER_OPENING_INVALID', `Use ${expectedOpening.toLocaleString()} as the next opening meter reading.`);
  if (input.meterClosing <= input.meterOpening) throw new AppError(400, 'METER_READING_INVALID', 'The closing meter must be greater than the opening meter.');
  return persistSale({ organizationId, input, kind: 'METERED', quantity: input.meterClosing - input.meterOpening, product });
}

async function persistSale({ organizationId, input, kind, quantity, product }: { organizationId: string; input: SaleInput; kind: 'METERED' | 'PRODUCT' | 'SERVICE'; quantity: number; product: { id: string; inventoryTracked: boolean; isService: boolean; purchasePrice: Prisma.Decimal;sellingPrice:Prisma.Decimal } }) {
  const unitPrice = product.sellingPrice; const totalAmount = new Prisma.Decimal(quantity).mul(unitPrice);
  return prisma.$transaction(async tx => {
    const liveShift=await tx.shift.findFirst({where:{id:input.shiftId,stationId:input.stationId,status:'OPEN',station:{organizationId}},select:{id:true}});
    if(!liveShift)throw new AppError(409,'SHIFT_NOT_OPEN','This shift was closed before the sale could be saved. Refresh and choose an open shift.');
    if(kind==='METERED'&&input.nozzleId){const latest=await tx.sale.findFirst({where:{shiftId:input.shiftId,nozzleId:input.nozzleId,kind:'METERED'},orderBy:[{meterClosing:'desc'},{createdAt:'desc'}],select:{meterClosing:true}});if(latest&&Math.abs(Number(latest.meterClosing)-Number(input.meterOpening))>.001)throw new AppError(409,'METER_ALREADY_ADVANCED',`This nozzle has already advanced to ${Number(latest.meterClosing).toLocaleString()} L. Refresh before recording the next sale.`);}
    const customer = input.customerId ? await tx.customer.findFirst({ where: { id: input.customerId, organizationId, active: true } }) : null;
    if (input.customerId && !customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Choose an active customer account.');
    if (input.paymentMethod === 'FLEET' && customer?.type !== 'FLEET') throw new AppError(400, 'FLEET_ACCOUNT_REQUIRED', 'Fleet collections require a fleet account.');
    const vehicle = input.vehicleId && customer ? await tx.vehicle.findFirst({ where: { id: input.vehicleId, customerId: customer.id, active: true } }) : null;
    if (input.vehicleId && !vehicle) throw new AppError(400, 'VEHICLE_INVALID', 'Choose a vehicle registered to this customer.');
    if (customer && ['CREDIT', 'FLEET'].includes(input.paymentMethod)) { const aggregate = await tx.customerLedgerEntry.aggregate({ where: { customerId: customer.id }, _sum: { amount: true } }); const projected = new Prisma.Decimal(aggregate._sum.amount ?? 0).add(totalAmount); if (projected.greaterThan(customer.creditLimit)) throw new AppError(409, 'CREDIT_LIMIT_EXCEEDED', `This sale would exceed ${customer.name}'s credit limit.`); }
    const sale = await tx.sale.create({ data: { organizationId, stationId: input.stationId, shiftId: input.shiftId, productId: product.id, employeeId: input.employeeId, tankId: input.tankId ?? null, nozzleId: input.nozzleId ?? null, kind, paymentMethod: input.paymentMethod, quantity: new Prisma.Decimal(quantity), unitPrice, totalAmount, meterOpening: input.meterOpening ?? null, meterClosing: input.meterClosing ?? null, customerId: customer?.id ?? null, vehicleId: vehicle?.id ?? null, customerName: customer?.name ?? input.customerName ?? null, vehicleNumber: vehicle?.number ?? input.vehicleNumber ?? null, notes: input.notes || null }, include: saleInclude });
    if (product.inventoryTracked) await tx.inventoryLedger.create({ data: { organizationId, stationId: input.stationId, productId: product.id, tankId: input.tankId ?? null, type: 'SALE', quantityDelta: new Prisma.Decimal(quantity).neg(), unitCost:product.purchasePrice, saleId: sale.id, occurredAt: sale.occurredAt, createdById: input.employeeId } });
    if (customer && ['CREDIT', 'FLEET'].includes(input.paymentMethod)) { const dueDate = new Date(sale.occurredAt); dueDate.setDate(dueDate.getDate() + customer.creditDays); await tx.customerLedgerEntry.create({ data: { organizationId, stationId: input.stationId, customerId: customer.id, type: 'SALE', amount: totalAmount, saleId: sale.id, description: `${sale.product.name} sale`, dueDate, occurredAt: sale.occurredAt, createdById: input.employeeId } }); }
    await postJournal(tx,{organizationId,stationId:input.stationId,createdById:input.employeeId,journalDate:sale.occurredAt,reference:`SALE-${sale.id.slice(-8)}`,description:`${sale.product.name} sale`,sourceType:'SALE',sourceId:sale.id,lines:[{account:collectionAccount(input.paymentMethod),debit:totalAmount},{account:product.isService?'4010':'4000',credit:totalAmount},...(product.inventoryTracked?[{account:'5000',debit:new Prisma.Decimal(quantity).mul(product.purchasePrice)},{account:'1200',credit:new Prisma.Decimal(quantity).mul(product.purchasePrice)}]:[])]});
    return sale;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
