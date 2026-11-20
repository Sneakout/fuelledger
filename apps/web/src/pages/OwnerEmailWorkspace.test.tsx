import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ list: vi.fn(), send: vi.fn(), preview: vi.fn(), retry: vi.fn(), welcome: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { ownerEmailDeliveries: mock.list, processOwnerEmail: mock.send, previewOwnerEmail: mock.preview, retryOwnerEmail: mock.retry, prepareOwnerEmailWelcome: mock.welcome } }));
import { OwnerEmailWorkspace } from './OwnerEmailWorkspace';
const job = { id: 'email-1', type: 'OWNER_WELCOME', status: 'PENDING', attempts: 0, destination: 'owner@example.com', createdAt: '2026-11-20T00:00:00Z' };
beforeEach(() => vi.resetAllMocks()); afterEach(cleanup);
it('does not send on open or refresh and keeps send disabled while the account is paused', async () => {
 mock.list.mockResolvedValue({ ready: false, deliveries: [job] });
 render(<OwnerEmailWorkspace organizationId="org-a" />); fireEvent.click(screen.getByRole('button', { name: 'Refresh emails' }));
 expect(await screen.findByRole('button', { name: 'Send this email' })).toBeDisabled(); expect(mock.send).not.toHaveBeenCalled();
 expect(mock.list).toHaveBeenCalledWith('org-a');
});
it('holds uncertain emails without offering resend and previews without sending', async () => {
 mock.list.mockResolvedValue({ ready: true, deliveries: [{ ...job, status: 'UNKNOWN' }] }); mock.preview.mockResolvedValue({ subject: 'Welcome preview', html: '<p>Welcome</p>', text: 'Welcome' });
 render(<OwnerEmailWorkspace organizationId="org-a" />); fireEvent.click(screen.getByRole('button', { name: 'Refresh emails' }));
 fireEvent.click(await screen.findByRole('button', { name: 'Preview email' }));
 expect(await screen.findByTitle('Owner email preview')).toHaveAttribute('sandbox', '');
 expect(screen.queryByRole('button', { name: /Send this email|Retry rejected email/ })).not.toBeInTheDocument(); expect(mock.send).not.toHaveBeenCalled();
});
