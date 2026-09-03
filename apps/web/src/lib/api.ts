import type { ApiError, ChangePasswordInput, CustomerInput, CustomerReceiptInput, DemoAccessInput, DensityReadingInput,ExpenseCategoryInput, ExpenseInput, GoogleAuthInput,InventoryAdjustmentInput, LoginInput, ManagerInput, OwnerNotificationSettingsInput, PurchaseInvoiceInput, PurchaseInvoiceUpdateInput, ReceiptInput, ReconciliationInput, SaleInput, SignupInput,StationAccessInput, StationProfileInput, StationSetup, SupplierInput, SupplierPaymentInput, TankReadingInput, User, VehicleInput } from '@fuelledger/shared';
const API_URL = import.meta.env.VITE_API_URL ?? '/api';
export class ApiRequestError extends Error { constructor(message: string, public readonly code: string, public readonly requestId?: string, public readonly details?: unknown) { super(message); } }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new ApiRequestError(
      response.ok ? 'The server returned an invalid response.' : 'FuelLedger could not connect to its server. Please try again shortly.',
      response.ok ? 'INVALID_SERVER_RESPONSE' : 'SERVER_UNAVAILABLE',
    );
  }
  const body = await response.json() as T | ApiError;
  if (!response.ok) {
    const apiError = body as ApiError;
    throw new ApiRequestError(apiError.error?.message ?? 'Something went wrong.', apiError.error?.code ?? 'REQUEST_FAILED', apiError.error?.requestId, apiError.error?.details);
  }
  return body as T;
}
export const api = {
  login: (input: LoginInput) => request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  signup:(input:SignupInput)=>request<{user:User}>('/auth/signup',{method:'POST',body:JSON.stringify(input)}),
  googleAuth:(input:GoogleAuthInput)=>request<{user:User}>('/auth/google',{method:'POST',body:JSON.stringify(input)}),
  startDemo:(input:DemoAccessInput)=>request<{user:User}>('/auth/demo',{method:'POST',body:JSON.stringify(input)}),
  me: () => request<{ user: User }>('/auth/me'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  changePassword:(input:ChangePasswordInput)=>request<{ok:boolean}>('/auth/change-password',{method:'POST',body:JSON.stringify(input)}),
  stations: () => request<{ stations: StationSummary[] }>('/stations'),
  createStation: (setup: StationSetup) => request<{ station: StationSummary }>('/stations', { method: 'POST', body: JSON.stringify(setup) }),
  stationSetupDraft: (id: string) => request<{ draft: { setup: StationSetup; updatedAt: string } | null }>(`/stations/${id}/draft`),
  saveStationSetupDraft: (id: string, setup: StationSetup) => request<{ draft: { setup: StationSetup; updatedAt: string } }>(`/stations/${id}/draft`, { method: 'PUT', body: JSON.stringify({ setup }) }),
  updateStation: (id: string, profile: StationProfileInput) => request<{ station: StationSummary }>(`/stations/${id}`, { method: 'PUT', body: JSON.stringify(profile) }),
  catalog: () => request<Catalog>('/products'),
  createProduct: (input: ProductForm) => request<{ product: CatalogProduct }>('/products', { method: 'POST', body: JSON.stringify(input) }),
  updateProduct: (id: string, input: ProductForm) => request<{ product: CatalogProduct }>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  createCategory: (input: { name: string; code: string }) => request<{ category: CatalogCategory }>('/products/categories', { method: 'POST', body: JSON.stringify(input) }),
  createTaxCategory: (input: { name: string; rate: number }) => request<{ taxCategory: CatalogTaxCategory }>('/products/tax-categories', { method: 'POST', body: JSON.stringify(input) }),
  shiftBootstrap: () => request<ShiftBootstrap>('/shifts/bootstrap'),
  openShift: (input: ShiftOpenForm) => request<{ shift: Shift }>('/shifts/open', { method: 'POST', body: JSON.stringify(input) }),
  closeShift: (id: string, input: ShiftCloseForm) => request<{ shift: Shift }>(`/shifts/${id}/close`, { method: 'POST', body: JSON.stringify(input) }),
  salesBootstrap: () => request<SalesBootstrap>('/sales/bootstrap'),
  createSale: (input: SaleForm) => request<{ sale: Sale }>('/sales', { method: 'POST', body: JSON.stringify(input) }),
  inventoryBootstrap: () => request<InventoryBootstrap>('/inventory/bootstrap'),
  createReceipt: (input: ReceiptForm) => request<{ receipt: unknown }>('/inventory/receipts', { method: 'POST', body: JSON.stringify(input) }),
  createAdjustment: (input: AdjustmentForm) => request<{ entry: unknown }>('/inventory/adjustments', { method: 'POST', body: JSON.stringify(input) }),
  recordTankReading: (input: TankReadingForm) => request<{ reading: unknown }>('/inventory/tank-readings', { method: 'POST', body: JSON.stringify(input) }),
  recordDensity: (input: DensityReadingInput) => request<{ reading: unknown }>('/inventory/density-readings', { method: 'POST', body: JSON.stringify(input) }),
  reconciliationBootstrap: () => request<ReconciliationBootstrap>('/reconciliation/bootstrap'),
  reconcileShift: (id:string,input:ReconciliationForm) => request<{shift:ReconciliationShift}>(`/reconciliation/shifts/${id}`, {method:'POST',body:JSON.stringify(input)}),
  customersBootstrap: () => request<CustomersBootstrap>('/customers/bootstrap'),
  createCustomer: (input:CustomerInput) => request<{customer:Customer}>('/customers',{method:'POST',body:JSON.stringify(input)}),
  updateCustomer: (id:string,input:CustomerInput) => request<{customer:Customer}>(`/customers/${id}`,{method:'PUT',body:JSON.stringify(input)}),
  addVehicle: (id:string,input:VehicleInput) => request<{vehicle:CustomerVehicle}>(`/customers/${id}/vehicles`,{method:'POST',body:JSON.stringify(input)}),
  receiveCustomerPayment: (id:string,input:CustomerReceiptInput) => request<{receipt:unknown}>(`/customers/${id}/receipts`,{method:'POST',body:JSON.stringify(input)}),
  purchasesBootstrap:()=>request<PurchasesBootstrap>('/purchases/bootstrap'),
  createSupplier:(input:SupplierInput)=>request<{supplier:Supplier}>('/purchases/suppliers',{method:'POST',body:JSON.stringify(input)}),
  createPurchaseInvoice:(input:PurchaseInvoiceInput)=>request<{invoice:PurchaseInvoice}>('/purchases/invoices',{method:'POST',body:JSON.stringify(input)}),
  updatePurchaseInvoice:(id:string,input:PurchaseInvoiceUpdateInput)=>request<{invoice:PurchaseInvoice}>(`/purchases/invoices/${id}`,{method:'PUT',body:JSON.stringify(input)}),
  purchaseInvoicePricePreview:(id:string)=>request<InvoicePricePreview>(`/purchases/invoices/${id}/price-preview`),
  paySupplierInvoice:(input:SupplierPaymentInput)=>request<{payment:unknown}>('/purchases/payments',{method:'POST',body:JSON.stringify(input)}),
  createExpenseCategory:(input:ExpenseCategoryInput)=>request<{category:ExpenseCategory}>('/purchases/expense-categories',{method:'POST',body:JSON.stringify(input)}),
  createExpense:(input:ExpenseInput)=>request<{expense:Expense}>('/purchases/expenses',{method:'POST',body:JSON.stringify(input)}),
  accountingBootstrap:(stationId?:string)=>request<AccountingBootstrap>(`/accounting/bootstrap${stationId?`?stationId=${encodeURIComponent(stationId)}`:''}`),
  reportsBootstrap:(filter:{startDate:string;endDate:string;stationId?:string})=>request<ReportsBootstrap>(`/reports/bootstrap?${new URLSearchParams(Object.entries(filter).filter(([,value])=>value) as string[][]).toString()}`),
  dashboardBootstrap:(stationId?:string)=>request<DashboardBootstrap>(`/dashboard/bootstrap${stationId?`?stationId=${encodeURIComponent(stationId)}`:''}`),
  stationContext:()=>request<StationContextData>('/access/context'),
  accessBootstrap:()=>request<AccessBootstrap>('/access'),
  createStaff:(input:{name:string;stationIds:string[]})=>request<{user:unknown}>('/access/users',{method:'POST',body:JSON.stringify(input)}),
  createManager:(input:ManagerInput)=>request<{user:unknown}>('/access/managers',{method:'POST',body:JSON.stringify(input)}),
  deactivateStaff:(userId:string)=>request<{id:string;active:boolean}>(`/access/users/${userId}`,{method:'DELETE'}),
  updateStationAccess:(userId:string,input:StationAccessInput)=>request<{userId:string;stationIds:string[]}>(`/access/users/${userId}`,{method:'PUT',body:JSON.stringify(input)}),
  updateNozzleCustody:(shiftId:string,assignments:Array<{nozzleId:string;userId:string}>)=>request<{shift:Shift}>(`/shifts/${shiftId}/nozzle-assignments`,{method:'PUT',body:JSON.stringify({assignments})}),
  notificationSettings:()=>request<NotificationBootstrap>('/notifications'),
  updateNotificationSettings:(input:OwnerNotificationSettingsInput)=>request<{settings:NotificationSettings}>('/notifications',{method:'PUT',body:JSON.stringify(input)}),
  testWhatsApp:()=>request<{delivery:{status:string;reason?:string}}>('/notifications/test',{method:'POST'}),
  demoLeads:()=>request<DemoLeadsBootstrap>('/platform/demo-leads'),
};
export type NotificationSettings={whatsappNumber:string|null;whatsappOptedIn:boolean;densityMissingEnabled:boolean;lowStockEnabled:boolean;shiftVarianceEnabled:boolean;unclosedShiftEnabled:boolean;dailySummaryEnabled:boolean;overdueCustomerEnabled:boolean;lowStockPercent:number;varianceThreshold:number;dailySummaryHour:number;providerReady:boolean};
export type NotificationDelivery={id:string;type:string;station:{name:string;code:string}|null;destination:string;message:string;status:'PENDING'|'SENT'|'FAILED';errorMessage:string|null;sentAt:string|null;createdAt:string};
export type NotificationBootstrap={settings:NotificationSettings;deliveries:NotificationDelivery[]};
export type DemoLead={id:string;contact:string;kind:string;createdAt:string;expiresAt:string};
export type DemoLeadsBootstrap={leads:DemoLead[];summary:{sessions:number;uniqueContacts:number}};
export type Reading = { id: string; value: number };
export type ShiftOpenForm = { stationId: string; managerId: string; userIds: string[]; nozzleAssignments:Array<{nozzleId:string;userId:string}>; openingCash: number; tankReadings: Reading[]; nozzleReadings: Reading[]; notes?: string };
export type ShiftCloseForm = { closingCash: number; tankReadings: Reading[]; nozzleReadings: Reading[]; notes?: string };
export type ShiftStation = { id:string;name:string;code:string; configurations:Array<{id:string;version:number;tanks:Array<{id:string;code:string;openingStock:string;product:{name:string;code:string}}>;dispensers:Array<{id:string;code:string;nozzles:Array<{id:string;code:string;openingMeter:string;product:{name:string;code:string}}>}>}> };
export type Shift = { id:string;shiftNumber:number;status:string;openingCash:string;closingCash:string|null;openedAt:string;closedAt:string|null;station:{id:string;name:string;code:string};manager:{id:string;name:string;role:string};users:Array<{user:{id:string;name:string;role:string}}> ;nozzleAssignments:Array<{nozzleId:string;userId:string;user:{id:string;name:string;role:string};nozzle:{code:string;product:{name:string;code:string};dispenser:{code:string}}}>;tankReadings:Array<{tankId:string;openingDip:string;closingDip:string|null;tank:{code:string;product:{name:string;code:string}}}>;nozzleReadings:Array<{nozzleId:string;openingMeter:string;closingMeter:string|null;nozzle:{code:string;product:{name:string;code:string};dispenser:{code:string}}}>;summary:{fuelVolume:number;tanksCaptured:number;nozzlesCaptured:number}};
export type ShiftBootstrap={stations:ShiftStation[];users:Array<{id:string;name:string;role:string}>;shifts:Shift[]};
export type CatalogCategory = { id: string; name: string; code: string; active: boolean };
export type CatalogTaxCategory = { id: string; name: string; rate: string; active: boolean };
export type CatalogProduct = { id: string; name: string; code: string; hsnCode: string | null; category: string; unit: string; purchasePrice: string; sellingPrice: string; inventoryTracked: boolean; tankLinked: boolean; meterLinked: boolean; isService: boolean; active: boolean; taxCategoryId: string | null; customCategoryId: string | null; taxCategory: CatalogTaxCategory | null; customCategory: CatalogCategory | null };
export type ProductForm = Omit<CatalogProduct, 'id' | 'purchasePrice' | 'sellingPrice' | 'taxCategory' | 'customCategory'> & { purchasePrice: number; sellingPrice: number };
export type Catalog = { products: CatalogProduct[]; categories: CatalogCategory[]; taxCategories: CatalogTaxCategory[] };
export type StationSummary = {
  id: string; name: string; code: string; addressLine1: string; city: string; state: string; postalCode: string; phone: string | null; gstin: string | null; openingTime: string | null; closingTime: string | null; active: boolean;
  configurations: Array<{
    version: number;
    tanks: Array<{ id: string; code: string; product: { name: string; code: string }; openingStock: string }>;
    dispensers: Array<{ id: string; code: string; nozzles: Array<{ id: string; code: string }> }>;
  }>;
};
export type SalesProduct = { id:string;name:string;code:string;unit:string;sellingPrice:string;meterLinked:boolean;tankLinked:boolean;isService:boolean;category:string };
export type OpenSaleShift = {
  id:string; shiftNumber:number; station:{id:string;name:string;code:string}; manager:{id:string;name:string;role:string}; users:Array<{user:{id:string;name:string;role:string}}>;nozzleAssignments:Array<{nozzleId:string;user:{id:string;name:string;role:string}}>;
  tankReadings:Array<{tank:{id:string;code:string;product:{id:string;name:string;code:string}}}>;
  nozzleReadings:Array<{ nozzle:{id:string;code:string;product:{id:string;name:string;code:string};dispenser:{code:string};tankMappings:Array<{tank:{id:string;code:string}}>}; openingMeter:string }>;
};
export type Sale = { id:string;kind:string;paymentMethod:string;quantity:string;unitPrice:string;totalAmount:string;meterOpening:string|null;meterClosing:string|null;customerName:string|null;vehicleNumber:string|null;notes:string|null;occurredAt:string;station:{name:string;code:string};shift:{id:string;shiftNumber:number;status:string};product:{name:string;code:string;unit:string;meterLinked:boolean;isService:boolean};employee:{name:string;role:string};tank:{code:string}|null;nozzle:{code:string;dispenser:{code:string}}|null;customer:{id:string;name:string;code:string;type:string}|null;vehicle:{id:string;number:string;label:string|null}|null };
export type SaleCustomer = {id:string;name:string;code:string;type:string;creditLimit:string;outstanding:number;vehicles:CustomerVehicle[]};
export type SalesBootstrap = { openShifts: OpenSaleShift[]; products: SalesProduct[]; employees:Array<{id:string;name:string;role:string}>; sales:Sale[];customers:SaleCustomer[] };
export type SaleForm = SaleInput;
export type InventoryProduct = { id:string;name:string;code:string;unit:string;tankLinked:boolean };
export type InventoryStation = { id:string;name:string;code:string; configurations:Array<{tanks:Array<{id:string;code:string;product:{id:string;name:string;code:string;unit:string;category:string}}>}> };
export type ReconciliationLine = { station:{id:string;name:string;code:string}|undefined;tank:{id:string;code:string}|null;product:{id:string;name:string;code:string;unit:string;category?:string};opening:number;receipts:number;sales:number;adjustments:number;bookStock:number;physicalStock:number|null;variance:number|null;dipReading:number|null;readAt:string|null;density:number|null;densityRecordedAt:string|null };
export type InventoryLedgerEntry = {id:string;type:string;quantityDelta:string;note:string|null;occurredAt:string;product:{name:string;code:string;unit:string};station:{name:string;code:string};tank:{code:string}|null};
export type PurchaseReceipt = {id:string;supplierName:string;referenceNo:string|null;receivedAt:string;station:{name:string};lines:Array<{quantity:string;unitCost:string;product:{name:string;code:string;unit:string};tank:{code:string}|null}>};
export type InventoryBootstrap = {stations:InventoryStation[];products:InventoryProduct[];tanks:ReconciliationLine[];untanked:ReconciliationLine[];ledger:InventoryLedgerEntry[];receipts:PurchaseReceipt[]};
export type ReceiptForm = ReceiptInput; export type AdjustmentForm = InventoryAdjustmentInput; export type TankReadingForm = TankReadingInput;
export type CollectionReconciliation = {id:string;paymentMethod:string;expectedAmount:string;actualAmount:string;adjustmentAmount:string;adjustmentReason:string|null;varianceAmount:string};
export type ReconciliationShift = {id:string;shiftNumber:number;status:string;openingCash:string;closingCash:string|null;openedAt:string;closedAt:string|null;station:{id:string;name:string;code:string};manager:{id:string;name:string;role:string};expected:Record<string,number>;suggestedActual:Record<string,number>;reconciliation:{id:string;reconciledAt:string;lockedAt:string;notes:string|null;reconciledBy:{id:string;name:string;role:string};collections:CollectionReconciliation[]}|null;totals:{expected:number;adjustedExpected:number;actual:number;variance:number}|null};
export type ReconciliationBootstrap={shifts:ReconciliationShift[]}; export type ReconciliationForm=ReconciliationInput;
export type CustomerVehicle={id:string;number:string;label:string|null;active:boolean};
export type CustomerLedgerEntry={id:string;type:string;amount:string;description:string;dueDate:string|null;occurredAt:string;station:{name:string;code:string};sale:{product:{name:string;code:string;category:string}}|null;receipt:{paymentMethod:string;referenceNo:string|null}|null};
export type Customer={id:string;name:string;code:string;type:'CREDIT'|'FLEET';phone:string|null;email:string|null;taxId:string|null;billingAddress:string|null;creditLimit:string;creditDays:number;active:boolean;outstanding:number;availableCredit:number;ageing:{current:number;days1to30:number;days31to60:number;days61to90:number;days90plus:number};vehicles:CustomerVehicle[];ledger:CustomerLedgerEntry[]};
export type CustomersBootstrap={customers:Customer[];stations:Array<{id:string;name:string;code:string}>};
export type Supplier={id:string;name:string;code:string;phone:string|null;email:string|null;taxId:string|null;address:string|null;paymentTerms:number;active:boolean};
export type PurchaseProduct={id:string;name:string;code:string;category:string;unit:string;hsnCode:string|null;purchasePrice:string;tankLinked:boolean;taxCategory:{rate:string}|null};
export type PurchaseStation={id:string;name:string;code:string;configurations:Array<{tanks:Array<{id:string;code:string;productId:string}>}>};
export type AttachmentMeta={id:string;fileName:string;mimeType:string;size:number};
export type PurchaseInvoice={id:string;invoiceNumber:string;invoiceDate:string;dueDate:string;subtotal:string;taxAmount:string;totalAmount:string;status:string;notes:string|null;outstanding:number;overdue:boolean;supplier:{id:string;name:string;code:string;paymentTerms:number};station:{id:string;name:string;code:string};lines:Array<{id:string;description:string;quantity:string;unitCost:string;taxRate:string;lineTotal:string;product:PurchaseProduct|null}>;payments:Array<{id:string;amount:string;paymentMethod:string;paidAt:string}>;receipt:{id:string;receivedAt:string}|null;attachments:AttachmentMeta[];createdBy:{name:string}};
export type InvoicePricePreview={lines:Array<{id:string;productId:string|null;productName:string;quantity:number;previousUnitCost:number;unitCost:number;lineTotal:number;tax:number}>;subtotal:number;taxAmount:number;totalAmount:number};
export type ExpenseCategory={id:string;name:string;code:string;active:boolean};
export type Expense={id:string;description:string;amount:string;paymentMethod:string;incurredAt:string;referenceNo:string|null;notes:string|null;station:{id:string;name:string;code:string};category:ExpenseCategory;attachments:AttachmentMeta[];createdBy:{name:string}};
export type PurchasesBootstrap={suppliers:Supplier[];invoices:PurchaseInvoice[];stations:PurchaseStation[];products:PurchaseProduct[];categories:ExpenseCategory[];expenses:Expense[];summary:{payables:number;overdue:number;expensesThisMonth:number}};
export type AccountBalance={id:string;code:string;name:string;type:string;debit:number;credit:number;balance:number};
export type Journal={id:string;journalDate:string;reference:string;description:string;sourceType:string;sourceId:string;station:{name:string;code:string}|null;createdBy:{name:string}|null;lines:Array<{id:string;debit:string;credit:string;memo:string|null;account:{code:string;name:string;type:string}}>};
export type AccountingBootstrap={accounts:AccountBalance[];journals:Journal[];trial:{debit:number;credit:number}};
export type ReportStation={id:string;name:string;code:string};
export type ReportSummary={grossSales:number;transactions:number;meteredVolume:number;purchases:number;expenses:number;receivables:number;payables:number;inventoryValue:number;grossProfit:number;netProfit:number};
export type ReportsBootstrap={
  filter:{startDate:string;endDate:string;stationId?:string;station:ReportStation|null};stations:ReportStation[];summary:ReportSummary;
  sales:{byProduct:Array<{key:string;product:string;code:string;unit:string;quantity:number;revenue:number}>;byPayment:Array<{key:string;method:string;transactions:number;amount:number}>;daily:Array<{key:string;date:string;transactions:number;amount:number}>;byStation:Array<{key:string;station:string;code:string;transactions:number;amount:number}>};
  inventory:Array<{key:string;product:string;code:string;unit:string;station:string;quantity:number;value:number;purchasePrice:number}>;
  customers:Array<{id:string;customer:string;code:string;type:string;outstanding:number;ageing:{current:number;days1to30:number;days31to60:number;days61to90:number;days90plus:number}}>;
  payables:Array<{id:string;invoiceNumber:string;supplier:string;station:string;dueDate:string;outstanding:number;overdue:boolean}>;
  expenses:Array<{key:string;category:string;amount:number}>;
  financial:{accounts:Array<{code:string;name:string;type:string;debit:number;credit:number;balance:number}>;revenue:number;cogs:number;operatingExpenses:number;grossProfit:number;netProfit:number};
};
export type DashboardBootstrap={asOf:string;today:ReportSummary;collections:Array<{key:string;method:string;transactions:number;amount:number}>;topProducts:Array<{key:string;product:string;code:string;unit:string;quantity:number;revenue:number}>;trend:{days:Array<{date:string;amount:number}>;thisWeek:number;previousWeek:number;weekChange:number|null};operations:{openShifts:number;pendingReconciliations:number;cashVariance:number};actions:Array<{id:string;severity:'HIGH'|'MEDIUM';title:string;detail:string;href:string}>;stationHealth:Array<{id:string;name:string;code:string;sales:number;transactions:number;openShifts:number;pendingReconciliations:number;stockAlerts:number;status:'ATTENTION'|'RUNNING'|'CALM'}>;tankStocks:Array<{id:string;code:string;product:string;productCode:string;unit:string;station:{id:string;name:string;code:string};bookStock:number;workingCapacity:number;fillPercent:number;sellingPrice:number;density:number|null;densityRecordedAt:string|null;physicalStock:number|null;physicalReadingAt:string|null;status:'EMPTY'|'LOW'|'HEALTHY'}>};
export type AccessStation={id:string;name:string;code:string;city:string;state:string;active?:boolean};
export type StationContextData={allStations:boolean;stations:AccessStation[]};
export type AccessBootstrap={stations:AccessStation[];users:Array<{id:string;name:string;email:string;role:string;allStations:boolean;stationIds:string[];loginEnabled:boolean;lastLoginAt:string|null;mustChangePassword:boolean}>};
