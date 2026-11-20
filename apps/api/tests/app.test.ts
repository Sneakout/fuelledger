import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

vi.mock('../src/lib/prisma.js', () => ({ prisma: { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]), user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() }, userSession: { findUnique: vi.fn() }, authThrottle: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() }, ownerNotificationDelivery: { findFirst: vi.fn().mockResolvedValue({ id: 'delivery-1', providerMessageId: 'wamid.1', callbackKey: null, status: 'ACCEPTED', failureKind: null }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } } }));
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.CRON_SECRET = 'test-cron-secret-at-least-16';
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = '123456789';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-sender';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-webhook-verify-token';
process.env.WHATSAPP_APP_SECRET = 'test-meta-app-secret-that-is-long-enough';

describe('API', async () => {
  const { createApp } = await import('../src/app.js');
  const { prisma } = await import('../src/lib/prisma.js');
  beforeEach(() => vi.clearAllMocks());
  it('reports health', async () => { const response = await request(createApp()).get('/api/health'); expect(response.status).toBe(200); expect(response.body.database).toBe('connected'); });
  it('validates login input', async () => { const response = await request(createApp()).post('/api/auth/login').send({ email: 'bad', password: 'short' }); expect(response.status).toBe(400); expect(response.body.error.code).toBe('VALIDATION_ERROR'); });
  describe('signed-in account settings', () => {
    const user = {
      id: 'owner-1', name: 'Original name', email: 'owner@example.com', role: 'OWNER',
      active: true, loginEnabled: true, mustChangePassword: false,
      organization: { id: 'org-1', name: 'Test station' }, stationAccess: [],
    };
    const cookie = () => `fuelledger_session=${jwt.sign({ sub: user.id, jti: 'session-1' }, process.env.JWT_SECRET!)}`;

    beforeEach(() => {
      vi.mocked(prisma.userSession.findUnique).mockResolvedValue({ userId: user.id, expiresAt: new Date(Date.now() + 60_000) } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(user as never);
    });

    it('trims and saves the signed-in user’s name while returning their email', async () => {
      vi.mocked(prisma.user.update).mockResolvedValue({ ...user, name: 'New name' } as never);
      const response = await request(createApp()).patch('/api/auth/me').set('Cookie', cookie()).send({ name: ' New name ' });
      expect(response.status).toBe(200);
      expect(response.body.user).toMatchObject({ name: 'New name', email: user.email });
      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: user.id }), data: { name: 'New name' } }));
      const extra = await request(createApp()).patch('/api/auth/me').set('Cookie', cookie()).send({ name: 'New name', email: 'other@example.com' });
      expect(extra.status).toBe(400);
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('requires the current password on an established account', async () => {
      const passwordHash = await bcrypt.hash('Current123', 4);
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ passwordHash, mustChangePassword: false } as never);
      vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 });
      const app = createApp();
      const change = (currentPassword?: string) => request(app).post('/api/auth/change-password').set('Cookie', cookie()).send({ password: 'NewPassword123', currentPassword });
      expect((await change()).status).toBe(403);
      expect((await change('Wrong123')).status).toBe(403);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect((await change('Current123')).status).toBe(200);
      expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: user.id, passwordHash }) }));
    });

    it('still lets a temporary-password session complete setup', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...user, mustChangePassword: true } as never);
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ passwordHash: 'temporary-hash', mustChangePassword: true } as never);
      vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 });
      const response = await request(createApp()).post('/api/auth/change-password').set('Cookie', cookie()).send({ password: 'NewPassword123' });
      expect(response.status).toBe(200);
      expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mustChangePassword: false }) }));
    });
  });
  it('rejects unsafe requests from an untrusted browser origin', async () => { const response = await request(createApp()).post('/api/auth/login').set('Origin','https://attacker.example').send({ email: 'owner@example.com', password: 'FuelLedger123!' }); expect(response.status).toBe(403); expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED'); });
  it('answers Meta webhook verification only for the configured token', async () => {
    const accepted = await request(createApp()).get('/api/notifications/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, 'hub.challenge': 'challenge-123' });
    expect(accepted.status).toBe(200); expect(accepted.text).toBe('challenge-123');
    const rejected = await request(createApp()).get('/api/notifications/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'challenge-123' });
    expect(rejected.status).toBe(403);
  });
  it('accepts authentic Meta delivery webhooks and rejects forged ones', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '123456789', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'test-sender' }, statuses: [{ id: 'wamid.1', status: 'delivered', timestamp: '1794542400' }] } }] }] });
    const signature = `sha256=${crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET!).update(body).digest('hex')}`;
    const accepted = await request(createApp()).post('/api/notifications/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature).send(body);
    expect(accepted.status).toBe(200); expect(accepted.body).toEqual({ received: true, processed: 1 });
    expect(prisma.ownerNotificationDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'delivery-1', providerMessageId: 'wamid.1', callbackKey: null, status: 'ACCEPTED' }, data: expect.objectContaining({ status: 'DELIVERED' }) }));
    const rejected = await request(createApp()).post('/api/notifications/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=bad').send(body);
    expect(rejected.status).toBe(401);
  });
  it.each(['email-schedule', 'email-agent-messages', 'email-delivery'])('protects the %s email worker endpoint', async path => { const response = await request(createApp()).get(`/api/notifications/cron/${path}`); expect(response.status).toBe(401); });
  it('rejects unauthorised market outlook triggers', async () => { const response = await request(createApp()).post('/api/notifications/cron/market-outlook').send({}); expect(response.status).toBe(401); expect(response.body.error.code).toBe('CRON_UNAUTHORIZED'); });
  it('returns a structured 404', async () => { const response = await request(createApp()).get('/api/unknown'); expect(response.status).toBe(404); expect(response.body.error.requestId).toBeTruthy(); });
});
