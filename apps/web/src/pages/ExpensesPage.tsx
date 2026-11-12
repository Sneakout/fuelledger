import { useEffect, useState } from "react";
import {
  CalendarDays,
  FileText,
  FilterX,
  IndianRupee,
  Plus,
  ReceiptIndianRupee,
  Tags,
  UsersRound,
  X,
} from "lucide-react";
import { api, ApiRequestError, type PurchasesBootstrap } from "../lib/api";
import { indiaCalendarDateIso, indiaDate } from "../lib/india-time";

const money = (value: number | string) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value));
const today = () => indiaDate();
const iso = indiaCalendarDateIso;
const categoryCode = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40);
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

export function ExpensesPage() {
  const [data, setData] = useState<PurchasesBootstrap | null>(null);
  const [mode, setMode] = useState<"expense" | "category" | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [filterMonth, setFilterMonth] = useState("ALL");
  const [filterCategoryId, setFilterCategoryId] = useState("ALL");
  const [category, setCategory] = useState({ name: "", code: "" });
  const [form, setForm] = useState({
    stationId: "",
    categoryId: "",
    description: "",
    amount: 0,
    paymentMethod: "CASH" as "CASH" | "UPI" | "CARD" | "OTHER",
    incurredAt: today(),
    referenceNo: "",
    notes: "",
  });
  const load = async () => {
    const result = await api.purchasesBootstrap();
    setData(result);
    setForm((current) => ({
      ...current,
      stationId: current.stationId || result.stations[0]?.id || "",
      categoryId: current.categoryId || result.categories[0]?.id || "",
    }));
    return result;
  };
  useEffect(() => {
    void load().catch(() => setError("Unable to load expenses."));
  }, []);
  async function addCategory() {
    const name = category.name.trim();
    const code = categoryCode(category.code || name);
    setError("");
    if (name.length < 2) {
      setError("Enter a category name with at least two characters.");
      return;
    }
    if (!code) {
      setError("Enter a category code using letters or numbers.");
      return;
    }
    setSaving(true);
    try {
      await api.createExpenseCategory({ name, code });
      setCategory({ name: "", code: "" });
      setMode(null);
      await load();
    } catch (item) {
      setError(
        item instanceof ApiRequestError
          ? item.message
          : "Unable to add category.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function openSalary() {
    setSaving(true);
    setError("");
    try {
      let current = data!;
      let salary = current.categories.find(
        (item) => item.code === "STAFF-SALARY",
      );
      if (!salary) {
        await api.createExpenseCategory({
          name: "Staff Salary",
          code: "STAFF-SALARY",
        });
        current = await load();
        salary = current.categories.find(
          (item) => item.code === "STAFF-SALARY",
        );
      }
      setForm((value) => ({
        ...value,
        categoryId: salary?.id ?? value.categoryId,
        description: "Staff salary - ",
        paymentMethod: "CASH",
      }));
      setMode("expense");
    } catch (item) {
      setError(
        item instanceof ApiRequestError
          ? item.message
          : "Unable to prepare staff salary.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function save() {
    setSaving(true);
    setError("");
    try {
      await api.createExpense({
        ...form,
        incurredAt: iso(form.incurredAt),
        referenceNo: form.referenceNo || undefined,
        notes: form.notes || undefined,
        attachment: await attachment(file),
      });
      setMode(null);
      setFile(null);
      setForm((value) => ({
        ...value,
        description: "",
        amount: 0,
        referenceNo: "",
        notes: "",
      }));
      await load();
    } catch (item) {
      if (item instanceof ApiRequestError && item.code === "OFFLINE_QUEUED") {
        setMode(null);
        setFile(null);
        setForm((value) => ({ ...value, description: "", amount: 0, referenceNo: "", notes: "" }));
      } else setError(
          item instanceof ApiRequestError
            ? item.message
            : item instanceof Error
              ? item.message
              : "Unable to record expense.",
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
          <p>Preparing expenses…</p>
        </div>
      </main>
    );

  const expenseMonths = [
    ...new Set(
      data.expenses.map((expense) => indiaDate(expense.incurredAt).slice(0, 7)),
    ),
  ].sort((left, right) => right.localeCompare(left));
  const filteredExpenses = data.expenses.filter(
    (expense) =>
      (filterMonth === "ALL" ||
        indiaDate(expense.incurredAt).slice(0, 7) === filterMonth) &&
      (filterCategoryId === "ALL" ||
        expense.category.id === filterCategoryId),
  );
  const filteredTotal = filteredExpenses.reduce(
    (sum, expense) => sum + Number(expense.amount),
    0,
  );
  const monthName = (value: string) =>
    new Date(`${value}-01T00:00:00+05:30`).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
  const filterLabel =
    filterMonth === "ALL" ? "All expenses" : monthName(filterMonth);
  const filtersActive =
    filterMonth !== "ALL" || filterCategoryId !== "ALL";

  return (
    <main className="page expenses-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Petrol pump expenses</span>
          <h1>Every expense, documented and visible</h1>
          <p>
            Salary, utilities, repairs and every other operating cost in one
            register.
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="secondary"
            disabled={saving}
            onClick={() => void openSalary()}
          >
            <UsersRound size={16} /> Staff salary
          </button>
          <button className="secondary" onClick={() => { setError(""); setMode("category"); }}>
            <Tags size={16} /> Category
          </button>
          <button
            className="primary small"
            disabled={!data.categories.length}
            onClick={() => setMode("expense")}
          >
            <Plus size={16} /> Record expense
          </button>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <section className="expense-hero">
        <span>
          <ReceiptIndianRupee />
        </span>
        <div>
          <small>{filterLabel}</small>
          <b>{money(filteredTotal)}</b>
          <p>
            {filteredExpenses.length} matching expense
            {filteredExpenses.length === 1 ? "" : "s"}
            {filterCategoryId === "ALL"
              ? ` across ${new Set(filteredExpenses.map((expense) => expense.category.id)).size} categories`
              : ` in ${data.categories.find((item) => item.id === filterCategoryId)?.name ?? "the selected category"}`}
          </p>
        </div>
      </section>
      {!data.categories.length ? (
        <section className="sales-empty">
          <span>
            <Tags />
          </span>
          <h2>Create an expense category</h2>
          <p>Start with Staff Salary, Utilities, Repairs, or Office.</p>
          <button className="primary small" onClick={() => { setError(""); setMode("category"); }}>
            <Plus size={16} /> Add category
          </button>
        </section>
      ) : (
        <section className="expense-layout">
          <div className="expense-list">
            <div className="history-head">
              <div>
                <span className="eyebrow">Expense register</span>
                <h2>Expenses</h2>
              </div>
              <span>{filteredExpenses.length} entries</span>
            </div>
            <div className="expense-filters" aria-label="Expense filters">
              <label>
                <span><CalendarDays /> Month</span>
                <select
                  aria-label="Filter expenses by month"
                  value={filterMonth}
                  onChange={(event) => setFilterMonth(event.target.value)}
                >
                  <option value="ALL">All months</option>
                  {expenseMonths.map((month) => (
                    <option key={month} value={month}>{monthName(month)}</option>
                  ))}
                </select>
              </label>
              <label>
                <span><Tags /> Category</span>
                <select
                  aria-label="Filter expenses by category"
                  value={filterCategoryId}
                  onChange={(event) => setFilterCategoryId(event.target.value)}
                >
                  <option value="ALL">All categories</option>
                  {data.categories.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              {filtersActive && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterMonth("ALL");
                    setFilterCategoryId("ALL");
                  }}
                >
                  <FilterX /> Clear filters
                </button>
              )}
            </div>
            {filteredExpenses.map((expense) => (
              <article key={expense.id}>
                <span className="expense-icon">
                  <IndianRupee />
                </span>
                <div>
                  <strong>{expense.description}</strong>
                  <small>
                    {expense.category.name} · {expense.station.name} ·{" "}
                    {new Date(expense.incurredAt).toLocaleDateString("en-IN", {
                      dateStyle: "medium",
                    })}
                  </small>
                  {expense.attachments.map((item) => (
                    <a
                      key={item.id}
                      href={`/api/purchases/attachments/${item.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FileText size={11} />
                      {item.fileName}
                    </a>
                  ))}
                </div>
                <span>{expense.paymentMethod}</span>
                <b>{money(expense.amount)}</b>
              </article>
            ))}
            {!filteredExpenses.length && (
              <div className="expense-filter-empty">
                <ReceiptIndianRupee />
                <strong>{data.expenses.length ? "No expenses match these filters" : "No expenses recorded yet"}</strong>
                <small>{data.expenses.length ? "Try another month or category." : "Recorded expenses will appear here."}</small>
                {filtersActive && <button type="button" onClick={() => { setFilterMonth("ALL"); setFilterCategoryId("ALL"); }}>Show all expenses</button>}
              </div>
            )}
          </div>
          <aside className="expense-categories">
            <span className="eyebrow">Categories</span>
            <h2>Cost groups</h2>
            {data.categories.map((item) => (
              <div key={item.id}>
                <Tags size={14} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.code}</small>
                </span>
              </div>
            ))}
          </aside>
        </section>
      )}
      {mode && (
        <div className="product-modal">
          <section className="product-editor expense-modal">
            <button className="modal-close" onClick={() => setMode(null)}>
              <X size={17} />
            </button>
            {mode === "category" ? (
              <>
                <span className="eyebrow">Expense master</span>
                <h2>Add category</h2>
                <div className="form-grid">
                  <label className="field">
                    <span>Name</span>
                    <input
                      value={category.name}
                      onChange={(event) => {
                        const name = event.target.value;
                        setCategory((current) => ({
                          name,
                          code:
                            !current.code || current.code === categoryCode(current.name)
                              ? categoryCode(name)
                              : current.code,
                        }));
                      }}
                      placeholder="e.g. Generator fuel"
                    />
                  </label>
                  <label className="field">
                    <span>Code</span>
                    <input
                      value={category.code}
                      onChange={(event) =>
                        setCategory({ ...category, code: categoryCode(event.target.value) })
                      }
                      placeholder="GENERATOR-FUEL"
                    />
                  </label>
                </div>
                {error && <div className="form-error" role="alert">{error}</div>}
                <div className="editor-footer">
                  <button className="secondary" onClick={() => setMode(null)}>
                    Cancel
                  </button>
                  <button
                    className="primary small"
                    disabled={saving}
                    onClick={() => void addCategory()}
                  >
                    Save category
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="eyebrow">New expense</span>
                <h2>
                  {form.categoryId ===
                  data.categories.find((item) => item.code === "STAFF-SALARY")
                    ?.id
                    ? "Record staff salary"
                    : "Record petrol pump expense"}
                </h2>
                <div className="form-grid">
                  <label className="field">
                    <span>Petrol pump</span>
                    <select
                      value={form.stationId}
                      onChange={(event) =>
                        setForm({ ...form, stationId: event.target.value })
                      }
                    >
                      {data.stations.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Category</span>
                    <select
                      value={form.categoryId}
                      onChange={(event) =>
                        setForm({ ...form, categoryId: event.target.value })
                      }
                    >
                      {data.categories.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Description</span>
                    <input
                      autoFocus
                      value={form.description}
                      onChange={(event) =>
                        setForm({ ...form, description: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Amount</span>
                    <input
                      type="number"
                      min="0.01"
                      value={form.amount}
                      onChange={(event) =>
                        setForm({ ...form, amount: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Payment method</span>
                    <select
                      value={form.paymentMethod}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          paymentMethod: event.target
                            .value as typeof form.paymentMethod,
                        })
                      }
                    >
                      {["CASH", "UPI", "CARD", "OTHER"].map(
                        (item) => (
                          <option key={item}>{item}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <label className="field">
                    <span>Date</span>
                    <input
                      type="date"
                      value={form.incurredAt}
                      onChange={(event) =>
                        setForm({ ...form, incurredAt: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Reference</span>
                    <input
                      value={form.referenceNo}
                      onChange={(event) =>
                        setForm({ ...form, referenceNo: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Proof (max 500 KB)</span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={(event) =>
                        setFile(event.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Notes</span>
                  <input
                    value={form.notes}
                    onChange={(event) =>
                      setForm({ ...form, notes: event.target.value })
                    }
                  />
                </label>
                <div className="editor-footer">
                  <button className="secondary" onClick={() => setMode(null)}>
                    Cancel
                  </button>
                  <button
                    className="primary small"
                    disabled={
                      saving || !form.description.trim() || form.amount <= 0
                    }
                    onClick={() => void save()}
                  >
                    {saving ? "Saving…" : "Record expense"}
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
