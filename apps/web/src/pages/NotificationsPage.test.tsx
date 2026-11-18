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
it('shows saved consent separately from unavailable delivery without owner test controls',async()=>{
  open();
  expect(await screen.findByText('Preferences saved')).toBeInTheDocument();
  expect(screen.getByText(/WhatsApp delivery is not available yet/)).toBeInTheDocument();
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
