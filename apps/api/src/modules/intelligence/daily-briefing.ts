import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { bootstrap as dashboardBootstrap } from '../dashboard/service.js';
import { buildReport } from '../reports/service.js';

export type BriefingFact = { id: string; category: string; severity: 'URGENT' | 'ATTENTION' | 'POSITIVE' | 'INFORMATION'; label: string; value: string; context: string; evidenceLabel: string; evidencePath: string };
type Narrative = { headline: string; summary: string; items: Array<{ factId: string; explanation: string; action: string }> };
const narrativeSchema = z.object({ headline: z.string().min(5).max(90), summary: z.string().min(10).max(240), items: z.array(z.object({ factId: z.string(), explanation: z.string().min(5).max(180), action: z.string().min(3).max(120) })).max(5) });
const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const severityOrder = { URGENT: 0, ATTENTION: 1, POSITIVE: 2, INFORMATION: 3 } as const;

export async function requireIntelligenceAccess(organizationId: string, now = new Date()) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { intelligenceEnabledAt: true, intelligenceExpiresAt: true } });
  if (!organization?.intelligenceEnabledAt || (organization.intelligenceExpiresAt && organization.intelligenceExpiresAt <= now)) throw new AppError(403, 'INTELLIGENCE_PLAN_REQUIRED', 'Daily briefing is available with Core + FuelNerve Intelligence.');
}

function fallbackNarrative(facts: BriefingFact[]): Narrative {
  const lead = facts[0];
  return {
    headline: lead?.severity === 'URGENT' ? 'Your fuel station needs attention' : lead?.severity === 'ATTENTION' ? 'A few items deserve a closer look' : 'Your fuel station is running steadily',
    summary: 'FuelNerve reviewed today’s trusted operational and accounting records and arranged the most useful actions first.',
    items: facts.slice(0, 5).map(fact => ({ factId: fact.id, explanation: fact.context, action: fact.severity === 'POSITIVE' ? 'Keep monitoring this signal.' : `Review ${fact.evidenceLabel.toLowerCase()}.` })),
  };
}

async function explain(facts: BriefingFact[]): Promise<{ narrative: Narrative; mode: string; model: string | null }> {
  if (!env.OPENAI_API_KEY || !facts.length) return { narrative: fallbackNarrative(facts), mode: 'DETERMINISTIC', model: null };
  try {
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({
      model: env.OPENAI_BRIEFING_MODEL, store: false,
      instructions: 'You explain and prioritize verified fuel-station facts. Never calculate, infer, change, or introduce numbers, money, quantities, dates, percentages, names, or evidence. Use only supplied fact IDs. Write plain language. Do not use digits, currency symbols, or percent signs. Return at most five items.',
      input: JSON.stringify(facts),
      text: { format: { type: 'json_schema', name: 'daily_owner_briefing', strict: true, schema: {
        type: 'object', additionalProperties: false, required: ['headline', 'summary', 'items'],
        properties: {
          headline: { type: 'string' }, summary: { type: 'string' },
          items: { type: 'array', maxItems: 5, items: { type: 'object', additionalProperties: false, required: ['factId', 'explanation', 'action'], properties: { factId: { type: 'string' }, explanation: { type: 'string' }, action: { type: 'string' } } } },
        },
      } } },
    }) });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
    const body = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const outputText = body.output_text ?? body.output?.flatMap(item => item.content ?? []).find(item => item.type === 'output_text')?.text;
    const parsed = narrativeSchema.parse(JSON.parse(outputText ?? ''));
    const factIds = new Set(facts.map(fact => fact.id));
    const text = [parsed.headline, parsed.summary, ...parsed.items.flatMap(item => [item.explanation, item.action])].join(' ');
    if (parsed.items.some(item => !factIds.has(item.factId)) || /[\d₹%]/.test(text)) throw new Error('AI narrative introduced an unsupported fact.');
    return { narrative: parsed, mode: 'AI_EXPLAINED', model: env.OPENAI_BRIEFING_MODEL };
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : 'unknown' }, 'Daily briefing AI explanation failed; deterministic briefing retained');
    return { narrative: fallbackNarrative(facts), mode: 'DETERMINISTIC_FALLBACK', model: null };
  }
}

export async function dailyBriefing(organizationId: string, permittedStationIds?: string[], stationId?: string, options: { demoAccess?: boolean } = {}) {
  const now = new Date();
  if (!options.demoAccess) await requireIntelligenceAccess(organizationId, now);
  const today = isoDate(now), yesterdayDate = new Date(now); yesterdayDate.setDate(yesterdayDate.getDate() - 1); const yesterday = isoDate(yesterdayDate);
  const [dashboard, previous] = await Promise.all([
    dashboardBootstrap(organizationId, permittedStationIds, stationId),
    buildReport(organizationId, { startDate: yesterday, endDate: yesterday, permittedStationIds, ...(stationId ? { stationId } : {}) }),
  ]);
  const facts: BriefingFact[] = [];
  const add = (fact: BriefingFact) => facts.push(fact);
  if (dashboard.operations.pendingReconciliations) add({ id: 'pending-reconciliation', category: 'SHIFT', severity: 'URGENT', label: 'Shifts awaiting reconciliation', value: String(dashboard.operations.pendingReconciliations), context: 'Expected and actual collections have not yet been approved.', evidenceLabel: 'Reconciliation records', evidencePath: '/reconciliation' });
  if (dashboard.operations.openShifts) add({ id: 'open-shifts', category: 'SHIFT', severity: 'ATTENTION', label: 'Open shifts', value: String(dashboard.operations.openShifts), context: 'These shifts remain operational and require a proper handover before closing.', evidenceLabel: 'Open shift records', evidencePath: '/operations' });
  for (const tank of dashboard.tankStocks.filter(tank => tank.status !== 'HEALTHY')) add({ id: `tank-${tank.id}`, category: 'STOCK', severity: tank.status === 'EMPTY' ? 'URGENT' : 'ATTENTION', label: `${tank.productCode} ${tank.code}`, value: `${Math.round(tank.bookStock).toLocaleString('en-IN')} L`, context: tank.status === 'EMPTY' ? 'Book stock is empty or below zero.' : 'Book stock is below the operating threshold.', evidenceLabel: 'Tank stock timeline', evidencePath: '/inventory' });
  const salesChange = previous.summary.grossSales ? ((dashboard.today.grossSales - previous.summary.grossSales) / previous.summary.grossSales) * 100 : null;
  add({ id: 'sales-today', category: 'SALES', severity: salesChange !== null && salesChange < -15 ? 'ATTENTION' : salesChange !== null && salesChange > 10 ? 'POSITIVE' : 'INFORMATION', label: 'Sales today', value: money(dashboard.today.grossSales), context: salesChange === null ? 'There is no comparable prior-day sales baseline.' : `Compared with yesterday: ${salesChange >= 0 ? '+' : ''}${salesChange.toFixed(1)}%.`, evidenceLabel: 'Sales records', evidencePath: '/sales' });
  add({ id: 'profit-today', category: 'PROFIT', severity: dashboard.today.netProfit < 0 ? 'URGENT' : 'INFORMATION', label: 'Net profit today', value: money(dashboard.today.netProfit), context: 'Calculated from posted revenue, cost of sales and operating expenses.', evidenceLabel: 'Profit report', evidencePath: '/reports' });
  if (dashboard.today.receivables > 0) add({ id: 'receivables', category: 'CREDIT', severity: 'ATTENTION', label: 'Customer balances', value: money(dashboard.today.receivables), context: 'Customer ledger balances remain outstanding.', evidenceLabel: 'Customer ledgers', evidencePath: '/customers' });
  if (dashboard.today.payables > 0) add({ id: 'payables', category: 'PURCHASES', severity: 'INFORMATION', label: 'Supplier balances', value: money(dashboard.today.payables), context: 'Open supplier invoices remain payable.', evidenceLabel: 'Supplier invoices', evidencePath: '/purchases' });
  facts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.id.localeCompare(b.id));
  const stationScope = stationId ?? 'ALL';
  const dateValue = new Date(`${today}T00:00:00.000Z`);
  const existing = await prisma.dailyOwnerBriefing.findUnique({ where: { organizationId_stationScope_briefingDate: { organizationId, stationScope, briefingDate: dateValue } } });
  if (existing && JSON.stringify(existing.facts) === JSON.stringify(facts)) return { date: today, calculatedAt: existing.calculatedAt.toISOString(), facts, narrative: existing.narrative as Narrative, narrativeMode: existing.narrativeMode, model: existing.model };
  const generated = await explain(facts);
  const saved = await prisma.dailyOwnerBriefing.upsert({ where: { organizationId_stationScope_briefingDate: { organizationId, stationScope, briefingDate: dateValue } }, create: { organizationId, stationScope, briefingDate: dateValue, calculatedAt: now, facts: facts as unknown as Prisma.InputJsonValue, narrative: generated.narrative as unknown as Prisma.InputJsonValue, narrativeMode: generated.mode, model: generated.model }, update: { calculatedAt: now, facts: facts as unknown as Prisma.InputJsonValue, narrative: generated.narrative as unknown as Prisma.InputJsonValue, narrativeMode: generated.mode, model: generated.model } });
  return { date: today, calculatedAt: saved.calculatedAt.toISOString(), facts, narrative: generated.narrative, narrativeMode: generated.mode, model: generated.model };
}
