import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';

export const emailWorkerStages = ['schedule', 'agents', 'delivery'] as const;
type Stage = typeof emailWorkerStages[number];
export async function trackEmailWorker<T>(stage: Stage, work: () => Promise<T>, failed: (result: T) => boolean = () => false) {
  const startedAt = new Date();
  await prisma.emailWorkerHeartbeat.upsert({ where: { stage }, create: { stage, lastStartedAt: startedAt }, update: { lastStartedAt: startedAt } });
  try {
    const result = await work();
    const unsuccessful = failed(result);
    await prisma.emailWorkerHeartbeat.updateMany({ where: { stage, lastStartedAt: startedAt }, data: {
      lastRunFailed: unsuccessful, ...(unsuccessful ? { lastFailedAt: new Date() } : { lastSucceededAt: new Date() }),
    } });
    return result;
  } catch (error) {
    await prisma.emailWorkerHeartbeat.updateMany({ where: { stage, lastStartedAt: startedAt }, data: { lastRunFailed: true, lastFailedAt: new Date() } });
    throw error;
  }
}
export async function readEmailWorkerHealth(now = new Date()) {
  const rows = await prisma.emailWorkerHeartbeat.findMany();
  return { backupConfigured: Boolean(env.CRON_SECRET), stages: emailWorkerStages.map(stage => {
    const row = rows.find(row => row.stage === stage);
    const stale = !row?.lastSucceededAt || now.getTime() - row.lastSucceededAt.getTime() > 30 * 60_000;
    return { stage, lastStartedAt: row?.lastStartedAt ?? null, lastSucceededAt: row?.lastSucceededAt ?? null,
      status: row?.lastRunFailed ? 'FAILED' as const : stale ? 'STALE' as const : 'HEALTHY' as const };
  }) };
}
