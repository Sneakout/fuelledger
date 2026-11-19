import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WhatsAppInbox } from './WhatsAppInbox';

const mock = vi.hoisted(() => ({ owners: vi.fn(), messages: vi.fn() }));
vi.mock('../lib/api', () => ({ ApiRequestError: class extends Error {}, api: { adminWhatsAppOwners: mock.owners, adminWhatsAppMessages: mock.messages } }));
vi.mock('./OwnerWhatsAppWorkspace', () => ({
  whatsappHoldReasons: { delivery_paused: 'All sending is paused.', category_paused: 'This message category is paused.' },
  whatsappMessageNames: { OWNER_WELCOME: 'Owner welcome' },
  OwnerWhatsAppWorkspace: ({ messageId, onHistory }: { messageId?: string; onHistory(): void }) =>
    <div><p>Selected message: {messageId}</p><button onClick={onHistory}>View full history</button></div>,
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const owner = { id: 'owner-a', name: 'Greenway Fuel', owner: null, notificationSettings: { whatsappNumber: null, whatsappOptedIn: false }, failedCount: 1, lastDeliveredAt: null };
const message = { id: 'older-message', organizationId: owner.id, organization: { name: owner.name }, type: 'OWNER_WELCOME', status: 'PENDING', needsApproval: false, rolloutHold: 'delivery_paused', createdAt: '2026-11-18T08:00:00Z' };
const open = () => render(<WhatsAppInbox policy={{ stage: 'SHADOW', paused: true, enabledCategories: [], organizationIds: [], version: 0 }} onRefresh={vi.fn()} onTestSetup={vi.fn()}/>);

it('searches and pages owners from the server before opening their workspace', async () => {
  mock.owners.mockResolvedValue({ owners: [owner], nextCursor: 'next-owner' });
  open();
  await screen.findByRole('button', { name: 'Open Greenway Fuel' });
  expect(mock.messages).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find an owner' }), { target: { value: 'Greenway' } });
  await waitFor(() => expect(mock.owners).toHaveBeenLastCalledWith({ search: 'Greenway' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  await waitFor(() => expect(mock.owners).toHaveBeenLastCalledWith({ search: 'Greenway', cursor: 'next-owner' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open Greenway Fuel' }));
  await screen.findByRole('heading', { name: 'Greenway Fuel' });
  fireEvent.click(screen.getByRole('button', { name: 'Back to owners' }));
  expect(screen.getByRole('searchbox', { name: 'Find an owner' })).toHaveValue('Greenway');
});

it('opens the exact attention message and scopes full history to its owner', async () => {
  mock.owners.mockResolvedValue({ owners: [owner], nextCursor: null });
  mock.messages.mockResolvedValue({ messages: [message], nextCursor: null });
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Needs attention' }));
  await screen.findByText('All sending is paused.');
  expect(mock.messages).toHaveBeenLastCalledWith({ view: 'attention' });
  fireEvent.click(screen.getByRole('button', { name: 'Open message' }));
  await screen.findByText('Selected message: older-message');
  fireEvent.click(screen.getByRole('button', { name: 'View full history' }));
  await waitFor(() => expect(mock.messages).toHaveBeenLastCalledWith({ view: 'history', ownerId: owner.id }));
  fireEvent.change(screen.getByLabelText('From (IST)'), { target: { value: '2026-11-18' } });
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'DELIVERED' } });
  await waitFor(() => expect(mock.messages).toHaveBeenLastCalledWith({ view: 'history', ownerId: owner.id, from: '2026-11-18', status: 'DELIVERED' }));
});


it('prioritises paused sending over preview approval in the message list', async () => {
  mock.owners.mockResolvedValue({ owners: [owner], nextCursor: null });
  mock.messages.mockResolvedValue({ messages: [{ ...message, needsApproval: true, rolloutHold: 'category_paused' }], nextCursor: null });
  const policy = { stage: 'INTERNAL' as const, paused: false, enabledCategories: [], organizationIds: [owner.id], version: 1 };
  const view = render(<WhatsAppInbox policy={policy} onRefresh={vi.fn()} onTestSetup={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Needs attention' }));
  expect(await screen.findByText('Paused')).toBeInTheDocument();
  expect(screen.getByText('This message category is paused.')).toBeInTheDocument();
  expect(screen.getByText('Preview: approval needed in FuelNerve')).toBeInTheDocument();
  expect(screen.queryByText('Needs preview approval')).not.toBeInTheDocument();
  view.rerender(<WhatsAppInbox policy={{ ...policy, enabledCategories: ['OWNER_WELCOME'] }} onRefresh={vi.fn()} onTestSetup={vi.fn()}/>);
  expect(await screen.findByText('Needs preview approval')).toBeInTheDocument();
  expect(screen.queryByText('This message category is paused.')).not.toBeInTheDocument();
});

it('keeps delivered outcomes distinct from rollout holds recorded earlier', async () => {
  mock.owners.mockResolvedValue({ owners: [owner], nextCursor: null });
  mock.messages.mockResolvedValue({ messages: [{ ...message, status: 'DELIVERED', needsApproval: false }], nextCursor: null });
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Delivery history' }));
  expect(await screen.findByText('Delivered')).toBeInTheDocument();
  expect(screen.queryByText('All sending is paused.')).not.toBeInTheDocument();
});
