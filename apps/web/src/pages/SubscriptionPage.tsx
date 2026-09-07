import { ArrowRight, ArrowUpRight, BadgeCheck, BanknoteArrowDown, Bot, Boxes, Check, ChevronDown, CircleDot, CircleHelp, Gauge, Layers3, MessageSquareText, Phone, ReceiptText, ShieldCheck, Sparkles, TrendingUp, TriangleAlert, UsersRound } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { api, type SubscriptionStatus } from "../lib/api";

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
const groups = [
  { name: "Run your fuel station", rows: ["Shifts, nozzle readings & attendant assignments", "Tank stock, deliveries, dips & testing", "Cash, UPI & card reconciliation", "Lubricant inventory & sales", "Non-fuel revenue (NFR) · retail products & services"] },
  { name: "Keep your accounts clear", rows: ["Customers, credit & fleet accounts", "Supplier invoices & payments", "Expenses, staff salaries & profit reports", "Stock & collection difference visibility", "Staff permissions, audit history & data exports"] },
  { name: "Your FuelNerve Intelligence agents", intelligence: true, rows: ["Shift Review Agent · checks closing and collection differences", "Stock Watch Agent · tracks tank risks, receipts and unusual movement", "Credit Agent · prioritises dues and prepares reminder drafts", "Purchase Check Agent · checks invoice rates, quantities and duplicates", "Profit Insight Agent · explains fuel margin, expenses and NFR", "Owner Assistant · answers questions with supporting records"] },
];
const agents = [
  { icon: Gauge, name: "Shift Review", copy: "Reviews closed shifts, cash handovers, payment methods and unexplained differences." },
  { icon: Boxes, name: "Stock Watch", copy: "Watches MS, HSD and lubricants, then flags stock risk and unusual tank movement." },
  { icon: UsersRound, name: "Credit Follow-up", copy: "Prioritises overdue customers and prepares clear, account-specific reminder drafts." },
  { icon: ReceiptText, name: "Purchase Check", copy: "Checks invoice rates, quantities, duplicates and receipt timing before errors spread." },
  { icon: TrendingUp, name: "Profit Insight", copy: "Explains margin changes across fuel, lubricants, NFR and operating expenses." },
  { icon: MessageSquareText, name: "Owner Assistant", copy: "Answers plain-language questions and links each explanation to supporting records." },
];
const faqs = [
  ["Can I pay monthly for Core?", "Yes. Core is ₹699 per month. The annual plan is ₹5,988, equivalent to ₹499 per month, and lifetime access is ₹24,000. Assisted setup is optional at ₹2,000. All prices are per fuel station, excluding applicable GST."],
  ["What is non-fuel revenue?", "NFR covers sales of lubricants, shop products and services configured in the app. These sales form part of your existing sales records; they should not be entered again as extra revenue."],
  ["What does FuelNerve Intelligence include?", "The early-access vision includes six specialised assistants for shift review, stock watch, customer credit, purchase checks, profit insight and owner questions. Availability may be phased by capability. Contact us to confirm what is currently active before subscribing."],
  ["What happens after the founding offer?", "The Core + FuelNerve Intelligence founding offer is ₹11,999 for the first year, subject to availability for the first 50 fuel stations. It renews at ₹14,999 per year. Applicable GST is additional."],
  ["How do I activate or change my plan?", "Contact our team to confirm your fuel stations, applicable taxes and activation details. Your existing purchase terms remain unchanged. This page does not charge you or change your plan automatically."],
];

export function SubscriptionPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [annual, setAnnual] = useState(true);
  const [coreBilling, setCoreBilling] = useState<"monthly" | "yearly" | "lifetime">("yearly");
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
      <h1>Your fuel station.<br /><span>Six agents watching the details.</span></h1>
      <p>FuelNerve Intelligence turns trusted station records into daily reviews, early warnings and clear actions for the owner.</p>
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
        <div className="sp-billing"><span>Intelligence billing</span><div role="group" aria-label="FuelNerve Intelligence billing period"><button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)}>Monthly</button><button type="button" aria-pressed={annual} onClick={() => setAnnual(true)}>Yearly</button></div></div>
      </header>
      <div className="sp-table-scroll" role="region" aria-label="Plan comparison, scroll horizontally on smaller screens" tabIndex={0}>
        <table className="sp-table">
          <caption className="sp-sr-only">Core and Core plus FuelNerve Intelligence features and prices. FuelNerve Intelligence features are early access.</caption>
          <thead><tr><th scope="col" className="sp-feature-heading"><Layers3 /><h3>Everything connected.</h3><p>Stock, sales and money in one place.</p><span className="sp-caption">✓ Included · — Not included</span></th>
            <th scope="col"><span className="sp-plan-eyebrow">YOUR DAILY FOUNDATION</span><h3>Core</h3><p>Run every shift with clarity.</p><div className="sp-core-options" role="group" aria-label="Core billing period"><button type="button" aria-pressed={coreBilling === "monthly"} onClick={() => setCoreBilling("monthly")}>Monthly</button><button type="button" aria-pressed={coreBilling === "yearly"} onClick={() => setCoreBilling("yearly")}>Yearly <em>Best value</em></button><button type="button" aria-pressed={coreBilling === "lifetime"} onClick={() => setCoreBilling("lifetime")}>Lifetime</button></div><div className="sp-price">{money(coreBilling === "monthly" ? 699 : coreBilling === "yearly" ? 5988 : 24000)}{coreBilling !== "lifetime" && <small>/{coreBilling === "monthly" ? "month" : "year"}</small>}</div><span className="sp-price-term">{coreBilling === "monthly" ? "Pay month to month" : coreBilling === "yearly" ? "₹499/month · billed yearly" : "One-time lifetime access"}</span><p className="sp-setup">Assisted setup is optional · {money(2000)}<br />Per fuel station · GST additional</p>{!loading && !error && lifetime ? <span className="sp-button sp-current"><BadgeCheck size={17} /> Current plan</span> : <a className="sp-button sp-secondary" href="tel:+918977506454">Choose Core <ArrowRight size={16} /></a>}</th>
            <th scope="col" className="sp-intelligence-col"><span className="sp-plan-eyebrow"><Bot size={14} /> AGENT AI · EARLY ACCESS</span><h3>Core +<br />FuelNerve Intelligence</h3><p>Core plus specialised agents for stock, money and daily decisions.</p><div className="sp-price">{money(annual ? 14999 : 1499)}<small>/{annual ? "year" : "month"}</small></div><span className="sp-price-term">Complete bundled plan</span><p className="sp-setup">{annual ? "Billed yearly · Save ₹2,989 vs monthly" : "Flexible monthly billing · ₹17,988 over 12 months"}<br />Six agent capabilities · phased early access</p><a className="sp-button sp-primary" href="https://wa.me/918977506454?text=Hi%2C%20I%27m%20interested%20in%20Fuel%20Intelligence%20early%20access." target="_blank" rel="noreferrer">Enquire about early access <ArrowRight size={16} /></a></th>
          </tr></thead>
          <tbody>{groups.map((group) => <Fragment key={group.name}><tr className="sp-group"><th scope="rowgroup" colSpan={3}>{group.name}{group.intelligence && <span>Agent AI · Early access</span>}</th></tr>{group.rows.map((row) => <tr key={row}><th scope="row">{row}</th><td>{group.intelligence ? <span aria-label="Not included">—</span> : <Check aria-label="Included" />}</td><td className="sp-intelligence-col">{group.intelligence ? <span className="sp-access-label">Agent · Early access</span> : <Check aria-label="Included" />}</td></tr>)}</Fragment>)}</tbody>
        </table>
      </div>
      <div className="sp-table-note"><ShieldCheck size={18} /><span>Accurate stock, essential difference checks and account permissions belong in every plan.</span></div>
    </section>

    <section className="sp-intelligence-story" aria-labelledby="intelligence-story-title">
      <div className="sp-intelligence-story-copy">
        <span className="sp-kicker"><Sparkles size={14} /> OWNER INTELLIGENCE</span>
        <h2 id="intelligence-story-title">Know the story<br /><span>behind the numbers.</span></h2>
        <p>FuelNerve uses AI and machine learning to turn the day&apos;s operations into a clear owner briefing. It surfaces patterns, flags unusual movement and helps you ask better questions before a small issue becomes a costly one.</p>
        <ul>
          <li><Check /> Daily business health summary</li>
          <li><Check /> Sales, stock and collection anomalies</li>
          <li><Check /> Actionable attention prompts</li>
        </ul>
      </div>
      <article className="sp-daily-brief" aria-label="Illustrative FuelNerve Intelligence daily brief">
        <header><span>FUELNERVE INTELLIGENCE</span><b><i /> DAILY BRIEF</b></header>
        <p className="sp-brief-station">GREENWAY FUEL POINT · 01 SEP</p>
        <h3>Your outlet is <span>healthy today.</span></h3>
        <div className="sp-brief-signal sp-brief-positive"><span><ArrowUpRight /></span><p><b>Sales are 8.4% above</b> your 7-day average, led by HSD volume.</p></div>
        <div className="sp-brief-signal sp-brief-warning"><span><TriangleAlert /></span><p><b>Collection gap needs review.</b> One shift remains open after the expected close time.</p></div>
        <div className="sp-brief-signal"><span><CircleDot /></span><p><b>MS Tank 1 is trending low.</b> Plan the next replenishment before tomorrow evening.</p></div>
        <footer><span>3 signals reviewed</span><b>Open daily brief <ArrowRight /></b></footer>
      </article>
    </section>

    <section className="sp-agent-section">
      <header><span className="sp-kicker"><Bot size={15} /> YOUR AGENT TEAM</span><h2>Always reviewing. Ready when you ask.</h2><p>Each agent has one clear job and works from the records already inside your fuel station account.</p><span>Agent capabilities are in phased early access.</span></header>
      <div className="sp-agent-grid">{agents.map(({ icon: Icon, name, copy }, index) => <article key={name}><div className="sp-agent-top"><span className="sp-agent-icon"><Icon /></span><em>0{index + 1}</em></div><h3>{name}<small> Agent</small></h3><p>{copy}</p><div className="sp-agent-state"><i /> Early access</div></article>)}</div>
      <div className="sp-agent-flow"><span><BanknoteArrowDown /> Trusted station records</span><ArrowRight /><span><Bot /> Specialist agents review</span><ArrowRight /><span><BadgeCheck /> Owner gets clear actions</span></div>
    </section>

    <section className="sp-preview-section">
      <div className="sp-preview-copy"><span className="sp-kicker"><Sparkles size={15} /> FUELNERVE INTELLIGENCE</span><h2>Ask the business.<br />See the evidence.</h2><p>Ask a plain-language question, review the explanation and open the supporting shift, invoice, tank or customer records.</p><span className="sp-preview-tag">Illustrative preview · Early access</span></div>
      <article className="sp-preview-card"><header><span className="sp-icon"><MessageSquareText /></span><div><b>Owner Assistant</b><small>A clearer view of your fuel station</small></div></header><div className="sp-question">Why is today’s collection lower than sales?</div><p>Some sales may be on customer credit or fleet accounts. Review that split alongside cash, UPI and card collections before treating the difference as a shortage.</p><div className="sp-source-tags"><span>Shift collections</span><span>Customer balances</span></div><small className="sp-example-note">Example explanation. No live account data is shown here.</small></article>
    </section>

    <section className="sp-founding"><Sparkles /><div><small>FOUNDING FUEL STATION OFFER</small><h3>{money(11999)} for your first year of Core + FuelNerve Intelligence</h3><p>For the first 50 fuel stations, subject to availability. Renews at {money(14999)}/year. GST additional.</p></div><a href="tel:+918977506454">Check availability <ArrowRight size={17} /></a></section>
    <section className="sp-faq"><div><span className="sp-kicker">THE DETAILS, MADE SIMPLE</span><h2>Good to know</h2><p>Clear terms before you choose.</p><a href="tel:+918977506454"><CircleHelp size={17} /> Talk to us · 89775 06454</a></div><div>{faqs.map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={17} /></summary><p>{answer}</p></details>)}</div></section>
  </main>;
}
