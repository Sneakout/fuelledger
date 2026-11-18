import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DemoLeadsPage } from './DemoLeadsPage';
const mock=vi.hoisted(()=>({admin:true,leads:vi.fn(),customers:vi.fn(),tickets:vi.fn()}));
vi.mock('../components/AuthProvider',()=>({useAuth:()=>({user:{isPlatformAdmin:mock.admin}})}));
vi.mock('../lib/api',()=>({ApiRequestError:class extends Error{},api:{demoLeads:mock.leads,platformCustomers:mock.customers,platformServiceTickets:mock.tickets}}));
vi.mock('./WhatsAppRolloutPanel',()=>({WhatsAppRolloutPanel:()=> <section><h2>Owner WhatsApp</h2><input aria-label="Unsent WhatsApp work"/></section>}));
function Location(){return <output aria-label="Page location">{useLocation().search}</output>;}
const open=(path='/demo-leads')=>render(<MemoryRouter initialEntries={[path]}><DemoLeadsPage/><Location/></MemoryRouter>);
beforeEach(()=>{vi.resetAllMocks();mock.admin=true;mock.leads.mockResolvedValue({leads:[{id:'lead',contact:'visitor@example.test',kind:'EMAIL',createdAt:new Date().toISOString(),expiresAt:new Date().toISOString()}]});mock.customers.mockResolvedValue({customers:[{id:'account',name:'Greenway Fuel',owner:{name:'Sam',email:'sam@example.test'},createdAt:new Date().toISOString(),petrolPumps:1,notificationSettings:{whatsappOptedIn:true,whatsappNumber:'919999999999'}}]});mock.tickets.mockResolvedValue({tickets:[]});});
afterEach(cleanup);
it('opens an overview with direct navigation to every section',async()=>{
  open();
  expect(await screen.findByRole('heading',{name:'What would you like to manage?'})).toBeInTheDocument();
  const nav=within(screen.getByRole('navigation',{name:'Growth Desk sections'}));
  expect(nav.getAllByRole('button')).toHaveLength(5);
  expect(screen.queryByRole('heading',{name:'Owner WhatsApp'})).not.toBeInTheDocument();
  fireEvent.click(nav.getByRole('button',{name:/WhatsApp/}));
  expect(screen.getByRole('heading',{name:'Owner WhatsApp'})).toBeInTheDocument();
  expect(screen.getByLabelText('Page location')).toHaveTextContent('section=whatsapp');
});
it('honours section links and preserves unsaved work while switching',async()=>{
  open('/demo-leads?section=whatsapp');
  const input=await screen.findByRole('textbox',{name:'Unsent WhatsApp work'});
  fireEvent.change(input,{target:{value:'Draft in progress'}});
  const nav=within(screen.getByRole('navigation',{name:'Growth Desk sections'}));
  fireEvent.click(nav.getByRole('button',{name:/Accounts/}));
  expect(screen.queryByRole('textbox',{name:'Unsent WhatsApp work'})).not.toBeInTheDocument();
  fireEvent.click(nav.getByRole('button',{name:/WhatsApp/}));
  expect(screen.getByRole('textbox',{name:'Unsent WhatsApp work'})).toHaveValue('Draft in progress');
});
it('searches accounts and keeps enquiry searches separate',async()=>{
  open('/demo-leads?section=accounts');
  const search=await screen.findByRole('searchbox',{name:'Search Growth Desk records'});
  fireEvent.change(search,{target:{value:'no-match'}});
  expect(screen.getByRole('heading',{name:'No matching accounts'})).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('navigation',{name:'Growth Desk sections'})).getByRole('button',{name:/Demo enquiries/}));
  expect(screen.getByRole('searchbox')).toHaveValue('');
  expect(screen.getByRole('heading',{name:'Recent demo visitors'})).toBeInTheDocument();
});
it('does not load admin records for a non-admin user',()=>{
  mock.admin=false;open();expect(screen.getByText(/restricted to the FuelNerve team/)).toBeInTheDocument();expect(mock.customers).not.toHaveBeenCalled();
});
