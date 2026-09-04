import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Banknote,
  CircleEllipsis,
  CreditCard,
  LockKeyhole,
  ReceiptText,
  Smartphone,
  UsersRound,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  ApiRequestError,
  api,
  type ReconciliationBootstrap,
  type ReconciliationShift,
} from "../lib/api";

const methods = ["CASH", "UPI", "CARD", "CREDIT", "FLEET", "OTHER"] as const;
type Method = (typeof methods)[number];
const labels: Record<Method, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  CREDIT: "Credit",
  FLEET: "Fleet",
  OTHER: "Other",
};
const icons = {
  CASH: Banknote,
  UPI: Smartphone,
  CARD: CreditCard,
  CREDIT: ReceiptText,
  FLEET: UsersRound,
  OTHER: CircleEllipsis,
};
const money = (value: number | string) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value));
type Row = {
  paymentMethod: Method;
  allocationAmount: number;
  actualAmount: number;
};
type CreditAllocation = {
  paymentMethod: "CREDIT" | "FLEET";
  customerId: string;
  vehicleId: string;
  amount: number;
};

export function ReconciliationPage() {
  const [data, setData] = useState<ReconciliationBootstrap | null>(null);
  const [shiftId, setShiftId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [creditAllocations, setCreditAllocations] = useState<
    CreditAllocation[]
  >([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const load = () =>
    api
      .reconciliationBootstrap()
      .then((result) => {
        setData(result);
        const next =
          result.shifts.find((s) => s.status === "RECONCILIATION_REQUIRED") ??
          result.shifts[0];
        if (next && !shiftId) choose(next);
      })
      .catch((e) =>
        setError(
          e instanceof ApiRequestError
            ? e.message
            : "Unable to load reconciliation.",
        ),
      );
  useEffect(() => {
    void load();
  }, []);
  const shift = data?.shifts.find((item) => item.id === shiftId);
  function choose(next: ReconciliationShift) {
    setShiftId(next.id);
    setRows(
      methods.map((paymentMethod) => {
        const saved = next.reconciliation?.collections.find(
          (row) => row.paymentMethod === paymentMethod,
        );
        return {
          paymentMethod,
          allocationAmount: saved
            ? Number(saved.expectedAmount) + Number(saved.adjustmentAmount)
            : Number(next.allocatedExpected[paymentMethod] ?? 0),
          actualAmount: saved
            ? Number(saved.actualAmount)
            : Number(next.suggestedActual[paymentMethod] ?? 0),
        };
      }),
    );
    setCreditAllocations(
      next.reconciliation?.creditAllocations.map((row) => ({
        paymentMethod: row.paymentMethod,
        customerId: row.customer.id,
        vehicleId: row.vehicle?.id ?? "",
        amount: Number(row.amount),
      })) ?? [],
    );
    setNotes(next.reconciliation?.notes ?? "");
    setError("");
  }
  function update(
    method: Method,
    field: "allocationAmount" | "actualAmount",
    value: string,
  ) {
    setRows((current) =>
      current.map((row) =>
        row.paymentMethod === method
          ? { ...row, [field]: value === "" ? 0 : Number(value) }
          : row,
      ),
    );
  }
  const totals = useMemo(
    () =>
      rows.reduce(
        (t, row) => ({
          allocated: t.allocated + Number(row.allocationAmount),
          actual: t.actual + Number(row.actualAmount),
        }),
        { allocated: 0, actual: 0 },
      ),
    [rows],
  );
  const salesTotal = Number(shift?.salesTotal ?? 0);
  const unallocated = salesTotal - totals.allocated;
  const customerAllocationComplete = (["CREDIT", "FLEET"] as const).every(
    (method) =>
      Math.abs(
        Number(
          rows.find((row) => row.paymentMethod === method)?.allocationAmount ??
            0,
        ) -
          creditAllocations
            .filter((row) => row.paymentMethod === method)
            .reduce((sum, row) => sum + Number(row.amount), 0),
      ) < 0.01,
  );
  const fullyAllocated =
    Math.abs(unallocated) < 0.01 &&
    customerAllocationComplete &&
    creditAllocations.every((allocation) => allocation.customerId && allocation.amount > 0);
  async function lock() {
    if (!shift || !fullyAllocated) return;
    setSaving(true);
    setError("");
    try {
      await api.reconcileShift(shift.id, {
        collections: rows.map((row) => ({
          paymentMethod: row.paymentMethod,
          actualAmount: row.actualAmount,
          adjustmentAmount:
            row.allocationAmount -
            Number(shift.expected[row.paymentMethod] ?? 0),
          adjustmentReason: null,
        })),
        creditAllocations: creditAllocations.map((row) => ({
          ...row,
          vehicleId: row.vehicleId || null,
        })),
        notes: notes || undefined,
      });
      const result = await api.reconciliationBootstrap();
      setData(result);
      const saved = result.shifts.find((item) => item.id === shift.id);
      if (saved) choose(saved);
    } catch (e) {
      setError(
        e instanceof ApiRequestError
          ? e.message
          : "Unable to reconcile this shift.",
      );
    } finally {
      setSaving(false);
    }
  }
  if (!data)
    return (
      <main className="page">
        <div className="loading">
          <span />
          <p>Preparing shift reconciliation…</p>
        </div>
      </main>
    );
  if (!data.shifts.length)
    return (
      <main className="page">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Cash & shift reconciliation</span>
            <h1>No shifts are waiting for review</h1>
            <p>
              Close a shift first. Its sales will appear here automatically.
            </p>
          </div>
        </div>
        <section className="sales-empty">
          <span>
            <BadgeCheck />
          </span>
          <h2>Everything is clear</h2>
          <p>There are no closed shifts to reconcile yet.</p>
          <Link className="primary small" to="/operations">
            Go to operations
          </Link>
        </section>
      </main>
    );
  const locked = shift?.status === "LOCKED";
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Shift reconciliation</span>
          <h1>Reconcile shift</h1>
          <p>Review the payment split and confirm the collections.</p>
        </div>
        <span className={`shift-status ${locked ? "ready" : "open"}`}>
          {locked ? <LockKeyhole size={15} /> : <ReceiptText size={15} />}{" "}
          {locked ? "Locked" : "Needs review"}
        </span>
      </div>
      {error && <div className="form-error">{error}</div>}
      <section className="cash-recon-layout">
        <aside className="shift-queue">
          <div>
            <span className="eyebrow">Shift queue</span>
            <h2>Closed shifts</h2>
          </div>
          {data.shifts.map((item) => (
            <button
              key={item.id}
              onClick={() => choose(item)}
              className={item.id === shiftId ? "selected" : ""}
            >
              <span>
                <strong>
                  #{item.shiftNumber} · {item.station.name}
                </strong>
                <small>
                  {new Date(item.closedAt!).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </small>
              </span>
              <b className={item.status === "LOCKED" ? "locked" : "pending"}>
                {item.status === "LOCKED" ? "Locked" : "Review"}
              </b>
            </button>
          ))}
        </aside>
        {shift && (
          <section className="collection-workspace allocation-workspace">
            <div className="collection-heading">
              <div>
                <span className="eyebrow">Shift #{shift.shiftNumber}</span>
                <h2>{shift.station.name}</h2>
                <p>
                  Manager: {shift.manager.name} · Sales are calculated from
                  closing meter readings.
                </p>
              </div>
              {locked && (
                <div className="lock-proof">
                  <LockKeyhole size={18} />
                  <span>
                    <b>Reconciled & locked</b>
                    <small>By {shift.reconciliation?.reconciledBy.name}</small>
                  </span>
                </div>
              )}
            </div>
            <div
              className={`allocation-progress ${fullyAllocated ? "complete" : ""}`}
            >
              <span>
                <small>Shift sales</small>
                <strong>{money(salesTotal)}</strong>
              </span>
              <span>
                <small>Allocated</small>
                <strong>{money(totals.allocated)}</strong>
              </span>
              <span>
                <small>
                  {fullyAllocated ? "Allocation complete" : "Still to allocate"}
                </small>
                <strong>{fullyAllocated ? "Ready" : money(unallocated)}</strong>
              </span>
            </div>
            <div className="allocation-columns">
              <span>Payment method</span>
              <span>Allocated sales (₹)</span>
              <span>Confirmed amount (₹)</span>
              <span>Difference (₹)</span>
            </div>
            {rows.map((row) => {
              const Icon = icons[row.paymentMethod];
              const difference =
                Number(row.actualAmount) - Number(row.allocationAmount);
              return (
                <article
                  className="collection-row allocation-row"
                  key={row.paymentMethod}
                >
                  <div className="collection-method">
                    <span>
                      <Icon size={17} />
                    </span>
                    <strong>{labels[row.paymentMethod]}</strong>
                  </div>
                  <label>
                    <input
                      aria-label={`${labels[row.paymentMethod]} allocated sales`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.allocationAmount || ""}
                      placeholder="0.00"
                      disabled={locked}
                      onChange={(e) =>
                        update(
                          row.paymentMethod,
                          "allocationAmount",
                          e.target.value,
                        )
                      }
                    />
                  </label>
                  <label>
                    <input
                      aria-label={`${labels[row.paymentMethod]} confirmed amount`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.actualAmount || ""}
                      placeholder="0.00"
                      disabled={locked}
                      onChange={(e) =>
                        update(
                          row.paymentMethod,
                          "actualAmount",
                          e.target.value,
                        )
                      }
                    />
                  </label>
                  <b
                    className={
                      Math.abs(difference) < 0.01 ? "balanced" : "unbalanced"
                    }
                  >
                    {Math.abs(difference) < 0.01 ? "Match" : money(difference)}
                  </b>
                </article>
              );
            })}
            <CreditAllocationEditor
              rows={rows}
              allocations={creditAllocations}
              customers={data.customers}
              locked={locked}
              onChange={setCreditAllocations}
            />
            <div className="allocation-total">
              <span>Shift total</span>
              <strong>{money(totals.allocated)} allocated</strong>
              <strong>{money(totals.actual)} confirmed</strong>
              <b
                className={
                  Math.abs(totals.actual - totals.allocated) < 0.01
                    ? "balanced"
                    : "unbalanced"
                }
              >
                {Math.abs(totals.actual - totals.allocated) < 0.01
                  ? "Collections match"
                  : `${money(totals.actual - totals.allocated)} difference`}
              </b>
            </div>
            <label className="field reconciliation-note">
              <span>Reconciliation note (optional)</span>
              <input
                value={notes}
                disabled={locked}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything the owner or accountant should know"
              />
            </label>
            {!locked && (
              <div className="lock-action">
                <div>
                  <LockKeyhole size={20} />
                  <span>
                    <strong>
                      {fullyAllocated
                        ? "Ready to lock"
                        : "Finish allocating sales"}
                    </strong>
                    <small>
                      {fullyAllocated
                        ? "Locking preserves this payment split and posts it to accounting."
                        : `${money(Math.abs(unallocated))} ${unallocated > 0 ? "is still unallocated." : "has been over-allocated."}`}
                    </small>
                  </span>
                </div>
                <button
                  className="primary small"
                  disabled={saving || !fullyAllocated}
                  onClick={() => void lock()}
                >
                  {saving ? "Locking…" : "Reconcile & lock shift"}
                </button>
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

function CreditAllocationEditor({rows,allocations,customers,locked,onChange}:{rows:Row[];allocations:CreditAllocation[];customers:ReconciliationBootstrap['customers'];locked:boolean;onChange:(rows:CreditAllocation[])=>void}) {
  return <>{(['CREDIT','FLEET'] as const).map(method=>{const required=Number(rows.find(row=>row.paymentMethod===method)?.allocationAmount??0);if(required<=0&&!allocations.some(row=>row.paymentMethod===method))return null;const assigned=allocations.filter(row=>row.paymentMethod===method).reduce((sum,row)=>sum+Number(row.amount),0);const available=customers.filter(customer=>customer.type===method);return <section className="credit-allocation" key={method}><header><div><span className="eyebrow">{method==='CREDIT'?'Credit customers':'Fleet accounts'}</span><h3>Who owes this amount?</h3></div><strong className={Math.abs(required-assigned)<.01?'balanced':'unbalanced'}>{money(assigned)} of {money(required)} assigned</strong></header>{allocations.map((allocation,index)=>allocation.paymentMethod===method&&<div className="credit-allocation-row" key={`${method}-${index}`}><label className="field"><span>Customer</span><select disabled={locked} value={allocation.customerId} onChange={e=>onChange(allocations.map((row,i)=>i===index?{...row,customerId:e.target.value,vehicleId:''}:row))}><option value="">Choose customer</option>{available.map(customer=><option value={customer.id} key={customer.id}>{customer.name} · {money(customer.outstanding)} due</option>)}</select></label>{method==='FLEET'&&<label className="field"><span>Vehicle (optional)</span><select disabled={locked||!allocation.customerId} value={allocation.vehicleId} onChange={e=>onChange(allocations.map((row,i)=>i===index?{...row,vehicleId:e.target.value}:row))}><option value="">No vehicle</option>{available.find(customer=>customer.id===allocation.customerId)?.vehicles.map(vehicle=><option value={vehicle.id} key={vehicle.id}>{vehicle.number}{vehicle.label?` · ${vehicle.label}`:''}</option>)}</select></label>}<label className="field"><span>Amount (₹)</span><input disabled={locked} type="number" min="0.01" step="0.01" value={allocation.amount||''} placeholder="0.00" onChange={e=>onChange(allocations.map((row,i)=>i===index?{...row,amount:Number(e.target.value)}:row))}/></label>{!locked&&<button className="text-button" type="button" onClick={()=>onChange(allocations.filter((_,i)=>i!==index))}>Remove</button>}</div>)}{!locked&&<button className="secondary small" type="button" disabled={!available.length} onClick={()=>onChange([...allocations,{paymentMethod:method,customerId:'',vehicleId:'',amount:Math.max(0,required-assigned)}])}>Add {method==='CREDIT'?'customer':'fleet account'}</button>}{!available.length&&<p className="allocation-help">Create an active {method==='CREDIT'?'credit customer':'fleet account'} in Customers before locking this shift.</p>}</section>})}</>;
}
