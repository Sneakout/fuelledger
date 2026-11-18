import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OwnerWhatsAppWorkspace } from './OwnerWhatsAppWorkspace';
import type { PlatformCustomer, AdminWhatsAppDelivery, WhatsAppRolloutPolicy } from '../lib/api';
const mock = vi.hoisted(() => ({ history: vi.fn(), approve: vi.fn(), send: vi.fn(), test: vi.fn() }));
vi.mock('../lib/api', () => ({ ApiRequestError: class extends Error {}, api: { customerWhatsAppDeliveries: mock.history, approveWhatsAppPreview: mock.approve, processOwnerWhatsApp: mock.send, testCustomerWhatsApp: mock.test } }));
const owners = ['a','b'].map(id => ({ id, name: `Owner ${id}`, owner: { name: id, email: `${id}@test.local` }, notificationSettings: { whatsappOptedIn: true, whatsappNumber: '919999999999' } })) as PlatformCustomer[];
const policy: WhatsAppRolloutPolicy = { stage:'INTERNAL', paused:false, organizationIds:['a'], enabledCategories:['OWNER_WELCOME'],version:1 };
const job = { id:'job-a',type:'OWNER_WELCOME',status:'PENDING',createdAt:new Date().toISOString(),attempts:0,previewBody:'Welcome owner a',previewTemplate:'welcome',previewHash:'hash',approvedPreviewHash:null,recipientEnding:'9999' } as AdminWhatsAppDelivery;
beforeEach(() => { vi.resetAllMocks(); mock.history.mockResolvedValue({deliveries:[job]}); mock.send.mockResolvedValue({accepted:1}); });
afterEach(cleanup);
it('requires preview approval and sends only the selected owner message', async () => {
  render(<OwnerWhatsAppWorkspace customers={owners} policy={policy} onTestSetup={vi.fn()}/>);
  expect(await screen.findByText('Welcome owner a')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Send this message'})).toBeDisabled();
  mock.history.mockResolvedValue({deliveries:[{...job,approvedPreviewHash:'hash'}]});
  fireEvent.click(screen.getByRole('button',{name:'Approve this preview'}));
  await waitFor(() => expect(screen.getByRole('button',{name:'Send this message'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Send this message'}));
  await waitFor(() => expect(mock.send).toHaveBeenCalledWith('a','job-a'));
});
it('does not offer sending while the platform is paused', async () => {
  mock.history.mockResolvedValue({deliveries:[{...job,approvedPreviewHash:'hash'}]});
  render(<OwnerWhatsAppWorkspace customers={owners} policy={{...policy,paused:true}} onTestSetup={vi.fn()}/>);
  expect(await screen.findByRole('button',{name:'Send this message'})).toBeDisabled();
});
it('clears the preceding owner history while switching accounts', async () => {
  render(<OwnerWhatsAppWorkspace customers={owners} policy={policy} onTestSetup={vi.fn()}/>);
  await screen.findByText('Welcome owner a');
  mock.history.mockReturnValue(new Promise(() => {}));
  fireEvent.change(screen.getByRole('combobox',{name:'Choose owner account'}),{target:{value:'b'}});
  expect(screen.queryByText('Welcome owner a')).not.toBeInTheDocument();
});
