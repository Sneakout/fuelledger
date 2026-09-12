import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { agentPresentation } from "./agent-presentation.js";

const evidenceSchema = z.object({ evidenceId: z.string().optional(), evidenceType: z.string().optional(), applicationId: z.string().optional(), tenantId: z.string().optional(), resourceId: z.string().optional(), label: z.string(), observedAt: z.string().optional(), resolverPath: z.string().startsWith("/") });
const findingSchema = z.object({
  findingId: z.string(), type: z.string(), title: z.string(), summary: z.string(), detectedAt: z.string(),
  evidence: z.array(evidenceSchema).min(1), proposalIds: z.tuple([]), actionIds: z.tuple([]), visibility: z.literal("SHADOW"),
});
const resultSchema = z.object({ agentKey: z.string(), runId: z.string(), findings: z.array(findingSchema) });
const reportSchema = z.object({
  mode: z.literal("SHADOW"), visibility: z.literal("HIDDEN"), proposalsEnabled: z.literal(false), actionsEnabled: z.literal(false),
  generatedAt: z.string(), scope: z.object({ organizationId: z.string(), stationId: z.string() }), results: z.array(resultSchema),
  isolation: z.object({ crossTenantDenied: z.literal(true), crossStationDenied: z.literal(true) }),
  offline: z.object({ failedClosed: z.literal(true), fuelNerveUnaffected: z.literal(true) }),
});

export async function nerveFindings(input: { reportPath?: string; organizationId: string; stationId: string }) {
  const report = await loadNerveReport(input);
  const ageMs = Date.now() - Date.parse(report.generatedAt);
  const groups = report.results.map(result => {
    const agent = agentPresentation(result.agentKey);
    const findings = result.findings.map(finding => presentFinding(finding, agent));
    return {
    ...agent,
    runId: result.runId,
    status: agentStatus(findings),
    lastCompletedAt: report.generatedAt,
    findings,
  }; });
  return {
    mode: "READ_ONLY" as const, sourceMode: report.mode, generatedAt: report.generatedAt, stale: !Number.isFinite(ageMs) || ageMs > 24 * 60 * 60 * 1000,
    safety: { evidenceVerified: true, crossTenantDenied: true, crossStationDenied: true, offlineSafe: true, proposalsEnabled: false, actionsEnabled: false },
    summary: { agents: groups.length, findings: groups.reduce((sum, group) => sum + group.findings.length, 0), urgent: groups.flatMap(group => group.findings).filter(item => item.severity === "URGENT").length },
    agents: groups,
  };
}

export async function nerveFindingSources(input: { reportPath?: string; organizationId: string; stationId: string; findingIds: string[] }) {
  const report = await loadNerveReport(input);
  const ageMs = Date.now() - Date.parse(report.generatedAt);
  if (!Number.isFinite(ageMs) || ageMs > 24 * 60 * 60 * 1000) throw new AppError(409, "NERVE_FINDING_STALE", "These findings are out of date. Run a fresh local review before investigating them.");
  const byId = new Map(report.results.flatMap(result => {
    const agent = agentPresentation(result.agentKey);
    return result.findings.map(finding => [finding.findingId, { finding, agent }] as const);
  }));
  const selected = input.findingIds.map(id => byId.get(id));
  if (selected.some(item => !item)) throw new AppError(404, "NERVE_FINDING_NOT_FOUND", "One or more findings are no longer available. Refresh Insights and try again.");
  return selected.map(item => ({ ...item!.finding, agent: item!.agent, detail: parseDetail(item!.finding.summary) }));
}

async function loadNerveReport(input: { reportPath?: string; organizationId: string; stationId: string }) {
  if (!input.reportPath) throw unavailable();
  try {
    const metadata = await stat(input.reportPath);
    if (!metadata.isFile() || metadata.size > 5_000_000) throw unavailable();
    const parsed = reportSchema.safeParse(JSON.parse(await readFile(input.reportPath, "utf8")));
    if (!parsed.success) throw unavailable();
    const report = parsed.data;
    if (report.scope.organizationId !== input.organizationId || report.scope.stationId !== input.stationId) throw new AppError(404, "NERVE_REPORT_SCOPE_MISMATCH", "Run a shadow review for this fuel station before viewing its findings.");
    return report;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unavailable();
  }
}

function presentFinding(finding: z.infer<typeof findingSchema>, agent: ReturnType<typeof agentPresentation>) {
  const detail = parseDetail(finding.summary);
  return {
    findingId: finding.findingId, type: finding.type, severity: severity(detail.severity), title: finding.title, agent,
    whyItMatters: typeof detail.whyItMatters === "string" ? detail.whyItMatters : "FuelNerve records indicate this item needs review.",
    recommendedNextStep: typeof detail.recommendedNextStep === "string" ? detail.recommendedNextStep : "Open the supporting records and review the source data.",
    displayValue: detail.displayValue ?? null, calculatedAt: typeof detail.calculatedAt === "string" ? detail.calculatedAt : finding.detectedAt,
    ...(typeof detail.priorityRank === "number" ? { priorityRank: detail.priorityRank } : {}),
    ...(typeof detail.priorityReason === "string" ? { priorityReason: detail.priorityReason } : {}),
    ...(Array.isArray(detail.recordsToCompare) ? { recordsToCompare: detail.recordsToCompare.filter((item): item is string => typeof item === "string") } : {}),
    ...(detail.relatedContext && typeof detail.relatedContext === "object" && !Array.isArray(detail.relatedContext) ? { relatedContext: detail.relatedContext as Record<string, unknown> } : {}),
    ...(Array.isArray(detail.unverified) ? { unverified: detail.unverified.filter((item): item is string => typeof item === "string") } : {}),
    evidence: finding.evidence,
  };
}

function parseDetail(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function severity(value: unknown): "INFORMATION" | "ATTENTION" | "URGENT" { return value === "URGENT" || value === "ATTENTION" ? value : "INFORMATION"; }
function agentStatus(findings: Array<{ severity: "INFORMATION" | "ATTENTION" | "URGENT" }>): "ALL_CLEAR" | "FINDINGS" | "NEEDS_ATTENTION" { if (findings.some(finding => finding.severity === "URGENT")) return "NEEDS_ATTENTION"; return findings.length ? "FINDINGS" : "ALL_CLEAR"; }
function unavailable() { return new AppError(503, "NERVE_REPORT_UNAVAILABLE", "The local intelligence review is not available yet. Run the shadow review and try again."); }
