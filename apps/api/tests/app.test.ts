import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/lib/prisma.js', () => ({ prisma: { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]), user: { findUnique: vi.fn() } } }));
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters';
process.env.CORS_ORIGIN = 'http://localhost:5173';

describe('API', async () => {
  const { createApp } = await import('../src/app.js');
  beforeEach(() => vi.clearAllMocks());
  it('reports health', async () => { const response = await request(createApp()).get('/api/health'); expect(response.status).toBe(200); expect(response.body.database).toBe('connected'); });
  it('validates login input', async () => { const response = await request(createApp()).post('/api/auth/login').send({ email: 'bad', password: 'short' }); expect(response.status).toBe(400); expect(response.body.error.code).toBe('VALIDATION_ERROR'); });
  it('rejects unsafe requests from an untrusted browser origin', async () => { const response = await request(createApp()).post('/api/auth/login').set('Origin','https://attacker.example').send({ email: 'owner@example.com', password: 'FuelLedger123!' }); expect(response.status).toBe(403); expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED'); });
  it('returns a structured 404', async () => { const response = await request(createApp()).get('/api/unknown'); expect(response.status).toBe(404); expect(response.body.error.requestId).toBeTruthy(); });
});
