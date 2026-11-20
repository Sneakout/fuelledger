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
  const sectionTitles = /^(Tank book stock|Closing tank stock):$/i;
  const sections = lines.map((line, index) => {
    if (sectionTitles.test(line)) return `<tr><td style="padding:22px 0 8px;font-size:11px;line-height:1.5;letter-spacing:1.3px;text-transform:uppercase;font-weight:700;color:#60756c">${e(line.slice(0, -1))}</td></tr>`;
    // Display the original verified values verbatim. Labels only control hierarchy;
    // templates never parse amounts, calculate totals, or invent missing figures.
    if (/^₹/.test(line)) return `<tr><td style="padding:16px;background:#e7f1eb;border-radius:12px;font-size:20px;line-height:1.5;font-weight:700;color:#173f35;word-break:break-word">${e(line)}</td></tr>`;
    const field = line.match(/^([^:]{1,100}):\s*(.+)$/);
    const attention = /^(Shortage|Excess|Partial receipt|Outstanding|Payment outstanding):/.test(line);
    const background = attention ? '#fff6e5' : '#f4f8f5';
    const color = attention ? '#825412' : '#173f35';
    if (field) return `<tr><td style="padding:6px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${background};border:1px solid ${attention ? '#f0dab1' : '#e3ece7'};border-radius:12px"><tr><td style="padding:14px 16px"><p style="margin:0 0 5px;font-size:12px;line-height:1.5;font-weight:700;color:#60756c">${e(field[1]!)}</p><p style="margin:0;font-size:18px;line-height:1.5;font-weight:700;color:${color};word-break:break-word">${e(field[2]!)}</p></td></tr></table></td></tr>`;
    return `<tr><td style="padding:${index ? '10px 0' : '0 0 14px'};font-size:${index ? '14px' : '13px'};line-height:1.7;color:${index ? '#304d43' : '#60756c'};font-weight:${index ? '400' : '700'};word-break:break-word">${e(line)}</td></tr>`;
  }).join('');
  const guidance = {
    OWNER_WELCOME: 'Start with your fuel station setup, then review your products and team before opening the first shift.',
    DAILY_SUMMARY: 'Compare sales with reconciled collections. Customer credit is a receivable, not money collected. Book stock is the system balance, not a new physical dip.',
    LOW_STOCK: 'Review the current tank balance and any pending deliveries before arranging replenishment. A low-stock alert does not create a purchase.',
    SHIFT_CLOSED_SUMMARY: 'Check any shortage or excess, then review measured closing stock against book stock. Customer dues and staff handovers remain separate from verified collections.',
    PURCHASE_RECEIPT_SUMMARY: 'Check the delivered quantities and tank assignments against the receipt. The invoice amount and payment position are shown separately.',
    OVERDUE_CUSTOMER: 'Review each customer ledger before following up. Payments posted after this report can change the outstanding balance; this email does not send reminders to customers.',
  }[input.type as typeof emailCategories[number]];
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? new Date(`${input.date}T00:00:00Z`) : null;
  const dateLabel = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : input.date;
  const text = `${design.title}\n${input.stationName} · ${dateLabel}\n\nHello ${input.ownerName},\n\n${design.introduction}\n\n${input.message}\n\n${design.action}: ${actionUrl}\n\n${guidance}\n\nManage email preferences: ${settingsUrl}\nFuelNerve · Mindvector\nReply to this email for support.`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media only screen and (max-width:480px){.email-padding{padding-left:20px!important;padding-right:20px!important}.email-title{font-size:26px!important}.email-outer{padding:16px 8px!important}}</style><title>${e(design.title)}</title></head>
<body style="margin:0;padding:0;background:#f2f6f3;color:#173f35;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${e(design.introduction)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f6f3"><tr><td align="center" class="email-outer" style="padding:32px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
<tr><td class="email-padding" style="border-top:4px solid #d6f16b;padding:28px 28px 24px;background:#123d31;border-radius:20px 20px 0 0"><span style="font-size:26px;line-height:1.3;font-weight:800;color:#d6f16b;letter-spacing:-1px">FuelNerve</span><p style="font-size:11px;letter-spacing:2px;color:#c6dacf;margin:20px 0 10px;font-weight:700">${e(design.eyebrow)}</p><h1 class="email-title" style="font-size:30px;line-height:1.2;letter-spacing:-.8px;color:#fff;margin:0">${e(design.title)}</h1><p style="font-size:13px;line-height:1.6;color:#c6dacf;margin:14px 0 0">${e(input.stationName)} &nbsp;·&nbsp; ${e(dateLabel)}<br><span style="font-size:11px;color:#b2cec1">India business date · ${input.type === 'OWNER_WELCOME' ? 'Account ready' : 'Recorded operations'}</span></p></td></tr>
<tr><td class="email-padding" style="background:#fff;padding:28px"><p style="font-size:16px;line-height:1.6;margin:0 0 12px">Hello ${e(input.ownerName)},</p><p style="font-size:15px;line-height:1.7;color:#60756c;margin:0 0 24px">${e(design.introduction)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${sections}</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td bgcolor="#173f35" style="border-radius:10px"><a href="${e(actionUrl)}" style="display:inline-block;padding:15px 22px;color:#fff;text-decoration:none;font-size:14px;font-weight:700;line-height:1.4">${e(design.action)} &rarr;</a></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #e3ece7"><tr><td style="padding-top:18px"><p style="font-size:11px;letter-spacing:1px;color:#60756c;font-weight:700;margin:0 0 7px">${input.type === 'OWNER_WELCOME' ? 'YOUR FIRST STEP' : 'WHAT TO REVIEW'}</p><p style="font-size:13px;line-height:1.7;color:#60756c;margin:0">${e(guidance)}</p><p style="font-size:11px;line-height:1.7;color:#74847c;margin:12px 0 0">This is a snapshot of recorded information. Open FuelNerve for the latest records.</p></td></tr></table></td></tr>
<tr><td class="email-padding" style="background:#e7f1eb;padding:22px 28px;border-radius:0 0 20px 20px"><p style="font-size:13px;color:#173f35;font-weight:700;margin:0 0 8px">Clear records. Informed decisions.</p><p style="font-size:12px;line-height:1.8;color:#60756c;margin:0">You enabled owner email updates in FuelNerve.<br><a href="${e(settingsUrl)}" style="color:#1b7057;text-decoration:underline">Manage email preferences</a> &nbsp;·&nbsp; Reply here for support</p></td></tr>
<tr><td align="center" style="font-size:11px;line-height:1.7;color:#7b8c82;padding:20px">FuelNerve &nbsp;·&nbsp; Mindvector<br>Fuel station operations, with clarity.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text };
}
