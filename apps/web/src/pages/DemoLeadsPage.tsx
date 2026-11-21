import { AccountDeletion } from './AccountDeletion';
import { DemoFollowUpAction, DemoFollowUpPanel } from './DemoFollowUpPanel';
import type { DemoLead, DemoFollowUpState } from '../lib/api';
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BadgeCheck, Building2, Clipboard, ExternalLink, LayoutDashboard, LifeBuoy, Mail, MessageCircleMore, Phone, Save, Search, Sparkles, Users } from "lucide-react";
import { ApiRequestError, api, type DemoLeadsBootstrap, type PlatformCustomer, type PlatformCustomersBootstrap, type PlatformServiceTicket, type ServiceTicketStatus, type SubscriptionBillingPeriod, type SubscriptionPlan } from "../lib/api";
import { useSearchParams } from "react-router-dom";
import { WhatsAppRolloutPanel } from "./WhatsAppRolloutPanel";
import { useAuth } from "../components/AuthProvider";

const dateTime = (value: string) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

function CustomerActivation({ customer, onSaved, onDeleted }: { customer: PlatformCustomer; onSaved(): Promise<void>; onDeleted(): Promise<void> }) {
  const initialPlan: SubscriptionPlan = customer.subscriptionPlan ?? (customer.intelligenceEnabledAt ? "CORE_INTELLIGENCE" : "CORE");
  const initialBilling: SubscriptionBillingPeriod = customer.subscriptionBillingPeriod ?? (customer.lifetimeAccessPaidAt ? "LIFETIME" : "YEARLY");
  const [plan, setPlan] = useState<SubscriptionPlan>(initialPlan);
  const [billingPeriod, setBillingPeriod] = useState<SubscriptionBillingPeriod>(initialBilling);
  const [setupFeePaid, setSetupFeePaid] = useState(Boolean(customer.setupFeePaidAt));
  const [paymentConfirmed, setPaymentConfirmed] = useState(Boolean(customer.subscriptionActivatedAt || customer.lifetimeAccessPaidAt || customer.intelligenceEnabledAt));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const originallyConfirmed = Boolean(customer.subscriptionActivatedAt || customer.lifetimeAccessPaidAt || customer.intelligenceEnabledAt);
  const changed = plan !== initialPlan || billingPeriod !== initialBilling || setupFeePaid !== Boolean(customer.setupFeePaidAt) || paymentConfirmed !== originallyConfirmed;
  const choices: Array<{ value: SubscriptionBillingPeriod; label: string; price: string }> = plan === "CORE"
    ? [{ value: "MONTHLY", label: "Monthly", price: "₹699/month" }, { value: "YEARLY", label: "Yearly", price: "₹5,988/year" }, { value: "LIFETIME", label: "Lifetime", price: "₹24,000 once" }]
    : [{ value: "MONTHLY", label: "Monthly", price: "₹1,499/month" }, { value: "YEARLY", label: "Yearly", price: "₹14,999/year" }, { value: "FOUNDING_YEARLY", label: "Founding offer", price: "₹11,999 first year" }];
  function choosePlan(next: SubscriptionPlan) {
    setPlan(next);
    if (next === "CORE" && billingPeriod === "FOUNDING_YEARLY") setBillingPeriod("YEARLY");
    if (next === "CORE_INTELLIGENCE" && billingPeriod === "LIFETIME") setBillingPeriod("YEARLY");
  }
  async function save() {
    setSaving(true); setMessage("");
    try {
      await api.updateCustomerSubscription(customer.id, { plan, billingPeriod, paymentConfirmed, setupFeePaid });
      await onSaved(); setMessage(paymentConfirmed ? "Access approved" : "Selection saved; access is not active");
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.message : "Unable to update this customer.");
    } finally { setSaving(false); }
  }
  return <article className="customer-activation">
    <span className="lead-kind customer"><Building2 /></span>
    <div className="customer-identity"><strong>{customer.name}</strong><small>{customer.owner?.name ?? "Owner pending"} · {customer.owner?.email ?? "No owner email"}</small><small>Signed up {dateTime(customer.createdAt)} · {customer.petrolPumps} petrol pump{customer.petrolPumps === 1 ? "" : "s"}</small></div>
    <div className="activation-checks" aria-label={`Access approval for ${customer.name}`}>
      <fieldset className="activation-plan"><legend>Plan</legend><div>
        <label><input type="radio" name={`plan-${customer.id}`} checked={plan === "CORE"} onChange={() => choosePlan("CORE")} /><span><b>Core</b><small>Station operations and accounts</small></span></label>
        <label><input type="radio" name={`plan-${customer.id}`} checked={plan === "CORE_INTELLIGENCE"} onChange={() => choosePlan("CORE_INTELLIGENCE")} /><span><b>Core + Intelligence</b><small>Core plus Daily Brief and agents</small></span></label>
      </div></fieldset>
      <fieldset className="activation-billing"><legend>Billing choice</legend><div>{choices.map((choice) => <label key={choice.value}><input type="radio" name={`billing-${customer.id}`} checked={billingPeriod === choice.value} onChange={() => setBillingPeriod(choice.value)} /><span><b>{choice.label}</b><small>{choice.price}</small></span></label>)}</div></fieldset>
      <div className="activation-confirmations">
        <label><input type="checkbox" checked={setupFeePaid} onChange={(event) => setSetupFeePaid(event.target.checked)} /><span><b>Optional assisted setup paid</b><small>{customer.setupFeePaidAt ? `Confirmed ${dateTime(customer.setupFeePaidAt)}` : "₹2,000 once"}</small></span></label>
        <label className="payment-confirm"><input type="checkbox" checked={paymentConfirmed} onChange={(event) => setPaymentConfirmed(event.target.checked)} /><span><b>Plan payment verified</b><small>Activates exactly the plan and billing choice above</small></span></label>
      </div>

    </div>
    <div className="activation-action">
      {customer.subscriptionActivatedAt || customer.lifetimeAccessPaidAt || customer.intelligenceEnabledAt ? <em><BadgeCheck /> {customer.subscriptionPlan === "CORE_INTELLIGENCE" || customer.intelligenceEnabledAt ? "Intelligence active" : "Core active"}</em> : <em className="pending">Awaiting approval</em>}
      <button className="secondary small" disabled={!changed || saving} onClick={() => void save()}><Save size={14} />{saving ? "Saving…" : paymentConfirmed ? "Approve access" : "Save selection"}</button>{message && <small>{message}</small>}
      <AccountDeletion id={customer.id} onDeleted={onDeleted}/>
    </div>
  </article>;
}

function ServiceTicketCard({ ticket, onSaved }: { ticket: PlatformServiceTicket; onSaved(): Promise<void> }) {
  const [status, setStatus] = useState<ServiceTicketStatus>(ticket.status);
  const [adminNote, setAdminNote] = useState(ticket.adminNote ?? "");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { await api.updatePlatformServiceTicket(ticket.id, { status, adminNote }); await onSaved(); }
    finally { setSaving(false); }
  }
  return <article className="service-ticket-card">
    <span className="lead-kind customer"><LifeBuoy/></span>
    <div className="service-ticket-copy"><div><strong>{ticket.reference} · {ticket.organization.name}</strong><em className={ticket.status.toLowerCase()}>{ticket.status.replace("_", " ")}</em></div><small>{ticket.createdBy.name} · {ticket.createdBy.email} · {dateTime(ticket.createdAt)}</small><h3>{ticket.issue.replaceAll("_", " ")}{ticket.subIssue ? ` · ${ticket.subIssue}` : ""}</h3><p>{ticket.comments}</p>{ticket.hasScreenshot && <a href={`/api/platform/service-tickets/${ticket.id}/screenshot`} target="_blank" rel="noreferrer"><ExternalLink/> Open screenshot</a>}</div>
    <div className="service-ticket-action"><select value={status} onChange={(event) => setStatus(event.target.value as ServiceTicketStatus)}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option></select><textarea rows={2} maxLength={2000} placeholder="Internal note" value={adminNote} onChange={(event) => setAdminNote(event.target.value)}/><button className="secondary small" disabled={saving || (status === ticket.status && adminNote === (ticket.adminNote ?? ""))} onClick={() => void save()}><Save/>{saving ? "Saving…" : "Save ticket"}</button></div>
  </article>;
}

export function DemoLeadsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [searches, setSearches] = useState<Record<string,string>>({});
  const tabs = ['overview', 'whatsapp', 'accounts', 'support', 'enquiries'] as const;
  type DeskTab = typeof tabs[number];
  const section = tabs.includes(params.get('section') as DeskTab) ? params.get('section') as DeskTab : 'overview';
  const [whatsAppOpened, setWhatsAppOpened] = useState(section === 'whatsapp');
  useEffect(() => { if (section === 'whatsapp') setWhatsAppOpened(true); }, [section]);
  const search = searches[section] ?? '';
  const setSearch = (value: string) => setSearches(previous => ({ ...previous, [section]: value }));
  function chooseSection(next: DeskTab) {
    setParams(previous => { const updated = new URLSearchParams(previous); updated.set('section', next); return updated; });
  }
  const [data, setData] = useState<DemoLeadsBootstrap | null>(null);
  const [accounts, setAccounts] = useState<PlatformCustomersBootstrap | null>(null);
  const [tickets, setTickets] = useState<PlatformServiceTicket[] | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [followUpLead, setFollowUpLead] = useState<DemoLead | null>(null);
  function updateFollowUp(state: DemoFollowUpState) { setData(current => current ? { ...current, leads: current.leads.map(lead => lead.kind === 'EMAIL' && lead.contact.trim().toLowerCase() === state.destination ? { ...lead, followUp: state } : lead) } : current); }
  const loadAccounts = async () => setAccounts(await api.platformCustomers());
  const [accountRevision, setAccountRevision] = useState(0);
  async function accountDeleted() {
    const [leads, customers, serviceTickets] = await Promise.all([api.demoLeads(), api.platformCustomers(), api.platformServiceTickets()]);
    setData(leads); setAccounts(customers); setTickets(serviceTickets.tickets); setAccountRevision(n => n + 1);
  }
  const loadTickets = async () => setTickets((await api.platformServiceTickets()).tickets);
  useEffect(() => {
    if (!user?.isPlatformAdmin) return;
    void Promise.all([api.demoLeads(), api.platformCustomers(), api.platformServiceTickets()]).then(([leads, customers, serviceTickets]) => { setData(leads); setAccounts(customers); setTickets(serviceTickets.tickets); }).catch((item) => setError(item instanceof ApiRequestError ? item.message : "Unable to load the growth desk."));
  }, [user?.isPlatformAdmin]);
  const unique = useMemo(() => new Set(data?.leads.map((lead) => lead.contact.toLowerCase())).size, [data]);
  const active = accounts?.customers.filter((customer) => customer.subscriptionActivatedAt || customer.lifetimeAccessPaidAt || customer.intelligenceEnabledAt).length ?? 0;
  async function copy(contact: string) { await navigator.clipboard.writeText(contact); setCopied(contact); window.setTimeout(() => setCopied(""), 1800); }
  if (!user?.isPlatformAdmin) return <main className="page"><div className="form-error">This area is restricted to the FuelNerve team.</div></main>;
  if (!data || !accounts || !tickets) return <main className="page"><div className="loading"><span/><p>Loading growth desk…</p></div>{error && <div className="form-error">{error}</div>}</main>;
  const pendingAccounts = accounts.customers.filter(customer => !customer.subscriptionActivatedAt && !customer.lifetimeAccessPaidAt && !customer.intelligenceEnabledAt).length;
  const openTickets = tickets.filter(ticket => ticket.status !== 'RESOLVED').length;
  const optedIn = accounts.customers.filter(customer => customer.notificationSettings.whatsappOptedIn && customer.notificationSettings.whatsappNumber).length;
  const navigation = [
    { id:'overview', label:'Overview', icon:LayoutDashboard, count:null },
    { id:'whatsapp', label:'WhatsApp', icon:MessageCircleMore, count:optedIn },
    { id:'accounts', label:'Accounts', icon:Building2, count:accounts.customers.length },
    { id:'support', label:'Support', icon:LifeBuoy, count:openTickets },
    { id:'enquiries', label:'Demo enquiries', icon:Users, count:unique },
  ] as const;
  const query = search.trim().toLowerCase();
  const matches = (...values: Array<string | null | undefined>) => values.some(value => value?.toLowerCase().includes(query));
  const filteredAccounts = accounts.customers.filter(customer => matches(customer.name, customer.owner?.name, customer.owner?.email));
  const filteredTickets = tickets.filter(ticket => matches(ticket.reference, ticket.organization.name, ticket.createdBy.name, ticket.createdBy.email, ticket.issue, ticket.comments));
  const filteredLeads = data.leads.filter(lead => matches(lead.contact));
  return <main className="page leads-page">
    <section className="leads-hero"><div><span className="eyebrow">Growth desk</span><h1>Growth Desk</h1><p>Manage owner accounts, WhatsApp delivery, support and demo enquiries in one place.</p></div><Sparkles/></section>
    {error && <div className="form-error">{error}</div>}
    <nav className="growth-desk-nav" aria-label="Growth Desk sections">{navigation.map(({id,label,icon:Icon,count}) => <button key={id} type="button" aria-current={section===id ? 'page' : undefined} onClick={() => chooseSection(id)}><Icon size={17}/><span>{label}</span>{count !== null && <b>{count}</b>}</button>)}</nav>
    <div hidden={section !== 'overview'} className="growth-desk-section">
      <div className="desk-overview-heading"><span className="eyebrow">Your admin workspace</span><h2>What would you like to manage?</h2><p>Choose a section to work with its records and actions.</p></div>
      <div className="desk-overview-grid">{[
        {id:'whatsapp' as const, title:'WhatsApp delivery', icon:MessageCircleMore, value:optedIn, metric:'owners with saved consent', detail:'Choose an owner, prepare a preview, test delivery and manage live alerts.'},
        {id:'accounts' as const, title:'Accounts & access', icon:Building2, value:accounts.customers.length, metric:`registered accounts · ${pendingAccounts} awaiting access approval`, detail:'Find an owner, review their plan and billing choice, then approve verified payments.'},
        {id:'support' as const, title:'Support tickets', icon:LifeBuoy, value:openTickets, metric:'unresolved tickets', detail:'Review customer issues, update progress and keep support notes together.'},
        {id:'enquiries' as const, title:'Demo enquiries', icon:Users, value:unique, metric:'unique contacts in the latest sessions', detail:'Find recent demo visitors and copy their contact details for follow-up.'},
      ].map(({id,title,icon:Icon,value,metric,detail}) => <button className="desk-overview-card" key={id} type="button" onClick={() => chooseSection(id)}><span className="desk-card-icon"><Icon/></span><h3>{title}</h3><strong>{value}</strong><small>{metric}</small><p>{detail}</p><span className="desk-card-action">Open section <ArrowRight size={16}/></span></button>)}</div>
      <p className="desk-overview-note">{active} accounts have recorded plan activation. WhatsApp consent, plan activation and actual message delivery are shown separately in their sections.</p>
    </div>
    {['accounts','support','enquiries'].includes(section) && <label className="desk-search"><Search size={18}/><input type="search" aria-label="Search Growth Desk records" placeholder={section === 'accounts' ? 'Search fuel station, owner or email' : section === 'support' ? 'Search ticket, fuel station or issue' : 'Search email or mobile number'} value={search} onChange={event => setSearch(event.target.value)}/>{search && <button type="button" onClick={()=>setSearch('')}>Clear</button>}</label>}
    <div hidden={section !== 'whatsapp'} className="growth-desk-section">
    {(whatsAppOpened || section === 'whatsapp') && <WhatsAppRolloutPanel key={accountRevision} customers={accounts.customers} onRefreshCustomers={loadAccounts} />}
    </div>
    <div hidden={section !== 'support'} className="growth-desk-section"><section className="leads-list service-ticket-list"><header><div><span className="eyebrow">Customer service</span><h2>Service tickets</h2><p>Issues submitted from customer Help pages, newest first.</p></div><small>{tickets.filter((ticket) => ticket.status !== "RESOLVED").length} open</small></header>{filteredTickets.length ? filteredTickets.map((ticket) => <ServiceTicketCard key={`${ticket.id}-${ticket.updatedAt}`} ticket={ticket} onSaved={loadTickets}/>) : <div className="leads-empty"><LifeBuoy/><h2>{query ? "No matching service tickets" : "No service tickets"}</h2></div>}</section>
    </div>
    <div hidden={section !== 'accounts'} className="growth-desk-section"><section className="leads-list customer-list"><header><div><span className="eyebrow">Customer activation</span><h2>Registered FuelNerve accounts</h2><p>Select the customer’s exact plan and billing choice. Approve access only after independently verifying payment.</p></div><small>Latest 250 accounts</small></header>{filteredAccounts.length ? filteredAccounts.map((customer) => <CustomerActivation key={`${customer.id}-${customer.subscriptionUpdatedAt}`} customer={customer} onSaved={loadAccounts} onDeleted={accountDeleted} />) : <div className="leads-empty"><Building2/><h2>{query ? "No matching accounts" : "No customer signups yet"}</h2></div>}</section>
    </div>
    {followUpLead && <DemoFollowUpPanel key={followUpLead.id} lead={followUpLead} onClose={() => setFollowUpLead(null)} onUpdated={updateFollowUp}/>}<div hidden={section !== 'enquiries'} className="growth-desk-section"><section className="leads-list"><header><div><span className="eyebrow">Follow-up list</span><h2>Recent demo visitors</h2><p className="demo-enquiries-intro">Start a personal conversation. Preview a branded benefits email for visitors who shared an email address, then send when you have their permission.</p></div><small>Latest 250 sessions</small></header>{filteredLeads.length ? filteredLeads.map((lead) => { const email = lead.kind === "EMAIL"; return <article className="demo-enquiry-row" key={lead.id}><span className={email ? "lead-kind email" : "lead-kind phone"}>{email ? <Mail/> : <Phone/>}</span><div><strong>{lead.contact}</strong><small>Started {dateTime(lead.createdAt)} · Demo ends {dateTime(lead.expiresAt)}</small></div>{email && <DemoFollowUpAction lead={lead} onOpen={() => setFollowUpLead(lead)}/>}<button className="secondary small" onClick={() => void copy(lead.contact)}><Clipboard size={14}/>{copied === lead.contact ? "Copied" : "Copy"}</button></article>; }) : <div className="leads-empty"><Users/><h2>{query ? "No matching enquiries" : "No demo enquiries yet"}</h2><p>When someone starts a demo, it will appear here.</p></div>}</section>
    </div>
  </main>;
}
