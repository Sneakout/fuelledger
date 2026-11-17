import { describe, expect, it } from 'vitest';

const suite = process.env.RECOVERY_TEST_DATABASE_URL ? describe : describe.skip;
suite('isolated release workflow', () => {
  it('checks fuel, lubricant credit, repayment, expense, correction and next opening', async () => {
    if (process.env.DATABASE_URL !== process.env.RECOVERY_TEST_DATABASE_URL) throw new Error('Use only the explicitly isolated database');
    const { prisma: db } = await import('../src/lib/prisma.js');
    const purchases = await import('../src/modules/purchases/service.js');
    const shifts = await import('../src/modules/shifts/service.js');
    const { createSale } = await import('../src/modules/sales/service.js');
    const { reconcile } = await import('../src/modules/reconciliation/service.js');
    const { receivePayment } = await import('../src/modules/customers/service.js');
    const org = await db.organization.create({data:{name:'Release scenario'}});
    const user = await db.user.create({data:{organizationId:org.id,name:'Test owner',email:`${org.id}@example.test`,passwordHash:'not-a-login',role:'OWNER'}});
    const station = await db.station.create({data:{organizationId:org.id,name:'Test fuel station',code:'TEST',addressLine1:'Test',city:'Test',state:'Test',postalCode:'000000'}});
    const fuel = await db.product.create({data:{organizationId:org.id,name:'Petrol',code:'MS',category:'FUEL',unit:'LITRE',purchasePrice:90,sellingPrice:100,tankLinked:true,meterLinked:true}});
    const oil = await db.product.create({data:{organizationId:org.id,name:'Oil',code:'OIL',category:'LUBRICANTS',unit:'PIECE',purchasePrice:50,sellingPrice:100}});
    const config = await db.stationConfiguration.create({data:{stationId:station.id,version:1}});
    const tank = await db.tank.create({data:{configurationId:config.id,productId:fuel.id,code:'T1',nominalCapacity:5000,workingCapacity:4500,tankType:'UNDERGROUND',dipMethod:'MANUAL'}});
    const du = await db.dispenser.create({data:{configurationId:config.id,code:'D1'}});
    const nozzle = await db.nozzle.create({data:{dispenserId:du.id,productId:fuel.id,code:'N1',tankMappings:{create:{tankId:tank.id}}}});
    const supplier = await db.supplier.create({data:{organizationId:org.id,name:'Test supplier',code:'SUP',paymentTerms:3}});
    const customer = await db.customer.create({data:{organizationId:org.id,name:'Test customer',code:'C1',type:'CREDIT',creditLimit:1000,creditDays:7}});
    const yesterday = new Date(Date.now()-86400000).toISOString();
    const invoice = await purchases.createInvoice(org.id,user.id,{stationId:station.id,supplierId:supplier.id,invoiceNumber:'I1',invoiceDate:yesterday,dueDate:yesterday,taxAmount:0,receiveNow:true,paidNow:false,lines:[{productId:fuel.id,tankId:tank.id,description:'Fuel',quantity:1000,unitCost:90,taxRate:0},{productId:oil.id,description:'Oil',quantity:10,unitCost:50,taxRate:0}]});
    const opening = {stationId:station.id,managerId:user.id,userIds:[user.id],nozzleAssignments:[{nozzleId:nozzle.id,userId:user.id}],openingCash:0,tankReadings:[{id:tank.id,value:1000}],nozzleReadings:[{id:nozzle.id,value:0}]};
    const shift = await shifts.openShift(org.id,opening);
    await createSale(org.id,{stationId:station.id,shiftId:shift.id,employeeId:user.id,productId:oil.id,quantity:1,unitPrice:100,paymentMethod:'CREDIT',customerId:customer.id} as any);
    await shifts.closeShift(org.id,shift.id,{closingCash:10000,tankReadings:[{id:tank.id,value:900}],nozzleReadings:[{id:nozzle.id,value:100,testingQuantity:0,testingReturned:true}],nozzleCollections:[{nozzleId:nozzle.id,amount:10000}]});
    await reconcile(org.id,user.id,shift.id,{collections:['CASH','UPI','CARD','CREDIT','FLEET','OTHER'].map(paymentMethod=>({paymentMethod,adjustmentAmount:paymentMethod==='CASH'?10000:paymentMethod==='OTHER'?-10000:0,actualAmount:paymentMethod==='CASH'?10000:paymentMethod==='CREDIT'?100:0,adjustmentReason:'Payment split verified'})),creditAllocations:[{paymentMethod:'CREDIT',customerId:customer.id,amount:100}]} as any);
    await receivePayment(org.id,customer.id,user.id,{stationId:station.id,amount:50,paymentMethod:'CASH'} as any);
    const category = await db.expenseCategory.create({data:{organizationId:org.id,name:'Repairs',code:'REPAIR'}});
    await purchases.createExpense(org.id,user.id,{stationId:station.id,categoryId:category.id,amount:20,paymentMethod:'CASH',description:'Test expense',incurredAt:new Date().toISOString()} as any);
    await purchases.updateInvoice(org.id,user.id,invoice.id,{version:0,invoiceNumber:'I1',invoiceDate:yesterday,dueDate:yesterday,refreshPrices:false,markPaid:false,correctionReason:'Correct original delivery quantity',lines:invoice.lines.map(line=>({id:line.id,quantity:line.productId===fuel.id?1100:10}))});
    expect(Number((await db.customerLedgerEntry.aggregate({where:{customerId:customer.id},_sum:{amount:true}}))._sum.amount)).toBe(50);
    expect(Number((await db.inventoryLedger.aggregate({where:{stationId:station.id,productId:fuel.id},_sum:{quantityDelta:true}}))._sum.quantityDelta)).toBe(1000);
    expect(Number((await db.inventoryLedger.aggregate({where:{stationId:station.id,productId:oil.id},_sum:{quantityDelta:true}}))._sum.quantityDelta)).toBe(9);
    const next = await shifts.openShift(org.id,{...opening,tankReadings:[{id:tank.id,value:900}],nozzleReadings:[{id:nozzle.id,value:100}]});
    expect(next.shiftNumber).toBe(2);
    expect(await db.sale.count({where:{shiftId:shift.id}})).toBe(2);
    await db.$disconnect();
  },30000);
});

suite('multi-tender retail shifts', () => {
  it('closes MS, HSD and lubricant shifts with returned testing, paid fleet, and accurate collection variances', async () => {
    if (process.env.DATABASE_URL !== process.env.RECOVERY_TEST_DATABASE_URL) throw new Error('Use only the explicitly isolated database');
    const { prisma: db } = await import('../src/lib/prisma.js');
    const { createInvoice } = await import('../src/modules/purchases/service.js');
    const { openShift, closeShift } = await import('../src/modules/shifts/service.js');
    const { createSale } = await import('../src/modules/sales/service.js');
    const { reconcile } = await import('../src/modules/reconciliation/service.js');
    const { readShiftMessageFacts, readTankAlertFacts } = await import('../src/modules/notifications/message-facts.js');
    const { shiftMessage } = await import('../src/modules/notifications/agent-messages.js');
    const organization = await db.organization.create({ data: { name: 'Multi-tender verification' } });
    const organizationId = organization.id;
    const owner = await db.user.create({ data: { organizationId, name: 'Owner', email: `${organizationId}@example.test`, passwordHash: 'fixture', role: 'OWNER' } });
    const makeStation = (code: string) => db.station.create({ data: { organizationId, code, name: code, addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000' } });
    const [station, other] = await Promise.all([makeStation('MAIN'), makeStation('OTHER')]);
    const config = await db.stationConfiguration.create({ data: { stationId: station.id, version: 1 } });
    const otherConfig = await db.stationConfiguration.create({ data: { stationId: other.id, version: 1 } });
    const du = await db.dispenser.create({ data: { configurationId: config.id, code: 'D1' } });
    const fuel = await Promise.all(['MS', 'HSD'].map(async (code, index) => {
      const product = await db.product.create({ data: { organizationId, code, name: code, category: 'FUEL', unit: 'LITRE', purchasePrice: 80, sellingPrice: 100, tankLinked: true, meterLinked: true } });
      const tankSettings = { productId: product.id, workingCapacity: 5000, nominalCapacity: 5000, tankType: 'UNDERGROUND' as const, dipMethod: 'MANUAL' as const };
      const tank = await db.tank.create({ data: { ...tankSettings, configurationId: config.id, code: `T${index + 1}` } });
      const otherTank = await db.tank.create({ data: { ...tankSettings, configurationId: otherConfig.id, code: tank.code, openingStock: 4500 } });
      const nozzle = await db.nozzle.create({ data: { dispenserId: du.id, productId: product.id, code: `N${index + 1}`, tankMappings: { create: { tankId: tank.id } } } });
      return { product, tank, otherTank, nozzle };
    }));
    const oil = await db.product.create({ data: { organizationId, name: 'Lubricant', code: 'OIL', category: 'LUBRICANTS', unit: 'PIECE', purchasePrice: 50, sellingPrice: 100 } });
    const supplier = await db.supplier.create({ data: { organizationId, name: 'Supplier', code: 'SUP', paymentTerms: 3 } });
    const credit = await db.customer.create({ data: { organizationId, name: 'Credit customer', code: 'C1', creditLimit: 2000, creditDays: 7 } });
    const fleet = await db.customer.create({ data: { organizationId, name: 'Paid fleet', code: 'F1', type: 'FLEET', creditLimit: 0 } });
    const date = new Date().toISOString();
    await createInvoice(organizationId, owner.id, { stationId: station.id, supplierId: supplier.id, invoiceNumber: 'I-MIX', invoiceDate: date, dueDate: date, taxAmount: 0, receiveNow: true, paidNow: false,
      lines: [...fuel.map(({ product, tank }) => ({ productId: product.id, tankId: tank.id, description: product.code, quantity: 1000, unitCost: 80, taxRate: 0 })),
        { productId: oil.id, description: 'Lubricant', quantity: 10, unitCost: 50, taxRate: 0 }] });
    const scope = { organizationId, stationId: station.id };
    const { createHistoricalImport } = await import('../src/modules/historical-sales/service.js');
    const { addIndiaDays, indiaDate } = await import('../src/lib/india-time.js');
    const { createHash } = await import('node:crypto');
    const registerDate = addIndiaDays(indiaDate(), -40);
    const { product, tank, nozzle } = fuel[0]!;
    const source = Buffer.from('fixture historical register');
    await db.organization.update({ where: { id: organizationId }, data: { intelligenceEnabledAt: new Date() } });
    const beforeImport = await db.nerveReviewJob.count({ where: scope });
    await createHistoricalImport(organizationId, owner.id, { ...scope, productId: product.id, month: registerDate.slice(0, 7),
      sourceFileName: 'fixture.pdf', sourceMimeType: 'application/pdf', sourceSize: source.length, sourceContentBase64: source.toString('base64'),
      sourceFingerprint: createHash('sha256').update(source).digest('hex'), applyCutover: false,
      rows: [{ date: registerDate, salesQuantity: 0, sellingPrice: 100, receiptQuantity: 999, testingQuantity: 0,
        tankReadings: [{ tankId: tank.id, openingStock: 3900 }], nozzleReadings: [{ nozzleId: nozzle.id, meterReading: 555 }] }],
    });
    expect(await db.nerveReviewJob.count({ where: scope })).toBe(beforeImport);
    expect(await db.ownerNotificationDelivery.count({ where: scope })).toBe(0);
    expect((await readTankAlertFacts(scope, tank.id))?.bookStock.toNumber()).toBe(1000);
    const methods = ['CASH', 'UPI', 'CARD', 'CREDIT', 'FLEET', 'OTHER'] as const;
    for (const [index, difference] of [0, -10, 20].entries()) {
      const shift = await openShift(organizationId, { stationId: station.id, managerId: owner.id, userIds: [owner.id], openingCash: 0,
        tankReadings: fuel.map(({ tank }, t) => ({ id: tank.id, value: 1000 - index * (t === 0 ? 10 : 20) })),
        nozzleReadings: fuel.map(({ nozzle }, t) => ({ id: nozzle.id, value: index * (t === 0 ? 15 : 22) })),
        nozzleAssignments: fuel.map(({ nozzle }) => ({ nozzleId: nozzle.id, userId: owner.id })) });
      await createSale(organizationId, { stationId: station.id, shiftId: shift.id, employeeId: owner.id, productId: oil.id, quantity: 1, unitPrice: 100, paymentMethod: 'CREDIT', customerId: credit.id } as any);
      await closeShift(organizationId, shift.id, { closingCash: 1000 + difference,
        tankReadings: fuel.map(({ tank }, t) => ({ id: tank.id, value: 1000 - (index + 1) * (t === 0 ? 10 : 20) })),
        nozzleReadings: fuel.map(({ nozzle }, t) => ({ id: nozzle.id, value: (index + 1) * (t === 0 ? 15 : 22), testingQuantity: t === 0 ? 5 : 2, testingReturned: true })),
        nozzleCollections: fuel.map(({ nozzle }, t) => ({ nozzleId: nozzle.id, amount: t === 0 ? 1000 : 2000 })) });
      expect((await readShiftMessageFacts(scope, shift.id))?.completeness).toBe('INCOMPLETE');
      await reconcile(organizationId, owner.id, shift.id, {
        collections: methods.map(paymentMethod => ({
          paymentMethod, adjustmentAmount: { CASH: 1000, UPI: 900, CARD: 1100, CREDIT: 0, FLEET: 0, OTHER: -3000 }[paymentMethod],
          actualAmount: { CASH: 1000 + difference, UPI: 900, CARD: 1100, CREDIT: 100, FLEET: 0, OTHER: 0 }[paymentMethod],
          adjustmentReason: 'Match actual tender breakdown',
        })),
        creditAllocations: [{ paymentMethod: 'CREDIT', customerId: credit.id, amount: 100 }, { paymentMethod: 'UPI', customerId: fleet.id, amount: 300 }],
      } as any);
      const facts = (await readShiftMessageFacts(scope, shift.id))!;
      expect(facts.sales.map(line => [line.product.code, line.quantity.toNumber(), line.value.toNumber()])).toEqual([['HSD', 20, 2000], ['MS', 10, 1000], ['OIL', 1, 100]]);
      expect(facts.collections?.adjustedExpected.toNumber()).toBe(3000);
      expect(facts.collections?.actual.toNumber()).toBe(3000 + difference);
      expect(facts.collections?.difference.toNumber()).toBe(difference);
      const summary = shiftMessage(facts);
      expect(summary).toContain('OIL: 1 piece');
      if (difference === 0) expect(summary).not.toMatch(/Shortage|Excess/);
      else expect(summary).toContain(difference < 0 ? 'Shortage: ₹10.00' : 'Excess: ₹20.00');
      expect(await readShiftMessageFacts({ ...scope, stationId: other.id }, shift.id)).toBeNull();
    }
    expect(await db.customerLedgerEntry.count({ where: { customerId: fleet.id } })).toBe(0);
    expect(Number((await db.customerLedgerEntry.aggregate({ where: { customerId: credit.id }, _sum: { amount: true } }))._sum.amount)).toBe(300);
    expect(Number((await db.inventoryLedger.aggregate({ where: { ...scope, productId: oil.id }, _sum: { quantityDelta: true } }))._sum.quantityDelta)).toBe(7);
    const closing = await Promise.all(fuel.map(({ tank }) => readTankAlertFacts(scope, tank.id)));
    expect(closing.map(row => row?.bookStock.toNumber())).toEqual([970, 940]);
    const isolated = await Promise.all(fuel.map(({ otherTank }) => readTankAlertFacts({ ...scope, stationId: other.id }, otherTank.id)));
    expect(isolated.map(row => row?.bookStock.toNumber())).toEqual([4500, 4500]);
    expect(await readTankAlertFacts({ ...scope, stationId: other.id }, fuel[0]!.tank.id)).toBeNull();
    await db.$disconnect();
  }, 30_000);
});
