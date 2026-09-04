import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  FileText,
  IndianRupee,
  PackageCheck,
  Plus,
  Truck,
  X,
} from "lucide-react";
import {
  api,
  ApiRequestError,
  type InvoicePricePreview,
  type PurchaseInvoice,
  type PurchasesBootstrap,
  type PurchaseStation,
} from "../lib/api";
const money = (v: number | string) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(v));
export const invoiceBalanceDisplay = (
  invoice: Pick<PurchaseInvoice, "totalAmount" | "outstanding">,
) => {
  const total = Number(invoice.totalAmount);
  const outstanding = Math.max(0, Number(invoice.outstanding));
  const paid = Math.max(0, total - outstanding);
  if (outstanding === 0) return { amount: total, detail: "Paid in full" };
  if (paid > 0)
    return {
      amount: outstanding,
      detail: `${money(paid)} paid · ${money(total)} total`,
    };
  return { amount: outstanding, detail: "Amount due" };
};
export const onlyCompatibleTankId = (
  stations: PurchaseStation[],
  stationId: string,
  productId: string,
) => {
  if (!productId) return "";
  const tanks =
    stations
      .find((station) => station.id === stationId)
      ?.configurations[0]?.tanks.filter(
        (tank) => tank.productId === productId,
      ) ?? [];
  return tanks.length === 1 ? tanks[0]!.id : "";
};
export const dueDateFromInvoiceDate = (
  invoiceDate: string,
  paymentTerms: number,
) => {
  const date = new Date(`${invoiceDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return invoiceDate;
  date.setDate(date.getDate() + Math.max(0, Math.trunc(paymentTerms)));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const iso = (date: string) => new Date(`${date}T00:00:00`).toISOString();
const today = () => new Date().toISOString().slice(0, 10);
async function attachment(file: File | null) {
  if (!file) return null;
  if (file.size > 500000)
    throw new Error("Attachments must be 500 KB or smaller.");
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Unable to read attachment."));
    reader.readAsDataURL(file);
  });
  return {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    contentBase64,
  };
}
type Mode = "supplier" | "invoice" | "edit-invoice" | "payment" | null;
type Line = {
  productId: string;
  tankId: string;
  description: string;
  quantity: number;
  unitCost: number;
  taxRate: number;
  hsnCode: string;
};
const emptyLine = (): Line => ({
  productId: "",
  tankId: "",
  description: "",
  quantity: 1,
  unitCost: 0,
  taxRate: 0,
  hsnCode: "",
});
const supplierCodeFromName = (name: string) =>
  name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
export function PurchasesPage() {
  const [data, setData] = useState<PurchasesBootstrap | null>(null),
    [mode, setMode] = useState<Mode>(null),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [file, setFile] = useState<File | null>(null);
  const [supplier, setSupplier] = useState({
    name: "",
    code: "",
    phone: "",
    email: "",
    taxId: "",
    address: "",
    paymentTerms: 30,
    active: true,
  });
  const [invoice, setInvoice] = useState({
    stationId: "",
    supplierId: "",
    invoiceNumber: "",
    invoiceDate: today(),
    dueDate: today(),
    taxAmount: 0,
    invoiceTotal: "",
    notes: "",
    receiveNow: true,
    paidNow: false,
    paymentMethod: "UPI" as "CASH" | "UPI" | "CARD" | "OTHER",
    paymentReferenceNo: "",
  });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [editingInvoice, setEditingInvoice] = useState<PurchaseInvoice | null>(
    null,
  );
  const [pricePreview, setPricePreview] = useState<InvoicePricePreview | null>(
    null,
  );
  const [payment, setPayment] = useState({
    stationId: "",
    invoiceId: "",
    amount: 0,
    paymentMethod: "UPI" as "CASH" | "UPI" | "CARD" | "OTHER",
    referenceNo: "",
  });
  const load = async () => {
    const result = await api.purchasesBootstrap();
    setData(result);
    setInvoice((x) => {
      const supplierId = x.supplierId || result.suppliers[0]?.id || "";
      const terms =
        result.suppliers.find((item) => item.id === supplierId)?.paymentTerms ??
        0;
      return {
        ...x,
        stationId: x.stationId || result.stations[0]?.id || "",
        supplierId,
        dueDate: dueDateFromInvoiceDate(x.invoiceDate, terms),
      };
    });
    setPayment((x) => ({
      ...x,
      stationId: x.stationId || result.stations[0]?.id || "",
    }));
  };
  useEffect(() => {
    void load().catch(() => setError("Unable to load purchases."));
  }, []);
  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
    [lines],
  );
  const calculatedTax = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const product = data?.products.find(
          (item) => item.id === line.productId,
        );
        const amount = line.quantity * line.unitCost;
        return (
          sum +
          (product && product.category !== "FUEL"
            ? (amount * Number(product.taxCategory?.rate ?? 0)) / 100
            : 0)
        );
      }, 0),
    [data, lines],
  );
  async function saveSupplier() {
    const name = supplier.name.trim();
    if (!name) {
      setError("Enter the supplier name before saving.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.createSupplier({
        ...supplier,
        name,
        code: supplierCodeFromName(name),
      });
      setMode(null);
      setSupplier({ ...supplier, name: "", code: "" });
      await load();
    } catch (e) {
      setError(
        e instanceof ApiRequestError ? e.message : "Unable to create supplier.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function saveInvoice() {
    setSaving(true);
    setError("");
    try {
      if (editingInvoice) {
        await api.updatePurchaseInvoice(editingInvoice.id, {
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: iso(invoice.invoiceDate),
          dueDate: iso(invoice.dueDate),
          notes: invoice.notes || undefined,
          refreshPrices: Boolean(pricePreview),
          markPaid: invoice.paidNow,
          paymentMethod: invoice.paidNow ? invoice.paymentMethod : undefined,
          paymentReferenceNo:
            invoice.paidNow && invoice.paymentReferenceNo
              ? invoice.paymentReferenceNo
              : undefined,
        });
        setMode(null);
        setEditingInvoice(null);
        setPricePreview(null);
        await load();
        return;
      }
      await api.createPurchaseInvoice({
        ...invoice,
        invoiceTotal: invoice.invoiceTotal
          ? Number(invoice.invoiceTotal)
          : undefined,
        taxAmount: invoice.invoiceTotal
          ? Math.max(0, Number(invoice.invoiceTotal) - subtotal)
          : calculatedTax,
        invoiceDate: iso(invoice.invoiceDate),
        dueDate: iso(invoice.dueDate),
        notes: invoice.notes || undefined,
        attachment: await attachment(file),
        lines: lines.map((x) => {
          const product = data?.products.find(
            (item) => item.id === x.productId,
          );
          return {
            ...x,
            quantity: x.quantity,
            taxRate:
              product?.category === "FUEL"
                ? 0
                : Number(product?.taxCategory?.rate ?? 0),
            hsnCode: x.hsnCode || product?.hsnCode || undefined,
            productId: x.productId || null,
            tankId: x.tankId || null,
          };
        }),
      });
      setMode(null);
      setFile(null);
      setInvoice((x) => ({
        ...x,
        invoiceNumber: "",
        invoiceDate: today(),
        dueDate: dueDateFromInvoiceDate(
          today(),
          data?.suppliers.find((item) => item.id === x.supplierId)
            ?.paymentTerms ?? 0,
        ),
        taxAmount: 0,
        notes: "",
        paidNow: false,
        paymentReferenceNo: "",
      }));
      setLines([emptyLine()]);
      await load();
    } catch (e) {
      setError(
        e instanceof ApiRequestError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Unable to create invoice.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function pay() {
    setSaving(true);
    setError("");
    try {
      await api.paySupplierInvoice({
        ...payment,
        referenceNo: payment.referenceNo || undefined,
      });
      setMode(null);
      await load();
    } catch (e) {
      setError(
        e instanceof ApiRequestError ? e.message : "Unable to record payment.",
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
          <p>Preparing purchasing…</p>
        </div>
      </main>
    );
  const open = data.invoices.filter(
    (x) => x.outstanding > 0 && x.status !== "VOID",
  );
  const editingPaid =
    editingInvoice?.payments.reduce(
      (sum, row) => sum + Number(row.amount),
      0,
    ) ?? 0;
  const editingOutstanding = Math.max(
    0,
    (pricePreview?.totalAmount ?? Number(editingInvoice?.totalAmount ?? 0)) -
      editingPaid,
  );
  const displayedTax =
    mode === "edit-invoice"
      ? (pricePreview?.taxAmount ?? Number(editingInvoice?.taxAmount ?? 0))
      : calculatedTax;
  return (
    <main className="page purchases-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Purchases & payables</span>
          <h1>From supplier invoice to stock, without gaps</h1>
          <p>
            Track what arrived, what is due, and the document behind every
            purchase.
          </p>
        </div>
        <div className="heading-actions">
          <button className="secondary" onClick={() => setMode("supplier")}>
            <Truck size={16} /> Supplier
          </button>
          <button
            className="primary small"
            onClick={() => setMode("invoice")}
            disabled={!data.suppliers.length}
          >
            <Plus size={16} /> Purchase invoice
          </button>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <section className="purchase-stats">
        <div>
          <span>
            <IndianRupee />
          </span>
          <b>{money(data.summary.payables)}</b>
          <small>Total payable</small>
        </div>
        <div>
          <span>
            <AlertTriangle />
          </span>
          <b>{money(data.summary.overdue)}</b>
          <small>Overdue</small>
        </div>
        <div>
          <span>
            <Truck />
          </span>
          <b>{data.suppliers.length}</b>
          <small>Suppliers</small>
        </div>
        <div>
          <span>
            <PackageCheck />
          </span>
          <b>{data.invoices.filter((x) => x.receipt).length}</b>
          <small>Stock received</small>
        </div>
      </section>
      {!data.suppliers.length ? (
        <section className="sales-empty">
          <span>
            <Truck />
          </span>
          <h2>Add a supplier first</h2>
          <p>
            Supplier terms set the default due date and make every payable easy
            to trace.
          </p>
          <button className="primary small" onClick={() => setMode("supplier")}>
            <Plus size={16} /> Add supplier
          </button>
        </section>
      ) : (
        <section className="purchase-layout">
          <div className="invoice-list">
            <div className="history-head">
              <div>
                <span className="eyebrow">Purchase invoices</span>
                <h2>Invoices & due dates</h2>
              </div>
              <span>{data.invoices.length} invoices</span>
            </div>
            {data.invoices.map((item) => {
              const balance = invoiceBalanceDisplay(item);
              return (
                <article key={item.id}>
                  <span className="invoice-icon">
                    <FileText />
                  </span>
                  <div>
                    <strong>
                      {item.supplier.name} · {item.invoiceNumber}
                    </strong>
                    <small>
                      {item.station.name} · Invoice{" "}
                      {new Date(item.invoiceDate).toLocaleDateString("en-IN", {
                        dateStyle: "medium",
                      })}{" "}
                      · Due{" "}
                      {new Date(item.dueDate).toLocaleDateString("en-IN", {
                        dateStyle: "medium",
                      })}
                    </small>
                    <span className="invoice-tags">
                      <i>{item.receipt ? "Stock received" : "Invoice only"}</i>
                      {item.attachments.map((a) => (
                        <a
                          key={a.id}
                          href={`/api/purchases/attachments/${a.id}`}
                          target="_blank"
                        >
                          {a.fileName}
                        </a>
                      ))}
                    </span>
                  </div>
                  <div className="invoice-balance">
                    <b>{money(balance.amount)}</b>
                    <small>{balance.detail}</small>
                    <em className={item.status.toLowerCase()}>
                      {item.outstanding === 0
                        ? "PAID"
                        : item.overdue
                          ? "OVERDUE"
                          : item.status.replace("_", " ")}
                    </em>
                  </div>
                  <div className="invoice-actions">
                    {item.outstanding > 0 && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setPayment({
                            ...payment,
                            invoiceId: item.id,
                            stationId: item.station.id,
                            amount: item.outstanding,
                          });
                          setMode("payment");
                        }}
                      >
                        Pay
                      </button>
                    )}
                    <button
                      className="text-button"
                      onClick={() => {
                        setEditingInvoice(item);
                        setPricePreview(null);
                        setInvoice((current) => ({
                          ...current,
                          stationId: item.station.id,
                          supplierId: item.supplier.id,
                          invoiceNumber: item.invoiceNumber,
                          invoiceDate: item.invoiceDate.slice(0, 10),
                          dueDate: item.dueDate.slice(0, 10),
                          notes: item.notes ?? "",
                          receiveNow: Boolean(item.receipt),
                          paidNow: false,
                          paymentReferenceNo: "",
                        }));
                        setMode("edit-invoice");
                      }}
                    >
                      View / Edit
                    </button>
                  </div>
                </article>
              );
            })}
            {!data.invoices.length && (
              <p className="history-empty">No purchase invoices yet.</p>
            )}
          </div>
          <aside className="supplier-panel">
            <span className="eyebrow">Supplier directory</span>
            <h2>Trusted vendors</h2>
            {data.suppliers.map((s) => (
              <div key={s.id}>
                <span className="customer-avatar">
                  {s.name.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.code} · {s.paymentTerms} day terms
                  </small>
                </span>
              </div>
            ))}
          </aside>
        </section>
      )}
      {mode && (
        <div className="product-modal">
          <section className="product-editor purchase-modal">
            <button className="modal-close" onClick={() => setMode(null)}>
              <X size={17} />
            </button>
            {mode === "supplier" ? (
              <>
                <span className="eyebrow">Supplier master</span>
                <h2>Add supplier</h2>
                <div className="form-grid">
                  <label className="field">
                    <span>Name</span>
                    <input
                      value={supplier.name}
                      onChange={(e) =>
                        setSupplier({ ...supplier, name: e.target.value })
                      }
                    />
                  </label>
                  <div className="field">
                    <span>Supplier code</span>
                    <div className="field-note">
                      Generated automatically from the supplier name.
                    </div>
                  </div>
                  <label className="field">
                    <span>Phone</span>
                    <input
                      value={supplier.phone}
                      onChange={(e) =>
                        setSupplier({ ...supplier, phone: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Payment terms (days)</span>
                    <input
                      type="number"
                      min="0"
                      value={supplier.paymentTerms}
                      onChange={(e) =>
                        setSupplier({
                          ...supplier,
                          paymentTerms: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
                <div className="editor-footer">
                  <button className="secondary" onClick={() => setMode(null)}>
                    Cancel
                  </button>
                  <button
                    className="primary small"
                    disabled={saving}
                    onClick={() => void saveSupplier()}
                  >
                    Save supplier
                  </button>
                </div>
              </>
            ) : mode === "payment" ? (
              <>
                <span className="eyebrow">Payable settlement</span>
                <h2>Record supplier payment</h2>
                <div className="form-grid">
                  <label className="field">
                    <span>Amount</span>
                    <input
                      type="number"
                      min="0.01"
                      value={payment.amount}
                      onChange={(e) =>
                        setPayment({
                          ...payment,
                          amount: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Method</span>
                    <select
                      value={payment.paymentMethod}
                      onChange={(e) =>
                        setPayment({
                          ...payment,
                          paymentMethod: e.target
                            .value as typeof payment.paymentMethod,
                        })
                      }
                    >
                      {["CASH", "UPI", "CARD", "OTHER"].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Reference</span>
                    <input
                      value={payment.referenceNo}
                      onChange={(e) =>
                        setPayment({ ...payment, referenceNo: e.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="editor-footer">
                  <button className="secondary" onClick={() => setMode(null)}>
                    Cancel
                  </button>
                  <button
                    className="primary small"
                    disabled={saving}
                    onClick={() => void pay()}
                  >
                    Record payment
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="eyebrow">
                  {mode === "edit-invoice"
                    ? "Edit purchase invoice"
                    : "New purchase"}
                </span>
                <h2>
                  {mode === "edit-invoice"
                    ? "Update invoice details"
                    : "Purchase invoice"}
                </h2>
                {mode === "edit-invoice" && (
                  <p className="invoice-edit-note">
                    Quantities stay fixed to protect received stock. Use Refresh
                    prices to fetch the latest purchase prices from Products,
                    review the new total, and then save.
                  </p>
                )}
                <div className="form-grid">
                  <label className="field">
                    <span>Supplier</span>
                    <select
                      value={invoice.supplierId}
                      disabled={mode === "edit-invoice"}
                      onChange={(e) => {
                        const supplierId = e.target.value;
                        const terms =
                          data.suppliers.find((item) => item.id === supplierId)
                            ?.paymentTerms ?? 0;
                        setInvoice({
                          ...invoice,
                          supplierId,
                          dueDate: dueDateFromInvoiceDate(
                            invoice.invoiceDate,
                            terms,
                          ),
                        });
                      }}
                    >
                      {data.suppliers.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Station</span>
                    <select
                      value={invoice.stationId}
                      disabled={mode === "edit-invoice"}
                      onChange={(e) => {
                        const stationId = e.target.value;
                        setInvoice({ ...invoice, stationId });
                        setLines((current) =>
                          current.map((line) => ({
                            ...line,
                            tankId: onlyCompatibleTankId(
                              data.stations,
                              stationId,
                              line.productId,
                            ),
                          })),
                        );
                      }}
                    >
                      {data.stations.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Invoice number</span>
                    <input
                      value={invoice.invoiceNumber}
                      onChange={(e) =>
                        setInvoice({
                          ...invoice,
                          invoiceNumber: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Invoice date</span>
                    <input
                      type="date"
                      value={invoice.invoiceDate}
                      onChange={(e) => {
                        const invoiceDate = e.target.value;
                        const terms =
                          data.suppliers.find(
                            (item) => item.id === invoice.supplierId,
                          )?.paymentTerms ?? 0;
                        setInvoice({
                          ...invoice,
                          invoiceDate,
                          dueDate: dueDateFromInvoiceDate(invoiceDate, terms),
                        });
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>Due date (calculated automatically)</span>
                    <input type="date" value={invoice.dueDate} readOnly />
                  </label>
                  <label className="field">
                    <span>Supplier invoice total (optional override)</span>
                    <input
                      type="number"
                      min="0"
                      disabled={mode === "edit-invoice"}
                      placeholder={String(Math.round(subtotal + calculatedTax))}
                      value={invoice.invoiceTotal}
                      onChange={(e) =>
                        setInvoice({
                          ...invoice,
                          invoiceTotal: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Notes (optional)</span>
                    <input
                      value={invoice.notes}
                      onChange={(e) =>
                        setInvoice({ ...invoice, notes: e.target.value })
                      }
                    />
                  </label>
                </div>
                {mode === "edit-invoice" ? (
                  <div className="invoice-locked-summary">
                    <div>
                      <span>
                        {pricePreview
                          ? "Refreshed invoice total"
                          : "Saved invoice total"}
                      </span>
                      <strong>
                        {money(
                          pricePreview?.totalAmount ??
                            editingInvoice?.totalAmount ??
                            0,
                        )}
                      </strong>
                    </div>
                    <button
                      className="secondary small"
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        if (!editingInvoice) return;
                        setSaving(true);
                        setError("");
                        void api
                          .purchaseInvoicePricePreview(editingInvoice.id)
                          .then(setPricePreview)
                          .catch((e) =>
                            setError(
                              e instanceof ApiRequestError
                                ? e.message
                                : "Unable to refresh product prices.",
                            ),
                          )
                          .finally(() => setSaving(false));
                      }}
                    >
                      Refresh prices
                    </button>
                    {pricePreview && (
                      <div className="invoice-price-preview">
                        {pricePreview.lines.map((line) => (
                          <small key={line.id}>
                            {line.productName}:{" "}
                            {line.quantity.toLocaleString("en-IN")} ×{" "}
                            {money(line.previousUnitCost)}
                            {line.previousUnitCost !== line.unitCost && (
                              <> → {money(line.unitCost)}</>
                            )}
                          </small>
                        ))}
                        <b>
                          Latest prices loaded. They will be applied only when
                          you save changes.
                        </b>
                        {editingInvoice?.status === "PAID" && (
                          <b>
                            This cash-and-carry invoice will remain paid in
                            full; its opening payment will update to the
                            refreshed total.
                          </b>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="invoice-lines">
                    <h3>Invoice lines</h3>
                    {lines.map((line, index) => {
                      const product = data.products.find(
                        (x) => x.id === line.productId,
                      );
                      const tanks =
                        data.stations
                          .find((x) => x.id === invoice.stationId)
                          ?.configurations[0]?.tanks.filter(
                            (x) => x.productId === line.productId,
                          ) ?? [];
                      return (
                        <div className="invoice-line" key={index}>
                          <label className="invoice-line-field">
                            <span>Product</span>
                            <select
                              aria-label={`Product ${index + 1}`}
                              value={line.productId}
                              onChange={(e) => {
                                const productId = e.target.value;
                                const p = data.products.find(
                                  (x) => x.id === productId,
                                );
                                setLines(
                                  lines.map((x, i) =>
                                    i === index
                                      ? {
                                          ...x,
                                          productId,
                                          tankId: onlyCompatibleTankId(
                                            data.stations,
                                            invoice.stationId,
                                            productId,
                                          ),
                                          description: p?.name ?? "",
                                          unitCost: Number(
                                            p?.purchasePrice ?? 0,
                                          ),
                                          hsnCode: p?.hsnCode ?? "",
                                        }
                                      : x,
                                  ),
                                );
                              }}
                            >
                              <option value="">Choose product</option>
                              {data.products.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          {product?.tankLinked ? (
                            <label className="invoice-line-field">
                              <span>Tank</span>
                              <select
                                aria-label={`Tank ${index + 1}`}
                                value={line.tankId}
                                onChange={(e) =>
                                  setLines(
                                    lines.map((x, i) =>
                                      i === index
                                        ? { ...x, tankId: e.target.value }
                                        : x,
                                    ),
                                  )
                                }
                              >
                                <option value="">Tank</option>
                                {tanks.map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.code}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : (
                            <span className="invoice-line-spacer" />
                          )}
                          <label className="invoice-line-field">
                            <span>
                              {product?.category === "FUEL"
                                ? "Quantity (L)"
                                : `Quantity (${product?.unit ?? "units"})`}
                            </span>
                            <input
                              aria-label={`${product?.category === "FUEL" ? "Quantity in litres" : "Quantity"} ${index + 1}`}
                              title={
                                product?.category === "FUEL"
                                  ? "Quantity (litres)"
                                  : `Quantity (${product?.unit ?? "units"})`
                              }
                              placeholder={
                                product?.category === "FUEL"
                                  ? "Litres"
                                  : "Quantity"
                              }
                              type="number"
                              min=".001"
                              step=".001"
                              value={line.quantity}
                              onChange={(e) =>
                                setLines(
                                  lines.map((x, i) =>
                                    i === index
                                      ? {
                                          ...x,
                                          quantity: Number(e.target.value),
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </label>
                          <label className="invoice-line-field">
                            <span>
                              {product?.category === "FUEL"
                                ? "Rate / L (₹)"
                                : "Rate / unit (₹)"}
                            </span>
                            <input
                              aria-label={`Rate per ${product?.category === "FUEL" ? "litre" : "unit"} ${index + 1}`}
                              title={
                                product?.category === "FUEL"
                                  ? "Purchase price (₹ per litre)"
                                  : "Purchase price per unit"
                              }
                              placeholder="Rate"
                              type="number"
                              min="0"
                              step=".01"
                              value={line.unitCost}
                              onChange={(e) =>
                                setLines(
                                  lines.map((x, i) =>
                                    i === index
                                      ? {
                                          ...x,
                                          unitCost: Number(e.target.value),
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </label>
                          <label className="invoice-line-field">
                            <span>HSN code</span>
                            <input
                              aria-label={`HSN code ${index + 1}`}
                              title="HSN code"
                              placeholder="HSN code"
                              value={line.hsnCode}
                              onChange={(e) =>
                                setLines(
                                  lines.map((x, i) =>
                                    i === index
                                      ? { ...x, hsnCode: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </label>
                          {lines.length > 1 && (
                            <button
                              onClick={() =>
                                setLines(lines.filter((_, i) => i !== index))
                              }
                            >
                              ×
                            </button>
                          )}
                          <small className="invoice-line-calculation">
                            {product?.category === "FUEL"
                              ? `${line.quantity.toLocaleString("en-IN")} L`
                              : `${line.quantity.toLocaleString("en-IN")} ${product?.unit ?? "units"}`}
                            {" × "}
                            {money(line.unitCost)} ={" "}
                            {money(line.quantity * line.unitCost)}
                          </small>
                        </div>
                      );
                    })}
                    <button
                      className="text-button"
                      onClick={() => setLines([...lines, emptyLine()])}
                    >
                      <Plus size={14} /> Add line
                    </button>
                  </div>
                )}
                <div className="invoice-options">
                  {mode !== "edit-invoice" && (
                    <>
                      <label className="invoice-check">
                        <input
                          type="checkbox"
                          checked={invoice.receiveNow}
                          onChange={(e) =>
                            setInvoice({
                              ...invoice,
                              receiveNow: e.target.checked,
                            })
                          }
                        />{" "}
                        Receive stock now
                      </label>
                      <label className="invoice-check">
                        <input
                          type="checkbox"
                          checked={invoice.paidNow}
                          onChange={(e) =>
                            setInvoice({
                              ...invoice,
                              paidNow: e.target.checked,
                            })
                          }
                        />{" "}
                        Paid in full already
                      </label>
                      {invoice.paidNow && (
                        <>
                          <label className="field">
                            <span>Paid by</span>
                            <select
                              value={invoice.paymentMethod}
                              onChange={(e) =>
                                setInvoice({
                                  ...invoice,
                                  paymentMethod: e.target
                                    .value as typeof invoice.paymentMethod,
                                })
                              }
                            >
                              {["CASH", "UPI", "CARD", "OTHER"].map(
                                (method) => (
                                  <option key={method}>{method}</option>
                                ),
                              )}
                            </select>
                          </label>
                          <label className="field">
                            <span>Payment reference (optional)</span>
                            <input
                              value={invoice.paymentReferenceNo}
                              onChange={(e) =>
                                setInvoice({
                                  ...invoice,
                                  paymentReferenceNo: e.target.value,
                                })
                              }
                            />
                          </label>
                        </>
                      )}
                      <label className="field">
                        <span>Attachment (max 500 KB)</span>
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                        />
                      </label>
                    </>
                  )}
                  {mode === "edit-invoice" && editingOutstanding > 0 && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          checked={invoice.paidNow}
                          onChange={(e) =>
                            setInvoice({
                              ...invoice,
                              paidNow: e.target.checked,
                            })
                          }
                        />{" "}
                        Mark remaining {money(editingOutstanding)} as fully paid
                      </label>
                      {invoice.paidNow && (
                        <>
                          <label className="field">
                            <span>Paid by</span>
                            <select
                              value={invoice.paymentMethod}
                              onChange={(e) =>
                                setInvoice({
                                  ...invoice,
                                  paymentMethod: e.target
                                    .value as typeof invoice.paymentMethod,
                                })
                              }
                            >
                              {["CASH", "UPI", "CARD", "OTHER"].map(
                                (method) => (
                                  <option key={method}>{method}</option>
                                ),
                              )}
                            </select>
                          </label>
                          <label className="field">
                            <span>Payment reference (optional)</span>
                            <input
                              value={invoice.paymentReferenceNo}
                              onChange={(e) =>
                                setInvoice({
                                  ...invoice,
                                  paymentReferenceNo: e.target.value,
                                })
                              }
                            />
                          </label>
                        </>
                      )}
                    </>
                  )}
                  <div className="invoice-total-summary">
                    <span>
                      Lines{" "}
                      {money(
                        mode === "edit-invoice"
                          ? (pricePreview?.subtotal ??
                              Number(editingInvoice?.subtotal ?? 0))
                          : subtotal,
                      )}
                    </span>
                    {displayedTax > 0 && <span>Tax {money(displayedTax)}</span>}
                    <strong>
                      Total{" "}
                      {money(
                        mode === "edit-invoice"
                          ? (pricePreview?.totalAmount ??
                              Number(editingInvoice?.totalAmount ?? 0))
                          : invoice.invoiceTotal
                            ? Number(invoice.invoiceTotal)
                            : subtotal + calculatedTax,
                      )}
                    </strong>
                  </div>
                </div>
                <div className="editor-footer">
                  <button className="secondary" onClick={() => setMode(null)}>
                    Cancel
                  </button>
                  <button
                    className="primary small"
                    disabled={saving}
                    onClick={() => void saveInvoice()}
                  >
                    {saving
                      ? "Saving…"
                      : mode === "edit-invoice"
                        ? "Save changes"
                        : "Save invoice"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
