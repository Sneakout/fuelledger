import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Building2, Clipboard, Mail, Phone, Save, Sparkles, Users } from "lucide-react";
import { ApiRequestError, api, type DemoLeadsBootstrap, type PlatformCustomer, type PlatformCustomersBootstrap } from "../lib/api";
import { useAuth } from "../components/AuthProvider";

const dateTime = (value: string) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

function CustomerActivation({ customer, onSaved }: { customer: PlatformCustomer; onSaved(): Promise<void> }) {
  const [setupFeePaid, setSetupFeePaid] = useState(Boolean(customer.setupFeePaidAt));
  const [lifetimeAccessPaid, setLifetimeAccessPaid] = useState(Boolean(customer.lifetimeAccessPaidAt));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const changed = setupFeePaid !== Boolean(customer.setupFeePaidAt) || lifetimeAccessPaid !== Boolean(customer.lifetimeAccessPaidAt);
  async function save() {
    setSaving(true); setMessage("");
    try {
      await api.updateCustomerSubscription(customer.id, { setupFeePaid, lifetimeAccessPaid });
      await onSaved(); setMessage("Customer portal updated");
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.message : "Unable to update this customer.");
    } finally { setSaving(false); }
  }
  return <article className="customer-activation">
    <span className="lead-kind customer"><Building2 /></span>
    <div className="customer-identity"><strong>{customer.name}</strong><small>{customer.owner?.name ?? "Owner pending"} · {customer.owner?.email ?? "No owner email"}</small><small>Signed up {dateTime(customer.createdAt)} · {customer.petrolPumps} petrol pump{customer.petrolPumps === 1 ? "" : "s"}</small></div>
    <div className="activation-checks">
      <label><input type="checkbox" checked={setupFeePaid} onChange={(event) => { const checked = event.target.checked; setSetupFeePaid(checked); if (!checked) setLifetimeAccessPaid(false); }} /><span><b>Setup fee paid</b><small>{customer.setupFeePaidAt ? `Confirmed ${dateTime(customer.setupFeePaidAt)}` : "₹2,000 checkpoint"}</small></span></label>
      <label><input type="checkbox" checked={lifetimeAccessPaid} onChange={(event) => { const checked = event.target.checked; setLifetimeAccessPaid(checked); if (checked) setSetupFeePaid(true); }} /><span><b>Lifetime access paid</b><small>{customer.lifetimeAccessPaidAt ? `Activated ${dateTime(customer.lifetimeAccessPaidAt)}` : "₹24,000 checkpoint"}</small></span></label>
    </div>
    <div className="activation-action">
      {customer.lifetimeAccessPaidAt ? <em><BadgeCheck /> Lifetime active</em> : customer.setupFeePaidAt ? <em className="setup"><BadgeCheck /> Setup active</em> : <em className="pending">Awaiting payment</em>}
      <button className="secondary small" disabled={!changed || saving} onClick={() => void save()}><Save size={14} />{saving ? "Saving…" : "Save access"}</button>{message && <small>{message}</small>}
    </div>
  </article>;
}

export function DemoLeadsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DemoLeadsBootstrap | null>(null);
  const [accounts, setAccounts] = useState<PlatformCustomersBootstrap | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const loadAccounts = async () => setAccounts(await api.platformCustomers());
  useEffect(() => {
    if (!user?.isPlatformAdmin) return;
    void Promise.all([api.demoLeads(), api.platformCustomers()]).then(([leads, customers]) => { setData(leads); setAccounts(customers); }).catch((item) => setError(item instanceof ApiRequestError ? item.message : "Unable to load the growth desk."));
  }, [user?.isPlatformAdmin]);
  const unique = useMemo(() => new Set(data?.leads.map((lead) => lead.contact.toLowerCase())).size, [data]);
  const active = accounts?.customers.filter((customer) => customer.lifetimeAccessPaidAt).length ?? 0;
  async function copy(contact: string) { await navigator.clipboard.writeText(contact); setCopied(contact); window.setTimeout(() => setCopied(""), 1800); }
  if (!user?.isPlatformAdmin) return <main className="page"><div className="form-error">This area is restricted to the FuelLedger team.</div></main>;
  if (!data || !accounts) return <main className="page"><div className="loading"><span/><p>Loading growth desk…</p></div>{error && <div className="form-error">{error}</div>}</main>;
  return <main className="page leads-page">
    <section className="leads-hero"><div><span className="eyebrow">Growth desk</span><h1>Customers & enquiries</h1><p>Follow new signups from first interest to verified setup and lifetime activation.</p></div><Sparkles/></section>
    {error && <div className="form-error">{error}</div>}
    <section className="leads-stats three"><article><Users/><span><small>Registered customers</small><b>{accounts.customers.length}</b></span></article><article><BadgeCheck/><span><small>Lifetime active</small><b>{active}</b></span></article><article><Sparkles/><span><small>Demo enquiries</small><b>{unique}</b></span></article></section>
    <section className="leads-list customer-list"><header><div><span className="eyebrow">Customer activation</span><h2>Registered FuelLedger accounts</h2><p>Confirm payments only after verifying the receipt. Saving updates the owner’s Subscription page immediately.</p></div><small>Latest 250 accounts</small></header>{accounts.customers.length ? accounts.customers.map((customer) => <CustomerActivation key={`${customer.id}-${customer.subscriptionUpdatedAt}`} customer={customer} onSaved={loadAccounts} />) : <div className="leads-empty"><Building2/><h2>No customer signups yet</h2></div>}</section>
    <section className="leads-list"><header><div><span className="eyebrow">Follow-up list</span><h2>Recent demo visitors</h2></div><small>Latest 250 sessions</small></header>{data.leads.length ? data.leads.map((lead) => { const email = lead.kind === "EMAIL"; return <article key={lead.id}><span className={email ? "lead-kind email" : "lead-kind phone"}>{email ? <Mail/> : <Phone/>}</span><div><strong>{lead.contact}</strong><small>Started {dateTime(lead.createdAt)} · Demo ends {dateTime(lead.expiresAt)}</small></div><button className="secondary small" onClick={() => void copy(lead.contact)}><Clipboard size={14}/>{copied === lead.contact ? "Copied" : "Copy"}</button></article>; }) : <div className="leads-empty"><Users/><h2>No demo enquiries yet</h2><p>When someone starts a demo, it will appear here.</p></div>}</section>
  </main>;
}
