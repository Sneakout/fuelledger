import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DemoFollowUpAction, DemoFollowUpPanel } from './DemoFollowUpPanel';
const mocks = vi.hoisted(() => ({ previewDemoFollowUp: vi.fn(), sendDemoFollowUp: vi.fn(), previewMarketingEmail: vi.fn(), sendMarketingEmail: vi.fn() }));
vi.mock('../lib/api', () => ({ ApiRequestError: class extends Error {}, api: mocks }));
const lead = { id: 'lead-a', contact: 'prospect@example.com', kind: 'EMAIL', createdAt: '2026-11-21', expiresAt: '2026-11-23' };
const preview = { id: 'mail-a', destination: lead.contact, status: 'PENDING', attempts: 0, acceptedAt: null, createdAt: lead.createdAt, errorMessage: null, ready: true, previewHash: 'a'.repeat(64), subject: 'Discover FuelNerve', html: '<p>FuelNerve benefits</p>', text: 'FuelNerve benefits' };
beforeEach(() => { vi.clearAllMocks(); HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; mocks.previewDemoFollowUp.mockResolvedValue(preview); });
afterEach(cleanup);
it('requires review and permission, sends once, and displays honest provider acceptance', async () => {
  const updated = vi.fn(); mocks.sendDemoFollowUp.mockResolvedValue({ ...preview, status: 'ACCEPTED', attempts: 1 });
  render(<DemoFollowUpPanel lead={lead} onClose={vi.fn()} onUpdated={updated}/>);
  expect(await screen.findByText(preview.subject)).toBeInTheDocument();
  const send = screen.getByRole('button', { name: 'Send follow-up email' }); expect(send).toBeDisabled();
  expect(screen.getByTitle('FuelNerve demo follow-up email')).toHaveAttribute('sandbox', '');
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(send);
  await screen.findByText('Follow-up accepted by the email service'); expect(send).toBeDisabled();
  expect(mocks.sendDemoFollowUp).toHaveBeenCalledWith('lead-a', { id: 'mail-a', previewHash: preview.previewHash, permissionConfirmed: true });
  expect(updated).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACCEPTED' }));
});
it.each(['ACCEPTED', 'UNKNOWN', 'PROCESSING', 'OPTED_OUT'])('does not allow sends when status is %s', async status => {
  mocks.previewDemoFollowUp.mockResolvedValue({ ...preview, status });
  render(<DemoFollowUpPanel lead={lead} onClose={vi.fn()} onUpdated={vi.fn()}/>);
  await screen.findByText(preview.subject); expect(screen.getByRole('button', { name: 'Send follow-up email' })).toBeDisabled(); expect(screen.queryByRole('checkbox')).toBeNull();
});
it('refreshes status without sending and preserves errors in the preview', async () => {
  render(<DemoFollowUpPanel lead={lead} onClose={vi.fn()} onUpdated={vi.fn()}/>);
  await screen.findByText(preview.subject); fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await waitFor(() => expect(mocks.previewDemoFollowUp).toHaveBeenCalledTimes(2)); expect(mocks.sendDemoFollowUp).not.toHaveBeenCalled();
});
it('shows prior follow-up status directly on an enquiry', () => {
  render(<DemoFollowUpAction lead={{ ...lead, followUp: { ...preview, status: 'ACCEPTED' } }} onOpen={vi.fn()}/>);
  expect(screen.getByText('Accepted by email service')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'View follow-up' })).toBeInTheDocument();
});

it('uses the manual recipient flow and requires permission before sending an introduction', async () => {
  mocks.previewMarketingEmail.mockResolvedValue(preview);
  mocks.sendMarketingEmail.mockResolvedValue({ ...preview, status: 'ACCEPTED', attempts: 1 });
  render(<DemoFollowUpPanel email="prospect@example.com" onClose={vi.fn()} onUpdated={vi.fn()}/>);
  await screen.findByText(preview.subject);
  expect(mocks.previewDemoFollowUp).not.toHaveBeenCalled();
  expect(mocks.sendMarketingEmail).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Send follow-up email' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Send follow-up email' }));
  await screen.findByText('Follow-up accepted by the email service');
  expect(mocks.sendMarketingEmail).toHaveBeenCalledWith('prospect@example.com', { id: preview.id, previewHash: preview.previewHash, permissionConfirmed: true });
});
