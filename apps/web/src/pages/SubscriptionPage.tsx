import { ArrowRight, BadgeCheck, Check, ChevronDown, CircleHelp, Layers3, MessageSquareText, Phone, ShieldCheck, Sparkles } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { api, type SubscriptionStatus } from "../lib/api";

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
const groups = [
  { name: "Run your fuel station", rows: ["Shifts, nozzle readings & attendant assignments", "Tank stock, deliveries, dips & testing", "Cash, UPI & card reconciliation", "Lubricant inventory & sales", "Non-fuel revenue (NFR) · retail products & services"] },
  { name: "Keep your accounts clear", rows: ["Customers, credit & fleet accounts", "Supplier invoices & payments", "Expenses, staff salaries & profit reports", "Stock & collection difference visibility", "Staff permissions, audit history & data exports"] },
  { name: "Understand what needs attention", intelligence: true, rows: ["Daily owner briefings", "AI explanations of unusual sales, stock & collections", "Ask questions about your business"] },
];
const faqs = [
  ["Is Core a monthly subscription?", "No. The existing Core offer is ₹2,000 for assisted setup with the first month included, followed by ₹24,000 for lifetime access per fuel station. That is ₹26,000 in total, excluding applicable GST. Fuel Intelligence is a separate optional recurring service."],
  ["What is non-fuel revenue?", "NFR covers sales of lubricants, shop products and services configured in the app. These sales form part of your existing sales records; they should not be entered again as extra revenue."],
  ["What does Fuel Intelligence include?", "The early-access offer covers daily owner briefings, explanations of unusual activity and 25 owner questions per month. Contact us to confirm availability before subscribing. It requires Core; it does not replace your stock and accounting records."],
  ["What happens after the founding offer?", "The published founding offer is ₹7,999 for the first year, subject to availability for the first 50 fuel stations. It renews at ₹11,999 per year. Applicable GST is additional."],
  ["How do I activate or change my plan?", "Contact our team to confirm your fuel stations, applicable taxes and activation details. Your existing purchase terms remain unchanged. This page does not charge you or change your plan automatically."],
];

export function SubscriptionPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [annual, setAnnual] = useState(true);
  useEffect(() => {
    if (user?.role !== "OWNER") return;
    let active = true;
    setLoading(true); setError(false);
    void api.subscription().then((value) => { if (active) setStatus(value); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, user?.role, attempt]);
  if (user?.role !== "OWNER") return <main className="page"><div className="form-error">Only the owner can manage the subscription.</div></main>;
  const lifetime = Boolean(status?.lifetimeAccessPaidAt);
  const stateLabel = loading ? "Checking your plan…" : error ? "Plan status unavailable" : lifetime ? "Core · Lifetime active" : status?.setupFeePaidAt ? "Core · Setup paid" : "Core · Awaiting activation";
  const paidAt = status?.lifetimeAccessPaidAt || status?.setupFeePaidAt;
  return <main className="page subscription-page">
    <section className="sp-hero">
      <div className="sp-orbit" aria-hidden="true"><Sparkles /></div>
      <span className="sp-kicker">YOUR SUBSCRIPTION</span>
      <h1>Control today.<br /><span>See what’s next.</span></h1>
      <p>Reliable fuel-station operations. A clearer view of your business with Fuel Intelligence.</p>
      <a href="#plan-comparison" className="sp-hero-link">Compare your plans <ArrowRight size={17} /></a>
    </section>

    <section className="sp-account" aria-label="Current subscription" aria-live="polite">
      <span className="sp-icon"><ShieldCheck /></span>
      <div><small>YOUR CURRENT ACCESS</small><h2>{stateLabel}</h2>
        <p>{loading ? "Retrieving your subscription details." : error ? "We couldn’t load your access details. Please try again." : paidAt ? `Payment confirmed ${new Date(paidAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.` : "Contact our team to set up your fuel station."}</p>
      </div>
      {error ? <button type="button" className="sp-button sp-secondary" onClick={() => setAttempt((value) => value + 1)}>Retry</button> : <a className="sp-button sp-secondary" href="tel:+918977506454"><Phone size={16} /> Plan support</a>}
    </section>

    <section id="plan-comparison" className="sp-comparison">
      <header className="sp-section-heading"><div><span className="sp-kicker">ONE FOUNDATION. TWO WAYS FORWARD.</span><h2>Choose your level of insight</h2><p>All prices are per fuel station, excluding applicable GST.</p></div>
        <div className="sp-billing"><span>Intelligence billing</span><div role="group" aria-label="Fuel Intelligence billing period"><button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)}>Monthly</button><button type="button" aria-pressed={annual} onClick={() => setAnnual(true)}>Yearly</button></div></div>
      </header>
      <div className="sp-table-scroll" role="region" aria-label="Plan comparison, scroll horizontally on smaller screens" tabIndex={0}>
        <table className="sp-table">
          <caption className="sp-sr-only">Core and Core plus Fuel Intelligence features and prices. Fuel Intelligence features are early access.</caption>
          <thead><tr><th scope="col" className="sp-feature-heading"><Layers3 /><h3>Everything connected.</h3><p>Stock, sales and money in one place.</p><span className="sp-caption">✓ Included · — Not included</span></th>
            <th scope="col"><span className="sp-plan-eyebrow">YOUR DAILY FOUNDATION</span><h3>Core</h3><p>Run every shift with clarity.</p><div className="sp-price">{money(24000)}</div><span className="sp-price-term">One-time lifetime access</span><p className="sp-setup">+ {money(2000)} assisted setup<br />First month included · {money(26000)} total</p>{!loading && !error && lifetime ? <span className="sp-button sp-current"><BadgeCheck size={17} /> Current plan</span> : <a className="sp-button sp-secondary" href="tel:+918977506454">Discuss Core <ArrowRight size={16} /></a>}</th>
            <th scope="col" className="sp-intelligence-col"><span className="sp-plan-eyebrow"><Sparkles size={14} /> EARLY ACCESS</span><h3>Core +<br />Fuel Intelligence</h3><p>Your numbers, explained.</p><div className="sp-price">{money(annual ? 11999 : 1199)}<small>/{annual ? "year" : "month"}</small></div><span className="sp-price-term">Optional service, additional to Core</span><p className="sp-setup">{annual ? "Billed yearly · Save ₹2,389 vs monthly" : "Billed monthly · ₹14,388 over 12 months"}<br />25 owner questions each month</p><a className="sp-button sp-primary" href="https://wa.me/918977506454?text=Hi%2C%20I%27m%20interested%20in%20Fuel%20Intelligence%20early%20access." target="_blank" rel="noreferrer">Enquire about early access <ArrowRight size={16} /></a></th>
          </tr></thead>
          <tbody>{groups.map((group) => <Fragment key={group.name}><tr className="sp-group"><th scope="rowgroup" colSpan={3}>{group.name}{group.intelligence && <span>Early access</span>}</th></tr>{group.rows.map((row, index) => <tr key={row}><th scope="row">{row}</th><td>{group.intelligence ? <span aria-label="Not included">—</span> : <Check aria-label="Included" />}</td><td className="sp-intelligence-col">{group.intelligence ? <span className="sp-access-label">{index === 2 ? "25 / month · Early access" : "Early access"}</span> : <Check aria-label="Included" />}</td></tr>)}</Fragment>)}</tbody>
        </table>
      </div>
      <div className="sp-table-note"><ShieldCheck size={18} /><span>Accurate stock, essential difference checks and account permissions belong in every plan.</span></div>
    </section>

    <section className="sp-preview-section">
      <div className="sp-preview-copy"><span className="sp-kicker"><Sparkles size={15} /> FUEL INTELLIGENCE</span><h2>Less searching.<br />More understanding.</h2><p>An owner assistant that helps you understand the records behind your day. Ask a question, review the explanation and check the supporting entries.</p><span className="sp-preview-tag">Illustrative preview · Early access</span></div>
      <article className="sp-preview-card"><header><span className="sp-icon"><MessageSquareText /></span><div><b>Owner Assistant</b><small>A clearer view of your fuel station</small></div></header><div className="sp-question">Why is today’s collection lower than sales?</div><p>Some sales may be on customer credit or fleet accounts. Review that split alongside cash, UPI and card collections before treating the difference as a shortage.</p><div className="sp-source-tags"><span>Shift collections</span><span>Customer balances</span></div><small className="sp-example-note">Example explanation. No live account data is shown here.</small></article>
    </section>

    <section className="sp-founding"><Sparkles /><div><small>FOUNDING FUEL STATION OFFER</small><h3>{money(7999)} for your first year of Fuel Intelligence</h3><p>For the first 50 fuel stations, subject to availability. Renews at {money(11999)}/year. Core and GST additional.</p></div><a href="tel:+918977506454">Check availability <ArrowRight size={17} /></a></section>
    <section className="sp-faq"><div><span className="sp-kicker">THE DETAILS, MADE SIMPLE</span><h2>Good to know</h2><p>Clear terms before you choose.</p><a href="tel:+918977506454"><CircleHelp size={17} /> Talk to us · 89775 06454</a></div><div>{faqs.map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={17} /></summary><p>{answer}</p></details>)}</div></section>
  </main>;
}
