import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotificationsPage } from './NotificationsPage';
const mock = vi.hoisted(() => ({ settings:vi.fn(), save:vi.fn() }));
vi.mock('../components/AuthProvider',()=>({useAuth:()=>({user:{role:'OWNER',demoExpiresAt:null}})}));
vi.mock('../lib/api',()=>({ApiRequestError:class extends Error {},api:{notificationSettings:mock.settings,updateNotificationSettings:mock.save}}));
const settings={whatsappNumber:'918086306454',whatsappOptedIn:true,dailySummaryEnabled:true,dailySummaryHour:20};
beforeEach(()=>{vi.resetAllMocks();mock.settings.mockResolvedValue({settings,deliveries:[],deliveryAvailable:false,testAvailable:true,intelligenceActive:false});});
afterEach(cleanup);
const open=()=>render(<MemoryRouter><NotificationsPage/></MemoryRouter>);
it('focuses on saved preferences without delivery diagnostics or test controls',async()=>{
  open();
  expect(await screen.findByText('Preferences saved')).toBeInTheDocument();
  expect(screen.getByText('Your WhatsApp number and alert preferences are saved. You can update them anytime.')).toBeInTheDocument();
  expect(screen.queryByText(/delivery is not available/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', {name:'Recent deliveries'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/test/i})).not.toBeInTheDocument();
  expect(screen.queryByText('Awaiting activation')).not.toBeInTheDocument();
});
it('requires renewed consent and saving when a number changes',async()=>{
  open();await screen.findByText('Preferences saved');
  fireEvent.change(screen.getByRole('textbox',{name:'WhatsApp number'}),{target:{value:'919999999999'}});
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  const consent=screen.getByRole('checkbox',{name:/I agree to receive/});
  expect(consent).not.toBeChecked();fireEvent.click(consent);
  mock.save.mockResolvedValue({settings:{...settings,whatsappNumber:'919999999999'}});
  fireEvent.click(screen.getByRole('button',{name:'Save preferences'}));
  await waitFor(()=>expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({whatsappNumber:'919999999999',whatsappOptedIn:true,confirmNewNumber:true})));
  expect(await screen.findByText('Preferences saved')).toBeInTheDocument();
});
it('shows alerts off when saved consent is withdrawn',async()=>{
  mock.settings.mockResolvedValue({settings:{...settings,whatsappOptedIn:false},deliveries:[],deliveryAvailable:true,intelligenceActive:false});
  open();expect(await screen.findByText('Alerts off')).toBeInTheDocument();
});

it('keeps provider failures and old suppression reasons out of owner preferences', async () => {
  mock.settings.mockResolvedValue({settings, deliveryAvailable: false, intelligenceActive: false, deliveries: [{id:'old',type:'LOW_STOCK',status:'SUPPRESSED',message:'Backend message',suppressionReason:'owner_not_opted_in',errorMessage:'Provider unavailable',createdAt:'2026-11-17T00:00:00Z'}]});
  open(); await screen.findByText('Preferences saved');
  expect(screen.queryByText('Backend message')).not.toBeInTheDocument();
  expect(screen.queryByText('Provider unavailable')).not.toBeInTheDocument();
  expect(screen.queryByText('The owner has not opted in.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name:'Save preferences'})).toBeEnabled();
});

it('saves email opt-in independently of WhatsApp and shows the sign-in address', async () => {
 mock.settings.mockResolvedValue({ settings: { ...settings, whatsappOptedIn: false, emailEnabled: false }, emailAddress: 'owner@example.com', deliveries: [], intelligenceActive: false });
 mock.save.mockResolvedValue({ settings: { ...settings, whatsappOptedIn: false, emailEnabled: true } });
 open();
 expect(await screen.findByRole('textbox', { name: 'Email address' })).toHaveValue('owner@example.com');
 expect(screen.getByRole('textbox', { name: 'Email address' })).toHaveAttribute('readonly');
 fireEvent.click(screen.getByRole('checkbox', { name: /Send me FuelNerve email updates/ }));
 expect(screen.getByRole('checkbox', { name: /I agree to receive/ })).not.toBeChecked();
 fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
 await waitFor(() => expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({ emailEnabled: true, whatsappOptedIn: false })));
 expect(await screen.findByRole('status')).toHaveTextContent('Email and WhatsApp preferences saved.');
});
