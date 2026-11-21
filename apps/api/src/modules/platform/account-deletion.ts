import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Prisma, type PrismaClient } from '@prisma/client';
import { env, isPlatformAdminEmail } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

// Ownership is deliberately independent of actor/created-by references. Never
// follow those references to remove records belonging to another customer.
const parents: Record<string, [string, string][]> = {
  ProductSellingPrice: [['productId','Product']], ProductPurchasePrice: [['productId','Product']],
  StationConfiguration: [['stationId','Station']], Tank: [['configurationId','StationConfiguration']],
  Shift: [['stationId','Station']], ShiftUser: [['shiftId','Shift']], ShiftTankReading: [['shiftId','Shift']],
  ShiftNozzleReading: [['shiftId','Shift']], ShiftNozzleAssignment: [['shiftId','Shift']],
  Dispenser: [['configurationId','StationConfiguration']], Nozzle: [['dispenserId','Dispenser']],
  NozzleAttendantAssignment: [['nozzleId','Nozzle']], NozzleTank: [['nozzleId','Nozzle']],
  Vehicle: [['customerId','Customer']], PurchaseInvoiceCorrection: [['invoiceId','PurchaseInvoice']],
  PurchaseInvoiceLine: [['invoiceId','PurchaseInvoice']], Attachment: [['purchaseInvoiceId','PurchaseInvoice'],['expenseId','Expense']],
  JournalLine: [['journalId','Journal']], ReceiptLine: [['receiptId','PurchaseReceipt']],
  ShiftReconciliation: [['shiftId','Shift']], ShiftCreditAllocation: [['reconciliationId','ShiftReconciliation']],
  ShiftCollectionReconciliation: [['reconciliationId','ShiftReconciliation']], UserSession: [['userId','User']],
  UserStationAccess: [['userId','User']], StockAlertState: [['tankId','Tank']],
};
const globalModels = new Set(['SaveReceipt','WhatsAppRollout','WhatsAppRolloutAudit','DemoSession','DemoAccessClaim','DemoFollowUpEmail','AuthThrottle']);
const models = Prisma.dmmf.datamodel.models;
const model = (name: string) => { const result = models.find(m => m.name === name); if (!result) throw new Error(`Unknown model ${name}`); return result; };
const q = (name: string) => `"${name.replaceAll('"','""')}"`;
const table = (name: string) => q(model(name).dbName ?? name);
const col = (name: string, field: string) => { const f = model(name).fields.find(f => f.name === field); if (!f) throw new Error(`Unknown field ${name}.${field}`); return q(f.dbName ?? field); };
export function deletionModels() {
  const names = models.filter(m => !globalModels.has(m.name)).map(m => m.name);
  for (const name of names) if (name !== 'Organization' && !model(name).fields.some(f => f.name === 'organizationId') && !parents[name]) throw new Error(`Account deletion ownership missing: ${name}`);
  const result: string[] = [], visiting = new Set<string>();
  function visit(name: string) {
    if (result.includes(name)) return;
    if (visiting.has(name)) throw new Error(`Account deletion dependency cycle: ${name}`);
    visiting.add(name);
    for (const [,parent] of parents[name] ?? []) visit(parent);
    for (const relation of model(name).fields.filter(f => f.kind === 'object' && f.relationFromFields?.length)) if (names.includes(relation.type)) visit(relation.type);
    visiting.delete(name); result.push(name);
  }
  names.forEach(visit);
  return result.reverse();
}
function scope(name: string, alias = 'r'): string {
  if (name === 'Organization') return `${alias}.${col(name,'id')} = $1`;
  if (model(name).fields.some(f => f.name === 'organizationId')) return `${alias}.${col(name,'organizationId')} = $1`;
  return '(' + parents[name]!.map(([field,parent]) => `${alias}.${col(name,field)} IN (SELECT p.${col(parent,'id')} FROM ${table(parent)} p WHERE ${scope(parent,'p')})`).join(' OR ') + ')';
}
const fail = (message: string) => new AppError(409,'ACCOUNT_DELETE_BLOCKED',message);
type Tx = Prisma.TransactionClient;
async function snapshot(tx: Tx, organizationId: string, actorId: string) {
  const actor = await tx.user.findUnique({where:{id:actorId},select:{email:true}});
  if (!actor || !isPlatformAdminEmail(actor.email)) throw new AppError(403,'PLATFORM_ADMIN_REQUIRED','Only a platform administrator can delete customer accounts.');
  const organization = await tx.organization.findUnique({ where: { id: organizationId }, include: { users: { select: { id:true,email:true } }, stations: { select:{name:true} } } });
  if (!organization) throw new AppError(404,'ACCOUNT_NOT_FOUND','This account no longer exists.');
  if (organization.users.some(u => u.id === actorId || isPlatformAdminEmail(u.email) || u.email === 'owner@fuelledger.local')) throw fail('Administrator and shared demo accounts cannot be deleted here.');
  const counts: Record<string,number> = {}, fingerprints: string[] = [];
  for (const name of [...deletionModels()].reverse()) {
    // Lock all existing owned rows before checking worker states or deleting.
    const rows = await tx.$queryRawUnsafe<Array<{ value: string }>>(`SELECT md5(row_to_json(r)::text) AS value FROM ${table(name)} r WHERE ${scope(name)} FOR UPDATE`, organizationId);
    counts[name] = rows.length;
    fingerprints.push(name, ...rows.map(r => r.value).sort());
  }
  const activeEmail = await tx.ownerEmailDelivery.count({where:{organizationId,status:'PROCESSING'}});
  const activePush = await tx.ownerPushDelivery.count({where:{organizationId,status:'PROCESSING'}});
  const activeWhatsApp = await tx.ownerNotificationDelivery.count({where:{organizationId,status:'PROCESSING'}});
  const reviewJobs = await tx.nerveReviewJob.findMany({where:{organizationId}});
  if (activeEmail || activePush || activeWhatsApp || reviewJobs.some(j => j.leaseToken !== null)) throw fail('A message or review is currently processing. Wait for it to finish before deleting this account.');
  // Even a malformed cross-account FK must never cascade into another tenant.
  for (const child of models) for (const relation of child.fields.filter(f => f.kind === 'object' && f.relationFromFields?.length)) {
    if (!(relation.type in counts)) continue;
    const fields = relation.relationFromFields!, targets = relation.relationToFields!;
    const matches = fields.map((f,i) => `c.${col(child.name,f)} = p.${col(relation.type,targets[i]!)}`).join(' AND ');
    const owned = child.name in counts ? scope(child.name,'c') : 'FALSE';
    const references = await tx.$queryRawUnsafe<Array<{ found:boolean }>>(`SELECT EXISTS(SELECT 1 FROM ${table(child.name)} c JOIN ${table(relation.type)} p ON ${matches} WHERE ${scope(relation.type,'p')} AND NOT (${owned})) AS found`, organizationId);
    if (references[0]?.found) throw fail('Records shared with another account need review before deletion. No records have been removed.');
  }
  return { organization, counts, fingerprint:createHash('sha256').update(JSON.stringify(fingerprints)).digest('hex') };
}
export async function previewAccountDeletion(db: PrismaClient, organizationId: string, actorId: string) {
  return db.$transaction(async tx => {
    const s = await snapshot(tx,organizationId,actorId);
    return { name:s.organization.name, users:s.organization.users.map(u => u.email), stations:s.organization.stations.map(s => s.name), counts:s.counts,
      token:jwt.sign({purpose:'account-deletion',organizationId,actorId,fingerprint:s.fingerprint},env.JWT_SECRET,{expiresIn:'10m'}) };
  }, {isolationLevel:'Serializable',timeout:30000});
}
export async function deleteAccount(db: PrismaClient, organizationId: string, actorId: string, input: {token:string;name:string;reason:string}) {
  let claim: jwt.JwtPayload;
  try { const decoded = jwt.verify(input.token,env.JWT_SECRET); if (typeof decoded === 'string') throw Error(); claim=decoded; } catch { throw fail('The deletion preview expired. Open a fresh preview before continuing.'); }
  if (claim.purpose !== 'account-deletion' || claim.organizationId !== organizationId || claim.actorId !== actorId) throw fail('This confirmation does not match the selected account.');
  return db.$transaction(async tx => {
    const s = await snapshot(tx,organizationId,actorId);
    if (input.name !== s.organization.name || input.reason.trim().length < 10) throw fail('Enter the exact account name and a deletion reason of at least 10 characters.');
    if (s.fingerprint !== claim.fingerprint) throw fail('This account changed after the preview. Review a fresh preview before deleting.');
    const emails = s.organization.users.map(u => u.email.toLowerCase());
    const contacts = [...emails, ...(await tx.user.findMany({where:{organizationId},select:{phone:true}})).flatMap(u=>u.phone?[u.phone]:[])];
    await tx.$queryRawUnsafe('SELECT id FROM demo_follow_up_emails WHERE destination = ANY($1::text[]) FOR UPDATE', emails);
    const followups = await tx.demoFollowUpEmail.findMany({where:{destination:{in:emails}}});
    if (followups.some(j => j.status === 'PROCESSING')) throw fail('An email is currently processing. Wait before deleting.');
    await tx.demoFollowUpEmail.deleteMany({where:{destination:{in:emails}}});
    await tx.$executeRawUnsafe('DELETE FROM demo_sessions WHERE lower(contact) = ANY($1::text[])', contacts);
    await tx.$executeRawUnsafe('DELETE FROM demo_access_claims WHERE lower(contact) = ANY($1::text[])', contacts);
    await tx.saveReceipt.deleteMany({where:{actor:{startsWith:`${organizationId}:`}}});
    await tx.$executeRawUnsafe('UPDATE whatsapp_rollout SET organization_ids = array_remove(organization_ids, $1), version = version + 1 WHERE $1 = ANY(organization_ids)',organizationId);
    // Scopes must be evaluated while their parents still exist.
    for (const name of deletionModels()) await tx.$executeRawUnsafe(`DELETE FROM ${table(name)} r WHERE ${scope(name)}`,organizationId);
    await tx.whatsAppRolloutAudit.create({data:{actorId,action:'CUSTOMER_ACCOUNT_DELETED',details:{organizationId,reason:input.reason.trim(),counts:s.counts}}});
    return {deleted:true};
  }, {isolationLevel:'Serializable',timeout:30000});
}
