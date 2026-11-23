import { beforeEach, expect, it, vi } from 'vitest';
const db=vi.hoisted(()=>({upsert:vi.fn(),updateMany:vi.fn(),findMany:vi.fn()}));
vi.mock('../src/lib/prisma.js',()=>({prisma:{emailWorkerHeartbeat:db}}));
import {readEmailWorkerHealth,trackEmailWorker} from '../src/modules/notifications/email-worker-health.js';
beforeEach(()=>vi.resetAllMocks());
it('shows missing or stale checks independently of sending configuration',async()=>{
 const now=new Date('2026-11-24T04:00:00Z');db.findMany.mockResolvedValue([{stage:'schedule',lastSucceededAt:new Date('2026-11-24T03:45:00Z'),lastRunFailed:false},{stage:'delivery',lastSucceededAt:new Date('2026-11-23T04:00:00Z'),lastRunFailed:false}]);
 expect((await readEmailWorkerHealth(now)).stages.map(s=>[s.stage,s.status])).toEqual([['schedule','HEALTHY'],['agents','STALE'],['delivery','STALE']]);
});
it('records partial schedule failures and exceptions without leaking error text',async()=>{
 await trackEmailWorker('schedule',async()=>({failed:1}),result=>result.failed>0);
 expect(db.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({data:expect.objectContaining({lastRunFailed:true,lastFailedAt:expect.any(Date)})}));
 await expect(trackEmailWorker('delivery',async()=>{throw new Error('private details')})).rejects.toThrow('private details');
 expect(JSON.stringify(db.updateMany.mock.calls)).not.toContain('private details');
});
it('does not let an older overlapping run overwrite the latest heartbeat',async()=>{
 await trackEmailWorker('delivery',async()=>({accepted:2}));
 expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{stage:'delivery',lastStartedAt:expect.any(Date)},data:{lastRunFailed:false,lastSucceededAt:expect.any(Date)}}));
});
