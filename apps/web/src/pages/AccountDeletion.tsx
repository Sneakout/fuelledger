import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { api, type AccountDeletionPreview, ApiRequestError } from '../lib/api';
import './account-deletion.css';

export function AccountDeletion({ id, onDeleted }: {id:string;onDeleted():Promise<void>}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open,setOpen] = useState(false);
  const [preview,setPreview] = useState<AccountDeletionPreview|null>(null);
  const [name,setName] = useState(''), [reason,setReason] = useState('');
  const [ack,setAck] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const [deleted,setDeleted] = useState(false);
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement|null;
    dialog.current?.showModal();
    let active=true;
    setBusy(true);setPreview(null);setError('');setName('');setReason('');setAck(false);
    api.previewAccountDeletion(id).then(p => {if(active)setPreview(p);}).catch(e => {if(active)setError(e instanceof ApiRequestError?e.message:'Unable to prepare deletion. Please try again.');}).finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;trigger?.focus();};
  },[open,id]);
  async function remove() {
    if (!preview || busy || name!==preview.name || !ack || reason.trim().length<10) return;
    setBusy(true);setError('');
    try {
      await api.deleteCustomerAccount(id,{token:preview.token,name,reason});
      setDeleted(true);setOpen(false);
      await onDeleted();
    } catch(e) {setError(e instanceof ApiRequestError?e.message:'Unable to delete the account. Refresh the account list before retrying.');}
    finally {setBusy(false);}
  }
  if(deleted) return <p role="status">Customer account deleted.</p>;
  return <>
    <button className="account-delete-link" onClick={()=>setOpen(true)}><Trash2 size={15}/>Delete account</button>
    {open && <dialog ref={dialog} className="account-delete-dialog" aria-labelledby="account-delete-title" onCancel={e=>{if(busy)e.preventDefault();else setOpen(false);}}>
      <header><div><span className="eyebrow">Account management</span><h2 id="account-delete-title">Delete customer account</h2></div><button className="secondary small" aria-label="Close deletion preview" disabled={busy} onClick={()=>setOpen(false)}><X/></button></header>
      <p className="account-delete-warning"><AlertTriangle/>This permanently removes the entire customer account and all its fuel stations. It cannot be undone.</p>
      {busy&&!preview&&<p role="status">Checking account and linked records…</p>}
      {error&&<p role="alert" className="account-delete-warning">{error}</p>}
      {preview&&<><h3>{preview.name}</h3><p>{preview.users.join(' · ')}</p><p><b>Fuel stations:</b> {preview.stations.join(' · ')||'None configured'}</p>
        <div className="account-delete-totals">{[['User','Staff logins'],['Station','Fuel stations'],['Sale','Sales'],['PurchaseInvoice','Purchase invoices'],['HistoricalSalesImport','DSR imports'],['Journal','Accounting journals']].map(([key,label])=><div key={key}><strong>{preview.counts[key!]??0}</strong><span>{label}</span></div>)}</div>
        <details><summary>All records included</summary><ul>{Object.entries(preview.counts).filter(([,n])=>n>0).map(([key,n])=><li key={key}>{key.replace(/([a-z])([A-Z])/g,'$1 $2')}: {n}</li>)}</ul></details>
        <p>Staff access and saved email and WhatsApp jobs are removed. A deletion audit is retained. Existing backups, browser drafts and messages already received by email or WhatsApp are outside this deletion.</p>
        <label>Deletion reason *<textarea value={reason} maxLength={1000} rows={3} onChange={e=>setReason(e.target.value)} disabled={busy} placeholder="Explain why this account is being removed (at least 10 characters)"/></label>
        <label>Type “{preview.name}” to confirm *<input value={name} onChange={e=>setName(e.target.value)} disabled={busy} autoComplete="off"/></label>
        <label className="account-delete-ack"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} disabled={busy}/>I understand that all records for this customer will be permanently deleted.</label>
        <footer><button className="secondary" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button><button className="account-delete-confirm" disabled={busy||!ack||name!==preview.name||reason.trim().length<10} onClick={()=>void remove()}><Trash2 size={18}/>{busy?'Deleting account…':'Permanently delete account'}</button></footer>
      </>}
    </dialog>}
  </>;
}
