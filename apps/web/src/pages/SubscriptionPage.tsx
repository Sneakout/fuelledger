import {
  BadgeCheck,
  Building2,
  CalendarDays,
  Check,
  DatabaseBackup,
  Headphones,
  IndianRupee,
  LockKeyhole,
  Phone,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import { useStation } from "../components/StationProvider";

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
const monthlyRate = (count: number) =>
  count >= 6 ? 1099 : count >= 3 ? 1299 : 1499;
const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

export function SubscriptionPage() {
  const { user } = useAuth();
  const { stations } = useStation();
  if (user?.role !== "OWNER")
    return (
      <main className="page">
        <div className="form-error">
          Only the owner can manage the FuelLedger subscription.
        </div>
      </main>
    );
  const count = Math.max(stations.length, 1);
  const rate = monthlyRate(count);
  return (
    <main className="page subscription-page">
      <section className="subscription-hero">
        <div>
          <span className="eyebrow">FuelLedger subscription</span>
          <h1>
            One complete plan.
            <br />
            Every petrol pump under control.
          </h1>
          <p>
            All operational, reconciliation and accounting safeguards are
            included. Nothing essential is hidden behind a higher plan.
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
            <span className="plan-status">Launch pricing</span>
          </header>
          <div className="price-choice">
            <div>
              <small>Pay monthly</small>
              <b>{money(rate)}</b>
              <span>per petrol pump / month</span>
            </div>
            <div className="featured-price">
              <small>Pay annually</small>
              <b>{money(14999)}</b>
              <span>per petrol pump / year</span>
              <em>About 2 months free</em>
            </div>
          </div>
          <div className="launch-offer">
            <Sparkles />
            <span>
              <small>Early-adopter first year</small>
              <b>{money(11999)} per petrol pump</b>
              <p>
                Includes assisted setup. Renewal moves to the standard annual
                price.
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
            <a
              className="primary subscription-contact"
              href="tel:+918977506454"
            >
              <Phone /> Contact us · 89775 06454
            </a>
            <p>
              Prices exclude applicable GST. No transaction fee is charged by
              FuelLedger.
            </p>
          </footer>
        </article>
        <aside className="billing-summary">
          <span className="eyebrow">Your estimate</span>
          <h2>
            {count} {count === 1 ? "petrol pump" : "petrol pumps"}
          </h2>
          <div className="estimate">
            <Building2 />
            <span>
              <small>Monthly rate per pump</small>
              <b>{money(rate)}</b>
            </span>
          </div>
          <div className="estimate">
            <IndianRupee />
            <span>
              <small>Estimated monthly subscription</small>
              <b>{money(rate * count)}</b>
            </span>
          </div>
          <div className="estimate total">
            <CalendarDays />
            <span>
              <small>Standard annual total</small>
              <b>{money(14999 * count)}</b>
            </span>
          </div>
          <p>
            The final checkout will show GST and the complete payable amount
            before payment.
          </p>
        </aside>
      </section>
      <section className="subscription-promises">
        <article>
          <BadgeCheck />
          <div>
            <b>14-day business trial</b>
            <p>Use your own petrol-pump data without entering a card.</p>
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
            <p>Included with the early-adopter annual offer.</p>
          </div>
        </article>
      </section>
      <section className="volume-pricing">
        <header>
          <span className="eyebrow">Multi-pump pricing</span>
          <h2>Lower price as your network grows</h2>
        </header>
        <div>
          <span>
            <b>1–2 petrol pumps</b>
            <em>{money(1499)} each / month</em>
          </span>
          <span>
            <b>3–5 petrol pumps</b>
            <em>{money(1299)} each / month</em>
          </span>
          <span>
            <b>6–10 petrol pumps</b>
            <em>{money(1099)} each / month</em>
          </span>
          <span>
            <b>More than 10</b>
            <em>Custom pricing</em>
          </span>
        </div>
      </section>
    </main>
  );
}
