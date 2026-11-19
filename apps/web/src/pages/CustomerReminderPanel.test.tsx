import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    saveCustomerReminderProfile: vi.fn(async () => ({ profile: {} })),
    previewCustomerReminder: vi.fn(async () => ({
      draft: { stationId: 'station', snapshot: 'reviewed-version', destination: '919876543210', preview: '₹2,000 is overdue.' },
    })),
    approveCustomerReminder: vi.fn(async () => ({ id: 'delivery', status: 'PENDING' })),
  },
  ApiRequestError: class extends Error {},
}));

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

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


async function openPreferences() {
  const { container } = render(<CustomerReminderPanel customerId="customer" stations={[{ id: 'station', name: 'Test station' }]} />);
  const details = container.querySelector('details')!;
  details.open = true; fireEvent(details, new Event('toggle'));
  await screen.findByLabelText('Customer WhatsApp number');
}

it('requires a deliberate consent method and highlights it before sending a save request', async () => {
  await openPreferences();
  fireEvent.click(screen.getByLabelText('The customer agreed to WhatsApp payment reminders on this number'));
  const method = screen.getByRole('combobox', { name: 'How they consented' });
  expect(method).toBeRequired();
  expect(method).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'Customer WhatsApp number' })).toBeRequired();
  fireEvent.click(screen.getByRole('button', { name: 'Save reminder preferences' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose how the customer agreed');
  expect(method).toHaveAttribute('aria-invalid', 'true');
  expect(method).toHaveFocus();
  expect(api.saveCustomerReminderProfile).not.toHaveBeenCalled();
  fireEvent.change(method, { target: { value: 'Verbal consent in person' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save reminder preferences' }));
  await waitFor(() => expect(api.saveCustomerReminderProfile).toHaveBeenCalledWith('customer', expect.objectContaining({
    consentSource: 'Verbal consent in person', recordConsent: true,
  })));
  expect(await screen.findByText('Reminder preferences saved.')).toBeInTheDocument();
});

it('requires details for Other and saves the actual description', async () => {
  await openPreferences();
  fireEvent.click(screen.getByLabelText('The customer agreed to WhatsApp payment reminders on this number'));
  fireEvent.change(screen.getByRole('combobox', { name: 'How they consented' }), { target: { value: 'OTHER' } });
  const details = screen.getByRole('textbox', { name: 'Consent details' });
  expect(details).toBeRequired();
  fireEvent.click(screen.getByRole('button', { name: 'Save reminder preferences' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Describe how the customer agreed');
  expect(api.saveCustomerReminderProfile).not.toHaveBeenCalled();
  fireEvent.change(details, { target: { value: ' Written authorization received at the outlet ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save reminder preferences' }));
  await waitFor(() => expect(api.saveCustomerReminderProfile).toHaveBeenCalledWith('customer', expect.objectContaining({ consentSource: 'Written authorization received at the outlet' })));
});

it('can pause an existing consent without requiring new consent details', async () => {
  await openPreferences();
  fireEvent.click(screen.getByLabelText('Pause reminders for this customer'));
  fireEvent.click(screen.getByRole('button', { name: 'Save reminder preferences' }));
  await waitFor(() => expect(api.saveCustomerReminderProfile).toHaveBeenCalledWith('customer', expect.objectContaining({ paused: true, recordConsent: false, consentSource: '' })));
});
