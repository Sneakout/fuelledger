import { createSign } from 'node:crypto';
import { connect } from 'node:http2';
import { env } from '../../config/env.js';

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');
let cachedToken: { value: string; createdAt: number } | null = null;

function providerToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now - cachedToken.createdAt < 50 * 60) return cachedToken.value;
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID }));
  const claims = base64url(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: now }));
  const input = `${header}.${claims}`;
  const signer = createSign('SHA256');
  signer.update(input);
  signer.end();
  const signature = signer.sign({ key: env.APNS_PRIVATE_KEY!.replace(/\\n/g, '\n'), dsaEncoding: 'ieee-p1363' });
  const value = `${input}.${base64url(signature)}`;
  cachedToken = { value, createdAt: now };
  return value;
}

export function sendApns(token: string, payload: { title: string; body: string; path: string; alertId?: string; type?: string; approvalId?: string | null }, deviceEnvironment?: string) {
  const useSandbox = deviceEnvironment ? deviceEnvironment === 'DEVELOPMENT' : env.APNS_ENVIRONMENT === 'development';
  const authority = useSandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  return new Promise<string | null>((resolve, reject) => {
    const client = connect(authority);
    client.once('error', reject);
    const request = client.request({
      ':method': 'POST', ':path': `/3/device/${token}`,
      authorization: `bearer ${providerToken()}`,
      'apns-topic': env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert', 'apns-priority': '10',
    });
    let responseBody = '';
    let status = 0;
    let apnsId: string | null = null;
    request.on('response', headers => { status = Number(headers[':status']); apnsId = String(headers['apns-id'] ?? '') || null; });
    request.setEncoding('utf8');
    request.on('data', chunk => { responseBody += chunk; });
    request.on('end', () => {
      client.close();
      if (status >= 200 && status < 300) resolve(apnsId);
      else reject(new Error(`APNs returned ${status}: ${responseBody || 'delivery rejected'}`));
    });
    request.on('error', error => { client.close(); reject(error); });
    request.end(JSON.stringify({ aps: { alert: { title: payload.title, body: payload.body }, sound: 'default', 'mutable-content': 1 }, evidencePath: payload.path, alertId: payload.alertId, notificationType: payload.type, ...(payload.approvalId ? { approvalId: payload.approvalId } : {}) }));
  });
}
