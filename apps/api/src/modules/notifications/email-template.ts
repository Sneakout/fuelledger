import { Prisma, type OwnerNotificationType } from '@prisma/client';

export const emailCategories = ['OWNER_WELCOME', 'DAILY_SUMMARY', 'LOW_STOCK', 'SHIFT_CLOSED_SUMMARY', 'PURCHASE_RECEIPT_SUMMARY', 'OVERDUE_CUSTOMER'] as const;
export const emailDesign: Partial<Record<OwnerNotificationType, { title: string; eyebrow: string; introduction: string; action: string; path: string }>> = {
  OWNER_WELCOME: { title: 'Welcome to FuelNerve', eyebrow: 'YOUR FUEL STATION, CONNECTED', introduction: 'Welcome aboard! Your account is ready. Let’s get your fuel station set up for its first day with FuelNerve.', action: 'Open FuelNerve', path: '/login' },
  DAILY_SUMMARY: { title: 'Your daily operating summary', eyebrow: 'THE DAY AT A GLANCE', introduction: 'Here’s how your day shaped up—what you sold, what you collected and where your tank stock stands.', action: 'Review daily reports', path: '/reports' },
  LOW_STOCK: { title: 'Fuel stock needs your attention', eyebrow: 'STOCK AGENT', introduction: 'It may be time to plan your next delivery. Here’s the tank balance that needs a closer look.', action: 'Review tank stock', path: '/inventory' },
  SHIFT_CLOSED_SUMMARY: { title: 'Your shift is reconciled', eyebrow: 'SHIFT AGENT', introduction: 'Your team’s shift is complete. Here’s a clear view of sales, collections and the stock left in your tanks.', action: 'Review this shift', path: '/reconciliation' },
  PURCHASE_RECEIPT_SUMMARY: { title: 'A stock receipt has been recorded', eyebrow: 'PURCHASE AGENT', introduction: 'Your delivery is on record. Here’s what arrived, which tanks received it and where the supplier payment stands.', action: 'View this receipt', path: '/purchases' },
  OVERDUE_CUSTOMER: { title: 'Your customer credit report', eyebrow: 'CREDIT AGENT', introduction: 'Some customers still have a balance to settle. Here’s who owes you money and which payments need a follow-up.', action: 'Review customer accounts', path: '/customers' },
};
export const escapeEmailHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export type ShiftEmailDetails = {
  number: number; openedAt: Date; closedAt: Date; managerName: string | null;
  staff: Array<{ name: string; nozzles: string[] }>;
  channels: Array<{ method: string; expected: string; adjustment: string; actual: string; difference: string }>;
  difference: string; correction: boolean; previousMessage?: string | undefined;
};
const money = (value: string) => Number(value).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
const shiftTime = (value: Date) => value.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' IST';
const channelName: Record<string,string> = { CASH: 'Cash · notes and coins', UPI: 'UPI', CARD: 'Card', CREDIT: 'Customer credit · money owed', FLEET: 'Fleet credit · money owed', OTHER: 'Other collections' };
function shiftSections(shift: ShiftEmailDetails, shiftCurrentMessage: string) {
  const e = escapeEmailHtml;
  const detail = (label: string, value: string) => `<tr><td style="padding:8px 0;font-size:13px;line-height:1.6;color:#60756c;vertical-align:top;width:90px">${e(label)}</td><td style="padding:8px 0;font-size:14px;line-height:1.6;color:#173f35;font-weight:600">${e(value)}</td></tr>`;
  const team = shift.staff.map(member => `${member.name}${member.nozzles.length ? ' — ' + member.nozzles.join(', ') : ''}`);
  const rows = [detail('Opened',shiftTime(shift.openedAt)),detail('Closed',shiftTime(shift.closedAt)),detail('Manager',shift.managerName ?? 'Not recorded'),...team.map((value,i)=>detail(i===0?'Shift team':'',value))];
  if (!team.length) rows.push(detail('Shift team','No staff assignments recorded'));
  const channels = shift.channels.filter(c => [c.expected,c.adjustment,c.actual,c.difference].some(n => !new Prisma.Decimal(n).isZero()));
  const paymentRows = channels.map(c => {
    const credit = ['CREDIT','FLEET'].includes(c.method);
    return `<tr><td style="padding:12px 8px;border-bottom:1px solid #e3ece7;font-size:13px;line-height:1.6;color:#173f35">${e(channelName[c.method] ?? c.method)}${!new Prisma.Decimal(c.adjustment).isZero()?`<br><span style="font-size:11px;color:#60756c">Adjustment ${e(money(c.adjustment))}</span>`:''}</td><td align="right" style="padding:12px 8px;border-bottom:1px solid #e3ece7;font-size:14px;line-height:1.6;color:#173f35;font-weight:700">${e(money(credit?c.expected:c.actual))}</td></tr>`;
  }).join('');
  let changes = '';
  let changesText = '';
  if (shift.correction) {
    const oldLines = new Map((shift.previousMessage ?? '').split('\n').filter(l=>l.includes(':')).map(l=>[l.split(':')[0]!,l]));
    const currentFields = ['Sales','Expected collection','Actual collection','Shortage','Excess'];
    changes = `<p style="padding:14px;background:#fff6e5;color:#825412;font-size:13px;line-height:1.7;border-radius:12px"><strong>Updated summary</strong><br>This replaces the earlier email for this shift. Review the current figures below.</p>`;
    // Before/after values are copied verbatim from the two verified messages.
    // A missing prior snapshot never becomes an invented previous amount.
    const current = shiftCurrentMessage.split('\n');
    const changed = current.filter(line=>currentFields.some(label=>line.startsWith(label+':')) && oldLines.has(line.split(':')[0]!) && oldLines.get(line.split(':')[0]!)!==line);
    changesText = changed.map(line => `Previously: ${oldLines.get(line.split(':')[0]!)}\nNow: ${line}`).join('\n') + (changed.length ? '\n\n' : '');
    if(changed.length) changes += `<table role="presentation" width="100%" style="margin-bottom:16px">${changed.map(line=>`<tr><td style="padding:10px;background:#fff6e5;color:#825412;font-size:13px;line-height:1.7">Previously: ${e(oldLines.get(line.split(':')[0]!)!)}<br>Now: ${e(line)}</td></tr>`).join('')}</table>`;
  }
  return {html:`${changes}<h2 style="font-size:17px;margin:0 0 8px;color:#173f35">Shift #${shift.number} · your team and timings</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">${rows.join('')}</table>${channels.length?`<h2 style="font-size:17px;margin:0 0 8px;color:#173f35">How payments were recorded</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;background:#f4f8f5;border-radius:12px">${paymentRows}</table><p style="font-size:12px;line-height:1.7;color:#60756c;margin:0 0 24px">Cash, UPI, card and other collections are shown separately. Customer and fleet credit are amounts owed, not money collected.</p>`:''}`,
  text:`${shift.correction?'Updated summary — this replaces the earlier email for this shift.\n\n':''}${changesText}Shift #${shift.number}\nOpened: ${shiftTime(shift.openedAt)}\nClosed: ${shiftTime(shift.closedAt)}\nManager: ${shift.managerName ?? 'Not recorded'}\nShift team: ${team.join('; ') || 'No staff assignments recorded'}\n\nHow payments were recorded\n${channels.map(c=>`${channelName[c.method]??c.method}: ${money(['CREDIT','FLEET'].includes(c.method)?c.expected:c.actual)}${new Prisma.Decimal(c.adjustment).isZero()?'':` (adjustment ${money(c.adjustment)})`}`).join('\n')}\nCustomer and fleet credit are money owed, not collected.\n\n`};
}
export function renderOwnerEmail(input: { type: OwnerNotificationType; message: string; ownerName: string; stationName: string; appUrl: string; sourceId?: string | undefined; date: string; shift?: ShiftEmailDetails; delayed?: boolean }) {
  const base = emailDesign[input.type];
  const shift = input.type === 'SHIFT_CLOSED_SUMMARY' ? input.shift : undefined;
  const balance = shift ? new Prisma.Decimal(shift.difference) : null;
  const outcome = shift && balance ? balance.isZero() ? `Shift #${shift.number} is complete. Collections match.` : `Shift #${shift.number}: ${money(balance.abs().toString())} ${balance.lt(0) ? 'shortage to review' : 'excess to review'}.` : null;
  const design = base ? { ...base, ...(outcome ? { title: shift?.correction ? `Updated: shift #${shift.number}` : outcome } : {}), ...(shift?.correction ? { introduction: 'The recorded details for this shift have changed. Here’s the updated summary—please use this version when reviewing the shift.' } : {}) } : undefined;
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
  const delayed = input.type === 'DAILY_SUMMARY' && input.delayed;
  const recoveryNote = delayed ? 'This summary arrived later than planned. It covers the business date shown above, with tank stock calculated to the end of that day. Open FuelNerve for the latest records.' : '';
  const subject = `${delayed ? `Delayed summary · ${input.date}` : design.title} · ${input.stationName}`.replace(/[\r\n]/g, ' ').slice(0, 180);
  // Keep the figures identical to the verified message. Do not infer or round balances in templates.
  const lines = input.message.split('\n').map(line => line.trim()).filter(line => line && !/^(Review:|Open FuelNerve:|Review ledgers:)/i.test(line));
  const shiftContent = shift ? shiftSections(shift, input.message) : { html: '', text: '' };
  const sectionTitles = /^(Tank book stock|Closing tank stock):$/i;
  const sections = lines.map((line, index) => {
    if (shift && index === 0 && /^FuelNerve Shift Agent/.test(line)) return '';
    if (sectionTitles.test(line)) return `<tr><td style="padding:22px 0 8px;font-size:11px;line-height:1.5;letter-spacing:1.3px;text-transform:uppercase;font-weight:700;color:#60756c">${e(line.slice(0, -1))}</td></tr>`;
    // Display the original verified values verbatim. Labels only control hierarchy;
    // templates never parse amounts, calculate totals, or invent missing figures.
    if (/^₹/.test(line)) return `<tr><td style="padding:16px;background:#e7f1eb;border-radius:12px;font-size:20px;line-height:1.5;font-weight:700;color:#173f35;word-break:break-word">${e(line)}</td></tr>`;
    const field = line.match(/^([^:]{1,100}):\s*(.+)$/);
    const attention = /^(Shortage|Excess|Partial receipt|Outstanding|Payment outstanding):/.test(line);
    const background = attention ? '#fff6e5' : '#f4f8f5';
    const color = attention ? '#825412' : '#173f35';
    if (field) return `<tr><td style="padding:6px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="${attention ? 'email-attention' : ''}" style="background:${background};border:1px solid ${attention ? '#f0dab1' : '#e3ece7'};border-radius:12px"><tr><td style="padding:14px 16px"><p style="margin:0 0 5px;font-size:12px;line-height:1.5;font-weight:700;color:#60756c">${e(field[1]!)}</p><p style="margin:0;font-size:18px;line-height:1.5;font-weight:700;color:${color};word-break:break-word">${e(field[2]!)}</p></td></tr></table></td></tr>`;
    return `<tr><td style="padding:${index ? '10px 0' : '0 0 14px'};font-size:${index ? '14px' : '13px'};line-height:1.7;color:${index ? '#304d43' : '#60756c'};font-weight:${index ? '400' : '700'};word-break:break-word">${e(line)}</td></tr>`;
  }).join('');
  const guidance = {
    OWNER_WELCOME: 'Start with your fuel station setup, then review your products and team before opening the first shift.',
    DAILY_SUMMARY: 'Want to look closer? Open your daily reports to compare sales and collections. Customer credit is money owed, while book stock is calculated stock rather than a fresh tank measurement.',
    LOW_STOCK: 'Check your tank stock and planned deliveries, then decide when to order your next load.',
    SHIFT_CLOSED_SUMMARY: 'Need to check a figure? Open this shift to see the payment split, team handovers and tank readings. Customer dues and staff handovers remain separate from verified collections.',
    PURCHASE_RECEIPT_SUMMARY: 'Does everything match the delivery? Open the receipt to check quantities, tank assignments and the supplier’s payment details.',
    OVERDUE_CUSTOMER: 'Ready to follow up? Open the customer accounts to check recent payments and prepare reminders. A payment made after this report may have changed the balance; no reminder is sent just because you receive this email.',
  }[input.type as typeof emailCategories[number]];
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? new Date(`${input.date}T00:00:00Z`) : null;
  const dateLabel = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : input.date;
  const text = `${design.title}\n${input.stationName} · ${dateLabel}\n\nHello ${input.ownerName},\n\n${design.introduction}\n\n${recoveryNote ? recoveryNote + '\n\n' : ''}${shiftContent.text}${input.message}\n\n${design.action}: ${actionUrl}\n\n${guidance}\n\nManage email preferences: ${settingsUrl}\nFuelNerve · Mindvector\nReply to this email for support.`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>@media (prefers-color-scheme:dark){body,.email-bg{background:#102b24!important}.email-body{background:#183c32!important;color:#eff8f2!important}.email-body p,.email-body h2,.email-body td{color:#eff8f2!important}.email-body table{background:#21483c!important}.email-body .email-cta,.email-body .email-cta td{background:#d6f16b!important}.email-body .email-cta a{color:#123d31!important}.email-body .email-attention,.email-body .email-attention td{background:#513f20!important}.email-body .email-attention p{color:#ffe4ad!important}.email-header{background:#123d31!important}.email-header h1{color:#fff!important}}@media only screen and (max-width:480px){.email-padding{padding-left:20px!important;padding-right:20px!important}.email-title{font-size:26px!important}.email-outer{padding:16px 8px!important}}</style><title>${e(design.title)}</title></head>
<body style="margin:0;padding:0;background:#f2f6f3;color:#173f35;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${e(design.introduction)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-bg" style="background:#f2f6f3"><tr><td align="center" class="email-outer" style="padding:32px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
<tr><td class="email-padding email-header" bgcolor="#123d31" style="border-top:4px solid #d6f16b;padding:28px 28px 24px;background:#123d31;border-radius:20px 20px 0 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="48" style="padding-right:12px"><img src="${e(origin)}/brand/fuelnerve-mark.png" width="44" height="44" alt="" style="display:block;border:0;border-radius:11px"></td><td style="font-size:26px;line-height:1.3;font-weight:800;color:#d6f16b;letter-spacing:-1px">FuelNerve</td></tr></table><p style="font-size:11px;letter-spacing:2px;color:#c6dacf;margin:20px 0 10px;font-weight:700">${e(design.eyebrow)}</p><h1 class="email-title" style="font-size:30px;line-height:1.2;letter-spacing:-.8px;color:#fff;margin:0">${e(design.title)}</h1><p style="font-size:13px;line-height:1.6;color:#c6dacf;margin:14px 0 0">${e(input.stationName)} &nbsp;·&nbsp; ${e(dateLabel)}<br><span style="font-size:11px;color:#b2cec1">India business date · ${input.type === 'OWNER_WELCOME' ? 'Account ready' : 'Recorded operations'}</span></p></td></tr>
<tr><td class="email-padding email-body" bgcolor="#ffffff" style="background:#fff;padding:28px"><p style="font-size:16px;line-height:1.6;margin:0 0 12px">Hello ${e(input.ownerName)},</p><p style="font-size:15px;line-height:1.7;color:#60756c;margin:0 0 24px">${e(design.introduction)}</p>
${delayed ? `<p class="email-attention" style="padding:14px 16px;background:#fff6e5;color:#825412;font-size:13px;line-height:1.7;border-radius:12px"><strong>Delayed daily summary</strong><br>${e(recoveryNote)}</p>` : ''}${shiftContent.html}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${sections}</table>
<table role="presentation" cellpadding="0" cellspacing="0" class="email-cta" style="margin-top:28px"><tr><td bgcolor="#173f35" style="border-radius:10px"><a href="${e(actionUrl)}" style="display:inline-block;padding:15px 22px;color:#fff;text-decoration:none;font-size:14px;font-weight:700;line-height:1.4">${e(design.action)} &rarr;</a></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #e3ece7"><tr><td style="padding-top:18px"><p style="font-size:11px;letter-spacing:1px;color:#60756c;font-weight:700;margin:0 0 7px">${input.type === 'OWNER_WELCOME' ? 'YOUR FIRST STEP' : 'WHAT TO REVIEW'}</p><p style="font-size:13px;line-height:1.7;color:#60756c;margin:0">${e(guidance)}</p><p style="font-size:11px;line-height:1.7;color:#74847c;margin:12px 0 0">This is a snapshot of recorded information. Open FuelNerve for the latest records.</p></td></tr></table></td></tr>
<tr><td class="email-padding" style="background:#e7f1eb;padding:22px 28px;border-radius:0 0 20px 20px"><p style="font-size:13px;color:#173f35;font-weight:700;margin:0 0 8px">Clear records. Informed decisions.</p><p style="font-size:12px;line-height:1.8;color:#60756c;margin:0">You enabled owner email updates in FuelNerve.<br><a href="${e(settingsUrl)}" style="color:#1b7057;text-decoration:underline">Manage email preferences</a> &nbsp;·&nbsp; Reply here for support</p></td></tr>
<tr><td align="center" style="font-size:11px;line-height:1.7;color:#7b8c82;padding:20px">FuelNerve &nbsp;·&nbsp; Mindvector<br>Fuel station operations, with clarity.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text };
}
