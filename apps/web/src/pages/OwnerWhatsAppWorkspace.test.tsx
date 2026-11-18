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
  render(<OwnerWhatsAppWorkspace customers={owners} policy={policy} onRefresh={vi.fn().mockResolvedValue(undefined)} onTestSetup={vi.fn()}/>);
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
  render(<OwnerWhatsAppWorkspace customers={owners} policy={{...policy,paused:true}} onRefresh={vi.fn().mockResolvedValue(undefined)} onTestSetup={vi.fn()}/>);
  expect(await screen.findByRole('button',{name:'Send this message'})).toBeDisabled();
});
it('clears the preceding owner history while switching accounts', async () => {
  render(<OwnerWhatsAppWorkspace customers={owners} policy={policy} onRefresh={vi.fn().mockResolvedValue(undefined)} onTestSetup={vi.fn()}/>);
  await screen.findByText('Welcome owner a');
  mock.history.mockReturnValue(new Promise(() => {}));
  fireEvent.change(screen.getByRole('combobox',{name:'Choose owner account'}),{target:{value:'b'}});
  expect(screen.queryByText('Welcome owner a')).not.toBeInTheDocument();
});

it('refreshes consent, destination and rollout settings alongside delivery history', async () => {
  const onRefresh = vi.fn();
  const view = render(<OwnerWhatsAppWorkspace customers={owners} policy={policy} onRefresh={onRefresh} onTestSetup={vi.fn()}/>);
  await screen.findByText('Welcome owner a');
  const changedOwners = owners.map(owner => owner.id === 'a' ? {...owner, notificationSettings:{...owner.notificationSettings,whatsappOptedIn:false,whatsappNumber:'918888888888'}} : owner);
  onRefresh.mockImplementation(async () => {
    view.rerender(<OwnerWhatsAppWorkspace customers={changedOwners} policy={{...policy,paused:true}} onRefresh={onRefresh} onTestSetup={vi.fn()}/>);
  });
  fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));
  await screen.findByText('Owner consent, WhatsApp number, delivery settings and message status refreshed.');
  expect(onRefresh).toHaveBeenCalledOnce();
  expect(screen.getByText('+918888888888')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Set up & test WhatsApp'));
  expect(screen.getByRole('button',{name:'Welcome preview'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Send this message'})).toBeDisabled();
  expect(screen.getByRole('heading',{name:'Sending paused'})).toBeInTheDocument();
});
it('does not report refresh success when owner settings fail to load', async () => {
  render(<OwnerWhatsAppWorkspace customers={owners} policy={policy} onRefresh={vi.fn().mockRejectedValue(new Error('offline'))} onTestSetup={vi.fn()}/>);
  await screen.findByText('Welcome owner a');
  fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));
  await screen.findByRole('alert');
  expect(screen.queryByText('Owner consent, WhatsApp number, delivery settings and message status refreshed.')).not.toBeInTheDocument();
});
it('enables preparation after renewed consent without reviving a suppressed message', async () => {
  mock.history.mockResolvedValue({deliveries:[{...job,status:'SUPPRESSED',suppressionReason:'owner_not_opted_in'}]});
  const onRefresh = vi.fn();
  const revoked = owners.map(owner => ({...owner,notificationSettings:{...owner.notificationSettings,whatsappOptedIn:false}}));
  const view = render(<OwnerWhatsAppWorkspace customers={revoked} policy={policy} onRefresh={onRefresh} onTestSetup={vi.fn()}/>);
  await screen.findByText('Welcome owner a');
  fireEvent.click(screen.getByText('Set up & test WhatsApp'));
  expect(screen.getByRole('button',{name:'Welcome preview'})).toBeDisabled();
  onRefresh.mockImplementation(async () => { view.rerender(<OwnerWhatsAppWorkspace customers={owners} policy={policy} onRefresh={onRefresh} onTestSetup={vi.fn()}/>); });
  fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));
  await waitFor(() => expect(screen.getByRole('button',{name:'Welcome preview'})).toBeEnabled());
  expect(screen.queryByRole('button',{name:'Send this message'})).not.toBeInTheDocument();
  expect(screen.getByText(/This message was stopped using the settings at that time/)).toBeInTheDocument();
  expect(mock.send).not.toHaveBeenCalled();
});
it('prepares a selected operational preview and enables only its owner category', async () => {
  mock.test.mockResolvedValue({delivery:{status:'QUEUED'}});
  const setup=vi.fn().mockResolvedValue(undefined);
  render(<OwnerWhatsAppWorkspace customers={owners} policy={policy} onRefresh={vi.fn().mockResolvedValue(undefined)} onTestSetup={setup}/>);
  await screen.findByText('Welcome owner a');
  fireEvent.click(screen.getByText('Set up & test WhatsApp'));
  fireEvent.change(screen.getByRole('combobox',{name:'Message to preview'}),{target:{value:'PURCHASE_RECEIPT_SUMMARY'}});
  fireEvent.click(screen.getByRole('button',{name:'Prepare operational preview'}));
  await waitFor(()=>expect(mock.test).toHaveBeenCalledWith('a',false,'PURCHASE_RECEIPT_SUMMARY'));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Enable selected message for this owner only'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Enable selected message for this owner only'}));
  await waitFor(()=>expect(setup).toHaveBeenCalledWith('a','PURCHASE_RECEIPT_SUMMARY'));
});
