import { useEffect, useMemo, useState } from "react";
import { Camera, CheckCircle2, Headphones, Paperclip, Send, TicketCheck } from "lucide-react";
import { ApiRequestError, api, type ServiceTicket } from "../lib/api";

const issues = [
  ["ACCESS_LOGIN", "Login or access", ["Cannot sign in", "Session logs out", "Wrong permissions", "Other access issue"]],
  ["SALES_SHIFTS", "Sales or shifts", ["Open or close shift", "Meter readings", "Collections", "Reconciliation"]],
  ["STOCK_TANKS", "Stock or tanks", ["Book stock", "Tank level", "Stock receipt", "Tank allocation"]],
  ["PURCHASES_INVOICES", "Purchases or invoices", ["Invoice OCR", "Product or total mismatch", "Stock not received", "Supplier payment"]],
  ["CUSTOMERS_CREDIT", "Customers or credit", ["Credit sale", "Customer balance", "Collection", "Credit Agent"]],
  ["ACCOUNTING_PAYMENTS", "Accounting or payments", ["Journal", "Expense", "Payment method", "Report"]],
  ["NERVE_INTELLIGENCE", "Nerve Intelligence", ["Briefing", "Agent finding", "Ask answer", "Approval"]],
  ["ALERTS_NOTIFICATIONS", "Alerts or notifications", ["iOS alert", "WhatsApp alert", "Missing alert", "Repeated alert"]],
  ["OTHER", "Something else", []],
] as const;
const labels = Object.fromEntries(issues.map(([value, label]) => [value, label]));

async function screenshot(file: File | null) {
  if (!file) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPEG, PNG or WebP screenshot.");
  if (file.size > 500_000) throw new Error("The screenshot must be 500 KB or smaller.");
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("The screenshot could not be read."));
    reader.readAsDataURL(file);
  });
  return { fileName: file.name, mimeType: file.type as "image/jpeg" | "image/png" | "image/webp", size: file.size, contentBase64 };
}

export function HelpPage() {
  const [issue, setIssue] = useState("");
  const [subIssue, setSubIssue] = useState("");
  const [comments, setComments] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [tickets, setTickets] = useState<ServiceTicket[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const subIssues = useMemo(() => issues.find(([value]) => value === issue)?.[2] ?? [], [issue]);
  useEffect(() => { void api.serviceTickets().then((result) => setTickets(result.tickets)).catch(() => undefined); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      const result = await api.createServiceTicket({ issue: issue as typeof issues[number][0], subIssue, comments, screenshot: await screenshot(file) });
      setTickets((current) => [result.ticket, ...current]);
      setIssue(""); setSubIssue(""); setComments(""); setFile(null);
      setMessage(`Ticket ${result.ticket.reference} has been sent to FuelNerve customer service.`);
    } catch (caught) {
      setError(caught instanceof ApiRequestError || caught instanceof Error ? caught.message : "The service ticket could not be submitted.");
    } finally { setSaving(false); }
  }
  return <main className="page help-page">
    <section className="help-hero"><span><Headphones/></span><div><small>HELP & CUSTOMER SERVICE</small><h1>Tell us what needs attention</h1><p>Create a ticket with the relevant details. FuelNerve customer service will receive it with your account information.</p></div></section>
    {message && <div className="success-banner"><CheckCircle2/>{message}</div>}{error && <div className="form-error">{error}</div>}
    <div className="help-layout">
      <form className="ticket-form" onSubmit={(event) => void submit(event)}>
        <header><TicketCheck/><div><h2>New service ticket</h2><p>Choose the closest issue so it reaches the right person.</p></div></header>
        <label><span>Issue</span><select required value={issue} onChange={(event) => { setIssue(event.target.value); setSubIssue(""); }}><option value="">Select an issue</option>{issues.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {subIssues.length > 0 && <label><span>Subissue</span><select value={subIssue} onChange={(event) => setSubIssue(event.target.value)}><option value="">Select if applicable</option>{subIssues.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
        <label><span>Comments</span><textarea required minLength={5} maxLength={2000} rows={6} placeholder="Briefly explain what happened and what you expected." value={comments} onChange={(event) => setComments(event.target.value)}/><small>{comments.length}/2000</small></label>
        <label className="ticket-file"><span>Screenshot · optional</span><div><Camera/><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)}/><b>{file?.name ?? "Choose screenshot"}</b></div><small>JPEG, PNG or WebP · maximum 500 KB</small></label>
        <button className="primary" disabled={saving || !issue || comments.trim().length < 5}><Send/>{saving ? "Sending ticket…" : "Submit service ticket"}</button>
      </form>
      <section className="ticket-history"><header><div><small>YOUR REQUESTS</small><h2>Recent tickets</h2></div><span>{tickets.filter((ticket) => ticket.status !== "RESOLVED").length} open</span></header>{tickets.length ? tickets.map((ticket) => <article key={ticket.id}><div><b>{ticket.reference}</b><span className={ticket.status.toLowerCase()}>{ticket.status.replace("_", " ")}</span></div><h3>{labels[ticket.issue] ?? ticket.issue}{ticket.subIssue ? ` · ${ticket.subIssue}` : ""}</h3><p>{ticket.comments}</p><small>{new Date(ticket.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}{ticket.hasScreenshot ? " · Screenshot attached" : ""}</small></article>) : <div className="ticket-empty"><Paperclip/><b>No tickets yet</b><p>Your submitted service requests will appear here.</p></div>}</section>
    </div>
  </main>;
}
