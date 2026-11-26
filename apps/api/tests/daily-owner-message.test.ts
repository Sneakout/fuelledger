import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { coreDailyMessage, ownerTankName } from '../src/modules/notifications/agent-messages.js';
import { renderOwnerEmail } from '../src/modules/notifications/email-template.js';
const d=(value:number)=>new Prisma.Decimal(value);
const facts = (open=true) => ({period:{start:new Date('2026-11-24T18:30:00Z'),end:new Date('2026-11-25T18:29:59.999Z')},sales:[],collections:{actual:null,incomplete:open},
 openShifts:open?[{id:'s',shiftNumber:1,station:{name:'Mughal Petroleum'},openedAt:new Date('2026-11-24T02:30:00Z')}]:[],
 tanks:[{station:{name:'Mughal Petroleum'},product:{code:'MS',unit:'LITRE'},code:'T-1',bookStock:d(7518.263),stockIssues:[]},{station:{name:'Mughal Petroleum'},product:{code:'HSD',unit:'LITRE'},code:'T-2',bookStock:d(16668.573),stockIssues:[]}],
});
describe('actionable daily owner summaries',()=>{
 it('names each pending shift with its actual opening date and IST time',()=>{
  const message=coreDailyMessage(facts() as never,'2026-11-25','https://fuel.mindvector.tech');
  expect(message).toContain('Mughal Petroleum · Shift #1: Opened at 08:00 AM IST on 24 Nov 2026 and is still not closed.');
  expect(message).toContain('Sales: Shift sales are awaiting closing');
  expect(message).toContain('MS/Petrol · Tank 1: 7,518.26 L');
  expect(message).toContain('HSD/Diesel · Tank 2: 16,668.57 L');
  expect(message).not.toContain('T-1'); expect(message).not.toContain('16,668.573');
  const mail=renderOwnerEmail({type:'DAILY_SUMMARY',message,ownerName:'Owner',stationName:'Mughal Petroleum',date:'2026-11-25',appUrl:'https://fuel.mindvector.tech',delayed:true});
  expect(mail.html).toContain('Shifts still open'); expect(mail.text).toContain('08:00 AM IST'); expect(mail.html).toContain('email-attention');
  expect(mail.html).not.toContain('Delayed daily summary'); expect(mail.text).not.toContain('arrived later than planned');
 });
 it('removes the open-shift attention section when no older shifts remain open',()=>{
  const message=coreDailyMessage(facts(false) as never,'2026-11-25','https://fuel.mindvector.tech');
  expect(message).not.toContain('Shifts still open'); expect(message).not.toContain('still not closed');
  expect(message).toContain('No sales recorded for this date');
 });
 it.each([['T-1','Tank 1'],['T2','Tank 2'],['Tank 03','Tank 3'],['Main underground','Main underground']])('makes %s readable without inventing identifiers', (code,expected)=>{
  expect(ownerTankName(code)).toBe(expected);
 });
});
