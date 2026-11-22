import { expect, it } from 'vitest';
import { renderDemoFollowUp } from '../src/modules/notifications/demo-follow-up-template.js';
it('presents real product benefits in image-independent branded HTML and plain text', () => {
  const email = renderDemoFollowUp({ appUrl: 'https://fuel.mindvector.tech', unsubscribeUrl: 'https://fuel.mindvector.tech/api/demo-email/unsubscribe?token=abc&x="' });
  for (const value of ['Follow every litre', 'Close shifts with clarity', 'Keep money in view', 'Grow beyond fuel', 'Decisions stay with you.', 'Bring your past DSR forward']) { expect(email.html).toContain(value); expect(email.text).toContain(value); }
  expect(email.html).toContain('#d6f16b'); expect(email.html).toContain('#123d31'); expect(email.html).toContain('role="presentation"'); expect(email.html).toContain('@media'); expect(email.html).not.toContain('<script'); expect(email.html).toContain('/brand/fuelnerve-mark.png'); expect(email.html).toContain('&amp;x=&quot;'); expect(email.text).toContain('Stop FuelNerve marketing emails:'); expect(email.subject).not.toMatch(/[\r\n]/);
});

it('introduces FuelNerve without falsely claiming the prospect used a demo', () => {
  const email = renderDemoFollowUp({ appUrl: 'https://fuel.mindvector.tech', unsubscribeUrl: 'https://fuel.mindvector.tech/unsubscribe', prospect: true });
  expect(email.subject).toBe('FuelNerve | Fuel Business Software with AI Agents');
  for (const body of [email.html, email.text]) {
    expect(body).toContain('AI agents');
    expect(body).not.toContain('Thank you for exploring');
    expect(body).not.toContain('after exploring');
    expect(body).toContain('Stop FuelNerve marketing emails');
  }
});
