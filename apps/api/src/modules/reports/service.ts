import { prisma } from '../../lib/prisma.js';
import { effectivePriceAt } from '../../lib/effective-price.js';

type ReportFilter = { startDate: string; endDate: string; stationId?: string | undefined; permittedStationIds?: string[] | undefined };

const number = (value: unknown) => Number(value ?? 0);
const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);
const add = <T>(map: Map<string, T>, key: string, make: () => T, update: (row: T) => void) => {
  const row = map.get(key) ?? make(); update(row); map.set(key, row);
};

export async function buildReport(organizationId: string, filter: ReportFilter) {
  const start = new Date(`${filter.startDate}T00:00:00`);
  const endExclusive = new Date(`${filter.endDate}T00:00:00`); endExclusive.setDate(endExclusive.getDate() + 1);
  const stationIds=filter.stationId?[filter.stationId]:filter.permittedStationIds;
  const stationWhere = stationIds ? { stationId: { in: stationIds } } : {};
  const period = { gte: start, lt: endExclusive };
  const station = filter.stationId ? await prisma.station.findFirst({ where: { id: filter.stationId, organizationId,...(filter.permittedStationIds?{id:{in:filter.permittedStationIds}}:{}) } }) : null;
  if (filter.stationId && !station) throw new Error('REPORT_STATION_NOT_FOUND');

  const [stations, sales, expenses, periodInvoices, openInvoices, inventoryEntries, tanks, customers, journalLines] = await Promise.all([
    prisma.station.findMany({ where: { organizationId, active: true,...(stationIds?{id:{in:stationIds}}:{}) }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    prisma.sale.findMany({ where: { organizationId, ...stationWhere, occurredAt: period }, include: { station: { select: { id: true, name: true, code: true } }, product: { select: { id: true, name: true, code: true, unit: true, category: true } } }, orderBy: { occurredAt: 'asc' } }),
    prisma.expense.findMany({
      where: { organizationId, ...stationWhere, incurredAt: period },
      include: { category: { select: { name: true, code: true } }, station: { select: { name: true, code: true } } },
    }),
    prisma.purchaseInvoice.findMany({ where: { organizationId, ...stationWhere, invoiceDate: period, status: { not: 'VOID' } }, select: { totalAmount: true } }),
    prisma.purchaseInvoice.findMany({ where: { organizationId, ...stationWhere, status: { in: ['OPEN', 'PART_PAID'] } }, include: { payments: { select: { amount: true } }, supplier: { select: { name: true, code: true } }, station: { select: { name: true, code: true } } }, orderBy: { dueDate: 'asc' } }),
    prisma.inventoryLedger.findMany({ where: { organizationId, ...stationWhere }, include: { product: { select: { id: true, name: true, code: true, unit: true, purchasePrice: true, purchasePriceHistory:{where:{effectiveFrom:{lte:new Date()}},orderBy:{effectiveFrom:'desc'},take:1} } }, station: { select: { id: true, name: true, code: true } } } }),
    prisma.tank.findMany({ where: { configuration: { active: true, station: { organizationId, ...(stationIds ? { id:{in:stationIds} } : {}) } } }, include: { product: { select: { id: true, name: true, code: true, unit: true, purchasePrice: true, purchasePriceHistory:{where:{effectiveFrom:{lte:new Date()}},orderBy:{effectiveFrom:'desc'},take:1} } }, configuration: { include: { station: { select: { id: true, name: true, code: true } } } } } }),
    prisma.customer.findMany({ where: { organizationId, active: true }, include: { ledger: { where: stationIds ? { stationId:{in:stationIds} } : {}, select: { amount: true, dueDate: true } } }, orderBy: { name: 'asc' } }),
    prisma.journalLine.findMany({ where: { journal: { organizationId, ...stationWhere, journalDate: period } }, include: { account: { select: { code: true, name: true, type: true } } } }),
  ]);

  const salesByProduct = new Map<string, { key: string; product: string; code: string; unit: string; quantity: number; revenue: number }>();
  const salesByPayment = new Map<string, { key: string; method: string; transactions: number; amount: number }>();
  const dailySales = new Map<string, { key: string; date: string; transactions: number; amount: number }>();
  const stationSales = new Map<string, { key: string; station: string; code: string; transactions: number; amount: number }>();
  for (const sale of sales) {
    add(salesByProduct, sale.productId, () => ({ key: sale.productId, product: sale.product.name, code: sale.product.code, unit: sale.product.unit, quantity: 0, revenue: 0 }), row => { row.quantity += number(sale.quantity); row.revenue += number(sale.totalAmount); });
    add(salesByPayment, sale.paymentMethod, () => ({ key: sale.paymentMethod, method: sale.paymentMethod, transactions: 0, amount: 0 }), row => { row.transactions += 1; row.amount += number(sale.totalAmount); });
    const day = `${sale.occurredAt.getFullYear()}-${String(sale.occurredAt.getMonth()+1).padStart(2,'0')}-${String(sale.occurredAt.getDate()).padStart(2,'0')}`;
    add(dailySales, day, () => ({ key: day, date: day, transactions: 0, amount: 0 }), row => { row.transactions += 1; row.amount += number(sale.totalAmount); });
    add(stationSales, sale.stationId, () => ({ key: sale.stationId, station: sale.station.name, code: sale.station.code, transactions: 0, amount: 0 }), row => { row.transactions += 1; row.amount += number(sale.totalAmount); });
  }

  const expenseByCategory = new Map<string, { key: string; category: string; amount: number }>();
  for (const expense of expenses) add(expenseByCategory, expense.category.code, () => ({ key: expense.category.code, category: expense.category.name, amount: 0 }), row => { row.amount += number(expense.amount); });

  const stock = new Map<string, { key: string; product: string; code: string; unit: string; station: string; quantity: number; value: number; purchasePrice: number }>();
  const stockKey = (stationId: string, productId: string) => `${stationId}:${productId}`;
  for (const tank of tanks) {
    const itemKey = stockKey(tank.configuration.station.id, tank.productId);
    const purchasePrice=effectivePriceAt(tank.product.purchasePrice,tank.product.purchasePriceHistory);
    add(stock, itemKey, () => ({ key: itemKey, product: tank.product.name, code: tank.product.code, unit: tank.product.unit, station: tank.configuration.station.name, quantity: 0, value: 0, purchasePrice: number(purchasePrice) }), row => { row.quantity += number(tank.openingStock); row.value+=number(tank.openingStock)*number(purchasePrice); });
  }
  for (const entry of inventoryEntries) {
    const itemKey = stockKey(entry.stationId, entry.productId);
    const purchasePrice=effectivePriceAt(entry.product.purchasePrice,entry.product.purchasePriceHistory);
    add(stock, itemKey, () => ({ key: itemKey, product: entry.product.name, code: entry.product.code, unit: entry.product.unit, station: entry.station.name, quantity: 0, value: 0, purchasePrice: number(purchasePrice) }), row => { const quantity=number(entry.quantityDelta),unitCost=number(entry.unitCost??purchasePrice);row.quantity+=quantity;row.value+=quantity*unitCost; });
  }
  const inventory = [...stock.values()].sort((a, b) => b.value - a.value);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const customerAgeing = customers.map(customer => {
    const outstanding = sum(customer.ledger, row => number(row.amount));
    const ageing = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
    for (const row of customer.ledger.filter(item => number(item.amount) > 0)) {
      const days = row.dueDate ? Math.floor((today.getTime() - row.dueDate.getTime()) / 86400000) : 0;
      const bucket = days <= 0 ? 'current' : days <= 30 ? 'days1to30' : days <= 60 ? 'days31to60' : days <= 90 ? 'days61to90' : 'days90plus';
      ageing[bucket] += number(row.amount);
    }
    const receipts = Math.abs(sum(customer.ledger.filter(row => number(row.amount) < 0), row => number(row.amount)));
    let remaining = receipts;
    for (const bucket of ['days90plus', 'days61to90', 'days31to60', 'days1to30', 'current'] as const) { const applied = Math.min(ageing[bucket], remaining); ageing[bucket] -= applied; remaining -= applied; }
    return { id: customer.id, customer: customer.name, code: customer.code, type: customer.type, outstanding, ageing };
  }).filter(row => row.outstanding > .005).sort((a, b) => b.outstanding - a.outstanding);

  const payables = openInvoices.map(invoice => {
    const outstanding = number(invoice.totalAmount) - sum(invoice.payments, row => number(row.amount));
    return { id: invoice.id, invoiceNumber: invoice.invoiceNumber, supplier: invoice.supplier.name, station: invoice.station.name, dueDate: invoice.dueDate.toISOString(), outstanding, overdue: invoice.dueDate < today };
  }).filter(row => row.outstanding > .005);

  const accountTotals = new Map<string, { code: string; name: string; type: string; debit: number; credit: number; balance: number }>();
  for (const line of journalLines) add(accountTotals, line.account.code, () => ({ code: line.account.code, name: line.account.name, type: line.account.type, debit: 0, credit: 0, balance: 0 }), row => { row.debit += number(line.debit); row.credit += number(line.credit); });
  for (const row of accountTotals.values()) row.balance = row.type === 'REVENUE' || row.type === 'LIABILITY' ? row.credit - row.debit : row.debit - row.credit;
  const revenue = sum([...accountTotals.values()].filter(row => row.type === 'REVENUE'), row => row.balance);
  const cogs = accountTotals.get('5000')?.balance ?? 0;
  const operatingExpenses = accountTotals.get('6100')?.balance ?? 0;
  const grossSales = sum(sales, row => number(row.totalAmount));

  return {
    filter: { startDate:filter.startDate,endDate:filter.endDate,...(filter.stationId?{stationId:filter.stationId}:{}), station: station ? { id: station.id, name: station.name, code: station.code } : null }, stations,
    summary: { grossSales, transactions: sales.length, meteredVolume: sum(sales.filter(row => row.kind === 'METERED'), row => number(row.quantity)), purchases: sum(periodInvoices, row => number(row.totalAmount)), expenses: sum(expenses, row => number(row.amount)), receivables: sum(customerAgeing, row => row.outstanding), payables: sum(payables, row => row.outstanding), inventoryValue: sum(inventory, row => row.value), grossProfit: revenue - cogs, netProfit: revenue - cogs - operatingExpenses },
    sales: { byProduct: [...salesByProduct.values()].sort((a, b) => b.revenue - a.revenue), byPayment: [...salesByPayment.values()].sort((a, b) => b.amount - a.amount), daily: [...dailySales.values()], byStation: [...stationSales.values()].sort((a, b) => b.amount - a.amount) },
    inventory, customers: customerAgeing, payables, expenses: [...expenseByCategory.values()].sort((a, b) => b.amount - a.amount),
    financial: { accounts: [...accountTotals.values()].sort((a, b) => a.code.localeCompare(b.code)), revenue, cogs, operatingExpenses, grossProfit: revenue - cogs, netProfit: revenue - cogs - operatingExpenses },
  };
}
