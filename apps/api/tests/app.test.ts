import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';

vi.mock('../src/lib/prisma.js', () => ({ prisma: { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]), user: { findUnique: vi.fn() }, ownerNotificationDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } } }));
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.CRON_SECRET = 'test-cron-secret';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-webhook-verify-token';
process.env.WHATSAPP_APP_SECRET = 'test-meta-app-secret-that-is-long-enough';

describe('API', async () => {
  const { createApp } = await import('../src/app.js');
  const { prisma } = await import('../src/lib/prisma.js');
  beforeEach(() => vi.clearAllMocks());
  it('reports health', async () => { const response = await request(createApp()).get('/api/health'); expect(response.status).toBe(200); expect(response.body.database).toBe('connected'); });
  it('validates login input', async () => { const response = await request(createApp()).post('/api/auth/login').send({ email: 'bad', password: 'short' }); expect(response.status).toBe(400); expect(response.body.error.code).toBe('VALIDATION_ERROR'); });
  it('rejects unsafe requests from an untrusted browser origin', async () => { const response = await request(createApp()).post('/api/auth/login').set('Origin','https://attacker.example').send({ email: 'owner@example.com', password: 'FuelLedger123!' }); expect(response.status).toBe(403); expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED'); });
  it('answers Meta webhook verification only for the configured token', async () => {
    const accepted = await request(createApp()).get('/api/notifications/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, 'hub.challenge': 'challenge-123' });
    expect(accepted.status).toBe(200); expect(accepted.text).toBe('challenge-123');
    const rejected = await request(createApp()).get('/api/notifications/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'challenge-123' });
    expect(rejected.status).toBe(403);
  });
  it('accepts authentic Meta delivery webhooks and rejects forged ones', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.1', status: 'delivered', timestamp: '1794542400' }] } }] }] });
    const signature = `sha256=${crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET!).update(body).digest('hex')}`;
    const accepted = await request(createApp()).post('/api/notifications/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature).send(body);
    expect(accepted.status).toBe(200); expect(accepted.body).toEqual({ received: true, processed: 1 });
    expect(prisma.ownerNotificationDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { providerMessageId: 'wamid.1', status: { in: ['PENDING', 'SENT'] } }, data: expect.objectContaining({ status: 'DELIVERED' }) }));
    const rejected = await request(createApp()).post('/api/notifications/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=bad').send(body);
    expect(rejected.status).toBe(401);
  });
  it('rejects unauthorised market outlook triggers', async () => { const response = await request(createApp()).post('/api/notifications/cron/market-outlook').send({}); expect(response.status).toBe(401); expect(response.body.error.code).toBe('CRON_UNAUTHORIZED'); });
  it('returns a structured 404', async () => { const response = await request(createApp()).get('/api/unknown'); expect(response.status).toBe(404); expect(response.body.error.requestId).toBeTruthy(); });
});
