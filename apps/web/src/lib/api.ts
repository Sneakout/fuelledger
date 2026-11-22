import type {
  ApiError,
  ChangePasswordInput,
  CustomerInput,
  CustomerReceiptInput,
  DemoAccessInput,
  DensityReadingInput,
  ExpenseCategoryInput,
  ExpenseInput,
  GoogleAuthInput,
  HistoricalSalesImportInput,
  HistoricalSalesCorrectionInput,
  HistoricalSalesRowInput,
  InventoryAdjustmentInput,
  LoginInput,
  ManagerInput,
  OwnerNotificationSettingsInput,
  PurchaseInvoiceInput,
  PurchaseInvoiceUpdateInput,
  ReceiptInput,
  ReconciliationInput,
  SaleInput,
  ServiceTicketInput,
  SignupInput,
  StationAccessInput,
  StationEquipmentInput,
  StationProfileInput,
  StationSetup,
  SupplierInput,
  SupplierPaymentInput,
  TankReadingInput,
  User,
  VehicleInput,
} from "@fuelledger/shared";
import {
  cacheOfflineResponse,
  configureOfflineSync,
  currentOfflineScope,
  enqueueOfflineRequest,
  isOfflineCacheable,
  isOfflineQueueable,
  markOffline,
  markOnline,
  readOfflineResponse,
  startOfflineSync,
  syncOfflineRequests,
  type OfflineRequest,
} from "./offline-sync";
const API_URL = import.meta.env.VITE_API_URL ?? "/api";
export const historicalSalesSourceUrl = (id: string) => `${API_URL}/historical-sales/${encodeURIComponent(id)}/source`;
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly requestId?: string,
    public readonly details?: unknown,
    public readonly status?: number,
  ) {
    super(message);
  }
}
export class OfflineQueuedError extends ApiRequestError {
  constructor(public readonly queueId: string) {
    super(
      "Saved securely on this device. FuelNerve will update the server automatically when the connection returns.",
      "OFFLINE_QUEUED",
    );
  }
}
export type StaffDeactivationCheck = {
  user: { id: string; name: string; role: string };
  canDeactivate: boolean;
  blockers: string[];
  activeShifts: Array<{
    id: string;
    shiftNumber: number;
    station: { id: string; name: string };
  }>;
  historicalShiftCount: number;
  historicalSalesCount: number;
  defaultNozzleCount: number;
  pendingHandoverCount: number;
  possibleAmountDue: number;
  historyPreserved: true;
};
const inFlightSaves = new Map<string, Promise<unknown>>();
async function queueOffline(method: "POST" | "PUT" | "PATCH", path: string, body: string, idempotencyKey: string) {
  try {
    return await enqueueOfflineRequest({ method, path, body, idempotencyKey });
  } catch {
    throw new ApiRequestError(
      "This device could not store the record offline. Free some browser storage or reconnect before trying again.",
      "OFFLINE_STORAGE_UNAVAILABLE",
    );
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!init?.method || !['POST', 'PUT', 'PATCH'].includes(init.method)) return rawRequest<T>(path, init);
  const signature = `${init.method}:${path}:${String(init.body ?? '')}`;
  const existing = inFlightSaves.get(signature);
  if (existing) return existing as Promise<T>;
  const pending = (async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature));
    const storageKey = 'fuelledger-save:' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    let key: string = crypto.randomUUID();
    try {
      key = sessionStorage.getItem(storageKey) ?? key;
      sessionStorage.setItem(storageKey, key);
    } catch {
      // IndexedDB still preserves the key for queueable offline records. For
      // online-only saves, the server receipt remains the source of truth.
    }
    const method = init.method as "POST" | "PUT" | "PATCH";
    const body = String(init.body ?? "");
    if (isOfflineQueueable(method, path) && currentOfflineScope() && typeof navigator !== "undefined" && !navigator.onLine) {
      const item = await queueOffline(method, path, body, key);
      try { sessionStorage.removeItem(storageKey); } catch { /* unavailable */ }
      throw new OfflineQueuedError(item.id);
    }
    try {
      const result = await rawRequest<T>(path, { ...init, headers: { ...init.headers, 'Idempotency-Key': key } });
      try { sessionStorage.removeItem(storageKey); } catch { /* unavailable */ }
      return result;
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        (error.code === "NETWORK_UNAVAILABLE" || (error.status ?? 0) >= 500 || ["SERVER_UNAVAILABLE", "DATABASE_UNAVAILABLE", "INTERNAL_ERROR"].includes(error.code)) &&
        isOfflineQueueable(method, path) &&
        currentOfflineScope()
      ) {
        const item = await queueOffline(method, path, body, key);
        try { sessionStorage.removeItem(storageKey); } catch { /* unavailable */ }
        throw new OfflineQueuedError(item.id);
      }
      // Keep the key for an uncertain result; retrying must not create a second payment.
      if (error instanceof ApiRequestError && !['SAVE_RETRY_REQUIRED', 'INTERNAL_ERROR', 'DATABASE_UNAVAILABLE', 'SERVER_UNAVAILABLE', 'INVALID_SERVER_RESPONSE', 'NETWORK_UNAVAILABLE'].includes(error.code)) {
        try { sessionStorage.removeItem(storageKey); } catch { /* unavailable */ }
      }
      throw error;
    }
  })();
  inFlightSaves.set(signature, pending);
  try { return await pending; } finally { inFlightSaves.delete(signature); }
}
async function rawRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const isRead = !init?.method || init.method === "GET";
  const allowOfflineFallback = isRead && init?.cache !== "no-store";
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    markOnline();
  } catch {
    markOffline();
    if (allowOfflineFallback) {
      const cached = await readOfflineResponse<T>(path);
      if (cached !== undefined) return cached;
    }
    throw new ApiRequestError(
      "No connection. Reconnect and try again.",
      "NETWORK_UNAVAILABLE",
    );
  }
  if (allowOfflineFallback && response.status >= 500) {
    const cached = await readOfflineResponse<T>(path);
    if (cached !== undefined) {
      markOffline();
      return cached;
    }
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiRequestError(
      response.ok
        ? "The server returned an invalid response."
        : "FuelNerve could not connect to its server. Please try again shortly.",
      response.ok ? "INVALID_SERVER_RESPONSE" : "SERVER_UNAVAILABLE",
      undefined,
      undefined,
      response.status,
    );
  }
  const body = (await response.json()) as T | ApiError;
  if (!response.ok) {
    const apiError = body as ApiError;
    throw new ApiRequestError(
      apiError.error?.message ?? "Something went wrong.",
      apiError.error?.code ?? "REQUEST_FAILED",
      apiError.error?.requestId,
      apiError.error?.details,
      response.status,
    );
  }
  const result = body as T;
  if (isRead && isOfflineCacheable(path))
    await cacheOfflineResponse(path, result);
  return result;
}

async function replayOfflineRequest(item: OfflineRequest) {
  try {
    await rawRequest(item.path, {
      method: item.method,
      body: item.body,
      headers: { "Idempotency-Key": item.idempotencyKey },
    });
    return { ok: true } as const;
  } catch (error) {
    const problem = error instanceof ApiRequestError ? error : null;
    return {
      ok: false,
      retryable: !problem || problem.code === "NETWORK_UNAVAILABLE" || problem.code === "SERVER_UNAVAILABLE" || (problem.status ?? 500) >= 500,
      message: problem?.message ?? "This record could not be synchronized.",
    } as const;
  }
}

export function setOfflineUserScope(scope: string | null) {
  configureOfflineSync(scope, replayOfflineRequest);
  startOfflineSync();
  if (scope) void syncOfflineRequests();
}
export const api = {
  login: (input: LoginInput) =>
    request<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  signup: (input: SignupInput) =>
    request<{ user: User }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  googleAuth: (input: GoogleAuthInput) =>
    request<{ user: User }>("/auth/google", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  startDemo: (input: DemoAccessInput) =>
    request<{ user: User }>("/auth/demo", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  me: () => request<{ user: User }>("/auth/me"),
  updateAccountProfile: (name: string) => request<{ user: User }>("/auth/me", {
    method: "PATCH",
    body: JSON.stringify({ name }),
  }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  changePassword: (input: ChangePasswordInput) =>
    request<{ ok: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  stations: () => request<{ stations: StationSummary[] }>("/stations"),
  createStation: (setup: StationSetup) =>
    request<{ station: StationSummary }>("/stations", {
      method: "POST",
      body: JSON.stringify(setup),
    }),
  stationSetupDraft: (id: string) =>
    request<{ draft: { setup: StationSetup; updatedAt: string } | null }>(
      `/stations/${id}/draft`,
    ),
  saveStationSetupDraft: (id: string, setup: StationSetup) =>
    request<{ draft: { setup: StationSetup; updatedAt: string } }>(
      `/stations/${id}/draft`,
      { method: "PUT", body: JSON.stringify({ setup }) },
    ),
  updateStation: (id: string, profile: StationProfileInput) =>
    request<{ station: StationSummary }>(`/stations/${id}`, {
      method: "PUT",
      body: JSON.stringify(profile),
    }),
  stationEquipment: (id: string) =>
    request<StationEquipment>(`/stations/${id}/equipment`),
  updateStationEquipment: (id: string, input: StationEquipmentInput) =>
    request<{ station: StationSummary }>(`/stations/${id}/equipment`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  historicalSalesSetup: (stationId: string) =>
    request<HistoricalSalesSetup>(`/historical-sales/setup?stationId=${encodeURIComponent(stationId)}`),
  historicalSalesImports: (stationId: string) =>
    request<{ imports: HistoricalSalesImportSummary[] }>(`/historical-sales?stationId=${encodeURIComponent(stationId)}`),
  historicalSalesImport: (id: string) => request<{ record: HistoricalSalesImportDetail }>(`/historical-sales/${encodeURIComponent(id)}`),
  extractHistoricalSales: (input: HistoricalSalesExtractionInput) =>
    request<HistoricalSalesExtractionResult>("/historical-sales/extract", { method: "POST", body: JSON.stringify(input) }),
  classifyFuelDocument: (input: { sourceFileName: string; sourceMimeType: 'application/pdf' | 'image/jpeg' | 'image/png'; sourceSize: number; sourceContentBase64: string }) =>
    request<{ kind: 'DSR' | 'INVOICE' | 'UNKNOWN'; confidence: number; productCode: 'HSD' | 'MS' | 'UNKNOWN'; evidence: string[] }>("/historical-sales/classify-document", { method: "POST", body: JSON.stringify(input) }),
  validateHistoricalSales: (input: HistoricalSalesImportInput) =>
    request<{ issues: HistoricalImportIssue[] }>("/historical-sales/validate", { method: "POST", body: JSON.stringify(input) }),
  createHistoricalSalesImport: (input: HistoricalSalesImportInput) =>
    request<{ record: HistoricalSalesImportSummary; issues: HistoricalImportIssue[] }>("/historical-sales", { method: "POST", body: JSON.stringify(input) }),
  validateHistoricalSalesCorrection: (id: string, input: HistoricalSalesCorrectionInput) =>
    request<{ issues: HistoricalImportIssue[] }>(`/historical-sales/${encodeURIComponent(id)}/validate-correction`, { method: "POST", body: JSON.stringify(input) }),
  correctHistoricalSalesImport: (id: string, input: HistoricalSalesCorrectionInput) =>
    request<{ record: HistoricalSalesImportDetail; issues: HistoricalImportIssue[]; stockTimelineRecalculated: true; financialEntriesUnchanged: true }>(`/historical-sales/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  catalog: () => request<Catalog>("/products"),
  createProduct: (input: ProductForm) =>
    request<ProductMutationResult>("/products", {
      method: "POST",
      body: JSON.stringify({ requestId: crypto.randomUUID(), product: input }),
    }),
  updateProduct: (id: string, input: ProductForm) =>
    request<ProductMutationResult>(`/products/${id}`, {
      method: "PUT",
      body: JSON.stringify({ requestId: crypto.randomUUID(), product: input }),
    }),
  createCategory: (input: { name: string; code: string }) =>
    request<{ category: CatalogCategory }>("/products/categories", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createTaxCategory: (input: { name: string; rate: number }) =>
    request<{ taxCategory: CatalogTaxCategory }>("/products/tax-categories", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  shiftDetails: (id: string) => request<ShiftDetail>(`/shifts/${encodeURIComponent(id)}`),
  tankReceiptHistory: (stationId: string, before?: string) => request<{ receipts: ShiftReceipt[]; nextCursor: string | null }>(
    `/shifts/stations/${encodeURIComponent(stationId)}/receipts${before ? `?before=${encodeURIComponent(before)}` : ""}`,
  ),
  shiftBootstrap: (fresh = false) => request<ShiftBootstrap>("/shifts/bootstrap", fresh ? { cache: "no-store" } : undefined),
  openShift: (input: ShiftOpenForm) =>
    request<{ shift: Shift }>("/shifts/open", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  closeShift: (id: string, input: ShiftCloseForm) =>
    request<{ shift: Shift }>(`/shifts/${id}/close`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  salesBootstrap: () => request<SalesBootstrap>("/sales/bootstrap"),
  createSale: (input: SaleForm) =>
    request<{ sale: Sale }>("/sales", {
      method: "POST",
      body: JSON.stringify({ ...input, occurredAt: input.occurredAt ?? new Date().toISOString() }),
    }),
  inventoryBootstrap: () => request<InventoryBootstrap>("/inventory/bootstrap"),
  createAdjustment: (input: AdjustmentForm) =>
    request<{ approval: { id: string; status: "PENDING" } }>("/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  approvals: (status?: OwnerApproval["status"]) =>
    request<{ approvals: OwnerApproval[] }>(`/approvals${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  decideApproval: (id: string, input: ApprovalDecisionInput) =>
    request<{ approval: OwnerApproval }>(`/approvals/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  recordTankReading: (input: TankReadingForm) =>
    request<{ reading: unknown }>("/inventory/tank-readings", {
      method: "POST",
      body: JSON.stringify({ ...input, recordedAt: input.recordedAt ?? new Date().toISOString() }),
    }),
  recordDensity: (input: DensityReadingInput) =>
    request<{ reading: unknown }>("/inventory/density-readings", {
      method: "POST",
      body: JSON.stringify({ ...input, recordedAt: input.recordedAt ?? new Date().toISOString() }),
    }),
  reconciliationBootstrap: (shiftId?: string) =>
    request<ReconciliationBootstrap>(`/reconciliation/bootstrap${shiftId ? `?shiftId=${encodeURIComponent(shiftId)}` : ""}`, { cache: "no-store" }),
  reconcileShift: (id: string, input: ReconciliationForm) =>
    request<{ shift: ReconciliationShift }>(`/reconciliation/shifts/${id}`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  customersBootstrap: () => request<CustomersBootstrap>("/customers/bootstrap"),
  createCustomer: (input: CustomerInput) =>
    request<{ customer: Customer }>("/customers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCustomer: (id: string, input: CustomerInput) =>
    request<{ customer: Customer }>(`/customers/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  removeCustomer: (id: string) =>
    request<{ removed: boolean }>(`/customers/${id}`, { method: "DELETE" }),
  addVehicle: (id: string, input: VehicleInput) =>
    request<{ vehicle: CustomerVehicle }>(`/customers/${id}/vehicles`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  receiveCustomerPayment: (id: string, input: CustomerReceiptInput) =>
    request<{ receipt: unknown }>(`/customers/${id}/receipts`, {
      method: "POST",
      body: JSON.stringify({ ...input, receivedAt: input.receivedAt ?? new Date().toISOString() }),
    }),
  purchasesBootstrap: (invoiceId?: string) => request<PurchasesBootstrap>(`/purchases/bootstrap${invoiceId ? `?invoiceId=${encodeURIComponent(invoiceId)}` : ""}`),
  purchaseReceiptTimingAudit: () => request<ReceiptTimingAudit>("/purchases/receipt-timing-audit"),
  purchaseReceiptShiftImpact: (stationId: string, receivedAt: string) => request<ReceiptShiftImpact>(`/purchases/receipt-shift-impact?stationId=${encodeURIComponent(stationId)}&receivedAt=${encodeURIComponent(receivedAt)}`),
  createSupplier: (input: SupplierInput) =>
    request<{ supplier: Supplier }>("/purchases/suppliers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateSupplier: (id: string, input: SupplierInput) =>
    request<{ supplier: Supplier }>(`/purchases/suppliers/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  createPurchaseInvoice: (input: PurchaseInvoiceInput) =>
    request<{ invoice: PurchaseInvoice; priceApprovals?: ProductPriceApprovalNotice[] }>("/purchases/invoices", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  invoiceImportPolicy: () =>
    request<InvoiceImportPolicy>("/purchases/invoice-import/policy"),
  createImportedPurchaseInvoice: (input: PurchaseInvoiceInput) =>
    request<{ invoice: PurchaseInvoice; priceApprovals?: ProductPriceApprovalNotice[] }>("/purchases/invoice-import", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  receiveImportedPurchaseInvoice: (id: string, input: PurchaseInvoiceReceiptInput) =>
    request<{ invoice: PurchaseInvoice; priceApprovals?: ProductPriceApprovalNotice[] }>(`/purchases/invoices/${id}/receive`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  recordInvoiceImportMetric: (input: InvoiceImportMetric) =>
    request<void>("/purchases/invoice-import/metrics", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updatePurchaseInvoice: (id: string, input: PurchaseInvoiceUpdateInput) =>
    request<{ invoice: PurchaseInvoice }>(`/purchases/invoices/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  purchaseInvoicePricePreview: (id: string, invoiceDate?: string) =>
    request<InvoicePricePreview>(
      `/purchases/invoices/${id}/price-preview${invoiceDate ? `?invoiceDate=${encodeURIComponent(invoiceDate)}` : ""}`,
    ),
  paySupplierInvoice: (input: SupplierPaymentInput) =>
    request<{ payment: unknown }>("/purchases/payments", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createExpenseCategory: (input: ExpenseCategoryInput) =>
    request<{ category: ExpenseCategory }>("/purchases/expense-categories", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createExpense: (input: ExpenseInput) =>
    request<{ expense: Expense }>("/purchases/expenses", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  accountingBootstrap: (stationId?: string) =>
    request<AccountingBootstrap>(
      `/accounting/bootstrap${stationId ? `?stationId=${encodeURIComponent(stationId)}` : ""}`,
    ),
  reportsBootstrap: (filter: {
    startDate: string;
    endDate: string;
    stationId?: string;
  }) =>
    request<ReportsBootstrap>(
      `/reports/bootstrap?${new URLSearchParams(Object.entries(filter).filter(([, value]) => value) as string[][]).toString()}`,
    ),
  salesHistory: (filter: { startDate: string; endDate: string; stationId?: string }) =>
    request<SalesHistory>(
      `/reports/sales-history?${new URLSearchParams(Object.entries(filter).filter(([, value]) => value) as string[][]).toString()}`,
    ),
  dashboardBootstrap: (stationId?: string) =>
    request<DashboardBootstrap>(
      `/dashboard/bootstrap${stationId ? `?stationId=${encodeURIComponent(stationId)}` : ""}`,
    ),
  stationContext: () => request<StationContextData>("/access/context"),
  accessBootstrap: () => request<AccessBootstrap>("/access"),
  createStaff: (input: { name: string; stationIds: string[] }) =>
    request<{ user: unknown }>("/access/users", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createManager: (input: ManagerInput) =>
    request<{ user: unknown }>("/access/managers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  staffDeactivationCheck: (userId: string) =>
    request<StaffDeactivationCheck>(
      `/access/users/${userId}/deactivation-check`,
    ),
  deactivateStaff: (userId: string) =>
    request<{
      id: string;
      active: boolean;
      historyPreserved: true;
      clearedDefaultNozzles: number;
    }>(`/access/users/${userId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true }),
    }),
  updateStationAccess: (userId: string, input: StationAccessInput) =>
    request<{ userId: string; stationIds: string[] }>(
      `/access/users/${userId}`,
      { method: "PUT", body: JSON.stringify(input) },
    ),
  updateNozzleCustody: (
    shiftId: string,
    assignments: Array<{ nozzleId: string; userId: string }>,
  ) =>
    request<{ shift: Shift }>(`/shifts/${shiftId}/nozzle-assignments`, {
      method: "PUT",
      body: JSON.stringify({ assignments }),
    }),
  updateDefaultNozzleAssignments: (
    stationId: string,
    assignments: Array<{ nozzleId: string; userId: string }>,
  ) =>
    request<{
      stationId: string;
      assignments: Array<{ nozzleId: string; userId: string }>;
      openShiftUpdated: boolean;
    }>(`/access/stations/${stationId}/nozzle-assignments`, {
      method: "PUT",
      body: JSON.stringify({ assignments }),
    }),
  customerReminderProfile: (id: string) => request<CustomerReminderProfileResponse>(`/customers/${id}/reminders`),
  saveCustomerReminderProfile: (id: string, input: CustomerReminderPreferences) => request<{ profile: CustomerReminderProfile }>(`/customers/${id}/reminders`, {
    method: "PUT", body: JSON.stringify(input),
  }),
  previewCustomerReminder: (id: string, stationId: string) => request<{ draft: CustomerReminderDraft }>(`/customers/${id}/reminders/preview`, {
    method: "POST", body: JSON.stringify({ stationId }),
  }),
  approveCustomerReminder: (id: string, stationId: string, snapshot: string) => request<{ id: string; status: NotificationDelivery["status"] }>(`/customers/${id}/reminders/approve`, {
    method: "POST", body: JSON.stringify({ stationId, snapshot }),
  }),
  ownerEmailStatus: () => request<{ emailStatus: OwnerEmailStatus }>("/notifications/email-status"),
  notificationSettings: () => request<NotificationBootstrap>("/notifications"),
  dailyBriefWorkspace: (stationId: string) => request<DailyBriefWorkspaceResponse>(`/intelligence/daily-brief-workspace?stationId=${encodeURIComponent(stationId)}`),
  setDailyBriefPreference: (input: { stationId: string; findingKey: string; action: "ACKNOWLEDGE" | "REMIND_LATER" }) =>
    request<{ acknowledgedAt: string | null; remindAt: string | null }>("/intelligence/daily-brief-workspace/preference", {
      method: "PUT", body: JSON.stringify(input),
    }),
  dailyBriefing: (stationId?: string) => request<DailyBriefingResponse>(`/intelligence/daily-briefing${stationId ? `?stationId=${encodeURIComponent(stationId)}` : ""}`),
  nerveAgents: (stationId: string) => request<NerveAgentsResponse>(`/intelligence/agents?stationId=${encodeURIComponent(stationId)}`),
  askFuelNerve: (input: { requestId: string; question: string; stationId?: string; asOf?: string }) =>
    request<AskFuelNerveResponse>("/intelligence/ask", { method: "POST", body: JSON.stringify(input) }),
  investigateFinding: (input: { requestId: string; stationId: string; findingIds: string[] }) =>
    request<InvestigationResponse>("/intelligence/investigations", { method: "POST", body: JSON.stringify(input) }),
  investigationFollowUp: (investigationId: string, input: { stationId: string; prompt: InvestigationFollowUpPrompt }) =>
    request<InvestigationFollowUpResponse>(`/intelligence/investigations/${encodeURIComponent(investigationId)}/follow-ups`, { method: "POST", body: JSON.stringify(input) }),
  updateNotificationSettings: (input: OwnerNotificationSettingsInput & { confirmNewNumber?: boolean }) =>
    request<{ settings: NotificationSettings; emailStatus?: OwnerEmailStatus }>("/notifications", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  testWhatsApp: () =>
    request<{ delivery: { status: string; reason?: string } }>(
      "/notifications/test",
      { method: "POST" },
    ),
  marketingEmails: () => request<{ emails: DemoFollowUpState[] }>('/platform/marketing-emails'),
  previewMarketingEmail: (email: string) => request<DemoFollowUpPreview>('/platform/marketing-emails/preview', { method: 'POST', body: JSON.stringify({ email }) }),
  sendMarketingEmail: (email: string, input: { id: string; previewHash: string; permissionConfirmed: true }) => request<DemoFollowUpState>('/platform/marketing-emails/send', { method: 'POST', body: JSON.stringify({ email, ...input }) }),
  demoLeads: () => request<DemoLeadsBootstrap>("/platform/demo-leads"),
  previewDemoFollowUp: (id: string) => request<DemoFollowUpPreview>(`/platform/demo-leads/${encodeURIComponent(id)}/follow-up/preview`, { method: 'POST' }),
  sendDemoFollowUp: (id: string, input: { id: string; previewHash: string; permissionConfirmed: true }) => request<DemoFollowUpState>(`/platform/demo-leads/${encodeURIComponent(id)}/follow-up/send`, { method: 'POST', body: JSON.stringify(input) }),
  previewAccountDeletion: (id: string) => request<AccountDeletionPreview>(`/platform/customers/${encodeURIComponent(id)}/deletion-preview`, { method:'POST' }),
  deleteCustomerAccount: (id: string, input: {token:string;name:string;reason:string}) => request<{deleted:boolean}>(`/platform/customers/${encodeURIComponent(id)}`, { method:'DELETE', body:JSON.stringify(input) }),
  platformCustomers: () =>
    request<PlatformCustomersBootstrap>("/platform/customers"),
  updateCustomerSubscription: (
    id: string,
    input:
      | { plan: SubscriptionPlan; billingPeriod: SubscriptionBillingPeriod; paymentConfirmed: boolean; setupFeePaid: boolean }
      | { setupFeePaid: boolean; lifetimeAccessPaid: boolean },
  ) =>
    request<{
      customer: Pick<
        PlatformCustomer,
        | "id"
        | "setupFeePaidAt"
        | "lifetimeAccessPaidAt"
        | "subscriptionUpdatedAt"
        | "subscriptionUpdatedBy"
        | "subscriptionPlan"
        | "subscriptionBillingPeriod"
        | "subscriptionPricePaise"
        | "subscriptionActivatedAt"
        | "subscriptionExpiresAt"
      >;
    }>(`/platform/customers/${id}/subscription`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  manualMessageContext: (id: string) => request<{ stations: { id: string; name: string }[]; today: string }>(`/platform/customers/${id}/manual-messages`),
  prepareManualMessage: (id: string, input: { stationId: string; type: string; date: string }) => request<{ body: string; destination: string; ownerName: string; stationName: string; checkedAt: string; warnings: string[] }>(`/platform/customers/${id}/manual-messages/prepare`, { method: 'POST', body: JSON.stringify(input) }),
  testCustomerWhatsApp: (id: string, welcome = false, operationalType?: string) =>
    request<{ delivery: { status: "QUEUED" | "FAILED" | "SKIPPED"; reason?: string } }>(`/platform/customers/${id}/notifications/test`, { method: "POST", body: JSON.stringify({ welcome, operationalType }) }),
  whatsappRollout: () => request<WhatsAppRolloutSnapshot>("/platform/whatsapp-rollout"),
  saveWhatsAppRollout: (policy: WhatsAppRolloutPolicy) =>
    request<{ policy: WhatsAppRolloutPolicy }>("/platform/whatsapp-rollout", { method: "PUT", body: JSON.stringify(policy) }),
  pauseWhatsAppRollout: () =>
    request<{ policy: WhatsAppRolloutPolicy }>("/platform/whatsapp-rollout/pause", { method: "POST" }),
  generateWhatsAppPreviews: () => request<{ previews: { deferred: number } }>("/platform/whatsapp-rollout/preview", { method: "POST" }),
  processOwnerWhatsApp: (organizationId: string, deliveryId: string) =>
    request<{ accepted: number; failed: number; deferred: number; suppressed: number }>(`/platform/customers/${organizationId}/notifications/deliveries/${deliveryId}/process`, { method: "POST" }),
  processApprovedWhatsApp: () => request<{ accepted: number; failed: number; deferred: number; suppressed: number }>("/platform/whatsapp-rollout/process-approved", { method: "POST" }),
  approveWhatsAppPreview: (organizationId: string, deliveryId: string, hash: string) =>
    request<void>(`/platform/customers/${organizationId}/notifications/deliveries/${deliveryId}/approve-preview`,
      { method: "POST", body: JSON.stringify({ hash }) }),
  adminWhatsAppOwners: (filters: Record<string, string>) =>
    request<{ owners: WhatsAppOwnerSummary[]; nextCursor: string | null }>(`/platform/whatsapp/owners?${new URLSearchParams(filters)}`),
  adminWhatsAppMessages: (filters: Record<string, string>) =>
    request<{ messages: WhatsAppMessageSummary[]; nextCursor: string | null }>(`/platform/whatsapp/messages?${new URLSearchParams(filters)}`),
  customerWhatsAppDeliveries: (id: string, options?: { recent: boolean; message?: string }) => {
    const query = new URLSearchParams();
    if (options?.recent) query.set("recent", "true");
    if (options?.message) query.set("message", options.message);
    return request<{ deliveries: AdminWhatsAppDelivery[] }>(`/platform/customers/${id}/notifications/deliveries${query.size ? `?${query}` : ""}`);
  },
  retryCustomerWhatsAppDelivery: (id: string, deliveryId: string) =>
    request<{ queued: boolean }>(`/platform/customers/${id}/notifications/deliveries/${deliveryId}/retry`, { method: "POST" }),
  serviceTickets: () => request<{ tickets: ServiceTicket[] }>("/support/tickets"),
  createServiceTicket: (input: ServiceTicketInput) =>
    request<{ ticket: ServiceTicket }>("/support/tickets", { method: "POST", body: JSON.stringify(input) }),
  platformServiceTickets: () => request<{ tickets: PlatformServiceTicket[] }>("/platform/service-tickets"),
  updatePlatformServiceTicket: (id: string, input: { status: ServiceTicketStatus; adminNote?: string }) =>
    request<{ ticket: Pick<PlatformServiceTicket, "id" | "status" | "adminNote" | "resolvedAt" | "updatedAt"> }>(`/platform/service-tickets/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  pauseOwnerEmails: (id: string, ownerId: string, paused: boolean) => request(`/platform/customers/${id}/email-owner/${ownerId}/pause`, { method: 'PUT', body: JSON.stringify({ paused }) }),
  ownerEmailDeliveries: (id: string) => request<{ ready: boolean; recipients?: OwnerEmailRecipient[]; deliveries: OwnerEmailDelivery[] }>(`/platform/customers/${id}/email-deliveries`),
  prepareOwnerEmailWelcome: (id: string, ownerId?: string) => request<{ prepared: boolean }>(`/platform/customers/${id}/email-welcome`, { method: 'POST', body: JSON.stringify({ ownerId }) }),
  previewOwnerEmail: (id: string, deliveryId: string) => request<{ subject: string; html: string; text: string }>(`/platform/customers/${id}/email-deliveries/${deliveryId}/preview`),
  retryOwnerEmail: (id: string, deliveryId: string) => request<{ queued: boolean }>(`/platform/customers/${id}/email-deliveries/${deliveryId}/retry`, { method: 'POST' }),
  processOwnerEmail: (id: string, deliveryId: string) => request<{ accepted: number }>(`/platform/customers/${id}/email-deliveries/${deliveryId}/process`, { method: 'POST' }),
  subscription: () => request<SubscriptionStatus>("/platform/subscription"),
};
export type NotificationSettings = {
  emailEnabled?: boolean;
  whatsappNumber: string | null;
  whatsappOptedIn: boolean;
  densityMissingEnabled: boolean;
  lowStockEnabled: boolean;
  shiftVarianceEnabled: boolean;
  unclosedShiftEnabled: boolean;
  dailySummaryEnabled: boolean;
  overdueCustomerEnabled: boolean;
  lowStockPercent: number;
  varianceThreshold: number;
  stockVarianceTolerance: number;
  dailySummaryHour: number;
  shiftSummaryEnabled: boolean;
  receiptSummaryEnabled: boolean;
  creditReportHour: number;
  customerReminderScheduled: boolean;
  customerReminderHour: number;
  providerReady: boolean;
};
export type WhatsAppRolloutPolicy = {
  stage: "SHADOW" | "INTERNAL" | "PILOT" | "EXPANDED";
  paused: boolean;
  organizationIds: string[];
  enabledCategories: string[];
  version: number;
};
export type WhatsAppRolloutSnapshot = {
  policy: WhatsAppRolloutPolicy;
  outcomes: Array<{ status: string; rolloutHold: string | null; suppressionReason: string | null; failureKind: string | null; count: number }>;
  audit: Array<{ id: string; action: string; createdAt: string }>;
};
export type WhatsAppOwnerSummary = {
  id: string;
  name: string;
  owner: { name: string; email: string } | null;
  notificationSettings: Pick<NotificationSettings, "whatsappNumber" | "whatsappOptedIn">;
  lastDeliveredAt: string | null;
  failedCount: number;
};
export type WhatsAppMessageSummary = Pick<AdminWhatsAppDelivery, "id" | "type" | "status" | "createdAt" | "rolloutHold" | "errorMessage" | "suppressionReason"> & {
  organizationId: string;
  organization: { name: string };
  needsApproval: boolean;
};
export type AdminWhatsAppDelivery = {
  id: string;
  type: string;
  status: NotificationDelivery["status"];
  createdAt: string;
  attempts: number;
  errorMessage: string | null;
  suppressionReason: string | null;
  rolloutHold: string | null;
  previewBody: string | null;
  previewTemplate: string | null;
  previewHash: string | null;
  approvedPreviewHash: string | null;
  previewAt: string | null;
  recipientEnding: string;
  sourceId: string | null;
  recordType: string | null;
  canRetry: boolean;
};
export type NotificationDelivery = {
  id: string;
  type: string;
  station: { name: string; code: string } | null;
  destination: string;
  message: string;
  status: "PENDING" | "PROCESSING" | "ACCEPTED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "SUPPRESSED";
  errorMessage: string | null;
  suppressionReason: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  createdAt: string;
};
export type CustomerReminderProfile = {
  id: string;
  reminderWhatsAppNumber: string | null;
  reminderConsentAt: string | null;
  reminderConsentById: string | null;
  reminderConsentSource: string | null;
  reminderPaused: boolean;
};
export type CustomerReminderPreferences = {
  destination: string;
  consentSource: string;
  recordConsent: boolean;
  revokeConsent: boolean;
  paused: boolean;
};
export type CustomerReminderProfileResponse = {
  profile: CustomerReminderProfile;
  history: Array<Pick<NotificationDelivery, "id" | "status" | "createdAt" | "suppressionReason"> & {
    station: { name: string } | null;
    failureKind: string | null;
  }>;
};
export type CustomerReminderDraft = {
  stationId: string;
  overdueAmount: number;
  dueDate: string;
  destination: string;
  snapshot: string;
  preview: string;
};
export type OwnerEmailStatus = { state: 'OFF' | 'SETUP' | 'ACTIVE' | 'PAUSED'; activatedAt: string | null; nextSummaryAt: string | null };
export type OwnerEmailRecipient = OwnerEmailStatus & { ownerId: string; ownerName: string; destination: string; consent: boolean; adminPaused: boolean; welcomeStatus: string | null; welcomeId: string | null; blocker: string | null };
export type NotificationBootstrap = {
  emailStatus?: OwnerEmailStatus;
  emailAddress?: string;
  settings: NotificationSettings;
  deliveries: NotificationDelivery[];
  deliveryAvailable?: boolean;
  testAvailable?: boolean;
  intelligenceActive: boolean;
};
export type DemoFollowUpState = { id: string; destination: string; status: string; attempts: number; acceptedAt: string | null; createdAt: string; errorMessage: string | null };
export type DemoFollowUpPreview = DemoFollowUpState & { ready: boolean; previewHash: string; subject: string; html: string; text: string };
export type DemoLead = {
  followUp?: DemoFollowUpState | null;
  id: string;
  contact: string;
  kind: string;
  createdAt: string;
  expiresAt: string;
};
export type DemoLeadsBootstrap = {
  leads: DemoLead[];
  summary: { sessions: number; uniqueContacts: number };
};
export type PlatformCustomer = {
  id: string;
  name: string;
  createdAt: string;
  setupFeePaidAt: string | null;
  lifetimeAccessPaidAt: string | null;
  subscriptionUpdatedAt: string | null;
  subscriptionUpdatedBy: string | null;
  intelligenceEnabledAt: string | null;
  intelligenceExpiresAt: string | null;
  subscriptionPlan: SubscriptionPlan | null;
  subscriptionBillingPeriod: SubscriptionBillingPeriod | null;
  subscriptionPricePaise: number | null;
  subscriptionActivatedAt: string | null;
  subscriptionExpiresAt: string | null;
  owner: { name: string; email: string; lastLoginAt: string | null } | null;
  petrolPumps: number;
  notificationSettings: NotificationSettings;
};
export type PlatformCustomersBootstrap = { customers: PlatformCustomer[] };
export type ServiceTicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";
export type ServiceTicket = {
  id: string;
  ticketNumber: number;
  reference: string;
  issue: string;
  subIssue: string | null;
  comments: string;
  status: ServiceTicketStatus;
  hasScreenshot: boolean;
  createdAt: string;
  updatedAt: string;
};
export type PlatformServiceTicket = ServiceTicket & {
  screenshotFileName: string | null;
  adminNote: string | null;
  resolvedAt: string | null;
  organization: { id: string; name: string };
  createdBy: { name: string; email: string };
};
export type SubscriptionPlan = "CORE" | "CORE_INTELLIGENCE";
export type SubscriptionBillingPeriod = "MONTHLY" | "YEARLY" | "LIFETIME" | "FOUNDING_YEARLY";
export type SubscriptionStatus = {
  setupFeePaidAt: string | null;
  lifetimeAccessPaidAt: string | null;
  subscriptionUpdatedAt: string | null;
  intelligenceEnabledAt: string | null;
  intelligenceExpiresAt: string | null;
  subscriptionPlan: SubscriptionPlan | null;
  subscriptionBillingPeriod: SubscriptionBillingPeriod | null;
  subscriptionPricePaise: number | null;
  subscriptionActivatedAt: string | null;
  subscriptionExpiresAt: string | null;
};
export type Reading = { id: string; value: number };
export type ClosingNozzleReading = Reading & {
  testingQuantity: number;
  testingReturned: boolean;
};
export type ShiftOpenForm = {
  cashHandover?: { previousShiftId: string | null; previousClosingCash: number | null; added: number; removed: number; bankDeposited?: number; otherWithdrawals?: number; reason?: string };
  stationId: string;
  managerId: string;
  userIds: string[];
  nozzleAssignments: Array<{ nozzleId: string; userId: string }>;
  openingCash: number;
  tankReadings: Reading[];
  nozzleReadings: Reading[];
  notes?: string;
};
export type ShiftCloseForm = {
  closingCash: number;
  tankReadings: Reading[];
  nozzleReadings: ClosingNozzleReading[];
  nozzleCollections: Array<{ nozzleId: string; amount: number }>;
  notes?: string;
};
export type ShiftStation = {
  id: string;
  name: string;
  code: string;
  availableTankStock: Array<{
    stockIssues?:string[];
    checkpoint?:{source:string;date:string;at:string|null;incomplete:boolean}|null;
    id: string;
    value: string;
    lastActual: string | null;
    received: string;
    adjustments: string;
    netOther: string;
    expectedOpening: string;
  }>;
  lastClosing: {
    closingCash: string | null;
    nozzleAssignments: Array<{ nozzleId: string; userId: string }>;
    shiftId: string;
    shiftNumber: number;
    closedAt: string;
    tankReadings: Array<{ id: string; value: string; lastActual?: string; receivedBetween?: string; adjustmentsBetween?: string; expectedOpening?: string }>;
    nozzleReadings: Array<{ id: string; value: string }>;
  } | null;
  configurations: Array<{
    id: string;
    version: number;
    tanks: Array<{
      id: string;
      code: string;
      openingStock: string;
      product: { name: string; code: string };
    }>;
    dispensers: Array<{
      id: string;
      code: string;
      location: string | null;
      nozzles: Array<{
        id: string;
        code: string;
        openingMeter: string;
        product: { name: string; code: string };
        attendantAssignment: { userId: string } | null;
      }>;
    }>;
  }>;
};
export type ShiftDelivery = {
  id: string;
  quantity: string;
  occurredAt: string;
  reference: string;
  supplier: string | null;
  recordedLate: boolean;
  correctedLate: boolean;
};
export type ShiftReceipt = ShiftDelivery & {
  period: "DURING" | "GAP" | "BEFORE_FIRST" | "OVERLAP" | "DATE_ONLY";
  source?: "DSR";
  businessDate?: string;
  sourceUrl?: string;
  dsrQuantity?: string;
  postedQuantity?: string;
  allocationRequired?: boolean;
  overlapMismatch?: boolean;
  shiftId: string | null;
  shiftNumber: number | null;
  tankInShift: boolean | null;
  previousShift: { id: string; number: number } | null;
  receiptScopeMismatch: boolean;
  tank: string | null;
  product: string | null;
  unit: string | null;
  timingMismatch: boolean;
};
export type Shift = {
  openingCashHandover?: { previousShiftId: string | null; previousClosingCash: string | null; added: string; removed: string; bankDeposited?: string | null; otherWithdrawals?: string | null; expectedOpening: string | null; actualOpening: string; difference: string | null; reason: string | null; enteredById: string | null; recordedAt: string } | null;
  id: string;
  shiftNumber: number;
  status: string;
  openingCash: string;
  closingCash: string | null;
  openedAt: string;
  closedAt: string | null;
  station: { id: string; name: string; code: string };
  manager: { id: string; name: string; role: string };
  users: Array<{ user: { id: string; name: string; role: string } }>;
  nozzleAssignments: Array<{
    nozzleId: string;
    userId: string;
    user: { id: string; name: string; role: string };
    collectionAmount: string | null;
    nozzle: {
      code: string;
      product: { name: string; code: string };
      dispenser: { code: string; location: string | null };
    };
  }>;
  tankReadings: Array<{
    tankId: string;
    openingDip: string;
    closingDip: string | null;
    receivedDuringShift: string;
    stockBridge: {
      counterSales?: string;
      postedSales?: string;
      postedTestingLoss?: string;
      received: string;
      adjustments: string;
      deliveries: ShiftDelivery[];
      adjustmentDetails: Array<{ id: string; quantity: string; note: string | null; occurredAt: string }>;
      nozzles: Array<{ id: string; code: string; counter?: boolean }>;
    };
    tank: { code: string; product: { name: string; code: string } };
  }>;
  nozzleReadings: Array<{
    nozzleId: string;
    openingMeter: string;
    closingMeter: string | null;
    testingQuantity: string;
    testingReturned: boolean;
    nozzle: {
      code: string;
      product: { name: string; code: string };
      dispenser: { code: string; location: string | null };
    };
  }>;
  summary: {
    fuelVolume: number;
    tanksCaptured: number;
    nozzlesCaptured: number;
  };
};
export type ShiftDetail = Shift & {
  openingStockReview: Array<{ code: string; actual: string; received: string; expectedOpening: string }>;
  receiptTimingChanges: Array<{ id: string; previousReceivedAt: string; receivedAt: string; receipt: { referenceNo: string | null } }>;
};
export type ShiftBootstrap = {
  stockVarianceTolerance: number;
  stations: ShiftStation[];
  users: Array<{
    id: string;
    name: string;
    role: string;
    stationIds: string[];
  }>;
  shifts: Shift[];
};
export type CatalogCategory = {
  id: string;
  name: string;
  code: string;
  active: boolean;
};
export type CatalogTaxCategory = {
  id: string;
  name: string;
  rate: string;
  active: boolean;
};
export type CatalogProduct = {
  packSizeLitres?: string | null;
  id: string;
  name: string;
  code: string;
  hsnCode: string | null;
  category: string;
  unit: string;
  purchasePrice: string;
  purchasePriceHistory: Array<{
    id: string;
    price: string;
    effectiveFrom: string;
    createdAt: string;
  }>;
  sellingPrice: string;
  sellingPriceHistory: Array<{
    id: string;
    price: string;
    effectiveFrom: string;
    createdAt: string;
  }>;
  inventoryTracked: boolean;
  tankLinked: boolean;
  meterLinked: boolean;
  isService: boolean;
  active: boolean;
  taxCategoryId: string | null;
  customCategoryId: string | null;
  taxCategory: CatalogTaxCategory | null;
  customCategory: CatalogCategory | null;
};
export type ProductForm = Omit<
  CatalogProduct,
  | "id"
  | "purchasePrice"
  | "packSizeLitres"
  | "sellingPrice"
  | "sellingPriceHistory"
  | "purchasePriceHistory"
  | "taxCategory"
  | "customCategory"
> & {
  packSizeLitres?: number | null;
  purchasePrice: number;
  sellingPrice: number;
  purchasePriceEffectiveFrom?: string;
  sellingPriceEffectiveFrom?: string;
};
export type Catalog = {
  products: CatalogProduct[];
  categories: CatalogCategory[];
  taxCategories: CatalogTaxCategory[];
};
export type OwnerApproval = {
  id: string;
  actionType: "INVENTORY_ADJUSTMENT" | "PRODUCT_PRICE_CHANGE" | string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason: string;
  payload: Record<string, unknown>;
  evidence: Record<string, unknown>;
  requestedAt: string;
  requestedBy: { id: string; name: string; role: string };
  station: { id: string; name: string; code: string };
  decidedAt: string | null;
  decidedBy: { id: string; name: string; role: string } | null;
  decisionNote: string | null;
  execution: { type: string | null; id: string; executedAt: string | null } | null;
  version: number;
};
export type ApprovalDecisionInput = {
  decision: "APPROVE" | "REJECT";
  note: string;
  version: number;
  sellingPrice?: number;
  sellingPriceEffectiveFrom?: string;
};
export type ProductMutationResult =
  | { product: CatalogProduct; pending?: false; approval?: never }
  | { pending: true; approval: OwnerApproval; product?: never };
export type StationSummary = {
  id: string;
  name: string;
  code: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string | null;
  gstin: string | null;
  openingTime: string | null;
  closingTime: string | null;
  active: boolean;
  configurations: Array<{
    version: number;
    tanks: Array<{
      id: string;
      code: string;
      status: "ACTIVE" | "INACTIVE";
      product: { name: string; code: string };
      openingStock: string;
    }>;
    dispensers: Array<{
      id: string;
      code: string;
      status: "ACTIVE" | "INACTIVE";
      nozzles: Array<{
        id: string;
        code: string;
        status: "ACTIVE" | "INACTIVE";
      }>;
    }>;
  }>;
};
export type StationEquipment = {
  configuration: {
    id: string;
    version: number;
    tanks: Array<{
      id: string;
      code: string;
      productId: string;
      nominalCapacity: string;
      workingCapacity: string;
      openingStock: string;
      tankType: "UNDERGROUND" | "ABOVE_GROUND";
      dipMethod: "MANUAL" | "ATG";
      status: "ACTIVE" | "INACTIVE";
      product: { id: string; name: string; code: string };
    }>;
    dispensers: Array<{
      id: string;
      code: string;
      location: string | null;
      status: "ACTIVE" | "INACTIVE";
      nozzles: Array<{
        id: string;
        code: string;
        productId: string;
        openingMeter: string;
        status: "ACTIVE" | "INACTIVE";
        product: { id: string; name: string; code: string };
        tankMappings: Array<{ tank: { id: string; code: string } }>;
      }>;
    }>;
  };
  products: Array<{
    id: string;
    name: string;
    code: string;
    tankLinked: boolean;
    meterLinked: boolean;
  }>;
};
export type SalesProduct = {
  packSizeLitres?: string | null;
  id: string;
  name: string;
  code: string;
  unit: string;
  sellingPrice: string;
  meterLinked: boolean;
  tankLinked: boolean;
  isService: boolean;
  category: string;
};
export type OpenSaleShift = {
  id: string;
  shiftNumber: number;
  station: { id: string; name: string; code: string };
  manager: { id: string; name: string; role: string };
  users: Array<{ user: { id: string; name: string; role: string } }>;
  nozzleAssignments: Array<{
    nozzleId: string;
    user: { id: string; name: string; role: string };
  }>;
  tankReadings: Array<{
    tank: {
      id: string;
      code: string;
      product: { id: string; name: string; code: string };
    };
  }>;
  nozzleReadings: Array<{
    nozzle: {
      id: string;
      code: string;
      product: { id: string; name: string; code: string };
      dispenser: { code: string };
      tankMappings: Array<{ tank: { id: string; code: string } }>;
    };
    openingMeter: string;
  }>;
};
export type Sale = {
  id: string;
  kind: string;
  paymentMethod: string;
  quantity: string;
  unitPrice: string;
  totalAmount: string;
  meterOpening: string | null;
  meterClosing: string | null;
  customerName: string | null;
  vehicleNumber: string | null;
  notes: string | null;
  occurredAt: string;
  station: { name: string; code: string };
  shift: { id: string; shiftNumber: number; status: string } | null;
  product: {
    name: string;
    code: string;
    unit: string;
    packSizeLitres?: string | null;
    meterLinked: boolean;
    isService: boolean;
  };
  employee: { name: string; role: string };
  tank: { code: string } | null;
  nozzle: { code: string; dispenser: { code: string } } | null;
  customer: { id: string; name: string; code: string; type: string } | null;
  vehicle: { id: string; number: string; label: string | null } | null;
};
export type SaleCustomer = {
  id: string;
  name: string;
  code: string;
  type: string;
  creditLimit: string;
  outstanding: number;
  vehicles: CustomerVehicle[];
};
export type SalesBootstrap = {
  stations: Array<{ id: string; name: string; code: string }>;
  tanks: Array<{ id: string; code: string; productId: string; stationId: string }>;
  openShifts: OpenSaleShift[];
  products: SalesProduct[];
  employees: Array<{ id: string; name: string; role: string }>;
  sales: Sale[];
  customers: SaleCustomer[];
};
export type SaleForm = SaleInput;
export type InventoryProduct = {
  id: string;
  name: string;
  code: string;
  unit: string;
  category: string;
  tankLinked: boolean;
};
export type InventoryStation = {
  id: string;
  name: string;
  code: string;
  configurations: Array<{
    tanks: Array<{
      id: string;
      code: string;
      product: {
        id: string;
        name: string;
        code: string;
        unit: string;
        category: string;
      };
    }>;
  }>;
};
export type OperationalStock = { quantity:number; opening:number; receipts:number; sales:number; adjustments:number; checkpointDate:string; checkpointAt:string|null; source:string; asOf:string; incomplete:boolean; issues:string[] };
export type TankStockTimeline = { anchorDate:string|null; throughDate:string|null; opening?:number; receipts?:number; sales?:number; adjustments?:number; issues:string[] };
export type TankObservation = {
  volume: number; dipCm: number | null; date: string; observedAt: string | null;
  precision: 'MORNING' | 'EXACT'; source: 'DSR' | 'TANK_CHECK' | 'SHIFT_OPENING' | 'SHIFT_CLOSING';
  sourceId: string; sourceLabel: string; sourcePath: string; savedAt: string | null; timingNote?: string;
};
export type ReconciliationLine = {
  latestObservation?: TankObservation | null;
  operationalStock?: OperationalStock | null;
  stockTimeline?: TankStockTimeline | null;
  station: { id: string; name: string; code: string } | undefined;
  tank: { id: string; code: string; nominalCapacity: number; workingCapacity: number } | null;
  product: {
    id: string;
    name: string;
    code: string;
    unit: string;
    category?: string;
    packSizeLitres?: string | null;
    purchasePrice: number;
  };
  opening: number;
  receipts: number;
  sales: number;
  adjustments: number;
  bookStock: number;
  physicalStock: number | null;
  variance: number | null;
  dipReading: number | null;
  bookStockAtReading?: number | null;
  readAt: string | null;
  density: number | null;
  densityRecordedAt: string | null;
};
export type InventoryLedgerEntry = {
  id: string;
  type: string;
  quantityDelta: string;
  note: string | null;
  occurredAt: string;
  product: { name: string; code: string; unit: string };
  station: { name: string; code: string };
  tank: { code: string } | null;
};
export type PurchaseReceipt = {
  id: string;
  supplierName: string;
  referenceNo: string | null;
  receivedAt: string;
  station: { name: string };
  lines: Array<{
    quantity: string;
    unitCost: string;
    product: { name: string; code: string; unit: string };
    tank: { code: string } | null;
  }>;
};
export type InventoryBootstrap = {
  stations: InventoryStation[];
  products: InventoryProduct[];
  tanks: ReconciliationLine[];
  untanked: ReconciliationLine[];
  ledger: InventoryLedgerEntry[];
  receipts: PurchaseReceipt[];
};
export type ReceiptForm = ReceiptInput;
export type AdjustmentForm = InventoryAdjustmentInput;
export type TankReadingForm = TankReadingInput;
export type CollectionReconciliation = {
  id: string;
  paymentMethod: string;
  expectedAmount: string;
  actualAmount: string;
  adjustmentAmount: string;
  adjustmentReason: string | null;
  varianceAmount: string;
};
export type ReconciliationShift = {
  id: string;
  shiftNumber: number;
  status: string;
  openingCash: string;
  closingCash: string | null;
  openedAt: string;
  closedAt: string | null;
  station: { id: string; name: string; code: string };
  manager: { id: string; name: string; role: string };
  expected: Record<string, number>;
  allocatedExpected: Record<string, number>;
  autoUnallocated: number;
  salesTotal: number;
  suggestedActual: Record<string, number>;
  closingCollections?: { basis: "MIXED_PAYMENTS"; declaredStaffCollections: number; missingDeclarations: number; physicalOpeningCash: number; physicalClosingCash: number | null };
  recordedCreditAllocations?: Array<{ customerId: string; vehicleId: string | null; paymentMethod: string; amount: number }>;
  collectionDifferences?: { shortage: number; excess: number };
  reconciliation: {
    id: string;
    reconciledAt: string;
    lockedAt: string;
    notes: string | null;
    reconciledBy: { id: string; name: string; role: string };
    collections: CollectionReconciliation[];
    creditAllocations: Array<{
      id: string;
      paymentMethod: "CASH" | "UPI" | "CARD" | "CREDIT" | "FLEET" | "OTHER";
      amount: string;
      dueDate: string;
      customer: {
        id: string;
        name: string;
        code: string;
        type: "CREDIT" | "FLEET";
      };
      vehicle: { id: string; number: string; label: string | null } | null;
    }>;
  } | null;
  totals: {
    expected: number;
    adjustedExpected: number;
    actual: number;
    variance: number;
  } | null;
};
export type ReconciliationCustomer = {
  id: string;
  name: string;
  code: string;
  type: "CREDIT" | "FLEET";
  creditLimit: string;
  creditDays: number;
  outstanding: number;
  vehicles: Array<{ id: string; number: string; label: string | null }>;
};
export type ReconciliationBootstrap = {
  shifts: ReconciliationShift[];
  customers: ReconciliationCustomer[];
};
export type ReconciliationForm = ReconciliationInput;
export type CustomerVehicle = {
  id: string;
  number: string;
  label: string | null;
  active: boolean;
};
export type CustomerLedgerEntry = {
  id: string;
  type: string;
  amount: string;
  description: string;
  dueDate: string | null;
  occurredAt: string;
  station: { name: string; code: string };
  sale: { product: { name: string; code: string; category: string } } | null;
  receipt: { paymentMethod: string; referenceNo: string | null } | null;
};
export type Customer = {
  id: string;
  name: string;
  code: string;
  type: "CREDIT" | "FLEET";
  phone: string | null;
  email: string | null;
  taxId: string | null;
  billingAddress: string | null;
  creditLimit: string;
  creditDays: number;
  active: boolean;
  outstanding: number;
  availableCredit: number;
  ageing: {
    current: number;
    days1to30: number;
    days31to60: number;
    days61to90: number;
    days90plus: number;
  };
  vehicles: CustomerVehicle[];
  ledger: CustomerLedgerEntry[];
};
export type CustomersBootstrap = {
  customers: Customer[];
  stations: Array<{ id: string; name: string; code: string }>;
};
export type Supplier = {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  address: string | null;
  paymentTerms: number;
  active: boolean;
};
export type PurchaseProduct = {
  packSizeLitres?: string | null;
  id: string;
  name: string;
  code: string;
  category: string;
  unit: string;
  hsnCode: string | null;
  purchasePrice: string;
  purchasePriceHistory: Array<{
    id: string;
    price: string;
    effectiveFrom: string;
    createdAt: string;
  }>;
  tankLinked: boolean;
  taxCategory: { rate: string } | null;
};
export type PurchaseStation = {
  id: string;
  name: string;
  code: string;
  configurations: Array<{
    tanks: Array<{ id: string; code: string; productId: string }>;
  }>;
};
export type AttachmentMeta = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
};
export type PurchaseInvoice = {
  version: number;
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  status: string;
  notes: string | null;
  outstanding: number;
  overdue: boolean;
  supplier: { id: string; name: string; code: string; paymentTerms: number };
  station: { id: string; name: string; code: string };
  lines: Array<{
    id: string;
    description: string;
    quantity: string;
    unitCost: string;
    taxRate: string;
    lineTotal: string;
    product: PurchaseProduct | null;
  }>;
  payments: Array<{
    id: string;
    amount: string;
    paymentMethod: string;
    paidAt: string;
  }>;
  receipt: { id: string; receivedAt: string; receivedAtReason: string | null; createdAt: string; createdBy: { name: string } } | null;
  attachments: AttachmentMeta[];
  createdBy: { name: string };
  corrections: Array<{
    id: string;
    reason: string;
    previousTotal: string;
    correctedTotal: string;
    correctedAt: string;
    correctedBy: { name: string };
  }>;
};
export type ProductPriceApprovalNotice = {
  id: string;
  evidence: {
    product: { id: string; name: string; code: string; unit: string };
    invoice: { id: string; invoiceNumber: string; totalAmount: number; quantity: number; sourceUnit: string };
    currentPurchasePrice: number;
    proposedPurchasePrice: number;
    currentSellingPrice: number;
    suggestedSellingPrice: number;
    purchaseEffectiveFrom: string;
  };
};
export type ReceiptTimingAudit = {
  generatedAt: string;
  recordsChanged: false;
  candidates: Array<{
    id: string;
    invoiceNumber: string;
    supplierName: string;
    station: { id: string; name: string; code: string };
    invoiceDate: string;
    receivedAt: string;
    enteredAt: string;
    enteredBy: string;
    reason: string;
  }>;
};
export type ReceiptShiftImpact = {
  receivedAt: string;
  interval: "DURING_SHIFT" | "BETWEEN_SHIFTS";
  affectsClosedShift: boolean;
  shift: { id: string; shiftNumber: number; status: string; openedAt: string; closedAt: string | null } | null;
};
export type InvoicePricePreview = {
  lines: Array<{
    id: string;
    productId: string | null;
    productName: string;
    quantity: number;
    previousUnitCost: number;
    unitCost: number;
    lineTotal: number;
    tax: number;
  }>;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
};
export type ExpenseCategory = {
  id: string;
  name: string;
  code: string;
  active: boolean;
};
export type Expense = {
  id: string;
  description: string;
  amount: string;
  paymentMethod: string;
  incurredAt: string;
  referenceNo: string | null;
  notes: string | null;
  station: { id: string; name: string; code: string };
  category: ExpenseCategory;
  attachments: AttachmentMeta[];
  createdBy: { name: string };
};
export type PurchasesBootstrap = {
  suppliers: Supplier[];
  invoices: PurchaseInvoice[];
  stations: PurchaseStation[];
  products: PurchaseProduct[];
  categories: ExpenseCategory[];
  expenses: Expense[];
  summary: { payables: number; overdue: number; expensesThisMonth: number };
};
export type InvoiceImportPolicy = { enabled: boolean; monitored: boolean };
export type PurchaseInvoiceReceiptInput = {
  receivedAt?: string;
  receiptTimingReason?: string;
  allocations: Array<{ invoiceLineId: string; productId: string; tankId?: string | null }>;
};
export type InvoiceImportMetric = {
  stage: "PDF_TEXT" | "OCR" | "PURCHASE_CHECK" | "SUBMISSION";
  durationMs: number;
  outcome: "SUCCESS" | "FAILED" | "WITHHELD";
};
export type AccountBalance = {
  id: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
};
export type Journal = {
  id: string;
  journalDate: string;
  reference: string;
  description: string;
  sourceType: string;
  sourceId: string;
  station: { name: string; code: string } | null;
  createdBy: { name: string } | null;
  lines: Array<{
    id: string;
    debit: string;
    credit: string;
    memo: string | null;
    account: { code: string; name: string; type: string };
  }>;
};
export type AccountingPayable = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  total: number;
  paid: number;
  outstanding: number;
  status: string;
  overdue: boolean;
  supplier: { name: string; code: string };
  station: { name: string; code: string };
};
export type AccountingBootstrap = {
  accounts: AccountBalance[];
  journals: Journal[];
  payables: AccountingPayable[];
  trial: { debit: number; credit: number };
};
export type ReportStation = { id: string; name: string; code: string };
export type SalesHistory = {
  filter: { startDate: string; endDate: string; stationId?: string; station: ReportStation | null };
  stations: ReportStation[];
  summary: { quantity: number; revenue: number; transactions: number };
  daily: Array<{ key: string; date: string; productId: string; product: string; code: string; unit: string; quantity: number; revenue: number; transactions: number; source?: 'LIVE' | 'HISTORICAL_IMPORT' }>;
};
export type HistoricalImportIssue = { date: string; level: 'WARNING' | 'ERROR'; field: string; message: string };
export type HistoricalSalesSetup = { products: Array<{ product: { id: string; name: string; code: string; sellingPrice: string; sellingPriceHistory?: Array<{ price: string; effectiveFrom: string }> }; tanks: Array<{ id: string; code: string; nominalCapacity: string; workingCapacity: string; openingStock: string; tankType: string }>; nozzles: Array<{ id: string; code: string; dispenserCode: string; openingMeter: string }> }> };
export type HistoricalSalesImportSummary = { id: string; month: string; monthStart: string; sourceFileName: string; cutoverApplied: boolean; createdAt: string; updatedAt: string; product: { name: string; code: string }; importedBy: { name: string }; _count?: { corrections: number } };
export type HistoricalSalesImportDetail = Omit<HistoricalSalesImportSummary, '_count'> & { stationId: string; productId: string; rows: HistoricalSalesRowInput[]; corrections: Array<{ id: string; reason: string; changedAt: string; changedBy: { name: string } }> };
export type HistoricalSalesExtractionInput = { stationId: string; productId: string; month: string; sourceFileName: string; sourceMimeType: 'application/pdf' | 'image/jpeg' | 'image/png'; sourceSize: number; sourceContentBase64: string; ocrEvidenceImagesBase64?: string[] };
export type HistoricalSalesExtractionResult = { rows: HistoricalSalesRowInput[]; warnings: string[]; layoutIssues: string[]; uncertainCells: string[]; periodNeedsConfirmation: boolean; effectiveMonth: string; periodSource: 'DOCUMENT' | 'SELECTED'; confidence: number; detectedProduct: string; detectedMonth: string; detectedPumpColumns: string[]; detectedTankColumns: string[] };
export type ReportSummary = {
  grossSales: number;
  transactions: number;
  meteredVolume: number;
  purchases: number;
  expenses: number;
  receivables: number;
  payables: number;
  inventoryValue: number;
  grossProfit: number;
  netProfit: number;
};
export type ReportsBootstrap = {
  filter: {
    startDate: string;
    endDate: string;
    stationId?: string;
    station: ReportStation | null;
  };
  stations: ReportStation[];
  summary: ReportSummary;
  sales: {
    byProduct: Array<{
      key: string;
      product: string;
      code: string;
      unit: string;
      quantity: number;
      revenue: number;
    }>;
    byPayment: Array<{
      key: string;
      method: string;
      transactions: number;
      amount: number;
    }>;
    daily: Array<{
      key: string;
      date: string;
      transactions: number;
      amount: number;
    }>;
    byStation: Array<{
      key: string;
      station: string;
      code: string;
      transactions: number;
      amount: number;
    }>;
  };
  inventory: Array<{
    key: string;
    product: string;
    code: string;
    unit: string;
    station: string;
    stationCode: string;
    quantity: number;
    value: number;
    purchasePrice: number;
  }>;
  customers: Array<{
    id: string;
    customer: string;
    code: string;
    type: string;
    outstanding: number;
    ageing: {
      current: number;
      days1to30: number;
      days31to60: number;
      days61to90: number;
      days90plus: number;
    };
  }>;
  payables: Array<{
    id: string;
    invoiceNumber: string;
    supplier: string;
    station: string;
    dueDate: string;
    outstanding: number;
    overdue: boolean;
  }>;
  expenses: Array<{ key: string; category: string; amount: number }>;
  financial: {
    accounts: Array<{
      code: string;
      name: string;
      type: string;
      debit: number;
      credit: number;
      balance: number;
    }>;
    revenue: number;
    cogs: number;
    operatingExpenses: number;
    grossProfit: number;
    netProfit: number;
  };
  operations: {
    shifts: Array<{ id:string;shiftNumber:number;station:string;stationCode:string;manager:string;status:string;openedAt:string;closedAt:string|null;openingCash:number;closingCash:number|null;sales:number;expectedCollection:number;actualCollection:number;variance:number;reconciledAt:string|null;reconciledBy:string|null;notes:string|null;collections:Array<{paymentMethod:string;expected:number;actual:number;adjustment:number;variance:number;reason:string|null}>;nozzles:Array<{dispenser:string;nozzle:string;product:string;productCode:string;opening:number;closing:number|null;testing:number;testingReturned:boolean}>;tanks:Array<{tank:string;product:string;productCode:string;opening:number;closing:number|null}> }>;
    tankReadings: Array<{id:string;station:string;stationCode:string;tank:string;product:string;productCode:string;unit:string;physicalStock:number;dipReading:number|null;recordedAt:string;recordedBy:string;notes:string|null}>;
    densityReadings: Array<{id:string;station:string;stationCode:string;tank:string;product:string;productCode:string;density:number;recordedAt:string;recordedBy:string}>;
    purchases: Array<{id:string;invoiceNumber:string;station:string;stationCode:string;supplier:string;supplierCode:string;invoiceDate:string;dueDate:string;subtotal:number;taxAmount:number;totalAmount:number;paidAmount:number;status:string;receivedAt:string|null;lines:Array<{description:string;product:string|null;productCode:string|null;unit:string|null;quantity:number;unitCost:number;taxRate:number;hsnCode:string|null;lineTotal:number}>;receivedLines:Array<{product:string;productCode:string;unit:string;quantity:number;unitCost:number}>}>;
    approvals: Array<{id:string;station:string;actionType:string;status:string;reason:string;requestedBy:string;requestedAt:string;decidedBy:string|null;decidedAt:string|null;decisionNote:string|null;executedAt:string|null;version:number}>;
    customerLedger: Array<{id:string;station:string;stationCode:string;customer:string;customerCode:string;type:string;description:string;amount:number;dueDate:string|null;disputedAt:string|null;occurredAt:string;sourceType:string;sourceId:string|null;referenceNo:string|null;createdBy:string}>;
    supplierPayments: Array<{id:string;station:string;stationCode:string;supplier:string;supplierCode:string;invoiceNumber:string|null;amount:number;paymentMethod:string;referenceNo:string|null;paidAt:string;createdBy:string}>;
    accountingEntries: Array<{id:string;journalId:string;date:string;station:string;stationCode:string|null;reference:string;description:string;sourceType:string;sourceId:string;accountCode:string;accountName:string;accountType:string;debit:number;credit:number;memo:string|null;createdBy:string}>;
  };
  tax: { rows:Array<{product:string;code:string;hsnCode:string|null;treatment:string;quantity:number;turnover:number}>;stateVatTurnover:number;gstReviewTurnover:number;warning:string };
  intelligence: {
    specialistReports: Array<{briefingDate:string;calculatedAt:string;station:string;headline:string;summary:string;priority:string;finding:string;explanation:string;nextStep:string;supportingRecord:string}>;
    runoutForecasts: Array<{station:string;stationCode:string;product:string;productCode:string;unit:string;currentQuantity:number;sellingDaysObserved:number;lookbackDays:number;averageDailyConsumption:number|null;estimatedDaysRemaining:number|null;status:string;assumption:string}>;
    cashFlowForecast: {asOf:string;openingLiquidPosition:number;supplierPaymentsDueIn7Days:number;supplierPaymentsDueIn30Days:number;conservativePositionAfter7Days:number;conservativePositionAfter30Days:number;customerReceiptsIncluded:boolean;assumption:string;warning:string};
    stationComparison: Array<{station:string;stationCode:string;sales:number;transactions:number;inventoryValue:number;receivables:number;payables:number;shiftVariance:number;shiftsReviewed:number}>;
    investigationPacks: Array<{station:string;subject:string;requestedBy:string;createdAt:string;findings:string;informationMissing:string;nextStep:string}>;
    anomalyTrends: Array<{station:string;severity:string;title:string;message:string;supportingRecord:string;createdAt:string;status:string;resolvedAt:string|null}>;
  };
  quality: {periodComplete:boolean;incompleteReason:string|null;missingCostOfSales:boolean;missingCostReason:string|null;salesToPostedRevenueDifference:number;netProfitReconciliationDifference:number;unavailableReportSections:string[]};
};
export type DashboardBootstrap = {
  asOf: string;
  today: ReportSummary;
  collections: Array<{
    key: string;
    method: string;
    transactions: number;
    amount: number;
  }>;
  topProducts: Array<{
    key: string;
    product: string;
    code: string;
    unit: string;
    quantity: number;
    revenue: number;
  }>;
  trend: {
    days: Array<{ date: string; amount: number }>;
    thisWeek: number;
    previousWeek: number;
    weekChange: number | null;
  };
  operations: {
    openShifts: number;
    pendingReconciliations: number;
    cashVariance: number;
  };
  actions: Array<{
    id: string;
    severity: "HIGH" | "MEDIUM";
    title: string;
    detail: string;
    href: string;
  }>;
  stationHealth: Array<{
    id: string;
    name: string;
    code: string;
    sales: number;
    transactions: number;
    openShifts: number;
    pendingReconciliations: number;
    stockAlerts: number;
    status: "ATTENTION" | "RUNNING" | "CALM";
  }>;
  tankStocks: Array<{
    latestObservation?: TankObservation | null;
  operationalStock?: OperationalStock | null;
  stockTimeline?: TankStockTimeline | null;
    id: string;
    code: string;
    product: string;
    productCode: string;
    unit: string;
    station: { id: string; name: string; code: string };
    bookStock: number;
    expectedFromLastDip?: number | null;
    bookDifferenceFromLastDip?: number | null;
    lastClosingDipAt?: string | null;
    workingCapacity: number;
    fillPercent: number;
    sellingPrice: number;
    density: number | null;
    densityRecordedAt: string | null;
    physicalStock: number | null;
    physicalReadingAt: string | null;
    status: "OVER_CAPACITY" | "EMPTY" | "LOW" | "HEALTHY";
  }>;
};
export type DailyBriefingFact = {
  id: string;
  category: string;
  severity: "URGENT" | "ATTENTION" | "POSITIVE" | "INFORMATION";
  label: string;
  value: string;
  context: string;
  evidenceLabel: string;
  evidencePath: string;
};
export type BriefRecordLink = { label: string; path: string };
export type BriefFinding = {
  key: string; title: string; impact: string; amount: string | null; action: string;
  severity: "URGENT" | "ATTENTION"; agent: string; checkedAt: string; records: BriefRecordLink[];
  insufficient?: boolean; acknowledgedAt: string | null; remindAt: string | null;
};
type BriefStock = { id: string; title: string; value: string; level: string; path: string };
type BriefDue = { id: string; title: string; amount: string; dueDate: string; path: string; disputed?: boolean };
export type DailyBriefWorkspaceResponse = {
  station: { id: string; name: string; code: string }; date: string; checkedAt: string; demo: boolean;
  coverage: { noSales: boolean; incompleteShifts: number; collectionsIncomplete: boolean; stockUnavailable: boolean;
    gaps: Array<{ productId: string; productCode: string; missingFrom: string; missingThrough: string; missingDates: string[]; path: string }> };
  attention: BriefFinding[];
  summary: { sales: number; collections: number | null; credit: number; creditIssued: number; creditHasMissingDueDates: boolean;
    receipts: Array<{ id: string; title: string; detail: string; path: string }>;
    stock: BriefStock[]; products: Array<{ code: string; volume: string }> };
  approvals: Array<{ id: string; title: string; reason: string; requester: string; requestedAt: string; path: string }>;
  specialists: Array<{ key: string; name: string; checkedAt: string | null; findings: Array<{
    id: string; title: string; impact: string; amount: unknown; action: string; checkedAt: string; records: BriefRecordLink[];
  }> }>;
  upcoming: { suppliers: BriefDue[]; customers: BriefDue[]; replenishment: BriefStock[] };
  resolved: Array<{ id: string; title: string; detail: string; closedAt: string; path: string }>;
};
export type DailyBriefingResponse = {
  date: string;
  calculatedAt: string;
  facts: DailyBriefingFact[];
  narrative: { headline: string; summary: string; items: Array<{ factId: string; explanation: string; action: string }> };
  narrativeMode: string;
  model: string | null;
};
export type NerveFinding = {
  findingId: string;
  type: string;
  severity: "INFORMATION" | "ATTENTION" | "URGENT";
  title: string;
  agent: NerveAgentPresentation;
  whyItMatters: string;
  recommendedNextStep: string;
  displayValue: unknown;
  calculatedAt: string;
  priorityRank?: number;
  priorityReason?: string;
  recordsToCompare?: string[];
  relatedContext?: Record<string, unknown>;
  unverified?: string[];
  evidence: Array<{ label: string; resolverPath: string }>;
};
export type NerveAgentPresentation = {
  agentKey: string;
  name: string;
  purpose: string;
  icon: "shift" | "stock" | "profit" | "assistant" | "specialist";
};
export type NerveAgentsResponse = {
  mode: "READ_ONLY";
  sourceMode: "SHADOW" | "VERIFIED_DEMO" | "VERIFIED_BRIEFING" | "VERIFIED_AGENT_RUN";
  generatedAt: string;
  stale: boolean;
  safety: { evidenceVerified: boolean; crossTenantDenied: boolean; crossStationDenied: boolean; offlineSafe: boolean; proposalsEnabled: false; actionsEnabled: false };
  summary: { agents: number; findings: number; urgent: number };
  agents: Array<NerveAgentPresentation & { runId: string; status: "ALL_CLEAR" | "FINDINGS" | "NEEDS_ATTENTION"; lastCompletedAt: string; findings: NerveFinding[] }>;
};
export type AskFuelNerveResponse = {
  id: string;
  intent: string;
  scope: { date: string; stationId: string | null };
  answer: {
    title: string;
    explanation: string;
    action: string;
    facts: Array<{ id: string; label: string; value: string; context: string; evidenceLabel: string; evidencePath: string; priorityRank?: number; priorityReason?: string; supportingRecords?: Array<{ evidenceId: string; evidenceType: string; label: string; resolverPath: string }> }>;
  };
  answerMode: string;
  stationId?: string;
  snapshotDate?: string;
  stale?: boolean;
  inconsistentSnapshot?: boolean;
  missingInformation?: string[];
  supportedFollowUps?: Array<"Give me details" | "Why first?" | "Show the records">;
  usage: { used: number; limit: number; remaining: number };
};
export type InvestigationCitation = {
  title: string;
  detail: string;
  value?: string;
  occurredAt?: string;
  factIds: string[];
  evidenceIds: string[];
};
export type InvestigationResponse = {
  investigationId: string;
  agent: NerveAgentPresentation;
  subject: string;
  headline: string;
  summary: string;
  status: "READ_ONLY";
  generatedAt: string;
  recordsReviewed: number;
  snapshotHash: string;
  narrativeMode: string;
  observations: InvestigationCitation[];
  timeline: InvestigationCitation[];
  possibleExplanations: Array<{ text: string; confidence: "POSSIBLE" | "SUPPORTED"; factIds: string[]; evidenceIds: string[] }>;
  unknowns: InvestigationCitation[];
  nextChecks: Array<{ label: string; detail: string; resolverPath: string; evidenceIds: string[] }>;
  evidence: Array<{ evidenceId: string; evidenceType: string; label: string; observedAt: string; resolverPath: string }>;
};
export type InvestigationFollowUpPrompt = "WHY_HIGHEST_PRIORITY" | "RECORDS_COMPARED" | "CHANGED_SINCE_PREVIOUS" | "UNCONFIRMED" | "RELEVANT_RECEIPT";
export type InvestigationFollowUpResponse = {
  investigationId: string;
  agent: NerveAgentPresentation;
  prompt: InvestigationFollowUpPrompt;
  question: string;
  status: "READ_ONLY";
  snapshotHash: string;
  supported: boolean;
  answer: string;
  citations: Array<{ evidenceId: string; label: string; resolverPath: string }>;
};
export type AccessStation = {
  id: string;
  name: string;
  code: string;
  city: string;
  state: string;
  active?: boolean;
  configurations?: Array<{
    dispensers: Array<{
      id: string;
      code: string;
      location: string | null;
      nozzles: Array<{
        id: string;
        code: string;
        product: { code: string; name: string };
        attendantAssignment: { userId: string } | null;
      }>;
    }>;
  }>;
};
export type StationContextData = {
  allStations: boolean;
  stations: AccessStation[];
};
export type AccessBootstrap = {
  stations: AccessStation[];
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    allStations: boolean;
    stationIds: string[];
    loginEnabled: boolean;
    lastLoginAt: string | null;
    mustChangePassword: boolean;
  }>;
};

export type OwnerEmailDelivery = { id: string; type: string; destination: string; status: string; attempts: number; createdAt: string; suppressionReason: string | null; errorMessage: string | null; providerMessageId: string | null };

export interface AccountDeletionPreview { name:string; users:string[]; stations:string[]; counts:Record<string,number>; token:string }
