import { useEffect, useMemo, useState } from "react";
import { Clipboard, Mail, Phone, Sparkles, Users } from "lucide-react";
import { ApiRequestError, api, type DemoLeadsBootstrap } from "../lib/api";
import { useAuth } from "../components/AuthProvider";

const dateTime = (value: string) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function DemoLeadsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DemoLeadsBootstrap | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  useEffect(() => {
    if (!user?.isPlatformAdmin) return;
    void api.demoLeads().then(setData).catch((item) => setError(item instanceof ApiRequestError ? item.message : "Unable to load demo enquiries."));
  }, [user?.isPlatformAdmin]);
  const unique = useMemo(() => new Set(data?.leads.map((lead) => lead.contact.toLowerCase())).size, [data]);
  async function copy(contact: string) { await navigator.clipboard.writeText(contact); setCopied(contact); window.setTimeout(() => setCopied(""), 1800); }
  if (!user?.isPlatformAdmin) return <main className="page"><div className="form-error">This area is restricted to the FuelLedger team.</div></main>;
  if (!data) return <main className="page"><div className="loading"><span/><p>Loading demo enquiries…</p></div>{error && <div className="form-error">{error}</div>}</main>;
  return <main className="page leads-page">
    <section className="leads-hero"><div><span className="eyebrow">Growth desk</span><h1>Demo enquiries</h1><p>People who started a 48-hour FuelLedger product tour. Use these details only for a relevant follow-up.</p></div><Sparkles/></section>
    <section className="leads-stats"><article><Users/><span><small>Unique contacts</small><b>{unique}</b></span></article><article><Sparkles/><span><small>Demo sessions</small><b>{data.summary.sessions}</b></span></article></section>
    <section className="leads-list"><header><div><span className="eyebrow">Follow-up list</span><h2>Recent demo visitors</h2></div><small>Latest 250 sessions</small></header>{data.leads.length ? data.leads.map((lead) => { const email = lead.kind === "EMAIL"; return <article key={lead.id}><span className={email ? "lead-kind email" : "lead-kind phone"}>{email ? <Mail/> : <Phone/>}</span><div><strong>{lead.contact}</strong><small>Started {dateTime(lead.createdAt)} · Demo ends {dateTime(lead.expiresAt)}</small></div><button className="secondary small" onClick={() => void copy(lead.contact)}><Clipboard size={14}/>{copied === lead.contact ? "Copied" : "Copy"}</button></article>; }) : <div className="leads-empty"><Users/><h2>No demo enquiries yet</h2><p>When someone starts a demo with an email address or mobile number, it will appear here.</p></div>}</section>
  </main>;
}
