import { useEffect, useState } from "react";
import { CirclePlus, Edit3, Package, Plus, Tags, X } from "lucide-react";
import {
  ApiRequestError,
  api,
  type Catalog,
  type CatalogProduct,
  type ProductForm,
} from "../lib/api";
import "../products.css";
const categories = [
  "FUEL",
  "DEF",
  "LUBRICANTS",
  "FLUIDS",
  "RETAIL",
  "ACCESSORIES",
  "SERVICES",
  "EV_CHARGING",
  "OTHER",
];
const units = ["LITRE", "KILOGRAM", "PIECE", "BOX", "UNIT", "KWH"];
const today = () => new Date().toISOString().slice(0, 10);
const effectiveIso = (value: string) =>
  new Date(`${value}T00:00:00`).toISOString();
const blank = (): ProductForm => ({
  name: "",
  code: "",
  hsnCode: "",
  category: "RETAIL",
  customCategoryId: null,
  unit: "PIECE",
  purchasePrice: 0,
  sellingPrice: 0,
  taxCategoryId: null,
  inventoryTracked: true,
  tankLinked: false,
  meterLinked: false,
  isService: false,
  active: true,
});
const makeCode = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange(value: string): void;
  type?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function ProductsPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [form, setForm] = useState<ProductForm | null>(null);
  const [priceInputs, setPriceInputs] = useState({
    purchasePrice: "",
    sellingPrice: "",
  });
  const [priceEffectiveDate, setPriceEffectiveDate] = useState(today());
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    Partial<
      Record<
        | "name"
        | "code"
        | "category"
        | "unit"
        | "purchasePrice"
        | "sellingPrice",
        string
      >
    >
  >({});
  const [categoryName, setCategoryName] = useState("");
  const [taxName, setTaxName] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const load = () =>
    api
      .catalog()
      .then(setCatalog)
      .catch(() => setError("Unable to load the product catalog."));
  useEffect(() => {
    void load();
  }, []);
  const set =
    (key: keyof ProductForm) => (value: string | number | boolean | null) =>
      setForm((current) => (current ? { ...current, [key]: value } : current));
  const setName = (value: string) =>
    setForm((current) => {
      if (!current) return current;
      const previousGenerated = makeCode(current.name);
      return {
        ...current,
        name: value,
        code:
          !current.code || current.code === previousGenerated
            ? makeCode(value)
            : current.code,
      };
    });
  async function save() {
    if (!form) return;
    const errors: Partial<
      Record<
        | "name"
        | "code"
        | "category"
        | "unit"
        | "purchasePrice"
        | "sellingPrice",
        string
      >
    > = {};
    const purchasePrice = Number(priceInputs.purchasePrice);
    const sellingPrice = Number(priceInputs.sellingPrice);
    if (form.name.trim().length < 2)
      errors.name = "Enter a product name with at least 2 letters.";
    if (!/^[A-Z0-9-]+$/.test(form.code))
      errors.code = "Use letters, numbers and hyphens only.";
    if (
      !priceInputs.purchasePrice.trim() ||
      !Number.isFinite(purchasePrice) ||
      purchasePrice < 0
    )
      errors.purchasePrice = "Enter a valid purchase price.";
    if (
      !priceInputs.sellingPrice.trim() ||
      !Number.isFinite(sellingPrice) ||
      sellingPrice < 0
    )
      errors.sellingPrice = "Enter a valid selling price.";
    if (
      form.isService &&
      (form.inventoryTracked || form.tankLinked || form.meterLinked)
    )
      errors.category = "A service cannot be linked to stock, tanks or meters.";
    if (
      (form.tankLinked || form.meterLinked) &&
      !["FUEL", "DEF"].includes(form.category)
    )
      errors.category = "Only Fuel or DEF can be linked to tanks or meters.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setError("Please correct the marked product details.");
      return;
    }
    setError("");
    const currentPrice = editing
      ? Number(catalog?.products.find((product) => product.id === editing)?.sellingPrice)
      : undefined;
    const currentPurchasePrice = editing ? Number(catalog?.products.find((product) => product.id === editing)?.purchasePrice) : undefined;
    const payload = {
      ...form,
      purchasePrice,
      sellingPrice,
      ...(!editing || purchasePrice !== currentPurchasePrice
        ? { purchasePriceEffectiveFrom: effectiveIso(priceEffectiveDate) }
        : {}),
      ...(!editing || sellingPrice !== currentPrice
        ? { sellingPriceEffectiveFrom: effectiveIso(priceEffectiveDate) }
        : {}),
    };
    try {
      if (editing) await api.updateProduct(editing, payload);
      else await api.createProduct(payload);
      setForm(null);
      setEditing(null);
      setFieldErrors({});
      load();
    } catch (e) {
      const details =
        e instanceof ApiRequestError &&
        e.details &&
        typeof e.details === "object"
          ? "fieldErrors" in e.details
            ? (e.details as { fieldErrors?: Record<string, string[]> })
                .fieldErrors
            : undefined
          : undefined;
      setFieldErrors(
        details
          ? Object.fromEntries(
              Object.entries(details).map(([key, messages]) => [
                key,
                messages[0] ?? "Check this value.",
              ]),
            )
          : {},
      );
      setError(
        e instanceof ApiRequestError ? e.message : "Unable to save product.",
      );
    }
  }
  async function addCategory() {
    try {
      await api.createCategory({
        name: categoryName,
        code: categoryName.trim().toUpperCase().replaceAll(/\s+/g, "-"),
      });
      setCategoryName("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to add category.");
    }
  }
  async function addTax() {
    try {
      await api.createTaxCategory({ name: taxName, rate: Number(taxRate) });
      setTaxName("");
      setTaxRate("0");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to add tax category.");
    }
  }
  const edit = (product: CatalogProduct) => {
    const {
      id,
      taxCategory,
      customCategory,
      purchasePrice,
      sellingPrice,
      sellingPriceHistory: _sellingPriceHistory,
      hsnCode,
      ...rest
    } = product;
    setEditing(id);
    setPriceEffectiveDate(today());
    setPriceInputs({
      purchasePrice: String(purchasePrice),
      sellingPrice: String(sellingPrice),
    });
    setForm({
      ...rest,
      hsnCode: hsnCode ?? "",
      purchasePrice: Number(purchasePrice),
      sellingPrice: Number(sellingPrice),
    });
  };
  const editingProduct = catalog?.products.find((product) => product.id === editing);
  if (!catalog)
    return (
      <main className="page">
        <div className="loading">
          <span />
          <p>Loading product catalog…</p>
        </div>
      </main>
    );
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Product & service engine</span>
          <h1>Products & services</h1>
          <p>
            One catalog for fuel, retail, fluids, services, and every other
            source of revenue.
          </p>
        </div>
        <button
          className="primary small"
          onClick={() => {
            setForm(blank());
            setPriceInputs({ purchasePrice: "0", sellingPrice: "0" });
            setEditing(null);
            setError("");
            setFieldErrors({});
          }}
        >
          <CirclePlus size={17} /> Add product
        </button>
      </div>
      {error && !form && <div className="form-error">{error}</div>}
      <section className="catalog-stats">
        <div>
          <strong>{catalog.products.length}</strong>
          <span>Products</span>
        </div>
        <div>
          <strong>
            {catalog.products.filter((p) => p.inventoryTracked).length}
          </strong>
          <span>Inventory tracked</span>
        </div>
        <div>
          <strong>{catalog.products.filter((p) => p.isService).length}</strong>
          <span>Services</span>
        </div>
        <div>
          <strong>{catalog.products.filter((p) => p.active).length}</strong>
          <span>Active</span>
        </div>
      </section>
      <section className="catalog-layout">
        <article className="catalog-table">
          <div className="catalog-table-head">
            <strong>Catalog</strong>
            <span>Purchase → Selling price</span>
          </div>
          {catalog.products.map((product) => (
            <div className="catalog-item" key={product.id}>
              <span className="product-icon">
                <Package size={17} />
              </span>
              <div>
                <strong>{product.name}</strong>
                <small>
                  {product.code} ·{" "}
                  {product.customCategory?.name ??
                    product.category.replaceAll("_", " ")}
                </small>
              </div>
              <div className="product-prices">
                <span>₹{product.purchasePrice}</span>
                <b>₹{product.sellingPrice}</b>
              </div>
              <div className="product-tags">
                {product.isService ? (
                  <span>Service</span>
                ) : product.inventoryTracked ? (
                  <span>Stock</span>
                ) : (
                  <span>Non-stock</span>
                )}
                {product.tankLinked && <span>Tank</span>}
                {product.meterLinked && <span>Meter</span>}
              </div>
              <button className="text-button" onClick={() => edit(product)}>
                <Edit3 size={16} /> Edit
              </button>
            </div>
          ))}
        </article>
        <aside className="catalog-aside">
          <section>
            <div className="aside-title">
              <Tags size={17} />
              <strong>Custom categories</strong>
            </div>
            {catalog.categories.map((c) => (
              <span className="setup-chip" key={c.id}>
                {c.name}
              </span>
            ))}
            <div className="inline-add">
              <input
                value={categoryName}
                placeholder="e.g. Seasonal"
                onChange={(e) => setCategoryName(e.target.value)}
              />
              <button
                onClick={() => void addCategory()}
                disabled={!categoryName.trim()}
              >
                <Plus size={16} />
              </button>
            </div>
          </section>
          <section>
            <div className="aside-title">
              <Tags size={17} />
              <strong>Tax categories</strong>
            </div>
            {catalog.taxCategories.map((t) => (
              <span className="setup-chip" key={t.id}>
                {t.name} · {t.rate}%
              </span>
            ))}
            <div className="inline-add tax-add">
              <input
                value={taxName}
                placeholder="Tax name"
                onChange={(e) => setTaxName(e.target.value)}
              />
              <input
                value={taxRate}
                type="number"
                min="0"
                max="100"
                onChange={(e) => setTaxRate(e.target.value)}
              />
              <button onClick={() => void addTax()} disabled={!taxName.trim()}>
                <Plus size={16} />
              </button>
            </div>
          </section>
        </aside>
      </section>
      {form && (
        <div
          className="product-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Product editor"
        >
          <div className="product-editor">
            <button className="modal-close" onClick={() => setForm(null)}>
              <span className="sr-only">Close</span>
              <X />
            </button>
            <span className="eyebrow">
              {editing ? "Edit product" : "New catalog item"}
            </span>
            <h2>
              {editing ? "Refine this product" : "Add a product or service"}
            </h2>
            {error && <div className="form-error editor-error">{error}</div>}
            <div className="form-grid">
              <label
                className={`field ${fieldErrors.name ? "field-invalid" : ""}`}
              >
                <span>Name</span>
                <input
                  value={form.name}
                  onChange={(e) => setName(e.target.value)}
                />
                {fieldErrors.name && <small>{fieldErrors.name}</small>}
              </label>
              <label
                className={`field ${fieldErrors.code ? "field-invalid" : ""}`}
              >
                <span>SKU / code</span>
                <input
                  value={form.code}
                  onChange={(e) => set("code")(e.target.value.toUpperCase())}
                />
                {fieldErrors.code && <small>{fieldErrors.code}</small>}
              </label>
              <label
                className={`field ${fieldErrors.category ? "field-invalid" : ""}`}
              >
                <span>Standard category</span>
                <select
                  value={form.category}
                  onChange={(e) => set("category")(e.target.value)}
                >
                  {categories.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
                {fieldErrors.category && <small>{fieldErrors.category}</small>}
              </label>
              <label className="field">
                <span>Custom category</span>
                <select
                  value={form.customCategoryId ?? ""}
                  onChange={(e) =>
                    set("customCategoryId")(e.target.value || null)
                  }
                >
                  <option value="">None</option>
                  {catalog.categories
                    .filter((c) => c.active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>Unit</span>
                <select
                  value={form.unit}
                  onChange={(e) => set("unit")(e.target.value)}
                >
                  {units.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Tax category</span>
                <select
                  value={form.taxCategoryId ?? ""}
                  onChange={(e) => set("taxCategoryId")(e.target.value || null)}
                >
                  <option value="">No tax category</option>
                  {catalog.taxCategories
                    .filter((t) => t.active)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.rate}%)
                      </option>
                    ))}
                </select>
              </label>
              <Field
                label="Purchase price"
                type="number"
                value={priceInputs.purchasePrice}
                onChange={(v) =>
                  setPriceInputs((current) => ({
                    ...current,
                    purchasePrice: v,
                  }))
                }
              />
              <Field
                label="Selling price"
                type="number"
                value={priceInputs.sellingPrice}
                onChange={(v) =>
                  setPriceInputs((current) => ({ ...current, sellingPrice: v }))
                }
              />
              <Field
                label="Prices effective from"
                type="date"
                value={priceEffectiveDate}
                onChange={setPriceEffectiveDate}
              />
            </div>
            {editingProduct && editingProduct.sellingPriceHistory.length > 0 && (
              <section className="price-history">
                <strong>Selling-price history</strong>
                <p>Saved sales keep the rate that applied on their transaction date.</p>
                {editingProduct.sellingPriceHistory.slice(0, 5).map((price) => (
                  <span key={price.id}>
                    <b>₹{price.price}</b>
                    <small>
                      From {new Date(price.effectiveFrom).toLocaleDateString("en-IN", { dateStyle: "medium" })}
                    </small>
                  </span>
                ))}
              </section>
            )}
            <div className="editor-toggles">
              {(
                [
                  ["inventoryTracked", "Track inventory"],
                  ["tankLinked", "Tank linked"],
                  ["meterLinked", "Meter linked"],
                  ["isService", "Service product"],
                  ["active", "Active"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={form[key]}
                    onChange={(e) => set(key)(e.target.checked)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="editor-footer">
              <button className="secondary" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button
                className="primary small"
                onClick={() => void save()}
                disabled={!form.name.trim() || !form.code.trim()}
              >
                Save product
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
