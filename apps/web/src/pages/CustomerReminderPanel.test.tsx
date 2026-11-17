import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CustomerReminderPanel } from './CustomerReminderPanel';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    customerReminderProfile: vi.fn(async () => ({
      profile: {
        id: 'customer', reminderWhatsAppNumber: '919876543210', reminderConsentAt: '2026-11-01T04:00:00Z',
        reminderConsentById: 'owner', reminderConsentSource: 'Signed agreement', reminderPaused: false,
      },
      history: [],
    })),
    previewCustomerReminder: vi.fn(async () => ({
      draft: { stationId: 'station', snapshot: 'reviewed-version', destination: '919876543210', preview: '₹2,000 is overdue.' },
    })),
    approveCustomerReminder: vi.fn(async () => ({ id: 'delivery', status: 'PENDING' })),
  },
  ApiRequestError: class extends Error {},
}));

describe('Customer reminders', () => {
  it('shows the recipient and exact reminder before the owner can queue it', async () => {
    const { container } = render(<CustomerReminderPanel customerId="customer" stations={[{ id: 'station', name: 'Test station' }]} />);
    const details = container.querySelector('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    fireEvent.click(await screen.findByRole('button', { name: 'Preview reminder' }));
    expect(await screen.findByText('To +919876543210')).toBeInTheDocument();
    expect(screen.getByText('₹2,000 is overdue.')).toBeInTheDocument();
    expect(api.approveCustomerReminder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and queue reminder' }));
    await waitFor(() => expect(api.approveCustomerReminder).toHaveBeenCalledExactlyOnceWith('customer', 'station', 'reviewed-version'));
    expect(await screen.findByText(/Reminder queued/)).toBeInTheDocument();
  });
});
