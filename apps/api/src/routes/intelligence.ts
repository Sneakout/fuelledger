import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { assertStationAccess, permittedStationIds, requireOwner } from '../lib/station-access.js';
import { authenticate } from '../middleware/authenticate.js';
import { dailyBriefing } from '../modules/intelligence/daily-briefing.js';
import { askFuelNerve } from '../modules/intelligence/ask.js';
import { env } from '../config/env.js';
import { briefingFindingSources, nerveFindings } from '../modules/intelligence/nerve-findings.js';
import { investigateFinding } from '../modules/intelligence/investigation.js';
import { answerInvestigationFollowUp, investigationFollowUpPrompts } from '../modules/intelligence/investigation-follow-up.js';
import { demoAgentFindings } from '../modules/intelligence/demo-agent-findings.js';

export const intelligenceRouter = Router();
intelligenceRouter.use(authenticate);
intelligenceRouter.get('/daily-briefing', async (req, res) => {
  requireOwner(req.user!);
  const parsed = z.object({ stationId: z.string().cuid().optional() }).safeParse(req.query);
  if (!parsed.success) throw new AppError(400, 'BRIEFING_FILTER_INVALID', 'Choose a valid fuel station.');
  if (parsed.data.stationId) assertStationAccess(req.user!, parsed.data.stationId);
  res.json(await dailyBriefing(req.user!.organization.id, permittedStationIds(req.user!), parsed.data.stationId, { demoAccess: Boolean(req.user!.demoExpiresAt) }));
});
intelligenceRouter.get('/agents', async (req, res) => {
  requireOwner(req.user!);
  const parsed = z.object({
    stationId: z.string().cuid(),
    source: z.enum(['live', 'shadow']).default('live'),
  }).safeParse(req.query);
  if (!parsed.success) throw new AppError(400, 'STATION_INVALID', 'Choose a valid fuel station.');
  assertStationAccess(req.user!, parsed.data.stationId);
  // The owner-facing page must use the same live records as the dashboard.
  // A saved shadow report is available only when a local tester explicitly
  // requests it; enabling the shadow runtime must never replace live results.
  if (parsed.data.source === 'shadow') {
    if (!env.NERVE_LOCAL_SHADOW_ENABLED || env.NODE_ENV === 'production' || req.user!.demoExpiresAt) {
      throw new AppError(404, 'NERVE_SHADOW_UNAVAILABLE', 'The local shadow review is not available.');
    }
    return res.json(await nerveFindings({ ...(env.NERVE_LOCAL_REPORT_PATH ? { reportPath: env.NERVE_LOCAL_REPORT_PATH } : {}), organizationId: req.user!.organization.id, stationId: parsed.data.stationId }));
  }
  const briefing = await dailyBriefing(req.user!.organization.id, permittedStationIds(req.user!), parsed.data.stationId, { demoAccess: Boolean(req.user!.demoExpiresAt) });
  res.json(demoAgentFindings({ organizationId: req.user!.organization.id, stationId: parsed.data.stationId, generatedAt: briefing.calculatedAt, facts: briefing.facts, sourceMode: req.user!.demoExpiresAt ? 'VERIFIED_DEMO' : 'VERIFIED_BRIEFING' }));
});
intelligenceRouter.post('/investigations', async (req, res) => {
  requireOwner(req.user!);
  const parsed = z.object({
    requestId: z.string().uuid(),
    stationId: z.string().cuid(),
    findingIds: z.array(z.string().uuid()).min(1).max(10),
    source: z.enum(['live', 'shadow']).default('live'),
  }).strict().safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'INVESTIGATION_REQUEST_INVALID', 'Choose up to ten current findings to investigate.');
  assertStationAccess(req.user!, parsed.data.stationId);
  const useLocalShadow = parsed.data.source === 'shadow'
    && env.NERVE_LOCAL_SHADOW_ENABLED
    && env.NODE_ENV !== 'production'
    && !req.user!.demoExpiresAt;
  if (parsed.data.source === 'shadow' && !useLocalShadow) {
    throw new AppError(404, 'NERVE_SHADOW_UNAVAILABLE', 'The local shadow review is not available.');
  }
  const findingIds = [...new Set(parsed.data.findingIds)];
  const briefing = useLocalShadow ? null : await dailyBriefing(req.user!.organization.id, permittedStationIds(req.user!), parsed.data.stationId);
  const sourceFindings = briefing ? briefingFindingSources({ organizationId: req.user!.organization.id, stationId: parsed.data.stationId, generatedAt: briefing.calculatedAt, facts: briefing.facts, findingIds }) : undefined;
  res.json(await investigateFinding({ organizationId: req.user!.organization.id, stationId: parsed.data.stationId, userId: req.user!.id, requestId: parsed.data.requestId, findingIds, ...(useLocalShadow && env.NERVE_LOCAL_REPORT_PATH ? { reportPath: env.NERVE_LOCAL_REPORT_PATH } : {}), ...(sourceFindings ? { sourceFindings } : {}) }));
});
intelligenceRouter.post('/investigations/:investigationId/follow-ups', async (req, res) => {
  requireOwner(req.user!);
  const parameters = z.object({ investigationId: z.string().cuid() }).safeParse(req.params);
  const body = z.object({ stationId: z.string().cuid(), prompt: z.enum(investigationFollowUpPrompts) }).strict().safeParse(req.body);
  if (!parameters.success || !body.success) throw new AppError(400, 'FOLLOW_UP_INVALID', 'Choose one of the available questions for this agent briefing.');
  assertStationAccess(req.user!, body.data.stationId);
  res.json(await answerInvestigationFollowUp({ investigationId: parameters.data.investigationId, organizationId: req.user!.organization.id, stationId: body.data.stationId, userId: req.user!.id, prompt: body.data.prompt }));
});
intelligenceRouter.post('/ask', async (req, res) => {
  requireOwner(req.user!);
  const parsed = z.object({ requestId: z.string().uuid(), question: z.string().trim().min(3).max(300), stationId: z.string().cuid().optional(), asOf: z.iso.datetime().optional() }).safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'QUESTION_INVALID', 'Enter a clear question of up to 300 characters.');
  if (parsed.data.stationId) assertStationAccess(req.user!, parsed.data.stationId);
  const stationIds = permittedStationIds(req.user!);
  res.json(await askFuelNerve({ organizationId: req.user!.organization.id, userId: req.user!.id, requestId: parsed.data.requestId, question: parsed.data.question, ...(stationIds ? { permittedStationIds: stationIds } : {}), ...(parsed.data.stationId ? { stationId: parsed.data.stationId } : {}), ...(parsed.data.asOf ? { asOf: parsed.data.asOf } : {}) }));
});
