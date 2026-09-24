import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Building2, Clipboard, ExternalLink, LifeBuoy, Mail, MessageCircleMore, Phone, Save, Sparkles, Users } from "lucide-react";
import { ApiRequestError, api, type DemoLeadsBootstrap, type NotificationSettings, type PlatformCustomer, type PlatformCustomersBootstrap, type PlatformServiceTicket, type ServiceTicketStatus, type SubscriptionBillingPeriod, type SubscriptionPlan } from "../lib/api";
import { useAuth } from "../components/AuthProvider";

const dateTime = (value: string) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

const alertChoices: Array<[keyof NotificationSettings, string]> = [
  ["densityMissingEnabled", "Missing density"],
  ["lowStockEnabled", "Low stock"],
  ["shiftVarianceEnabled", "Shift variance"],
  ["unclosedShiftEnabled", "Open shift"],
  ["dailySummaryEnabled", "Daily summary"],
  ["overdueCustomerEnabled", "Overdue credit"],
];

function CustomerWhatsAppSettings({ customer }: { customer: PlatformCustomer }) {
  const [settings, setSettings] = useState(customer.notificationSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setSaving(true); setMessage("");
    try {
      const { providerReady: _providerReady, ...input } = settings;
      const result = await api.updateCustomerNotifications(customer.id, input);
      setSettings(result.settings); setMessage("WhatsApp alerts saved");
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.message : "Unable to save WhatsApp alerts.");
    } finally { setSaving(false); }
  }
  return <details className="admin-whatsapp">
    <summary><MessageCircleMore/><span><b>WhatsApp alerts</b><small>{settings.whatsappOptedIn && settings.whatsappNumber ? `Active · +${settings.whatsappNumber}` : "Not active"}</small></span></summary>
    <div className="admin-whatsapp-body">
      <label><span>Customer WhatsApp number</span><input inputMode="tel" placeholder="919876543210" value={settings.whatsappNumber ?? ""} onChange={(event) => setSettings({ ...settings, whatsappNumber: event.target.value.replace(/[^0-9+]/g, "") })}/></label>
      <label className="admin-whatsapp-optin"><input type="checkbox" checked={settings.whatsappOptedIn} onChange={(event) => setSettings({ ...settings, whatsappOptedIn: event.target.checked })}/><span>Customer opt-in confirmed</span></label>
      <div className="admin-alert-choices">{alertChoices.map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })}/><span>{label}</span></label>)}</div>
      <div className="admin-whatsapp-thresholds"><label><span>Low stock %</span><input type="number" min="1" max="50" value={settings.lowStockPercent} onChange={(event) => setSettings({ ...settings, lowStockPercent: Number(event.target.value) })}/></label><label><span>Cash variance ₹</span><input type="number" min="0" value={settings.varianceThreshold} onChange={(event) => setSettings({ ...settings, varianceThreshold: Number(event.target.value) })}/></label><label><span>Summary hour</span><input type="number" min="0" max="23" value={settings.dailySummaryHour} onChange={(event) => setSettings({ ...settings, dailySummaryHour: Number(event.target.value) })}/></label></div>
      <div className="admin-whatsapp-action"><button className="secondary small" disabled={saving} onClick={() => void save()}><Save size={14}/>{saving ? "Saving…" : "Save WhatsApp setup"}</button>{message && <small>{message}</small>}</div>
    </div>
  </details>;
}

function CustomerActivation({ customer, onSaved }: { customer: PlatformCustomer; onSaved(): Promise<void> }) {
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
      <CustomerWhatsAppSettings customer={customer}/>
    </div>
    <div className="activation-action">
      {customer.subscriptionActivatedAt || customer.lifetimeAccessPaidAt || customer.intelligenceEnabledAt ? <em><BadgeCheck /> {customer.subscriptionPlan === "CORE_INTELLIGENCE" || customer.intelligenceEnabledAt ? "Intelligence active" : "Core active"}</em> : <em className="pending">Awaiting approval</em>}
      <button className="secondary small" disabled={!changed || saving} onClick={() => void save()}><Save size={14} />{saving ? "Saving…" : paymentConfirmed ? "Approve access" : "Save selection"}</button>{message && <small>{message}</small>}
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
  const [data, setData] = useState<DemoLeadsBootstrap | null>(null);
  const [accounts, setAccounts] = useState<PlatformCustomersBootstrap | null>(null);
  const [tickets, setTickets] = useState<PlatformServiceTicket[] | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const loadAccounts = async () => setAccounts(await api.platformCustomers());
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
  return <main className="page leads-page">
    <section className="leads-hero"><div><span className="eyebrow">Growth desk</span><h1>Customers & enquiries</h1><p>Follow new signups from first interest to verified setup and lifetime activation.</p></div><Sparkles/></section>
    {error && <div className="form-error">{error}</div>}
    <section className="leads-stats three"><article><Users/><span><small>Registered customers</small><b>{accounts.customers.length}</b></span></article><article><BadgeCheck/><span><small>Paid plans active</small><b>{active}</b></span></article><article><Sparkles/><span><small>Demo enquiries</small><b>{unique}</b></span></article></section>
    <section className="leads-list service-ticket-list"><header><div><span className="eyebrow">Customer service</span><h2>Service tickets</h2><p>Issues submitted from customer Help pages, newest first.</p></div><small>{tickets.filter((ticket) => ticket.status !== "RESOLVED").length} open</small></header>{tickets.length ? tickets.map((ticket) => <ServiceTicketCard key={`${ticket.id}-${ticket.updatedAt}`} ticket={ticket} onSaved={loadTickets}/>) : <div className="leads-empty"><LifeBuoy/><h2>No service tickets</h2></div>}</section>
    <section className="leads-list customer-list"><header><div><span className="eyebrow">Customer activation</span><h2>Registered FuelNerve accounts</h2><p>Select the customer’s exact plan and billing choice. Approve access only after independently verifying payment.</p></div><small>Latest 250 accounts</small></header>{accounts.customers.length ? accounts.customers.map((customer) => <CustomerActivation key={`${customer.id}-${customer.subscriptionUpdatedAt}`} customer={customer} onSaved={loadAccounts} />) : <div className="leads-empty"><Building2/><h2>No customer signups yet</h2></div>}</section>
    <section className="leads-list"><header><div><span className="eyebrow">Follow-up list</span><h2>Recent demo visitors</h2></div><small>Latest 250 sessions</small></header>{data.leads.length ? data.leads.map((lead) => { const email = lead.kind === "EMAIL"; return <article key={lead.id}><span className={email ? "lead-kind email" : "lead-kind phone"}>{email ? <Mail/> : <Phone/>}</span><div><strong>{lead.contact}</strong><small>Started {dateTime(lead.createdAt)} · Demo ends {dateTime(lead.expiresAt)}</small></div><button className="secondary small" onClick={() => void copy(lead.contact)}><Clipboard size={14}/>{copied === lead.contact ? "Copied" : "Copy"}</button></article>; }) : <div className="leads-empty"><Users/><h2>No demo enquiries yet</h2><p>When someone starts a demo, it will appear here.</p></div>}</section>
  </main>;
}
