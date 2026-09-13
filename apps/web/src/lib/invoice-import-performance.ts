import { api, type InvoiceImportMetric } from "./api";

const pending: InvoiceImportMetric[] = [];

export function rememberInvoiceImportPerformance(stage: InvoiceImportMetric["stage"], startedAt: number, outcome: InvoiceImportMetric["outcome"]) {
  const durationMs = Math.max(0, Math.min(120_000, Math.round(performance.now() - startedAt)));
  pending.push({ stage, durationMs, outcome });
  if (pending.length > 12) pending.shift();
}

export async function flushInvoiceImportPerformance(monitored: boolean) {
  const metrics = pending.splice(0);
  if (!monitored) return;
  await Promise.allSettled(metrics.map(metric => api.recordInvoiceImportMetric(metric)));
}

export async function recordInvoiceImportPerformance(metric: InvoiceImportMetric, monitored: boolean) {
  if (!monitored) return;
  await api.recordInvoiceImportMetric(metric).catch(() => undefined);
}
