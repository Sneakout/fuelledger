import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
const config = vi.hoisted(() => ({ EMAIL_DELIVERY_ENABLED: true, SMTP2GO_API_KEY: 'isolated-test-only-key', EMAIL_FROM: 'hello@mindvector.tech', APP_URL: 'https://fuel.mindvector.tech' }));
vi.mock('../src/config/env.js', () => ({ env: config, apnsConfigured: false }));
vi.mock('../src/lib/prisma.js', async () => { const { PrismaClient } = await import('@prisma/client'); return { prisma: new PrismaClient({ datasourceUrl: process.env.DEMO_FOLLOW_UP_TEST_DATABASE_URL ?? 'postgresql://unused' }) }; });
import { prisma } from '../src/lib/prisma.js';
import { prepareDemoFollowUp, sendDemoFollowUp, prepareProspectEmail, sendProspectEmail, listMarketingEmails } from '../src/modules/notifications/demo-follow-up.js';
import { demoEmailRouter } from '../src/routes/demo-email.js';
const suite = process.env.DEMO_FOLLOW_UP_TEST_DATABASE_URL ? describe : describe.skip;
suite('demo follow-up on isolated PostgreSQL', () => {
  beforeEach(() => { config.EMAIL_DELIVERY_ENABLED = true; });
  afterAll(async () => { vi.unstubAllGlobals(); await prisma.$disconnect(); });
  const lead = (contact: string, kind = 'EMAIL') => prisma.demoSession.create({ data: { contact, kind, expiresAt: new Date() } });
  const sendInput = (p: Awaited<ReturnType<typeof prepareDemoFollowUp>>) => ({ id: p.id, previewHash: p.previewHash, permissionConfirmed: true as const });
  it('applies the additive migration while preserving demo sessions', async () => {
    await lead('preserved@example.com');
    await prisma.$executeRawUnsafe('DROP TABLE "demo_follow_up_emails"');
    const sql = await readFile(new URL('../../../prisma/migrations/20261121143000_demo_follow_up_email/migration.sql', import.meta.url), 'utf8');
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
    expect(await prisma.demoSession.count()).toBe(1);
    const nullableMigration = await readFile(new URL('../../../prisma/migrations/20261122090000_manual_prospect_email/migration.sql', import.meta.url), 'utf8');
    await prisma.$executeRawUnsafe(nullableMigration.trim());
  });

  it('prepares a manual prospect without inventing a demo session and deduplicates across both entry points', async () => {
    const count = await prisma.demoSession.count();
    const p = await prepareProspectEmail('  Manual@example.com  ', 'admin');
    expect(await prisma.demoSession.count()).toBe(count);
    expect(p.html).not.toContain('Thank you for exploring');
    expect((await prisma.demoFollowUpEmail.findUniqueOrThrow({ where: { id: p.id } })).demoSessionId).toBeNull();
    expect((await listMarketingEmails()).emails.some(e => e.id === p.id)).toBe(true);
    const session = await lead('manual@example.com');
    expect((await prepareDemoFollowUp(session.id, 'admin')).id).toBe(p.id);
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { succeeded: 1, failed: 0, email_id: 'manual-ok' } }) }); vi.stubGlobal('fetch', fetcher);
    const sent = await Promise.allSettled([sendProspectEmail('manual@example.com', sendInput(p), 'admin'), sendDemoFollowUp(session.id, sendInput(p), 'admin')]);
    expect(sent.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(prepareProspectEmail('a@example.com,b@example.com', 'admin')).rejects.toThrow();
    const opted = await prepareProspectEmail('stopmanual@example.com', 'admin');
    await prisma.demoFollowUpEmail.update({ where: { id: opted.id }, data: { optedOutAt: new Date() } });
    await expect(sendProspectEmail(opted.destination, sendInput(opted), 'admin')).rejects.toMatchObject({ code: 'DEMO_OPTED_OUT' });
    await expect(sendProspectEmail('wrong@example.com', sendInput(opted), 'admin')).rejects.toMatchObject({ code: 'DEMO_PREVIEW_CHANGED' });
  });
  it('previews without sending and deduplicates normalized contacts and simultaneous sends', async () => {
    const a = await lead('Prospect@example.com'); const b = await lead('prospect@example.com');
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { succeeded: 1, failed: 0, email_id: 'smtp-demo' } }) }); vi.stubGlobal('fetch', fetcher);
    const [pa, pb] = await Promise.all([prepareDemoFollowUp(a.id, 'admin'), prepareDemoFollowUp(b.id, 'admin')]);
    expect(pa.id).toBe(pb.id); expect(pa.html).toBe(pb.html); expect(fetcher).not.toHaveBeenCalled();
    const results = await Promise.allSettled([sendDemoFollowUp(a.id, sendInput(pa), 'admin'), sendDemoFollowUp(b.id, sendInput(pb), 'admin')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetcher.mock.calls[0]![1].body); expect(body.to).toEqual(['prospect@example.com']); expect(body.html_body).toBe(pa.html);
    const job = await prisma.demoFollowUpEmail.findUniqueOrThrow({ where: { id: pa.id } }); expect(job).toMatchObject({ status: 'ACCEPTED', attempts: 1, sentBy: 'admin' }); expect(job.permissionConfirmedAt).toBeInstanceOf(Date);
    expect(await prisma.ownerEmailDelivery.count()).toBe(0); expect(await prisma.ownerEmailPreference.count()).toBe(0);
    await expect(sendDemoFollowUp(a.id, sendInput(pa), 'admin')).rejects.toMatchObject({ code: 'DEMO_ALREADY_HANDLED' });
  });
  it('rejects phone contacts, missing permission, wrong preview or destination, and converted owners', async () => {
    const phone = await lead('918000000000', 'PHONE'); await expect(prepareDemoFollowUp(phone.id, 'admin')).rejects.toMatchObject({ code: 'DEMO_EMAIL_REQUIRED' });
    const a = await lead('guard@example.com'); const p = await prepareDemoFollowUp(a.id, 'admin'); const b = await lead('other@example.com');
    await expect(sendDemoFollowUp(a.id, { ...sendInput(p), permissionConfirmed: false as unknown as true }, 'admin')).rejects.toMatchObject({ code: 'DEMO_PERMISSION_REQUIRED' });
    await expect(sendDemoFollowUp(b.id, sendInput(p), 'admin')).rejects.toMatchObject({ code: 'DEMO_PREVIEW_CHANGED' });
    await expect(sendDemoFollowUp(a.id, { ...sendInput(p), previewHash: '0'.repeat(64) }, 'admin')).rejects.toMatchObject({ code: 'DEMO_PREVIEW_CHANGED' });
    const org = await prisma.organization.create({ data: { name: 'Converted' } });
    await prisma.user.create({ data: { email: 'guard@example.com', name: 'Owner', role: 'OWNER', organizationId: org.id, passwordHash: 'test-only' } });
    await expect(sendDemoFollowUp(a.id, sendInput(p), 'admin')).rejects.toMatchObject({ code: 'DEMO_CONVERTED' });
  });
  it('confirms opt-out on POST only, keeps it durable, and blocks sending', async () => {
    const a = await lead('optout@example.com'); const p = await prepareDemoFollowUp(a.id, 'admin'); const job = await prisma.demoFollowUpEmail.findUniqueOrThrow({ where: { id: p.id } });
    const app = express().use('/api/demo-email', demoEmailRouter); const path = `/api/demo-email/unsubscribe?token=${job.unsubscribeToken}`;
    expect((await request(app).get(path)).status).toBe(200); expect((await prisma.demoFollowUpEmail.findUniqueOrThrow({ where: { id: p.id } })).optedOutAt).toBeNull();
    expect((await request(app).post(path)).status).toBe(200); expect((await request(app).post(path)).status).toBe(200);
    expect((await prepareDemoFollowUp(a.id, 'admin')).status).toBe('OPTED_OUT');
    await expect(sendDemoFollowUp(a.id, sendInput(p), 'admin')).rejects.toMatchObject({ code: 'DEMO_OPTED_OUT' });
  });
  it('holds network ambiguity and interrupted workers, but permits explicit safe failure retry', async () => {
    const a = await lead('uncertain@example.com'); const p = await prepareDemoFollowUp(a.id, 'admin'); const fetcher = vi.fn().mockRejectedValue(new Error('timeout')); vi.stubGlobal('fetch', fetcher);
    expect(await sendDemoFollowUp(a.id, sendInput(p), 'admin')).toMatchObject({ status: 'UNKNOWN' });
    await expect(sendDemoFollowUp(a.id, sendInput(p), 'admin')).rejects.toMatchObject({ code: 'DEMO_ALREADY_HANDLED' }); expect(fetcher).toHaveBeenCalledTimes(1);
    const b = await lead('interrupted@example.com'); const pb = await prepareDemoFollowUp(b.id, 'admin');
    await prisma.demoFollowUpEmail.update({ where: { id: pb.id }, data: { status: 'PROCESSING', attempts: 1, leaseUntil: new Date(Date.now() - 1000) } });
    expect((await prepareDemoFollowUp(b.id, 'admin')).status).toBe('UNKNOWN');
    const c = await lead('retry@example.com'); const pc = await prepareDemoFollowUp(c.id, 'admin');
    fetcher.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }); expect((await sendDemoFollowUp(c.id, sendInput(pc), 'admin')).status).toBe('FAILED');
    fetcher.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { succeeded: 1, failed: 0, email_id: 'retry-ok' } }) }); expect((await sendDemoFollowUp(c.id, sendInput(pc), 'admin')).status).toBe('ACCEPTED');
    const d = await lead('paused@example.com'); const pd = await prepareDemoFollowUp(d.id, 'admin'); config.EMAIL_DELIVERY_ENABLED = false;
    await expect(sendDemoFollowUp(d.id, sendInput(pd), 'admin')).rejects.toMatchObject({ code: 'EMAIL_UNAVAILABLE' });
  });
});
