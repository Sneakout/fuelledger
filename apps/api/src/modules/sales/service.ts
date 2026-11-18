import { assertDefPackQuantity } from '../products/def-format.js';
import { safeTransaction } from '../../lib/safe-save.js';
import { enqueueReview } from '../nerve/review-events.js';
import { requiresFuelShift, type SaleInput } from '@fuelledger/shared';
import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { effectivePriceAt } from '../../lib/effective-price.js';
import { collectionAccount, postJournal } from '../accounting/service.js';
import { assertStockAvailable } from '../../lib/stock.js';
import { notifyCreditSale } from '../notifications/service.js';

const saleInclude = { station: { select: { id: true, name: true, code: true } }, shift: { select: { id: true, shiftNumber: true, status: true } }, product: { select: { id: true, name: true, code: true, unit: true, packSizeLitres: true, meterLinked: true, isService: true } }, employee: { select: { id: true, name: true, role: true } }, tank: { select: { id: true, code: true } }, nozzle: { select: { id: true, code: true, dispenser: { select: { code: true } } } }, customer: { select: { id: true, name: true, code: true, type: true } }, vehicle: { select: { id: true, number: true, label: true } } } as const;

export async function bootstrap(organizationId: string,stationIds?:string[]) {
  const [openShifts, products, employees, sales, customers, stations, tanks] = await Promise.all([
    prisma.shift.findMany({
      where: { status: 'OPEN', station: { organizationId,...(stationIds?{id:{in:stationIds}}:{}) } },
      include: {
        station: { select: { id: true, name: true, code: true } }, manager: { select: { id: true, name: true, role: true } }, users: { include: { user: { select: { id: true, name: true, role: true } } } }, nozzleAssignments:{include:{user:{select:{id:true,name:true,role:true}}}},
        tankReadings: { include: { tank: { include: { product: { select: { id: true, name: true, code: true } } } } } },
        nozzleReadings: { include: { nozzle: { include: { product: { select: { id: true, name: true, code: true } }, dispenser: { select: { code: true } }, tankMappings: { include: { tank: { select: { id: true, code: true } } } } } } } },
      },
    }),
    prisma.product.findMany({ where: { organizationId, active: true }, orderBy: [{ isService: 'asc' }, { name: 'asc' }], select: { id: true, name: true, code: true, unit: true, packSizeLitres: true, sellingPrice: true, sellingPriceHistory:{where:{effectiveFrom:{lte:new Date()}},orderBy:{effectiveFrom:'desc'},take:1,select:{price:true,effectiveFrom:true}},meterLinked: true, tankLinked: true, isService: true, category: true } }),
    prisma.user.findMany({ where: { organizationId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, role: true } }),
    prisma.sale.findMany({ where: { organizationId,...(stationIds?{stationId:{in:stationIds}}:{}) }, take: 100, orderBy: { occurredAt: 'desc' }, include: saleInclude }),
    prisma.customer.findMany({ where: { organizationId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, type: true, creditLimit: true, vehicles: { where: { active: true }, orderBy: { number: 'asc' }, select: { id: true, number: true, label: true } }, ledger: { select: { amount: true } } } }),
    prisma.station.findMany({ where: { organizationId, active: true, ...(stationIds ? { id: { in: stationIds } } : {}) }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    prisma.tank.findMany({ where: { status: 'ACTIVE', configuration: { active: true, station: { organizationId, active: true, ...(stationIds ? { id: { in: stationIds } } : {}) } } }, select: { id: true, code: true, productId: true, configuration: { select: { stationId: true } } } }),
  ]);
  return { stations, tanks: tanks.map(({ configuration, ...tank }) => ({ ...tank, stationId: configuration.stationId })), openShifts, products:products.map(product=>({...product,sellingPrice:effectivePriceAt(product.sellingPrice,product.sellingPriceHistory)})), employees, sales, customers: customers.map(customer => ({ ...customer, outstanding: customer.ledger.reduce((sum, row) => sum + Number(row.amount), 0), ledger: undefined })) };
}

export async function createSale(organizationId: string, input: SaleInput) {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, organizationId, active: true },
    include: {
      sellingPriceHistory: { where: { effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' }, take: 1 },
      purchasePriceHistory: { where: { effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' }, take: 1 },
    },
  });
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Choose an active product.');
  const applicablePrice = effectivePriceAt(product.sellingPrice, product.sellingPriceHistory);
  const applicablePurchasePrice = effectivePriceAt(product.purchasePrice, product.purchasePriceHistory);
  if (Math.abs(input.unitPrice - Number(applicablePrice)) > .005)
    throw new AppError(409, 'SELLING_PRICE_CHANGED', `The current price is ${Number(applicablePrice).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })} per ${product.unit.toLowerCase()}. Refresh before recording this sale.`);
  if (['CREDIT', 'FLEET'].includes(input.paymentMethod) && !input.customerId)
    throw new AppError(400, 'CUSTOMER_REQUIRED', 'Choose a customer account for this payment type.');
  assertDefPackQuantity(product, input.quantity ?? 0);
  const pricedProduct = { ...product, sellingPrice: applicablePrice, purchasePrice: applicablePurchasePrice };
  const fuelSale = requiresFuelShift(product);
  if (fuelSale) {
    if (!input.shiftId) throw new AppError(409, 'SHIFT_NOT_OPEN', 'MS and HSD sales require an open shift.');
    const shift = await prisma.shift.findFirst({ where: { id: input.shiftId, stationId: input.stationId, status: 'OPEN', station: { organizationId } }, include: { users: true, nozzleReadings: true, nozzleAssignments: true } });
    if (!shift) throw new AppError(409, 'SHIFT_NOT_OPEN', 'Choose an open shift for this fuel station.');
    const permittedEmployees = new Set([shift.managerId, ...shift.users.map(user => user.userId)]);
    if (!permittedEmployees.has(input.employeeId)) throw new AppError(400, 'EMPLOYEE_NOT_ON_SHIFT', 'Choose a team member assigned to this shift.');
    if (product.meterLinked) {
      const sale = await createMeteredSale(organizationId, input, shift, pricedProduct);
      await notifyCreditSaleAfterCommit(organizationId, sale);
      return sale;
    }
  }
  // Counter transactions are independent of any shift, including old clients that send one.
  const quantityInput = fuelSale ? input : { ...input, shiftId: null };
  if (input.nozzleId || input.meterOpening !== null && input.meterOpening !== undefined || input.meterClosing !== null && input.meterClosing !== undefined) throw new AppError(400, 'EQUIPMENT_NOT_APPLICABLE', 'Record this counter product using quantity and its source tank where applicable.');
  const quantity = input.quantity;
  if (!quantity) throw new AppError(400, 'QUANTITY_REQUIRED', 'Enter a quantity for this sale.');
  const sale = await persistSale({ organizationId, input: quantityInput, kind: product.isService ? 'SERVICE' : 'PRODUCT', quantity, product: pricedProduct });
  await notifyCreditSaleAfterCommit(organizationId, sale);
  return sale;
}

async function notifyCreditSaleAfterCommit(organizationId: string, sale: Awaited<ReturnType<typeof persistSale>>) {
  if (!sale.customer || !['CREDIT', 'FLEET'].includes(sale.paymentMethod)) return;
  const customer = await prisma.customer.findFirst({ where: { id: sale.customer.id, organizationId }, select: { creditDays: true } });
  if (!customer) return;
  const dueDate = new Date(sale.occurredAt);
  dueDate.setDate(dueDate.getDate() + customer.creditDays);
  await notifyCreditSale({
    saleId: sale.id,
    organizationId,
    stationId: sale.station.id,
    stationName: sale.station.name,
    customerId: sale.customer.id,
    customerName: sale.customer.name,
    productName: sale.product.name,
    productCode: sale.product.code,
    quantity: Number(sale.quantity),
    unit: sale.product.unit,
    amount: Number(sale.totalAmount),
    dueDate,
    occurredAt: sale.occurredAt,
  }).catch(() => undefined);
}

async function createMeteredSale(organizationId: string, input: SaleInput, shift: { id: string; configurationId: string; nozzleReadings: Array<{ nozzleId: string; openingMeter: Prisma.Decimal }>;nozzleAssignments:Array<{nozzleId:string;userId:string}> }, product: { id: string; category: string; unit: string; packSizeLitres: Prisma.Decimal | null; inventoryTracked: boolean; tankLinked: boolean; isService: boolean; purchasePrice: Prisma.Decimal;sellingPrice:Prisma.Decimal }) {
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

async function persistSale({ organizationId, input, kind, quantity, product }: { organizationId: string; input: SaleInput; kind: 'METERED' | 'PRODUCT' | 'SERVICE'; quantity: number; product: { id: string; category: string; unit: string; packSizeLitres: Prisma.Decimal | null; inventoryTracked: boolean; tankLinked: boolean; isService: boolean; purchasePrice: Prisma.Decimal;sellingPrice:Prisma.Decimal } }) {
  const unitPrice = product.sellingPrice; const totalAmount = new Prisma.Decimal(quantity).mul(unitPrice);
  return safeTransaction(prisma, async tx => {
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (!Number.isFinite(quantity) || quantity <= 0) throw new AppError(400, 'QUANTITY_REQUIRED', 'Enter a positive quantity for this sale.');
    const station = await tx.station.findFirst({ where: { id: input.stationId, organizationId, active: true }, select: { id: true } });
    if (!station) throw new AppError(404, 'STATION_NOT_FOUND', 'Choose an active fuel station.');
    const currentProduct = await tx.product.findFirst({ where: { id: product.id, organizationId, active: true }, select: { unit: true, tankLinked: true, packSizeLitres: true } });
    if (!currentProduct || currentProduct.unit !== product.unit || currentProduct.tankLinked !== product.tankLinked || String(currentProduct.packSizeLitres) !== String(product.packSizeLitres)) throw new AppError(409, 'PRODUCT_FORMAT_CHANGED', 'This product changed while the sale was being prepared. Refresh and choose it again.');
    const employee = await tx.user.findFirst({ where: { id: input.employeeId, organizationId, active: true }, select: { id: true } });
    if (!employee) throw new AppError(400, 'EMPLOYEE_INVALID', 'Choose an active employee from your account.');
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) throw new AppError(400, 'SALE_TIME_INVALID', 'The sale time cannot be in the future.');
    if (input.shiftId) {
      const liveShift = await tx.shift.findFirst({ where: { id: input.shiftId, stationId: input.stationId, status: 'OPEN', station: { organizationId } }, include: { users: true, nozzleAssignments: true } });
      if (!liveShift) throw new AppError(409, 'SHIFT_NOT_OPEN', 'This shift was closed before the sale could be saved. Refresh and choose an open shift.');
      const assigned = input.employeeId === liveShift.managerId || liveShift.users.some(row => row.userId === input.employeeId);
      const custodian = liveShift.nozzleAssignments.find(row => row.nozzleId === input.nozzleId);
      if (!assigned || (custodian && custodian.userId !== input.employeeId)) throw new AppError(403, 'EMPLOYEE_NOT_ON_SHIFT', 'Choose the employee assigned to this shift and nozzle.');
      if (occurredAt < liveShift.openedAt) throw new AppError(400, 'SALE_TIME_INVALID', 'The sale time must fall within the current open shift.');
    }
    if (product.tankLinked) {
      const tank = input.tankId ? await tx.tank.findFirst({ where: { id: input.tankId, productId: product.id, status: 'ACTIVE', configuration: { active: true, stationId: input.stationId, station: { organizationId } } }, select: { id: true } }) : null;
      if (!tank) throw new AppError(400, 'TANK_REQUIRED', 'Choose an active source tank for this product at this fuel station.');
    } else if (input.tankId) throw new AppError(400, 'EQUIPMENT_NOT_APPLICABLE', 'This counter product has no source tank.');
    if(kind==='METERED'&&input.nozzleId){const latest=await tx.sale.findFirst({where:{shiftId:input.shiftId ?? null,nozzleId:input.nozzleId,kind:'METERED'},orderBy:[{meterClosing:'desc'},{createdAt:'desc'}],select:{meterClosing:true}});if(latest&&Math.abs(Number(latest.meterClosing)-Number(input.meterOpening))>.001)throw new AppError(409,'METER_ALREADY_ADVANCED',`This nozzle has already advanced to ${Number(latest.meterClosing).toLocaleString()} L. Refresh before recording the next sale.`);}
    const customer = input.customerId ? await tx.customer.findFirst({ where: { id: input.customerId, organizationId, active: true } }) : null;
    if (input.customerId && !customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Choose an active customer account.');
    if (input.paymentMethod === 'FLEET' && customer?.type !== 'FLEET') throw new AppError(400, 'FLEET_ACCOUNT_REQUIRED', 'Fleet collections require a fleet account.');
    const vehicle = input.vehicleId && customer ? await tx.vehicle.findFirst({ where: { id: input.vehicleId, customerId: customer.id, active: true } }) : null;
    if (input.vehicleId && !vehicle) throw new AppError(400, 'VEHICLE_INVALID', 'Choose a vehicle registered to this customer.');
    if (customer && ['CREDIT', 'FLEET'].includes(input.paymentMethod)) { const aggregate = await tx.customerLedgerEntry.aggregate({ where: { customerId: customer.id }, _sum: { amount: true } }); const projected = new Prisma.Decimal(aggregate._sum.amount ?? 0).add(totalAmount); if (projected.greaterThan(customer.creditLimit)) throw new AppError(409, 'CREDIT_LIMIT_EXCEEDED', `This sale would exceed ${customer.name}'s credit limit.`); }
    if (product.inventoryTracked) await assertStockAvailable(tx, { organizationId, stationId: input.stationId, productId: product.id, tankId: input.tankId }, quantity);
    const sale = await tx.sale.create({ data: { organizationId, stationId: input.stationId, shiftId: input.shiftId ?? null, productId: product.id, employeeId: input.employeeId, tankId: input.tankId ?? null, nozzleId: input.nozzleId ?? null, kind, paymentMethod: input.paymentMethod, quantity: new Prisma.Decimal(quantity), unitPrice, totalAmount, meterOpening: input.meterOpening ?? null, meterClosing: input.meterClosing ?? null, customerId: customer?.id ?? null, vehicleId: vehicle?.id ?? null, customerName: customer?.name ?? input.customerName ?? null, vehicleNumber: vehicle?.number ?? input.vehicleNumber ?? null, notes: input.notes || null, occurredAt }, include: saleInclude });
    if (product.inventoryTracked) await tx.inventoryLedger.create({ data: { organizationId, stationId: input.stationId, productId: product.id, tankId: input.tankId ?? null, type: 'SALE', quantityDelta: new Prisma.Decimal(quantity).neg(), unitCost:product.purchasePrice, saleId: sale.id, occurredAt: sale.occurredAt, createdById: input.employeeId } });
    if (customer && ['CREDIT', 'FLEET'].includes(input.paymentMethod)) { const dueDate = new Date(sale.occurredAt); dueDate.setDate(dueDate.getDate() + customer.creditDays); await tx.customerLedgerEntry.create({ data: { organizationId, stationId: input.stationId, customerId: customer.id, type: 'SALE', amount: totalAmount, saleId: sale.id, description: `${sale.product.name} sale`, dueDate, occurredAt: sale.occurredAt, createdById: input.employeeId } }); }
    await postJournal(tx,{organizationId,stationId:input.stationId,createdById:input.employeeId,journalDate:sale.occurredAt,reference:`SALE-${sale.id.slice(-8)}`,description:`${sale.product.name} sale`,sourceType:'SALE',sourceId:sale.id,lines:[{account:collectionAccount(input.paymentMethod),debit:totalAmount},{account:product.isService?'4010':'4000',credit:totalAmount},...(product.inventoryTracked?[{account:'5000',debit:new Prisma.Decimal(quantity).mul(product.purchasePrice)},{account:'1200',credit:new Prisma.Decimal(quantity).mul(product.purchasePrice)}]:[])]});
    await enqueueReview(tx, { type: 'SALE_RECORDED', organizationId, stationId: sale.stationId, resourceId: sale.id, occurredAt: sale.occurredAt });
    return sale;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
