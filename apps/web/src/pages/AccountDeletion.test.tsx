import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountDeletion } from './AccountDeletion';
const mocks=vi.hoisted(()=>({previewAccountDeletion:vi.fn(),deleteCustomerAccount:vi.fn()}));
vi.mock('../lib/api',()=>({ApiRequestError:class extends Error{},api:mocks}));
const preview={name:'Example Fuels',users:['owner@example.com'],stations:['Main outlet'],counts:{User:2,Sale:100},token:'signed-preview'};
beforeEach(()=>{vi.clearAllMocks();HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};mocks.previewAccountDeletion.mockResolvedValue(preview);});afterEach(cleanup);
it('previews the exact account, requires typed name, reason and acknowledgement, and deletes only after confirmation',async()=>{
 const updated=vi.fn().mockResolvedValue(undefined);mocks.deleteCustomerAccount.mockResolvedValue({deleted:true});
 render(<AccountDeletion id="org-a" onDeleted={updated}/>);fireEvent.click(screen.getByRole('button',{name:'Delete account'}));
 await screen.findByText('Example Fuels');expect(mocks.deleteCustomerAccount).not.toHaveBeenCalled();
 const confirm=screen.getByRole('button',{name:'Permanently delete account'});expect(confirm).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Deletion reason *'),{target:{value:'Requested by the customer'}});
 fireEvent.change(screen.getByLabelText('Type “Example Fuels” to confirm *'),{target:{value:'Example Fuels'}});
 expect(confirm).toBeDisabled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(confirm);
 await waitFor(()=>expect(updated).toHaveBeenCalledOnce());expect(mocks.deleteCustomerAccount).toHaveBeenCalledWith('org-a',{token:'signed-preview',name:'Example Fuels',reason:'Requested by the customer'});
 expect(await screen.findByRole('status')).toHaveTextContent('Customer account deleted.');
});
it('shows protected-account errors without exposing a delete action',async()=>{
 mocks.previewAccountDeletion.mockRejectedValue(new Error('blocked'));render(<AccountDeletion id="admin" onDeleted={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Delete account'}));
 expect(await screen.findByRole('alert')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Permanently delete account'})).toBeNull();
});
it('keeps the preview open when the account changes before deletion',async()=>{
 mocks.deleteCustomerAccount.mockRejectedValue(new Error('changed'));render(<AccountDeletion id="org-a" onDeleted={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Delete account'}));await screen.findByText('Example Fuels');
 fireEvent.change(screen.getByLabelText('Deletion reason *'),{target:{value:'Customer asked for deletion'}});fireEvent.change(screen.getByLabelText('Type “Example Fuels” to confirm *'),{target:{value:'Example Fuels'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Permanently delete account'}));
 expect(await screen.findByRole('alert')).toBeInTheDocument();expect(screen.getByRole('dialog')).toBeInTheDocument();
});
