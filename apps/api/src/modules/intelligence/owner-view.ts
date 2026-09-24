import { bootstrap as customerBootstrap } from '../customers/service.js';
import { bootstrap as dashboardBootstrap } from '../dashboard/service.js';

export async function intelligenceOwnerView(organizationId: string, stationId: string) {
  const [dashboard, customers] = await Promise.all([
    dashboardBootstrap(organizationId, [stationId], stationId),
    customerBootstrap(organizationId, [stationId]),
  ]);
  return {
    asOf: dashboard.asOf,
    stationId,
    summary: {
      sales: dashboard.today.grossSales,
      transactions: dashboard.today.transactions,
      meteredVolume: dashboard.today.meteredVolume,
      collections: dashboard.collections.filter(row => !['CREDIT', 'FLEET'].includes(row.method)).reduce((sum, row) => sum + row.amount, 0),
      netProfit: dashboard.today.netProfit,
      openShifts: dashboard.operations.openShifts,
      pendingReconciliations: dashboard.operations.pendingReconciliations,
    },
    collections: dashboard.collections,
    customers: customers.customers
      .filter(customer => customer.outstanding > 0.005)
      .map(customer => ({ id: customer.id, name: customer.name, code: customer.code, outstanding: customer.outstanding, availableCredit: customer.availableCredit }))
      .sort((left, right) => right.outstanding - left.outstanding),
  };
}
