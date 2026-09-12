import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, Bot, CheckCircle2, ChevronDown, ClipboardCheck, Clock3, Droplets, FileCheck2, MessageCircleQuestion, RefreshCw, SearchCheck, ShieldCheck, Sparkles, TrendingUp, X } from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import { useStation } from "../components/StationProvider";
import { api, ApiRequestError, type InvestigationFollowUpPrompt, type InvestigationFollowUpResponse, type InvestigationResponse, type NerveAgentPresentation, type NerveAgentsResponse, type NerveFinding } from "../lib/api";

type FindingGroup = { key: string; title: string; severity: NerveFinding["severity"]; agent: NerveAgentPresentation; findings: NerveFinding[] };
type TeamAgent = NerveAgentPresentation & {
  area: string;
  runId?: string;
  status: "ALL_CLEAR" | "FINDINGS" | "NEEDS_ATTENTION" | "AWAITING_REVIEW";
  lastCompletedAt?: string;
  findings: NerveFinding[];
};

const agentCatalogue: Array<NerveAgentPresentation & { area: string; aliases?: string[]; checks: string[] }> = [
  { agentKey: "reconciliation-review", name: "Shift Agent", purpose: "Shifts, collections and handovers", icon: "shift", area: "Operations", checks: ["Open or overdue shifts", "Missing readings and collections", "Differences that still need reconciliation"] },
  { agentKey: "inventory-watch", name: "Stock Agent", purpose: "Tanks, readings, receipts and movement", icon: "stock", area: "Operations", checks: ["Empty and low-stock tanks", "Physical stock compared with book stock", "Missing density readings and unusual movement"] },
  { agentKey: "credit-watch", aliases: ["receivables-watch"], name: "Credit Agent", purpose: "Customer dues, ageing and reminder drafts", icon: "specialist", area: "Money", checks: ["Customer payments that are overdue", "Partial payments and agreed credit limits", "Verified details for reminder drafts"] },
  { agentKey: "purchase-check", name: "Purchase Agent", purpose: "Invoices, receipts, rates and supplier payments", icon: "specialist", area: "Money", checks: ["Invoice and delivery quantity differences", "Possible duplicates and rate differences", "Supplier payments that are overdue"] },
  { agentKey: "profit-insight", name: "Profit Agent", purpose: "Margins, costs and financial changes", icon: "profit", area: "Money", checks: ["Revenue and cost changes", "Fuel and non-fuel contribution", "Comparable periods and missing costs"] },
  { agentKey: "business-assistant", aliases: ["owner-assistant"], name: "Owner Assistant", purpose: "Connects findings and answers with supporting records", icon: "assistant", area: "Your guide", checks: ["Brings related agent findings together", "Explains why an issue comes first", "Takes you to the exact supporting records"] },
];

export function IntelligenceAgentsPage() {
  const { agentKey } = useParams();
  const { user } = useAuth();
  const { selectedStationId, selectedStation } = useStation();
  const [data, setData] = useState<NerveAgentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [investigation, setInvestigation] = useState<InvestigationResponse | null>(null);
  const [investigationAgent, setInvestigationAgent] = useState<NerveAgentPresentation | null>(null);
  const [investigatingKey, setInvestigatingKey] = useState<string | null>(null);
  const [investigationError, setInvestigationError] = useState("");
  const investigationTrigger = useRef<HTMLButtonElement | null>(null);

  const load = async () => {
    if (!selectedStationId) return;
    setLoading(true); setError("");
    try { setData(await api.nerveAgents(selectedStationId)); }
    catch (caught) { setData(null); setError(caught instanceof ApiRequestError ? caught.message : "The latest review could not be loaded."); }
    finally { setLoading(false); }
  };
  useEffect(() => { setInvestigation(null); setInvestigationAgent(null); void load(); }, [selectedStationId]);

  const findings = useMemo(() => data?.agents.flatMap((agent) => agent.findings) ?? [], [data]);
  const team = useMemo<TeamAgent[]>(() => agentCatalogue.map((definition) => {
    const keys = [definition.agentKey, ...(definition.aliases ?? [])];
    const reviewed = data?.agents.find((agent) => keys.includes(agent.agentKey));
    return reviewed ? { ...reviewed, ...definition } : { ...definition, status: "AWAITING_REVIEW", findings: [] };
  }), [data]);
  const reviewedAgentCount = team.filter((agent) => agent.status !== "AWAITING_REVIEW").length;
  const groups = groupFindings(findings);
  const selectedAgent = agentKey ? team.find((agent) => agent.agentKey === agentKey || agentCatalogue.find((item) => item.agentKey === agent.agentKey)?.aliases?.includes(agentKey)) : undefined;
  const selectedGroups = selectedAgent ? groups.filter((group) => group.agent.agentKey === selectedAgent.agentKey || agentCatalogue.find((item) => item.agentKey === selectedAgent.agentKey)?.aliases?.includes(group.agent.agentKey)) : [];

  const investigate = async (group: FindingGroup, trigger: HTMLButtonElement) => {
    if (!selectedStationId || investigatingKey) return;
    investigationTrigger.current = trigger;
    setInvestigation(null); setInvestigationError(""); setInvestigationAgent(group.agent); setInvestigatingKey(group.key);
    try { setInvestigation(await api.investigateFinding({ requestId: crypto.randomUUID(), stationId: selectedStationId, findingIds: group.findings.map(finding => finding.findingId) })); }
    catch (caught) { setInvestigationError(caught instanceof ApiRequestError ? caught.message : "The investigation could not be completed safely."); }
    finally { setInvestigatingKey(null); }
  };

  const closeInvestigation = () => {
    setInvestigation(null); setInvestigationAgent(null); setInvestigationError("");
    window.requestAnimationFrame(() => investigationTrigger.current?.focus());
  };

  if (agentKey) return <main className="page nerve-page nerve-agent-page">
    <Link className="agent-back" to="/insights"><ArrowLeft/> All agents</Link>
    {!selectedAgent ? <section className="nerve-unavailable"><MessageCircleQuestion/><div><h2>That agent could not be found</h2><p>Return to Nerve Intelligence and choose one of your six specialists.</p></div></section> : <>
      <header className="agent-page-heading"><AgentGlyph agent={selectedAgent}/><div><span className="eyebrow">{selectedAgent.area}</span><h1>{selectedAgent.name}</h1><p>{selectedAgent.purpose} for <strong>{selectedStation?.name ?? "the selected station"}</strong>.</p></div>{selectedAgent.lastCompletedAt && <span className="today-updated"><Clock3/> Reviewed {relativeTime(selectedAgent.lastCompletedAt)}</span>}</header>
      <section className={`agent-summary ${selectedAgent.status.toLowerCase()}`}><div><span>{agentStateLabel(selectedAgent)}</span><h2>{agentSummaryTitle(selectedAgent)}</h2><p>{agentSummaryText(selectedAgent)}</p></div>{selectedAgent.findings.length > 0 && <strong>{selectedAgent.findings.length}</strong>}</section>
      {data?.stale && selectedAgent.lastCompletedAt && <div className="nerve-stale"><Clock3/> This review is more than 24 hours old. Treat it as a previous snapshot until a fresh review completes.</div>}
      <section className="agent-focus"><span className="eyebrow">What this agent checks</span><div>{agentCatalogue.find((item) => item.agentKey === selectedAgent.agentKey)?.checks.map((check) => <p key={check}><CheckCircle2/>{check}</p>)}</div></section>
      <section className="agent-activity"><div className="today-section-heading"><div><span className="eyebrow">Latest review</span><h2>{selectedGroups.length ? "Here’s what I found" : selectedAgent.status === "AWAITING_REVIEW" ? "No review is available yet" : "Nothing needs your attention"}</h2></div>{selectedAgent.findings.length > 0 && <span>{selectedAgent.findings.length} finding{selectedAgent.findings.length === 1 ? "" : "s"}</span>}</div>{selectedGroups.length ? <div className="attention-feed">{selectedGroups.map((group) => <FindingGroupCard key={group.key} group={group} busy={investigatingKey === group.key} readOnlyDemo={Boolean(user?.demoExpiresAt)} onInvestigate={(trigger) => void investigate(group, trigger)}/>)}</div> : <div className="today-clear"><CheckCircle2/><div><h3>{selectedAgent.status === "AWAITING_REVIEW" ? "Waiting for the first completed review" : "You’re all caught up"}</h3><p>{selectedAgent.status === "AWAITING_REVIEW" ? "When verified findings are available, they will appear here in plain language with links to the records." : `${selectedAgent.name} did not find anything that needs your attention in the latest review.`}</p></div></div>}<div className="safety-promise activity-safety"><ShieldCheck/><p>This agent can review and explain. Only you can make changes.</p></div></section>
    </>}
    {(investigatingKey || investigationError || investigation) && <InvestigationDialog agent={investigation?.agent ?? investigationAgent} result={investigation} stationId={selectedStationId} loading={Boolean(investigatingKey)} error={investigationError} onClose={closeInvestigation}/>}
  </main>;

  return <main className="page nerve-page">
    <header className="today-heading"><div><span className="eyebrow">{`${dayGreeting()}, ${user?.name.split(" ")[0] ?? "there"}`}</span><h1>Nerve Intelligence</h1><p>Six specialists review <strong>{selectedStation?.name ?? "the selected station"}</strong> and bring forward what needs your attention.</p></div>{data && <span className="today-updated"><Clock3/> Last review {relativeTime(data.generatedAt)}</span>}</header>

    {data && <section className="nerve-team" aria-label={`Nerve Intelligence specialists for ${selectedStation?.name ?? "the selected station"}`}><div className="nerve-team-heading"><div><span className="eyebrow">Your specialist team</span><h2>Six agents, one clear owner view</h2><p>Each agent watches a specific part of the business. The Owner Assistant connects their findings.</p></div><span>{reviewedAgentCount} reviewed · {team.length - reviewedAgentCount} awaiting review</span></div><div className="nerve-team-grid">{team.map(agent => <AgentTeamCard key={agent.agentKey} agent={agent}/>)}</div></section>}

    {error && <section className="nerve-unavailable"><MessageCircleQuestion/><div><h2>Nerve Intelligence is temporarily unavailable</h2><p>{error}</p><small>FuelNerve continues working normally.</small></div><button className="secondary" onClick={() => void load()}><RefreshCw/> Try again</button></section>}
    {loading && <div className="loading-inline nerve-loading"><span/><p>Checking the latest records…</p></div>}
    {data?.stale && <div className="nerve-stale"><Clock3/> These reviews are more than 24 hours old. Open an agent to see its latest saved findings.</div>}
  </main>;
}

function AgentTeamCard({ agent }: { agent: TeamAgent }) {
  const content = <><AgentGlyph agent={agent}/><div><span className="agent-area">{agent.area}</span><h3>{agent.name}</h3><p>{agent.purpose}</p><strong className={agent.status.toLowerCase()}>{agentStateLabel(agent)}</strong><small>{agent.lastCompletedAt ? `Reviewed ${relativeTime(agent.lastCompletedAt)}` : "No completed review yet"}</small></div><ArrowRight/></>;
  return <Link className={`nerve-agent-card ${agent.status === "AWAITING_REVIEW" ? "awaiting-review" : agent.status === "ALL_CLEAR" ? "all-clear" : ""}`} to={`/insights/${agent.agentKey}`}>{content}</Link>;
}

function FindingGroupCard({ group, anchorId, busy, readOnlyDemo, onInvestigate }: { group: FindingGroup; anchorId?: string; busy: boolean; readOnlyDemo: boolean; onInvestigate: (trigger: HTMLButtonElement) => void }) {
  const first = group.findings[0]!; const records = uniqueEvidence(group.findings); const grouped = group.findings.length > 1;
  const prioritized = group.findings.some(finding => finding.priorityRank === 1);
  return <article id={anchorId} className={`attention-card activity-card ${group.severity.toLowerCase()}${prioritized ? " prioritized" : ""}`}><div className="activity-copy"><header className="activity-author"><AgentGlyph agent={group.agent}/><div><strong>{group.agent.name}</strong><time>{relativeTime(latestFindingTime(group.findings))}</time></div><span>{prioritized ? "Review first" : group.severity === "URGENT" ? "Check now" : group.severity === "ATTENTION" ? "Review today" : "Update"}</span></header><h3>{activityTitle(group)}</h3><p>{activityMessage(group)}</p>{grouped && <details className="group-details"><summary>See the {group.findings.length} differences <ChevronDown/></summary><div>{group.findings.map((finding) => <span key={finding.findingId}>{formatValue(finding.displayValue)}</span>)}</div></details>}{!grouped && !prioritized && <strong className="attention-value">{formatValue(first.displayValue)}</strong>}<div className="activity-next"><ArrowRight/><div><small>Next step</small><p>{activityNextStep(group)}</p></div></div></div><div className="attention-actions">{!readOnlyDemo && <button type="button" disabled={busy} onClick={(event) => onInvestigate(event.currentTarget)}><SearchCheck/>{busy ? `${group.agent.name} is checking…` : `Let ${group.agent.name} investigate`}</button>}{records.slice(0, 1).map((record) => <Link key={record.resolverPath} to={record.resolverPath}>{readOnlyDemo ? "View supporting record" : recordLinkLabel(record.resolverPath)} <ArrowRight/></Link>)}</div></article>;
}

function InvestigationDialog({ agent, result, stationId, loading, error, onClose }: { agent: NerveAgentPresentation | null; result: InvestigationResponse | null; stationId: string | null; loading: boolean; error: string; onClose: () => void }) {
  const drawer = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);
  useEffect(() => { if (loading) drawer.current?.focus(); else closeButton.current?.focus(); }, [loading]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !loading) { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...(drawer.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])') ?? [])].filter(element => !element.hasAttribute("disabled"));
    if (!focusable.length) return;
    const first = focusable[0]!; const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="investigation-overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !loading) onClose(); }}><section ref={drawer} tabIndex={-1} className="investigation-dialog" role="dialog" aria-modal="true" aria-labelledby="investigation-title" onKeyDown={onKeyDown}><header><div>{agent && <AgentIdentity agent={agent}/>}<span className="eyebrow">Agent briefing</span><h2 id="investigation-title">{result ? briefingHeadline(result.headline) : loading ? "Following the record trail…" : "I couldn’t complete this review"}</h2></div><button ref={closeButton} type="button" aria-label="Close agent briefing" disabled={loading} onClick={onClose}><X/></button></header>{loading && <div className="investigation-loading"><span/><h3>{agent ? `${agent.name} is checking the related records` : "Checking the related records"}</h3><p>I’ll only use information available for this station.</p></div>}{error && <div className="investigation-failed"><AlertTriangle/><h3>I stopped without showing a result</h3><p>{error}</p><button className="secondary" onClick={onClose}>Close</button></div>}{result && stationId && <AgentBriefing key={result.investigationId} result={result} stationId={stationId}/>}</section></div>;
}

const followUpChoices: Array<{ prompt: InvestigationFollowUpPrompt; label: string }> = [
  { prompt: "WHY_HIGHEST_PRIORITY", label: "Why is this the highest priority?" },
  { prompt: "RECORDS_COMPARED", label: "Which records did you compare?" },
  { prompt: "CHANGED_SINCE_PREVIOUS", label: "What changed since the previous reading?" },
  { prompt: "UNCONFIRMED", label: "What can’t you determine?" },
  { prompt: "RELEVANT_RECEIPT", label: "Show me the relevant receipt." },
];

function AgentBriefing({ result, stationId }: { result: InvestigationResponse; stationId: string }) {
  const [followUp, setFollowUp] = useState<InvestigationFollowUpResponse | null>(null);
  const [followUpLoading, setFollowUpLoading] = useState<InvestigationFollowUpPrompt | null>(null);
  const [followUpError, setFollowUpError] = useState("");
  const connection = result.possibleExplanations[0];
  const reasons = result.observations.slice(0, connection ? 2 : 3).map(item => ({ title: item.title, detail: item.detail, value: item.value }));
  if (connection) reasons.push({ title: connection.confidence === "SUPPORTED" ? "A pattern in the records" : "A possibility to consider", detail: connection.text, value: undefined });
  const nextCheck = result.nextChecks[0];
  const evidenceReferences = uniqueStrings([...result.observations, ...result.timeline, ...result.unknowns].flatMap(item => item.evidenceIds).concat(result.possibleExplanations.flatMap(item => item.evidenceIds)));
  const ask = async (prompt: InvestigationFollowUpPrompt) => {
    if (followUpLoading) return;
    setFollowUp(null); setFollowUpError(""); setFollowUpLoading(prompt);
    try { setFollowUp(await api.investigationFollowUp(result.investigationId, { stationId, prompt })); }
    catch (caught) { setFollowUpError(caught instanceof ApiRequestError ? caught.message : "I couldn’t answer that safely from this briefing."); }
    finally { setFollowUpLoading(null); }
  };
  return <div className="investigation-report"><section className="briefing-assessment"><span>My assessment</span><p>{result.summary}</p></section><section className="briefing-section"><h3>Why I think this</h3>{reasons.length ? <div className="briefing-observations">{reasons.map((item, index) => <article key={`${item.title}-${index}`}><span>{index + 1}</span><div><h4>{item.title}</h4><p>{item.detail}</p>{item.value && <strong>{item.value}</strong>}</div></article>)}</div> : <p className="briefing-empty">I did not find enough confirmed information to make a stronger assessment.</p>}</section><section className="briefing-section"><h3>What I could not confirm</h3>{result.unknowns.length ? <div className="briefing-unknowns">{result.unknowns.slice(0, 2).map((item, index) => <p key={`${item.title}-${index}`}><MessageCircleQuestion/><span><strong>{item.title}</strong>{item.detail}</span></p>)}</div> : <p className="briefing-empty"><CheckCircle2/> I did not find any important unanswered question in this review.</p>}</section><section className="briefing-section briefing-next"><h3>What to check next</h3>{nextCheck ? <><p>{nextCheck.detail}</p><Link to={nextCheck.resolverPath}>{nextCheck.label}<ArrowRight/></Link></> : <p className="briefing-empty">No further check is recommended from the records currently available.</p>}</section><section className="briefing-followups" aria-label={`Questions for ${result.agent.name}`}><span>Ask {result.agent.name} about this briefing</span><div>{followUpChoices.map(choice => <button type="button" key={choice.prompt} disabled={Boolean(followUpLoading)} className={followUp?.prompt === choice.prompt ? "selected" : undefined} onClick={() => void ask(choice.prompt)}>{followUpLoading === choice.prompt ? "Checking the briefing…" : choice.label}</button>)}</div>{followUpError && <p className="followup-error" role="alert">{followUpError}</p>}{followUp && <article className={followUp.supported ? "followup-answer" : "followup-answer refused"} aria-live="polite"><AgentGlyph agent={followUp.agent}/><div><strong>{followUp.agent.name}</strong><p>{followUp.answer}</p>{followUp.citations.length > 0 && <nav aria-label="Supporting records">{followUp.citations.map(citation => <Link key={citation.evidenceId} to={citation.resolverPath}><FileCheck2/>{citation.label}<ArrowRight/></Link>)}</nav>}</div></article>}</section><div className="briefing-details"><details><summary><span><FileCheck2/>Records I checked</span><ChevronDown/></summary><div className="briefing-records">{result.evidence.map(record => <Link to={record.resolverPath} key={record.evidenceId}><span><strong>{record.label}</strong><small>Recorded {formatDateTime(record.observedAt)}</small></span><ArrowRight/></Link>)}<p>Assessment calculated {formatDateTime(result.generatedAt)}</p></div></details>{result.timeline.length > 1 && <details><summary><span><Clock3/>Timeline</span><ChevronDown/></summary><div className="briefing-timeline">{result.timeline.map((item, index) => <article key={`${item.title}-${index}`}><time>{item.occurredAt ? formatDateTime(item.occurredAt) : "Time unavailable"}</time><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}</div></details>}<details><summary><span><ShieldCheck/>How I reached this</span><ChevronDown/></summary><dl className="briefing-technical"><div><dt>Access</dt><dd>Owner-only · read-only</dd></div><div><dt>Scope</dt><dd>Organization and station verified</dd></div><div><dt>Evidence</dt><dd>Every answer must cite saved records</dd></div><div><dt>Freshness</dt><dd>Out-of-date findings are rejected</dd></div><div><dt>Changes</dt><dd>Proposals and actions disabled</dd></div><div><dt>Protection</dt><dd>Repeat requests cannot create duplicate work</dd></div><div><dt>Allowance</dt><dd>Monthly limit enforced</dd></div><div><dt>Audit</dt><dd>This briefing is saved</dd></div><div><dt>Explanation</dt><dd>{result.narrativeMode.startsWith("DETERMINISTIC") ? "Rules-based" : "AI-assisted"}</dd></div><div><dt>Run ID</dt><dd>{result.investigationId}</dd></div><div><dt>Evidence references</dt><dd>{evidenceReferences.length ? evidenceReferences.join(", ") : "None"}</dd></div><div><dt>Snapshot</dt><dd>{result.snapshotHash}</dd></div></dl></details></div><footer><ShieldCheck/><p>Nerve Intelligence can review and explain. Only you can make changes.</p></footer></div>;
}

function AgentIdentity({ agent }: { agent: NerveAgentPresentation }) { return <div className="agent-identity"><AgentGlyph agent={agent}/><span><strong>{agent.name}</strong><small>{agent.purpose}</small></span></div>; }
function AgentGlyph({ agent }: { agent: NerveAgentPresentation }) { const Icon = agent.icon === "shift" ? ClipboardCheck : agent.icon === "stock" ? Droplets : agent.icon === "profit" ? TrendingUp : agent.icon === "assistant" ? Sparkles : Bot; return <span className={`agent-glyph ${agent.icon}`} aria-hidden="true"><Icon/></span>; }
function groupFindings(findings: NerveFinding[]): FindingGroup[] { const order = { URGENT: 0, ATTENTION: 1, INFORMATION: 2 } as const; const groups = new Map<string, NerveFinding[]>(); for (const finding of findings) { const key = `${finding.agent.agentKey}:${finding.title.trim().toLowerCase()}`; groups.set(key, [...(groups.get(key) ?? []), finding]); } return [...groups.entries()].map(([key, rows]) => ({ key, agent: rows[0]!.agent, severity: rows.some(row => row.severity === "URGENT") ? "URGENT" as const : rows.some(row => row.severity === "ATTENTION") ? "ATTENTION" as const : "INFORMATION" as const, title: rows[0]!.title, findings: rows })).sort((a, b) => groupPriority(a) - groupPriority(b) || order[a.severity] - order[b.severity] || Date.parse(latestFindingTime(b.findings)) - Date.parse(latestFindingTime(a.findings))); }
function activityTitle(group: FindingGroup) { const first = group.findings[0]!; const value = first.displayValue; if (group.findings.length > 1 && first.type.includes("VARIANCE")) return `${group.agent.name} found differences in ${group.findings.length} tanks`; if (first.type.includes("SHIFT_RECONCILIATION") && typeof value === "number" && value > 1) return `${group.agent.name} found ${value} shifts waiting for review`; if (first.type.includes("INVENTORY_EMPTY")) return "A stock position is empty"; if (first.type.includes("DENSITY_READING_MISSING")) return "A morning density reading is missing"; if (first.type.includes("RECEIPT_TIMING")) return "A fuel receipt needs a timing check"; if (first.type.includes("PROFIT_POSITION")) return "The recorded profit position is ready"; return first.title; }
function activityMessage(group: FindingGroup) { const first = group.findings[0]!; if (group.findings.length > 1 && first.type.includes("VARIANCE")) return `I compared the latest physical readings with the recorded stock and found differences in ${group.findings.length} tank positions.`; if (first.type.includes("SHIFT_RECONCILIATION")) return `I checked the closed shifts. ${formatValue(first.displayValue)} still need to be reconciled and locked.`; if (first.type.includes("INVENTORY_EMPTY")) return "I checked the current stock position. No available stock remains in the recorded balance."; if (first.type.includes("PHYSICAL_BOOK_VARIANCE")) return "I compared the latest physical reading with the recorded stock and found a difference."; if (first.type.includes("DENSITY_READING_MISSING")) return "I checked the tank records. A morning density reading has not been entered."; if (first.type.includes("RECEIPT_TIMING")) return "I compared the recorded receipt and entry times. The physical delivery time may need confirmation."; if (first.type.includes("PROFIT_POSITION")) return "I checked the posted financial records and brought the selected period’s result together for review."; return `I checked the available records. ${first.whyItMatters}`; }
function activityNextStep(group: FindingGroup) { const first = group.findings[0]!; if (group.findings.length > 1 && first.type.includes("VARIANCE")) return "Let me compare their readings, movements and recent receipts together."; return first.recommendedNextStep; }
function latestFindingTime(findings: NerveFinding[]) { return findings.reduce((latest, finding) => Date.parse(finding.calculatedAt) > Date.parse(latest) ? finding.calculatedAt : latest, findings[0]?.calculatedAt ?? new Date(0).toISOString()); }
function groupPriority(group: FindingGroup) { return group.findings.some(finding => finding.priorityRank === 1) ? 0 : 1; }
function recordLinkLabel(path: string) { if (path === "/inventory") return "View inventory"; if (path === "/reconciliation") return "View shifts"; if (path === "/purchases") return "View purchases"; if (path === "/reports") return "View report"; return "View record"; }
function briefingHeadline(headline: string) { return headline.replace(/^Investigation:\s*/i, ""); }
function uniqueEvidence(findings: NerveFinding[]) { return [...new Map(findings.flatMap((finding) => finding.evidence).map((record) => [record.resolverPath, record])).values()]; }
function uniqueStrings(values: string[]) { return [...new Set(values)]; }
function formatDateTime(value: string) { return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }); }
function formatValue(value: unknown): string { if (typeof value === "number") return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value); if (typeof value === "string") return value === "MISSING" ? "Not recorded" : value; if (value && typeof value === "object" && !Array.isArray(value)) { const row = value as Record<string, unknown>; if (typeof row.netProfit === "number") return `Net result ${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(row.netProfit)}`; } return "Review the source records"; }
function relativeTime(value: string) { const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000)); return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} hr ago`; }
function agentStateLabel(agent: TeamAgent) { if (agent.status === "AWAITING_REVIEW") return "Awaiting first review"; if (agent.status === "NEEDS_ATTENTION") return "Needs your attention"; if (agent.status === "ALL_CLEAR") return "All clear"; return `${agent.findings.length} thing${agent.findings.length === 1 ? "" : "s"} found`; }
function agentSummaryTitle(agent: TeamAgent) { if (agent.status === "AWAITING_REVIEW") return "I’m waiting for verified records to review."; if (agent.status === "ALL_CLEAR") return "Nothing needs your attention right now."; return agent.findings.length === 1 ? "I found one thing for you to review." : `I found ${agent.findings.length} things for you to review.`; }
function agentSummaryText(agent: TeamAgent) { if (agent.status === "AWAITING_REVIEW") return "I won’t guess or create an insight without a completed, evidence-backed review."; if (agent.status === "ALL_CLEAR") return "I checked the available records and did not find an issue that needs action."; return "The most important item appears first. Open it to see why it matters and the records behind it."; }
function agentAnchor(agentKey: string) { return `agent-${agentKey.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`; }
function dayGreeting() { const hour = new Date().getHours(); return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"; }
