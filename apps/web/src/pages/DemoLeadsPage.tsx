import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Building2, Clipboard, Mail, Phone, Save, Sparkles, Users } from "lucide-react";
import { ApiRequestError, api, type DemoLeadsBootstrap, type PlatformCustomer, type PlatformCustomersBootstrap, type SubscriptionBillingPeriod, type SubscriptionPlan } from "../lib/api";
import { useAuth } from "../components/AuthProvider";

const dateTime = (value: string) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

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
    </div>
    <div className="activation-action">
      {customer.subscriptionActivatedAt || customer.lifetimeAccessPaidAt || customer.intelligenceEnabledAt ? <em><BadgeCheck /> {customer.subscriptionPlan === "CORE_INTELLIGENCE" || customer.intelligenceEnabledAt ? "Intelligence active" : "Core active"}</em> : <em className="pending">Awaiting approval</em>}
      <button className="secondary small" disabled={!changed || saving} onClick={() => void save()}><Save size={14} />{saving ? "Saving…" : paymentConfirmed ? "Approve access" : "Save selection"}</button>{message && <small>{message}</small>}
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
  const active = accounts?.customers.filter((customer) => customer.subscriptionActivatedAt || customer.lifetimeAccessPaidAt || customer.intelligenceEnabledAt).length ?? 0;
  async function copy(contact: string) { await navigator.clipboard.writeText(contact); setCopied(contact); window.setTimeout(() => setCopied(""), 1800); }
  if (!user?.isPlatformAdmin) return <main className="page"><div className="form-error">This area is restricted to the FuelNerve team.</div></main>;
  if (!data || !accounts) return <main className="page"><div className="loading"><span/><p>Loading growth desk…</p></div>{error && <div className="form-error">{error}</div>}</main>;
  return <main className="page leads-page">
    <section className="leads-hero"><div><span className="eyebrow">Growth desk</span><h1>Customers & enquiries</h1><p>Follow new signups from first interest to verified setup and lifetime activation.</p></div><Sparkles/></section>
    {error && <div className="form-error">{error}</div>}
    <section className="leads-stats three"><article><Users/><span><small>Registered customers</small><b>{accounts.customers.length}</b></span></article><article><BadgeCheck/><span><small>Paid plans active</small><b>{active}</b></span></article><article><Sparkles/><span><small>Demo enquiries</small><b>{unique}</b></span></article></section>
    <section className="leads-list customer-list"><header><div><span className="eyebrow">Customer activation</span><h2>Registered FuelNerve accounts</h2><p>Select the customer’s exact plan and billing choice. Approve access only after independently verifying payment.</p></div><small>Latest 250 accounts</small></header>{accounts.customers.length ? accounts.customers.map((customer) => <CustomerActivation key={`${customer.id}-${customer.subscriptionUpdatedAt}`} customer={customer} onSaved={loadAccounts} />) : <div className="leads-empty"><Building2/><h2>No customer signups yet</h2></div>}</section>
    <section className="leads-list"><header><div><span className="eyebrow">Follow-up list</span><h2>Recent demo visitors</h2></div><small>Latest 250 sessions</small></header>{data.leads.length ? data.leads.map((lead) => { const email = lead.kind === "EMAIL"; return <article key={lead.id}><span className={email ? "lead-kind email" : "lead-kind phone"}>{email ? <Mail/> : <Phone/>}</span><div><strong>{lead.contact}</strong><small>Started {dateTime(lead.createdAt)} · Demo ends {dateTime(lead.expiresAt)}</small></div><button className="secondary small" onClick={() => void copy(lead.contact)}><Clipboard size={14}/>{copied === lead.contact ? "Copied" : "Copy"}</button></article>; }) : <div className="leads-empty"><Users/><h2>No demo enquiries yet</h2><p>When someone starts a demo, it will appear here.</p></div>}</section>
  </main>;
}
