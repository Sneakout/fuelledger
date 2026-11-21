import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
vi.mock('../src/config/env.js', () => ({env:{JWT_SECRET:'isolated-account-deletion-secret-at-least-32'},isPlatformAdminEmail:(email:string)=>['admin@example.com','protected@example.com'].includes(email)}));
import { deleteAccount, deletionModels, previewAccountDeletion } from '../src/modules/platform/account-deletion.js';
const suite=process.env.ACCOUNT_DELETION_TEST_DATABASE_URL?describe:describe.skip;
suite('complete account deletion in isolated PostgreSQL',()=>{
 const db=new PrismaClient({datasourceUrl:process.env.ACCOUNT_DELETION_TEST_DATABASE_URL??'postgresql://unused'});
 beforeAll(async()=>{const org=await db.organization.create({data:{name:'Platform'}});await db.user.create({data:{id:'platform-actor',organizationId:org.id,email:'admin@example.com',name:'Admin',role:'OWNER',passwordHash:'test'}});});
 afterAll(()=>db.$disconnect());
 let sequence=0;
 async function fixture() {
  const prefix=`tenant${++sequence}`;const ids:Record<string,string>={};
  for(const name of [...deletionModels()].reverse()) {
   const m=Prisma.dmmf.datamodel.models.find(m=>m.name===name)!;
   const data:Record<string,unknown>={};
   for(const field of m.fields.filter(f=>f.kind!=='object')) {
    if(field.name==='id') {data.id=`${prefix}_${name}`;continue;}
    if(!field.isRequired||field.hasDefaultValue||field.isUpdatedAt) continue;
    if(field.isList) {data[field.name]=[];continue;}
    if(field.kind==='enum') {data[field.name]=Prisma.dmmf.datamodel.enums.find(e=>e.name===field.type)!.values[0]!.name;continue;}
    data[field.name]=field.type==='String'?`${prefix}_${field.name}`:field.type==='Boolean'?false:field.type==='DateTime'?new Date('2026-01-01'):field.type==='Json'?{}:field.type==='Bytes'?Buffer.from('test'):1;
   }
   for(const rel of m.fields.filter(f=>f.kind==='object'&&f.relationFromFields?.length)) {
    if(!ids[rel.type]) continue;
    for(const fk of rel.relationFromFields!) data[fk]=ids[rel.type];
   }
   if(m.fields.some(f=>f.name==='organizationId'))data.organizationId=ids.Organization;
   if(name==='User') {data.email=`${prefix}@example.com`;data.role='OWNER';}
   if(name==='Organization')data.name=`Test ${prefix}`;
   if(name==='StockAlertState')data.tankId=ids.Tank;
   if(name==='OwnerEmailDelivery') {data.status='PENDING';data.ownerId=ids.User;}
   if(name==='OwnerNotificationDelivery')data.status='PENDING';
   // Foreign keys without Prisma relations still belong to this tenant.
   if(name==='NerveReviewJob') {data.stationId=ids.Station;data.agentKey='stock';}
   const delegate=(db as unknown as Record<string,{create(args:unknown):Promise<{id?:string}>}>)[name[0]!.toLowerCase()+name.slice(1)]!;
   const row=await delegate.create({data});ids[name]=row.id??String(data.tankId??'');
  }
  return ids;
 }
 it('covers every tenant model and removes only the selected tenant, including sessions, imports, stock, money and queued alerts',async()=>{
  const a=await fixture(),b=await fixture();
  await db.saveReceipt.create({data:{actor:`${a.Organization}:${a.User}`,key:'test-key',fingerprint:'test',result:{}}});
  await db.whatsAppRollout.create({data:{id:'rollout',organizationIds:[a.Organization!,b.Organization!]}});
  await db.demoSession.create({data:{contact:'TENANT1@example.com',kind:'EMAIL',expiresAt:new Date()}});
  await db.demoAccessClaim.create({data:{contact:'tenant1@example.com',kind:'EMAIL'}});
  const p=await previewAccountDeletion(db,a.Organization!,'platform-actor');
  expect(Object.values(p.counts).every(n=>n===1)).toBe(true);
  expect(await deleteAccount(db,a.Organization!,'platform-actor',{token:p.token,name:p.name,reason:'Customer requested removal'})).toEqual({deleted:true});
  expect(await db.organization.findUnique({where:{id:a.Organization!}})).toBeNull();
  expect(await db.demoSession.count()).toBe(0);expect(await db.demoAccessClaim.count()).toBe(0);
  expect(await db.userSession.findUnique({where:{id:a.UserSession!}})).toBeNull();
  expect(await db.stockAlertState.findUnique({where:{tankId:a.Tank!}})).toBeNull();
  expect(await db.nerveReviewJob.findUnique({where:{id:a.NerveReviewJob!}})).toBeNull();
  expect(await db.saveReceipt.count({where:{actor:{startsWith:`${a.Organization}:`}}})).toBe(0);
  const other=await previewAccountDeletion(db,b.Organization!,'platform-actor');expect(Object.values(other.counts).every(n=>n===1)).toBe(true);
  expect((await db.whatsAppRollout.findUniqueOrThrow({where:{id:'rollout'}})).organizationIds).toEqual([b.Organization]);
  expect(await db.whatsAppRolloutAudit.count({where:{action:'CUSTOMER_ACCOUNT_DELETED'}})).toBe(1);
 });
 it('protects self, platform administrators and demo accounts',async()=>{
  const a=await fixture();await expect(previewAccountDeletion(db,a.Organization!,a.User!)).rejects.toMatchObject({code:'PLATFORM_ADMIN_REQUIRED'});
  await db.user.update({where:{id:a.User!},data:{email:'protected@example.com'}});
  await expect(previewAccountDeletion(db,a.Organization!,'platform-actor')).rejects.toMatchObject({code:'ACCOUNT_DELETE_BLOCKED'});
  await db.user.update({where:{id:a.User!},data:{email:'owner@fuelledger.local'}});
  await expect(previewAccountDeletion(db,a.Organization!,'platform-actor')).rejects.toMatchObject({code:'ACCOUNT_DELETE_BLOCKED'});
 });
 it('rejects stale previews, wrong confirmation, wrong administrator and in-flight delivery without deleting anything',async()=>{
  const a=await fixture();const p=await previewAccountDeletion(db,a.Organization!,'platform-actor');
  await expect(deleteAccount(db,a.Organization!,'different',{token:p.token,name:p.name,reason:'Customer requested removal'})).rejects.toMatchObject({code:'ACCOUNT_DELETE_BLOCKED'});
  await expect(deleteAccount(db,a.Organization!,'platform-actor',{token:p.token,name:'wrong',reason:'Customer requested removal'})).rejects.toMatchObject({code:'ACCOUNT_DELETE_BLOCKED'});
  await db.sale.update({where:{id:a.Sale!},data:{quantity:2}});
  await expect(deleteAccount(db,a.Organization!,'platform-actor',{token:p.token,name:p.name,reason:'Customer requested removal'})).rejects.toThrow('changed after');
  await db.ownerEmailDelivery.update({where:{id:a.OwnerEmailDelivery!},data:{status:'PROCESSING'}});
  await expect(previewAccountDeletion(db,a.Organization!,'platform-actor')).rejects.toThrow('currently processing');
  expect(await db.organization.findUnique({where:{id:a.Organization!}})).not.toBeNull();
 });
 it('fails closed on cross-account references, including cascading relations',async()=>{
  const a=await fixture(),b=await fixture();
  await db.dailyBriefFindingPreference.updateMany({where:{organizationId:b.Organization!},data:{userId:a.User!}});
  await expect(previewAccountDeletion(db,a.Organization!,'platform-actor')).rejects.toThrow('shared with another account');
  expect(await db.organization.findUnique({where:{id:a.Organization!}})).not.toBeNull();
 });
 it('rolls back every deletion when the final audit write fails',async()=>{
  const a=await fixture();const p=await previewAccountDeletion(db,a.Organization!,'platform-actor');
  await db.$executeRawUnsafe("CREATE FUNCTION reject_deletion_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit unavailable'; END $$");
  await db.$executeRawUnsafe('CREATE TRIGGER reject_deletion BEFORE INSERT ON whatsapp_rollout_audit FOR EACH ROW EXECUTE FUNCTION reject_deletion_audit()');
  try {await expect(deleteAccount(db,a.Organization!,'platform-actor',{token:p.token,name:p.name,reason:'Customer requested removal'})).rejects.toThrow();}
  finally {await db.$executeRawUnsafe('DROP TRIGGER reject_deletion ON whatsapp_rollout_audit');await db.$executeRawUnsafe('DROP FUNCTION reject_deletion_audit()');}
  expect((await previewAccountDeletion(db,a.Organization!,'platform-actor')).counts).toEqual(p.counts);
 });
 it('allows only one simultaneous deletion and records one audit event',async()=>{
  const a=await fixture();const p=await previewAccountDeletion(db,a.Organization!,'platform-actor');const before=await db.whatsAppRolloutAudit.count();
  const results=await Promise.allSettled([1,2].map(()=>deleteAccount(db,a.Organization!,'platform-actor',{token:p.token,name:p.name,reason:'Customer requested removal'})));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await db.whatsAppRolloutAudit.count()).toBe(before+1);
 });

});
