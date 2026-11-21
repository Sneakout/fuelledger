import { expect, it } from 'vitest';
import { renderDemoFollowUp } from '../src/modules/notifications/demo-follow-up-template.js';
it('presents real product benefits in image-independent branded HTML and plain text', () => {
  const email = renderDemoFollowUp({ appUrl: 'https://fuel.mindvector.tech', unsubscribeUrl: 'https://fuel.mindvector.tech/api/demo-email/unsubscribe?token=abc&x="' });
  for (const value of ['Follow every litre', 'Close shifts with clarity', 'Keep money in view', 'Grow beyond fuel', 'Decisions stay with you.', 'Bring your past DSR forward']) { expect(email.html).toContain(value); expect(email.text).toContain(value); }
  expect(email.html).toContain('#d6f16b'); expect(email.html).toContain('#123d31'); expect(email.html).toContain('role="presentation"'); expect(email.html).toContain('@media'); expect(email.html).not.toContain('<script'); expect(email.html).toContain('/brand/fuelnerve-mark.png'); expect(email.html).toContain('&amp;x=&quot;'); expect(email.text).toContain('Stop demo follow-up emails:'); expect(email.subject).not.toMatch(/[\r\n]/);
});
