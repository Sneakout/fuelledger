import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  CalendarDays,
  Check,
  DatabaseBackup,
  Headphones,
  LockKeyhole,
  MessageSquareText,
  Phone,
  ScanSearch,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { api, type SubscriptionStatus } from "../lib/api";

const included = [
  "Shift, nozzle and attendant management",
  "Sales and collection reconciliation",
  "Tank stock, dips and density",
  "Customers, credit and fleet",
  "Purchases, expenses and salaries",
  "Double-entry accounting and reports",
  "Owner dashboard and multi-pump view",
  "Daily backups, exports and audit history",
];
const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

export function SubscriptionPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  useEffect(() => { if (user?.role === "OWNER") void api.subscription().then(setStatus); }, [user?.role]);
  if (user?.role !== "OWNER")
    return (
      <main className="page">
        <div className="form-error">
          Only the owner can manage the FuelLedger subscription.
        </div>
      </main>
    );
  return (
    <main className="page subscription-page">
      <section className="subscription-hero">
        <div>
          <span className="eyebrow">FuelLedger subscription</span>
          <h1>
            Start for {money(2000)}.
            <br />
            Your first month is free.
          </h1>
          <p>
            We set up your petrol pump and help you get started. After the free
            month, continue with lifetime access for just {money(24000)}.
          </p>
        </div>
        <span className="subscription-shield">
          <ShieldCheck />
        </span>
      </section>
      <section className="subscription-layout">
        <article className="plan-card">
          <header>
            <div>
              <span className="plan-mark">
                <Sparkles />
              </span>
              <div>
                <small>Recommended plan</small>
                <h2>FuelLedger Complete</h2>
              </div>
            </div>
            <span className={`plan-status ${status?.lifetimeAccessPaidAt ? "active" : ""}`}>
              {status?.lifetimeAccessPaidAt ? "Lifetime access active" : status?.setupFeePaidAt ? "Setup activated" : "Payment pending"}
            </span>
          </header>
          <div className="price-choice">
            <div>
              <small>First-time setup</small>
              <b>{money(2000)}</b>
              <span>per petrol pump</span>
              <em>1 month free</em>
            </div>
            <div className="featured-price">
              <small>Lifetime access</small>
              <b>{money(24000)}</b>
              <span>lifetime access per petrol pump</span>
              <em>One-time payment</em>
            </div>
          </div>
          <div className="launch-offer">
            <BadgeCheck />
            <span>
              <small>{status?.lifetimeAccessPaidAt ? "Plan activated" : "No recurring subscription"}</small>
              <b>{status?.lifetimeAccessPaidAt ? "FuelLedger Complete · Lifetime" : status?.setupFeePaidAt ? "Setup paid · First month active" : "Pay once. Use for life."}</b>
              <p>
                {status?.lifetimeAccessPaidAt ? "Your lifetime access payment is confirmed. There are no recurring platform fees." : "The setup fee includes assisted onboarding and your first month of full access."}
              </p>
            </span>
          </div>
          <div className="included-grid">
            {included.map((item) => (
              <span key={item}>
                <Check />
                {item}
              </span>
            ))}
          </div>
          <footer>
            {status?.lifetimeAccessPaidAt ? <div className="subscription-contact active"><BadgeCheck /> Lifetime plan active</div> : <a
              className="primary subscription-contact"
              href="tel:+918977506454"
            >
              <Phone /> Contact us · 89775 06454
            </a>}
            <p>
              Prices exclude applicable GST. No transaction fee is charged by
              FuelLedger.
            </p>
          </footer>
        </article>
        <aside className="billing-summary">
          <span className="eyebrow">How it works</span>
          <h2>Simple from day one</h2>
          <div className="estimate">
            <Sparkles />
            <span>
              <small>Step 1</small>
              <b>{money(2000)} assisted setup</b>
            </span>
          </div>
          <div className="estimate">
            <CalendarDays />
            <span>
              <small>Step 2</small>
              <b>Use FuelLedger free for 1 month</b>
            </span>
          </div>
          <div className="estimate total">
            <BadgeCheck />
            <span>
              <small>Step 3</small>
              <b>Just {money(24000)} for lifetime access</b>
            </span>
          </div>
          <p>
            Prices are per petrol pump. Applicable GST will be shown before
            payment.
          </p>
        </aside>
      </section>
      <section className="subscription-promises">
        <article>
          <BadgeCheck />
          <div>
            <b>One full month free</b>
            <p>Use every included feature with your own petrol-pump data.</p>
          </div>
        </article>
        <article>
          <DatabaseBackup />
          <div>
            <b>Your records stay protected</b>
            <p>
              Failed payment moves the account through grace and read-only
              periods—data is never suddenly removed.
            </p>
          </div>
        </article>
        <article>
          <LockKeyhole />
          <div>
            <b>Secure billing</b>
            <p>FuelLedger will never store card or UPI credentials.</p>
          </div>
        </article>
        <article>
          <Headphones />
          <div>
            <b>Assisted onboarding</b>
            <p>Included in the one-time setup fee.</p>
          </div>
        </article>
      </section>
      <section className="intelligence-offer">
        <div className="intelligence-copy">
          <span className="intelligence-kicker">
            <i /> A recurring AI service
          </span>
          <h2>
            FuelLedger
            <span> Intelligence.</span>
          </h2>
          <p>
            Turn each day’s operations into a clear owner briefing. FuelLedger
            Intelligence finds unusual movement, highlights what needs your
            attention and helps you ask better questions before a small issue
            becomes an expensive one.
          </p>
          <div className="intelligence-benefits">
            <article>
              <span>01</span>
              <Activity />
              <b>Daily business-health briefings</b>
            </article>
            <article>
              <span>02</span>
              <ScanSearch />
              <b>Sales, stock and collection anomaly alerts</b>
            </article>
            <article>
              <span>03</span>
              <MessageSquareText />
              <b>25 AI owner questions every month</b>
            </article>
          </div>
          <small>
            Requires FuelLedger Complete. GST applies where applicable.
          </small>
        </div>
        <article className="intelligence-card">
          <header>
            <span className="intelligence-mark">
              <BrainCircuit />
            </span>
            <div>
              <small>FuelLedger Intelligence</small>
              <b>AI owner briefings and actions</b>
            </div>
            <em>Early access</em>
          </header>
          <div className="intelligence-prices">
            <div>
              <small>Monthly</small>
              <b>{money(1199)}</b>
              <span>per petrol pump / month</span>
            </div>
            <div className="best-value">
              <small>Best value · Annual</small>
              <b>{money(11999)}</b>
              <span>per petrol pump / year</span>
              <em>Two months effectively free</em>
            </div>
          </div>
          <div className="founding-offer">
            <span>Founding petrol pump offer</span>
            <b>{money(7999)} for the first year</b>
            <p>
              Available to the first 50 petrol pumps. Renews at {money(11999)}
              /year.
            </p>
          </div>
          <a
            className="intelligence-action"
            href="https://wa.me/918977506454?text=Hi%2C%20I%27m%20interested%20in%20FuelLedger%20Intelligence%20early%20access."
            target="_blank"
            rel="noreferrer"
          >
            <span>Join Intelligence early access</span>
            <ArrowRight />
          </a>
          <p className="intelligence-note">
            Intelligence is an optional recurring service and is not included in
            the FuelLedger Complete lifetime fee.
          </p>
        </article>
      </section>
    </main>
  );
}
