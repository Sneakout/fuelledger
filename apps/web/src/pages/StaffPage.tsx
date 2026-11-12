import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Gauge,
  History,
  IndianRupee,
  KeyRound,
  LockKeyhole,
  Mail,
  Plus,
  Radio,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import {
  ApiRequestError,
  api,
  type AccessBootstrap,
  type ShiftBootstrap,
  type StaffDeactivationCheck,
} from "../lib/api";
import { useAuth } from "../components/AuthProvider";
import { useStation } from "../components/StationProvider";

export function StaffPage() {
  const { user } = useAuth();
  const { selectedStationId, selectedStation } = useStation();
  const [data, setData] = useState<AccessBootstrap | null>(null);
  const [shifts, setShifts] = useState<ShiftBootstrap | null>(null);
  const [name, setName] = useState("");
  const [manager, setManager] = useState({
    name: "",
    email: "",
    temporaryPassword: "",
    stationId: "",
  });
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [removal, setRemoval] = useState<{
    member: AccessBootstrap["users"][number];
    check: StaffDeactivationCheck | null;
    loading: boolean;
    error: string;
  } | null>(null);
  const load = async () => {
    const [access, shiftData] = await Promise.all([
      api.accessBootstrap(),
      api.shiftBootstrap(),
    ]);
    setData(access);
    setShifts(shiftData);
  };

  useEffect(() => {
    if (user?.role === "OWNER")
      void load().catch((item) =>
        setError(
          item instanceof ApiRequestError
            ? item.message
            : "Unable to load staff.",
        ),
      );
  }, [user]);
  const station = data?.stations.find((item) => item.id === selectedStationId);
  const nozzles = useMemo(
    () =>
      station?.configurations?.[0]?.dispensers.flatMap((dispenser) =>
        dispenser.nozzles.map((nozzle) => ({ ...nozzle, dispenser })),
      ) ?? [],
    [station],
  );
  const currentShift = useMemo(
    () =>
      shifts?.shifts.find(
        (shift) =>
          shift.status === "OPEN" && shift.station.id === selectedStationId,
      ),
    [shifts, selectedStationId],
  );
  useEffect(() => {
    setAssignments(
      Object.fromEntries(
        nozzles.map((row) => [
          row.id,
          currentShift
            ? currentShift.nozzleAssignments.find(
              (assignment) => assignment.nozzleId === row.id,
            )?.userId ?? ""
            : row.attendantAssignment?.userId ?? "",
        ]),
      ),
    );
  }, [selectedStationId, data, currentShift]);

  if (user?.role !== "OWNER")
    return (
      <main className="page">
        <div className="form-error">
          Only the owner can manage staff and nozzle custody.
        </div>
      </main>
    );
  if (!selectedStationId)
    return (
      <main className="page">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Staff & access</span>
            <h1>Select a petrol pump</h1>
            <p>
              Choose a petrol pump from the sidebar to manage its staff and
              nozzles.
            </p>
          </div>
        </div>
      </main>
    );
  if (!data || !shifts)
    return (
      <main className="page">
        <div className="loading">
          <span />
          <p>Preparing staff workspace…</p>
        </div>
      </main>
    );

  const staff = data.users.filter(
    (member) =>
      member.role === "STAFF" && member.stationIds.includes(selectedStationId),
  );
  const managers = data.users.filter(
    (member) =>
      member.role === "MANAGER" &&
      member.stationIds.includes(selectedStationId),
  );
  const team = staff;
  const assignedNozzles = nozzles.filter((row) => assignments[row.id]).length;
  const create = async () => {
    setSaving(true);
    setError("");
    try {
      await api.createStaff({ name, stationIds: [selectedStationId] });
      setName("");
      setMessage("Staff member added. No login account was created.");
      await load();
    } catch (item) {
      setError(
        item instanceof ApiRequestError ? item.message : "Unable to add staff.",
      );
    } finally {
      setSaving(false);
    }
  };
  const createManager = async () => {
    setSaving(true);
    setError("");
    try {
      await api.createManager({ ...manager, stationId: selectedStationId });
      setManager({ name: "", email: "", temporaryPassword: "", stationId: "" });
      setMessage(
        "Manager login created. They must change the temporary password when they first sign in.",
      );
      await load();
    } catch (item) {
      setError(
        item instanceof ApiRequestError
          ? item.message
          : "Unable to create manager login.",
      );
    } finally {
      setSaving(false);
    }
  };
  const beginRemoval = async (member: AccessBootstrap["users"][number]) => {
    setRemoval({ member, check: null, loading: true, error: "" });
    try {
      const check = await api.staffDeactivationCheck(member.id);
      setRemoval({ member, check, loading: false, error: "" });
    } catch (item) {
      setRemoval({
        member,
        check: null,
        loading: false,
        error:
          item instanceof ApiRequestError
            ? item.message
            : "Unable to check this team member’s records.",
      });
    }
  };
  const confirmRemoval = async () => {
    if (!removal?.check?.canDeactivate) return;
    setSaving(true);
    setRemoval({ ...removal, loading: true, error: "" });
    try {
      const result = await api.deactivateStaff(removal.member.id);
      setMessage(
        `${removal.member.name} was deactivated. Historical shifts, sales and transactions were preserved${result.clearedDefaultNozzles ? `; ${result.clearedDefaultNozzles} nozzle default${result.clearedDefaultNozzles === 1 ? " was" : "s were"} cleared` : ""}.`,
      );
      setRemoval(null);
      await load();
    } catch (item) {
      setRemoval({
        ...removal,
        loading: false,
        error:
          item instanceof ApiRequestError
            ? item.message
            : "Unable to deactivate this team member.",
      });
    } finally {
      setSaving(false);
    }
  };
  const saveCustody = async () => {
    if (currentShift) {
      setError("Nozzle assignments are locked until the open shift closes.");
      return;
    }
    if (!nozzles.length) {
      setError("Configure active nozzles for this petrol pump first.");
      return;
    }
    const rows = nozzles.map((row) => ({
      nozzleId: row.id,
      userId: assignments[row.id] ?? "",
    })).filter((row) => row.userId);
    setSaving(true);
    setError("");
    try {
      await api.updateDefaultNozzleAssignments(
        selectedStationId,
        rows,
      );
      setMessage("Assignment defaults saved for the next shift opening.");
      await load();
    } catch (item) {
      setError(
        item instanceof ApiRequestError
          ? item.message
          : "Unable to save nozzle assignments.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="page staff-page">
      <div className="staff-heading">
        <div>
          <span className="eyebrow">People & permissions</span>
          <h1>Team control for {selectedStation?.name ?? station?.name}</h1>
          <p>Give managers secure access, keep attendants organised, and set optional nozzle custody from one place.</p>
        </div>
        <span className={`staff-live-state ${currentShift ? "open" : "ready"}`}><Radio />{currentShift ? `Shift #${currentShift.shiftNumber} open` : "Ready for next shift"}</span>
      </div>
      {message && <div className="success-banner">{message}</div>}
      {error && <div className="form-error">{error}</div>}
      <section className="staff-overview" aria-label="Staff and access overview">
        <article><span><ShieldCheck /></span><div><small>Manager logins</small><b>{managers.length}</b><em>Private station access</em></div></article>
        <article><span><UsersRound /></span><div><small>Active attendants</small><b>{staff.length}</b><em>Operational team</em></div></article>
        <article><span><Gauge /></span><div><small>{currentShift ? "Shift assignments" : "Nozzle defaults"}</small><b>{assignedNozzles} of {nozzles.length}</b><em>{currentShift ? "Locked until shift closes" : "Optional opening suggestions"}</em></div></article>
      </section>

      <div className="staff-management-grid">
        <section className="manager-panel">
          <header className="staff-section-heading">
            <span className="manager-icon"><ShieldCheck /></span>
            <div><span className="eyebrow">Secure access</span><h2>Managers</h2><p>Managers receive a private login restricted to this petrol pump.</p></div>
          </header>
          <form className="manager-form" onSubmit={(event) => { event.preventDefault(); void createManager(); }}>
            <label><span>Full name</span><div className="staff-input"><UserRound /><input aria-label="Manager full name" placeholder="Manager name" value={manager.name} onChange={(event) => setManager({ ...manager, name: event.target.value })}/></div></label>
            <label><span>Email address</span><div className="staff-input"><Mail /><input aria-label="Manager email address" type="email" placeholder="manager@company.in" value={manager.email} onChange={(event) => setManager({ ...manager, email: event.target.value })}/></div></label>
            <label><span>Temporary password</span><div className="staff-input"><KeyRound /><input aria-label="Manager temporary password" type="password" placeholder="At least 8 characters" value={manager.temporaryPassword} onChange={(event) => setManager({ ...manager, temporaryPassword: event.target.value })}/></div></label>
            <button className="primary small" disabled={saving || manager.name.trim().length < 2 || !manager.email || manager.temporaryPassword.length < 8}><Plus /> Create manager login</button>
          </form>
          <div className="manager-list">
            <header><b>Manager accounts</b><span>{managers.length}</span></header>
            {managers.map((member) => <article key={member.id}><span className="avatar">{member.name.slice(0, 2).toUpperCase()}</span><div><b>{member.name}</b><small>{member.email}</small></div><span className="manager-login-state">{member.mustChangePassword ? "First login pending" : member.lastLoginAt ? "Login active" : "Ready to sign in"}</span><button className="remove" aria-label={`Deactivate ${member.name}`} onClick={() => void beginRemoval(member)}><Trash2 /></button></article>)}
            {!managers.length && <div className="staff-empty compact"><span><ShieldCheck /></span><b>No manager login yet</b><small>Create one when this station needs delegated access.</small></div>}
          </div>
        </section>

        <section className="staff-panel">
          <header className="staff-section-heading"><span className="attendant-icon"><UsersRound /></span><div><span className="eyebrow">Shift team</span><h2>Attendants</h2><p>Attendants appear in shift and nozzle workflows. They do not receive a login.</p></div></header>
          <form className="staff-add" onSubmit={(event) => { event.preventDefault(); void create(); }}><label htmlFor="staff-name">Add an attendant</label><div><input id="staff-name" placeholder="Attendant name" value={name} onChange={(event) => setName(event.target.value)}/><button className="primary small" disabled={saving || name.trim().length < 2}><Plus /> Add attendant</button></div></form>
          <div className="staff-roster">
            <header><b>Active attendants</b><span>{staff.length}</span></header>
            {staff.map((member) => <div className="staff-row" key={member.id}><span className="avatar">{member.name.slice(0, 2).toUpperCase()}</span><div><b>{member.name}</b><small>Available for shifts</small></div><span className="staff-status">Active</span><button className="remove" aria-label={`Deactivate ${member.name}`} onClick={() => void beginRemoval(member)}><Trash2 /></button></div>)}
            {!staff.length && <div className="staff-empty compact"><span><UserRound /></span><b>No attendants yet</b><small>Add the first attendant above.</small></div>}
          </div>
        </section>
      </div>

      <section className="nozzle-custody">
        <header>
          <div className="staff-section-heading"><span className="nozzle-icon"><Gauge /></span><div><span className="eyebrow">Shift custody</span><h2>Nozzle assignments</h2><p>{currentShift ? `Confirmed when shift #${currentShift.shiftNumber} opened. These assignments cannot change until the shift closes.` : "Set optional suggestions for the next opening. The final assignments are confirmed when the shift opens."}</p></div></div>
          {currentShift ? (
            <span className="nozzle-lock-state"><ShieldCheck /> Locked until shift closes</span>
          ) : (
            <button
              className="primary small"
              disabled={saving || !staff.length || !nozzles.length}
              onClick={() => void saveCustody()}
            >
              <Save /> Save opening defaults
            </button>
          )}
        </header>
        {!nozzles.length ? (
          <div className="staff-empty">
            <b>No active nozzles yet</b>
            <small>
              Add dispensing units and nozzles in Petrol pumps first.
            </small>
          </div>
        ) : (
          <div className="custody-grid">
            {nozzles.map((row) => (
              <label key={row.id} className={currentShift ? "locked" : undefined}>
                <span>
                  <b>
                    {row.dispenser.code} / {row.code}
                  </b>
                  <small>
                    {row.product.code}
                    {row.dispenser.location
                      ? ` · ${row.dispenser.location}`
                      : ""}
                  </small>
                </span>
                <select
                  value={assignments[row.id] ?? ""}
                  aria-label={`Attendant for ${row.dispenser.code} / ${row.code}`}
                  disabled={!staff.length || Boolean(currentShift)}
                  onChange={(event) =>
                    setAssignments({
                      ...assignments,
                      [row.id]: event.target.value,
                    })
                  }
                >
                  <option value="">
                    {currentShift
                      ? "Unassigned for this shift"
                      : staff.length
                        ? "No default attendant"
                        : "Add an attendant first"}
                  </option>
                  {team.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
                {assignments[row.id] && <Check />}
              </label>
            ))}
          </div>
        )}
      </section>
      {removal && (
        <div
          className="staff-removal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.currentTarget === event.target &&
              !removal.loading &&
              !saving
            )
              setRemoval(null);
          }}
        >
          <section
            className="staff-removal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-removal-title"
          >
            <header>
              <span><UserRound /></span>
              <div>
                <small>Deactivate team member</small>
                <h2 id="staff-removal-title">Check {removal.member.name} first</h2>
                <p>This removes future access and assignments—not historical records.</p>
              </div>
              <button
                type="button"
                aria-label="Close deactivation check"
                disabled={removal.loading || saving}
                onClick={() => setRemoval(null)}
              >
                <X />
              </button>
            </header>
            {removal.loading && !removal.check ? (
              <div className="staff-removal-loading"><span /><p>Checking shifts, handovers and transaction history…</p></div>
            ) : removal.check ? (
              <div className="staff-removal-body">
                <div className={`staff-removal-result ${removal.check.canDeactivate ? "safe" : "blocked"}`}>
                  {removal.check.canDeactivate ? <Check /> : <AlertTriangle />}
                  <span>
                    <strong>{removal.check.canDeactivate ? "Safe to deactivate" : "Deactivation is blocked"}</strong>
                    <small>{removal.check.canDeactivate ? "No open shift or unresolved handover was found." : "Resolve the items below before trying again."}</small>
                  </span>
                </div>
                <div className="staff-removal-facts">
                  <article><LockKeyhole /><span><small>Open shifts</small><strong>{removal.check.activeShifts.length}</strong></span></article>
                  <article><IndianRupee /><span><small>Possible amount due</small><strong>₹{removal.check.possibleAmountDue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</strong></span></article>
                  <article><History /><span><small>Historical shifts</small><strong>{removal.check.historicalShiftCount}</strong></span></article>
                  <article><History /><span><small>Historical sales</small><strong>{removal.check.historicalSalesCount}</strong></span></article>
                </div>
                {removal.check.blockers.length > 0 && (
                  <div className="staff-removal-blockers">
                    {removal.check.blockers.map((blocker) => <p key={blocker}><AlertTriangle />{blocker}</p>)}
                  </div>
                )}
                <div className="staff-history-proof">
                  <ShieldCheck />
                  <span><strong>History will remain intact</strong><small>Past shifts, nozzle custody, sales, collections and audit records continue to show {removal.member.name}.</small></span>
                </div>
                {removal.check.defaultNozzleCount > 0 && removal.check.canDeactivate && (
                  <p className="staff-default-note">{removal.check.defaultNozzleCount} future nozzle default{removal.check.defaultNozzleCount === 1 ? "" : "s"} will be cleared automatically.</p>
                )}
              </div>
            ) : null}
            {removal.error && <div className="form-error">{removal.error}</div>}
            <footer>
              <button type="button" className="secondary" disabled={removal.loading || saving} onClick={() => setRemoval(null)}>Cancel</button>
              <button
                type="button"
                className="staff-deactivate-confirm"
                disabled={removal.loading || saving || !removal.check?.canDeactivate}
                onClick={() => void confirmRemoval()}
              >
                <Trash2 /> {removal.loading && removal.check ? "Deactivating…" : "Confirm deactivation"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
