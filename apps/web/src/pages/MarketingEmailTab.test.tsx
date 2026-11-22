import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MarketingEmailTab } from './MarketingEmailTab';
const mocks = vi.hoisted(() => ({ marketingEmails: vi.fn() }));
vi.mock('../lib/api', () => ({ api: mocks, ApiRequestError: class extends Error {} }));
vi.mock('./DemoFollowUpPanel', () => ({ DemoFollowUpPanel: ({ email }: { email: string }) => <div role="dialog">Preview for {email}</div> }));
afterEach(cleanup);
it('opens a preview for one normalized address and lets the admin find recent introductions', async () => {
  mocks.marketingEmails.mockResolvedValue({ emails: [{ id: 'job', destination: 'prior@example.com', status: 'ACCEPTED', createdAt: '2026-11-22T10:00:00Z' }] });
  render(<MarketingEmailTab/>);
  expect(await screen.findByText('prior@example.com')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: /Potential customer/ }), { target: { value: 'New@Example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview introduction' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Preview for new@example.com');
  fireEvent.click(screen.getByRole('button', { name: 'View email' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Preview for prior@example.com');
});
