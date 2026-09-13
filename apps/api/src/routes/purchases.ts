import type { User } from "@fuelledger/shared";
import { expenseCategoryInputSchema, expenseInputSchema, purchaseInvoiceInputSchema, purchaseInvoiceUpdateSchema, supplierInputSchema, supplierPaymentInputSchema } from "@fuelledger/shared";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { safeSaveContext } from "../lib/safe-save.js";
import { assertAttachmentAccess, assertStationAccess, permittedStationIds } from "../lib/station-access.js";
import { authenticate } from "../middleware/authenticate.js";
import { invoiceImportReleasePolicy } from "../modules/purchases/invoice-import-release.js";
import { requestProductPriceChangeFromInvoice } from "../modules/approvals/service.js";
import * as service from "../modules/purchases/service.js";

export const purchasesRouter = Router();
type ValidationIssue = { path?: PropertyKey[]; message?: string };
const invoiceMessage = (issue?: ValidationIssue) => {
  const field = String(issue?.path?.at(-1) ?? "");
  return ({ stationId: "Choose the petrol pump for this invoice.", supplierId: "Choose a supplier for this invoice.", invoiceNumber: "Enter the supplier invoice number.", invoiceDate: "Choose the invoice date.", dueDate: "Choose a due date that is not before the invoice date.", invoiceTotal: "The confirmed invoice total must match the line items and tax.", productId: "Choose a product for every received invoice line.", description: "Enter a description for every invoice line.", quantity: "Enter a quantity greater than zero for every invoice line.", unitCost: "Enter the purchase price for every invoice line.", lines: "Add at least one invoice line." }[field] ?? issue?.message ?? "Please review the invoice details.");
};
const parse = <T>(result: { success: boolean; data?: T; error?: { flatten(): unknown; issues?: ValidationIssue[] } }, code: string, message: string) => {
  if (!result.success) {
    const issue = result.error?.issues?.[0];
    throw new AppError(400, code, code === "INVOICE_INVALID" ? invoiceMessage(issue) : issue?.message ?? message, result.error?.flatten());
  }
  return result.data!;
};
const metricSchema = z.object({
  stage: z.enum(["PDF_TEXT", "OCR", "PURCHASE_CHECK", "SUBMISSION"]),
  durationMs: z.number().int().min(0).max(120_000),
  outcome: z.enum(["SUCCESS", "FAILED", "WITHHELD"]),
}).strict();
const importPolicy = (user: User) => invoiceImportReleasePolicy({
  stage: env.INVOICE_IMPORT_RELEASE_STAGE,
  rolloutPercent: env.INVOICE_IMPORT_ROLLOUT_PERCENT,
  monitoringPercent: env.INVOICE_IMPORT_MONITORING_PERCENT,
  rollback: env.INVOICE_IMPORT_ROLLBACK,
  environment: env.NODE_ENV,
  organizationId: user.organization.id,
  userId: user.id,
  role: user.role,
});

async function createInvoiceAndPriceApproval(user: User, input: ReturnType<typeof purchaseInvoiceInputSchema.parse>) {
  const invoice = await service.createInvoice(user.organization.id, user.id, input);
  try {
    await requestProductPriceChangeFromInvoice(user.organization.id, user.id, invoice, input);
  } catch (error) {
    logger.error({ invoiceId: invoice.id, error: error instanceof Error ? error.message : 'Unknown error' }, 'Could not create product price approval after invoice creation');
  }
  return invoice;
}

purchasesRouter.use(authenticate);

purchasesRouter.get("/invoice-import/policy", (req, res) => {
  const policy = importPolicy(req.user!);
  res.json({ enabled: policy.enabled, monitored: policy.monitored });
});

purchasesRouter.post("/invoice-import/metrics", (req, res) => {
  const policy = importPolicy(req.user!);
  if (!policy.enabled || !policy.monitored) return res.status(204).send();
  const metric = parse(metricSchema.safeParse(req.body), "METRIC_INVALID", "The performance measurement was not accepted.");
  // Deliberately exclude station, supplier, invoice, amounts, filenames and document text.
  logger.info({ metric: "invoice_import_browser_performance", ...metric }, "Invoice import browser performance");
  res.status(204).send();
});

purchasesRouter.use(safeSaveContext);

purchasesRouter.get("/bootstrap", async (req, res) => res.json(await service.bootstrap(req.user!.organization.id, permittedStationIds(req.user!))));
purchasesRouter.get("/receipt-timing-audit", async (req, res) => res.json(await service.receiptTimingAudit(req.user!.organization.id, permittedStationIds(req.user!))));
purchasesRouter.get("/receipt-shift-impact", async (req, res) => res.json(await service.receiptShiftImpact(req.user!.organization.id, String(req.query.stationId ?? ""), String(req.query.receivedAt ?? ""), permittedStationIds(req.user!))));
purchasesRouter.get("/receipts/:id/timing-preview", async (req, res) => res.json(await service.receiptTimingRepairPreview(req.user!.organization.id, req.params.id!, String(req.query.receivedAt ?? ""), permittedStationIds(req.user!))));
purchasesRouter.post("/suppliers", async (req, res) => res.status(201).json({ supplier: await service.createSupplier(req.user!.organization.id, parse(supplierInputSchema.safeParse(req.body), "SUPPLIER_INVALID", "Please review the supplier details.")) }));
purchasesRouter.put("/suppliers/:id", async (req, res) => res.json({ supplier: await service.updateSupplier(req.user!.organization.id, req.params.id!, parse(supplierInputSchema.safeParse(req.body), "SUPPLIER_INVALID", "Please review the supplier details.")) }));

purchasesRouter.post("/invoice-import", async (req, res) => {
  const policy = importPolicy(req.user!);
  if (!policy.enabled) throw new AppError(403, "INVOICE_IMPORT_UNAVAILABLE", "Invoice import is not available for this account yet.");
  const input = parse(purchaseInvoiceInputSchema.safeParse(req.body), "INVOICE_INVALID", "Please review the invoice details.");
  if (input.receiveNow || input.paidNow || input.attachment) throw new AppError(400, "INVOICE_IMPORT_SCOPE_INVALID", "This confirmation can create only an unpaid invoice. Stock, payment and document storage remain separate.");
  assertStationAccess(req.user!, input.stationId);
  res.status(201).json({ invoice: await createInvoiceAndPriceApproval(req.user!, input) });
});

purchasesRouter.post("/invoices", async (req, res) => {
  const input = parse(purchaseInvoiceInputSchema.safeParse(req.body), "INVOICE_INVALID", "Please review the invoice details.");
  assertStationAccess(req.user!, input.stationId);
  res.status(201).json({ invoice: await createInvoiceAndPriceApproval(req.user!, input) });
});
purchasesRouter.get("/invoices/:id/price-preview", async (req, res) => res.json(await service.invoicePricePreview(req.user!.organization.id, req.params.id!, permittedStationIds(req.user!), typeof req.query.invoiceDate === "string" ? req.query.invoiceDate : undefined)));
purchasesRouter.put("/invoices/:id", async (req, res) => {
  const input = parse(purchaseInvoiceUpdateSchema.safeParse(req.body), "INVOICE_INVALID", "Please review the invoice details.");
  res.json({ invoice: await service.updateInvoice(req.user!.organization.id, req.user!.id, req.params.id!, input, permittedStationIds(req.user!)) });
});
purchasesRouter.post("/payments", async (req, res) => {
  const input = parse(supplierPaymentInputSchema.safeParse(req.body), "PAYMENT_INVALID", "Please review the payment details.");
  assertStationAccess(req.user!, input.stationId);
  res.status(201).json({ payment: await service.payInvoice(req.user!.organization.id, req.user!.id, input) });
});
purchasesRouter.post("/expense-categories", async (req, res) => res.status(201).json({ category: await service.createCategory(req.user!.organization.id, parse(expenseCategoryInputSchema.safeParse(req.body), "CATEGORY_INVALID", "Please review the category details.")) }));
purchasesRouter.post("/expenses", async (req, res) => {
  const input = parse(expenseInputSchema.safeParse(req.body), "EXPENSE_INVALID", "Please review the expense details.");
  assertStationAccess(req.user!, input.stationId);
  res.status(201).json({ expense: await service.createExpense(req.user!.organization.id, req.user!.id, input) });
});
purchasesRouter.get("/attachments/:id", async (req, res) => {
  await assertAttachmentAccess(req.user!, req.params.id!);
  const file = await service.attachment(req.user!.organization.id, req.params.id!);
  res.type(file.mimeType).setHeader("Content-Disposition", `inline; filename="${file.fileName.replaceAll('"', '')}"`);
  res.send(file.content);
});
