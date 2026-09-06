import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { safeSaveContext, safeTransaction } from '../src/lib/safe-save.js';

const url = process.env.RECOVERY_TEST_DATABASE_URL;
// Never fall back to DATABASE_URL: this suite must use an explicitly isolated database.
const suite = url ? describe : describe.skip;
suite('durable saves against isolated PostgreSQL', () => {
  const db = new PrismaClient({ datasourceUrl: url ?? 'postgresql://unused' });
  afterAll(() => db.$disconnect());
  function submit(key: string, body: object, work: Parameters<typeof safeTransaction>[1]) {
    return new Promise((resolve, reject) => {
      safeSaveContext({method:'POST', originalUrl:'/test/save', body, user:{id:'test-user',organization:{id:'test-org'}}, get:()=>key} as any, {} as any, error => {
        if(error) return reject(error);
        safeTransaction(db,work).then(resolve,reject);
      });
    });
  }
  it('commits once for simultaneous submissions and a lost-response retry', async () => {
    const key=randomUUID(), id='retry-'+randomUUID();
    const work = (tx: any) => tx.organization.create({data:{id,name:'Recovery fixture'}});
    const first=await Promise.allSettled([submit(key,{amount:100},work),submit(key,{amount:100},work)]);
    expect(first.some(result=>result.status==='fulfilled')).toBe(true);
    const replay:any=await submit(key,{amount:100},work);
    expect(replay.id).toBe(id);
    expect(await db.organization.count({where:{id}})).toBe(1);
    await expect(submit(key,{amount:200},work)).rejects.toMatchObject({code:'SAVE_KEY_REUSED'});
  });
  it('rolls back business records and retry receipt on an interrupted transaction', async () => {
    const key=randomUUID(),id='rollback-'+randomUUID();
    await expect(submit(key,{},async tx=>{await tx.organization.create({data:{id,name:'Rollback fixture'}});throw new Error('Simulated interruption');})).rejects.toThrow('Simulated interruption');
    expect(await db.organization.count({where:{id}})).toBe(0);
    expect(await db.saveReceipt.count({where:{key}})).toBe(0);
    await submit(key,{},tx=>tx.organization.create({data:{id,name:'Recovered fixture'}}));
    expect(await db.organization.count({where:{id}})).toBe(1);
  });
});
