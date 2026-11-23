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
 expect(await screen.findByRole('button', { name: 'Preview email' })).toBeEnabled(); expect(screen.queryByRole('button', { name: 'Send this email' })).not.toBeInTheDocument(); expect(mock.send).not.toHaveBeenCalled();
 expect(mock.list).toHaveBeenCalledWith('org-a');
});
it('holds uncertain emails without offering resend and previews without sending', async () => {
 mock.list.mockResolvedValue({ ready: true, deliveries: [{ ...job, status: 'UNKNOWN' }] }); mock.preview.mockResolvedValue({ subject: 'Welcome preview', html: '<p>Welcome</p>', text: 'Welcome' });
 render(<OwnerEmailWorkspace organizationId="org-a" />); fireEvent.click(screen.getByRole('button', { name: 'Refresh emails' }));
 fireEvent.click(await screen.findByRole('button', { name: 'Preview email' }));
 expect(await screen.findByTitle('Owner email preview')).toHaveAttribute('sandbox', '');
 expect(screen.queryByRole('button', { name: /Send this email|Retry rejected email/ })).not.toBeInTheDocument(); expect(mock.send).not.toHaveBeenCalled();
});

it('requires preview before a welcome send and transitions to active without duplicate controls', async () => {
 const recipient = { ownerId: 'owner', ownerName: 'Owner', destination: 'owner@example.com', consent: true, state: 'SETUP', welcomeStatus: null as string | null, welcomeId: 'email-1', blocker: 'Preview and send the welcome email to start updates.' };
 let current = { ready: true, recipients: [recipient], deliveries: [] as typeof job[] };
 mock.list.mockImplementation(async () => current); mock.welcome.mockImplementation(async () => { current = { ...current, deliveries: [job] }; });
 mock.preview.mockResolvedValue({ subject: 'Welcome to FuelNerve', html: '<p>Welcome</p>', text: 'Welcome' });
 mock.send.mockImplementation(async () => { current = { ...current, recipients: [{ ...recipient, state: 'ACTIVE', welcomeStatus: 'ACCEPTED' }], deliveries: [{ ...job, status: 'ACCEPTED' }] }; return { accepted: 1 }; });
 render(<OwnerEmailWorkspace organizationId="org-a" />); fireEvent.click(screen.getByRole('button', { name: 'Refresh emails' }));
 fireEvent.click(await screen.findByRole('button', { name: 'Preview welcome' }));
 const send = await screen.findByRole('button', { name: 'Send welcome & start email updates' }); expect(mock.send).not.toHaveBeenCalled();
 fireEvent.click(send); expect(await screen.findByText('Updates active')).toBeInTheDocument();
 expect(screen.queryByRole('button', { name: 'Send welcome & start email updates' })).not.toBeInTheDocument(); expect(mock.send).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('button', { name: 'Pause email updates' })).toBeEnabled();
});

it('shows stalled automation even when the email connection is ready',async()=>{
 mock.list.mockResolvedValue({ready:true,deliveries:[],recipients:[],workerHealth:{stages:[{stage:'schedule',status:'STALE',lastSucceededAt:'2026-11-22T15:38:00Z'},{stage:'delivery',status:'FAILED',lastSucceededAt:null}]}});
 render(<OwnerEmailWorkspace organizationId="org-a"/>);fireEvent.click(screen.getByRole('button',{name:'Refresh emails'}));
 expect(await screen.findByText('Automatic emails need attention.')).toBeInTheDocument();
 expect(screen.getByText(/Daily reports · No successful check in 30 minutes/)).toBeInTheDocument();
 expect(screen.getByText(/Sending queue · Last check failed/)).toBeInTheDocument();expect(mock.send).not.toHaveBeenCalled();
});
