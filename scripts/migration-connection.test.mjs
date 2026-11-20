import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationConnection } from './migration-connection.mjs';

test('explicit direct connection takes precedence', () => {
  assert.deepEqual(migrationConnection({ DIRECT_URL: 'postgres://direct/db', DATABASE_URL: 'postgres://pooled/db' }), { url: 'postgres://direct/db', source: 'DIRECT_URL' });
});
test('Neon migration connection preserves credentials, database and TLS settings', () => {
  const environment = { DATABASE_URL: 'postgresql://owner:p%40ss@ep-example-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require&pgbouncer=true' };
  const result = migrationConnection(environment);
  const url = new URL(result.url);
  assert.equal(url.hostname, 'ep-example.c-4.ap-southeast-1.aws.neon.tech');
  assert.equal(url.username, 'owner');
  assert.equal(url.password, 'p%40ss');
  assert.equal(url.pathname, '/neondb');
  assert.equal(url.searchParams.get('sslmode'), 'require');
  assert.equal(url.searchParams.get('channel_binding'), 'require');
  assert.equal(url.searchParams.has('pgbouncer'), false);
  assert.match(environment.DATABASE_URL, /ep-example-pooler/);
});
test('other providers, direct Neon URLs and lookalike domains remain unchanged', () => {
  for (const url of ['postgres://owner:pass@db-pooler.example.com/db', 'postgres://owner:pass@ep-example.neon.tech/db', 'postgres://owner:pass@ep-example-pooler.neon.tech.example.com/db', 'invalid']) {
    assert.equal(migrationConnection({ DATABASE_URL: url }).url, url);
  }
});
