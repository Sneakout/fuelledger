import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { escapeEmailHtml } from '../modules/notifications/email-template.js';
export const demoEmailRouter = Router();
const page = (text: string, form = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FuelNerve email preferences</title></head><body style="background:#f2f6f3;color:#173f35;font-family:Arial,Helvetica,sans-serif;padding:24px"><main style="max-width:520px;margin:40px auto;background:white;padding:32px;border-radius:20px"><h1>FuelNerve</h1><p style="line-height:1.8">${text}</p>${form}</main></body></html>`;
// GET only displays confirmation: email link scanners must not unsubscribe visitors.
demoEmailRouter.get('/unsubscribe', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const job = token.length <= 100 ? await prisma.demoFollowUpEmail.findUnique({ where: { unsubscribeToken: token } }) : null;
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer');
  if (!job) { res.status(404).type('html').send(page('This email preference link is not valid.')); return; }
  res.type('html').send(page(job.optedOutAt ? 'You have opted out of demo follow-up emails. Your owner alert preferences are unchanged.' : 'Stop FuelNerve demo follow-up emails to this address? Your owner alert preferences will not change.', job.optedOutAt ? '' : `<form method="post" action="?token=${escapeEmailHtml(token)}"><button style="border:0;border-radius:10px;background:#173f35;color:white;padding:14px;font-weight:bold">Stop demo follow-ups</button></form>`));
});
demoEmailRouter.post('/unsubscribe', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (token.length > 100) { res.sendStatus(400); return; }
  const result = await prisma.demoFollowUpEmail.updateMany({ where: { unsubscribeToken: token, optedOutAt: null }, data: { optedOutAt: new Date() } });
  const exists = result.count || await prisma.demoFollowUpEmail.count({ where: { unsubscribeToken: token } });
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').status(exists ? 200 : 404).type('html').send(page(exists ? 'You have opted out of demo follow-up emails. Your owner alert preferences are unchanged.' : 'This email preference link is not valid.'));
});
