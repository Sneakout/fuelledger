import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, BellRing, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, type OwnerApproval } from "../lib/api";

const dismissalKey = "fuelnerve:approval-reminder-signature";
const dismissedSignature = () => {
  try { return window.sessionStorage.getItem(dismissalKey); }
  catch { return null; }
};
const rememberDismissal = (signature: string) => {
  try { window.sessionStorage.setItem(dismissalKey, signature); }
  catch { /* reminders still work when browser storage is unavailable */ }
};

export function OwnerApprovalReminder({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<OwnerApproval[]>([]);
  const [open, setOpen] = useState(false);
  const signature = useMemo(() => pending.map(item => `${item.id}:${item.version}`).sort().join("|"), [pending]);
  const load = useCallback(async () => {
    if (!enabled) return;
    try { setPending((await api.approvals("PENDING")).approvals); } catch { /* the approval page shows actionable errors */ }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    const onChanged = () => void load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("fuelnerve:approvals-changed", onChanged);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); window.removeEventListener("fuelnerve:approvals-changed", onChanged); };
  }, [enabled, load]);

  useEffect(() => {
    if (!signature) { setOpen(false); return; }
    setOpen(dismissedSignature() !== signature);
  }, [signature]);

  function later() { rememberDismissal(signature); setOpen(false); }
  if (!enabled || !open || pending.length === 0) return null;
  return <div className="approval-reminder" role="dialog" aria-modal="false" aria-labelledby="approval-reminder-title"><button className="approval-reminder-close" aria-label="Remind me later" onClick={later}><X /></button><span className="approval-reminder-icon"><BellRing /></span><div><small>Owner approval</small><h2 id="approval-reminder-title">{pending.length === 1 ? "One decision is waiting" : `${pending.length} decisions are waiting`}</h2><p>Review price, stock and product requests before they are applied.</p></div><footer><button onClick={later}>Later</button><button onClick={() => { later(); navigate("/approvals"); }}>Review now <ArrowRight /></button></footer></div>;
}
