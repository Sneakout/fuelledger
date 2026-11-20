import type { OwnerNotificationType } from '@prisma/client';

export const emailCategories = ['OWNER_WELCOME', 'DAILY_SUMMARY', 'LOW_STOCK', 'SHIFT_CLOSED_SUMMARY', 'PURCHASE_RECEIPT_SUMMARY', 'OVERDUE_CUSTOMER'] as const;
export const emailDesign: Partial<Record<OwnerNotificationType, { title: string; eyebrow: string; introduction: string; action: string; path: string }>> = {
  OWNER_WELCOME: { title: 'Welcome to FuelNerve', eyebrow: 'YOUR FUEL STATION, CONNECTED', introduction: 'Your next chapter starts with a clear view of your fuel station.', action: 'Open FuelNerve', path: '/login' },
  DAILY_SUMMARY: { title: 'Your daily operating summary', eyebrow: 'THE DAY AT A GLANCE', introduction: 'Sales, collections and tank stock, brought together from your recorded operations.', action: 'Review daily reports', path: '/reports' },
  LOW_STOCK: { title: 'Fuel stock needs your attention', eyebrow: 'STOCK AGENT', introduction: 'A tank has reached your stock threshold. Review the latest balance before planning a delivery.', action: 'Review tank stock', path: '/inventory' },
  SHIFT_CLOSED_SUMMARY: { title: 'Your shift is reconciled', eyebrow: 'SHIFT AGENT', introduction: 'Review the completed shift: litres sold, collections, differences and closing tank stock.', action: 'View shift reconciliation', path: '/reconciliation' },
  PURCHASE_RECEIPT_SUMMARY: { title: 'A stock receipt has been recorded', eyebrow: 'PURCHASE AGENT', introduction: 'Here is what arrived, where it was received, and the recorded supplier payment position.', action: 'View purchase receipt', path: '/purchases' },
  OVERDUE_CUSTOMER: { title: 'Your customer credit report', eyebrow: 'CREDIT AGENT', introduction: 'Review outstanding customer balances and due dates before following up.', action: 'Review customer accounts', path: '/customers' },
};
export const escapeEmailHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export function renderOwnerEmail(input: { type: OwnerNotificationType; message: string; ownerName: string; stationName: string; appUrl: string; sourceId?: string | undefined; date: string }) {
  const design = emailDesign[input.type];
  if (!design) throw new Error('Unsupported owner email category');
  const origin = new URL(input.appUrl).origin;
  const path = design.path + (input.sourceId && input.type === 'SHIFT_CLOSED_SUMMARY' ? `?shiftId=${encodeURIComponent(input.sourceId)}` : '');
  let actionUrl = `${origin}${path}`;
  const reference = input.message.match(/^Review:\s*(https?:\/\/\S+)/m)?.[1];
  if (reference) {
    try { const url = new URL(reference); if (url.origin === origin && url.pathname === design.path) actionUrl = url.href; } catch { /* Keep the safe category link. */ }
  }
  const settingsUrl = `${origin}/notifications`;
  const e = escapeEmailHtml;
  const subject = `${design.title} · ${input.stationName}`.replace(/[\r\n]/g, ' ').slice(0, 180);
  // Keep the figures identical to the verified message. Do not infer or round balances in templates.
  const lines = input.message.split('\n').map(line => line.trim()).filter(line => line && !/^(Review:|Open FuelNerve:|Review ledgers:)/i.test(line));
  const sections = lines.map((line, index) => `<tr><td style="padding:${index ? '12px 0' : '0 0 16px'};border-bottom:1px solid #e3ece7;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:${index ? '#304d43' : '#173f35'};font-weight:${index ? '400' : '700'};word-break:break-word">${e(line)}</td></tr>`).join('');
  const text = `${design.title}\n${input.stationName} · ${input.date}\n\nHello ${input.ownerName},\n\n${design.introduction}\n\n${input.message}\n\n${design.action}: ${actionUrl}\n\nManage email preferences: ${settingsUrl}\nFuelNerve · Mindvector\nReply to this email for support.`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(design.title)}</title></head>
<body style="margin:0;padding:0;background:#f2f6f3;color:#173f35;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${e(design.introduction)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f6f3"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
<tr><td style="padding:28px 28px 24px;background:#123d31;border-radius:20px 20px 0 0"><span style="font-size:26px;line-height:1.3;font-weight:800;color:#d6f16b;letter-spacing:-1px">FuelNerve</span><p style="font-size:11px;letter-spacing:2px;color:#c6dacf;margin:20px 0 10px;font-weight:700">${e(design.eyebrow)}</p><h1 style="font-size:30px;line-height:1.2;letter-spacing:-.8px;color:#fff;margin:0">${e(design.title)}</h1><p style="font-size:13px;line-height:1.6;color:#c6dacf;margin:14px 0 0">${e(input.stationName)} &nbsp;·&nbsp; ${e(input.date)}</p></td></tr>
<tr><td style="background:#fff;padding:28px"><p style="font-size:16px;line-height:1.6;margin:0 0 12px">Hello ${e(input.ownerName)},</p><p style="font-size:15px;line-height:1.7;color:#60756c;margin:0 0 24px">${e(design.introduction)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${sections}</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td bgcolor="#173f35" style="border-radius:10px"><a href="${e(actionUrl)}" style="display:inline-block;padding:15px 22px;color:#fff;text-decoration:none;font-size:14px;font-weight:700;line-height:1.4">${e(design.action)} &rarr;</a></td></tr></table>
<p style="font-size:12px;line-height:1.7;color:#74847c;margin:22px 0 0">Based on recorded information. Open FuelNerve to review supporting records and the latest changes.</p></td></tr>
<tr><td style="background:#e7f1eb;padding:22px 28px;border-radius:0 0 20px 20px"><p style="font-size:13px;color:#173f35;font-weight:700;margin:0 0 8px">Clear records. Informed decisions.</p><p style="font-size:12px;line-height:1.8;color:#60756c;margin:0">You enabled owner email updates in FuelNerve.<br><a href="${e(settingsUrl)}" style="color:#1b7057;text-decoration:underline">Manage email preferences</a> &nbsp;·&nbsp; Reply here for support</p></td></tr>
<tr><td align="center" style="font-size:11px;line-height:1.7;color:#7b8c82;padding:20px">FuelNerve &nbsp;·&nbsp; Mindvector<br>Fuel station operations, with clarity.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text };
}
