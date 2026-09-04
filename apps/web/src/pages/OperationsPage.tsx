import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Fuel, LockKeyhole, Play } from "lucide-react";
import {
  ApiRequestError,
  api,
  type Reading,
  type Shift,
  type ShiftBootstrap,
  type ShiftStation,
} from "../lib/api";
const money = (value: string | number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value));
const captured = (value: string) =>
  new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const meterLabel = (
  dispenser: { code: string; location: string | null },
  nozzle: { code: string; product: { code: string } },
) =>
  `${dispenser.code} / ${nozzle.code} · ${nozzle.product.code}${
    dispenser.location ? ` · ${dispenser.location}` : ""
  }`;
function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
function ShiftTimes({
  shift,
  closing = false,
}: {
  shift: Shift;
  closing?: boolean;
}) {
  return (
    <section className="shift-times">
      <span>
        <Clock3 />
        <i>
          <small>Shift opened</small>
          <b>{captured(shift.openedAt)}</b>
        </i>
      </span>
      <span>
        <Clock3 />
        <i>
          <small>Shift closed</small>
          <b>
            {shift.closedAt
              ? captured(shift.closedAt)
              : closing
                ? "Captured when you close this shift"
                : "—"}
          </b>
        </i>
      </span>
      <p>Times are captured by FuelLedger’s server and cannot be edited.</p>
    </section>
  );
}
export function OperationsPage() {
  const [data, setData] = useState<ShiftBootstrap | null>(null),
    [stationId, setStationId] = useState(""),
    [managerId, setManagerId] = useState(""),
    [userIds, setUserIds] = useState<string[]>([]),
    [nozzleAssignments, setNozzleAssignments] = useState<
      Array<{ nozzleId: string; userId: string }>
    >([]),
    [openingCash, setOpeningCash] = useState(0),
    [openTanks, setOpenTanks] = useState<Reading[]>([]),
    [openNozzles, setOpenNozzles] = useState<Reading[]>([]),
    [closeCash, setCloseCash] = useState(0),
    [closeTanks, setCloseTanks] = useState<Reading[]>([]),
    [closeNozzles, setCloseNozzles] = useState<Reading[]>([]),
    [closeCollections, setCloseCollections] = useState<Reading[]>([]),
    [notes, setNotes] = useState(""),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [saving, setSaving] = useState(false);
  const load = async () => {
    setLoadError("");
    let timeoutId: number | undefined;
    try {
      const result = await Promise.race([
        api.shiftBootstrap(),
        new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(
            () => reject(new Error("SHIFT_WORKSPACE_TIMEOUT")),
            15_000,
          );
        }),
      ]);
      setData(result);
      const station =
        result.stations.find((item) => item.id === stationId) ??
        result.stations[0];
      if (station) selectStation(station, result);
    } catch (item) {
      setLoadError(
        item instanceof ApiRequestError
          ? item.message
          : "The shift workspace is taking longer than expected. Check your connection and try again.",
      );
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const selectStation = (station: ShiftStation, source = data) => {
    setStationId(station.id);
    const config = station.configurations[0];
    const last = station.lastClosing;
    setOpenTanks(
      config?.tanks.map((t) => ({ id: t.id, value: Number(last?.tankReadings.find(reading=>reading.id===t.id)?.value??station.availableTankStock.find(reading=>reading.id===t.id)?.value??t.openingStock) })) ??
        [],
    );
    setOpenNozzles(
      config?.dispensers.flatMap((d) =>
        d.nozzles.map((n) => ({ id: n.id, value: Number(last?.nozzleReadings.find(reading=>reading.id===n.id)?.value??n.openingMeter) })),
      ) ?? [],
    );
    const stationUsers =
      source?.users.filter(
        (user) =>
          user.role === "OWNER" || user.stationIds.includes(station.id),
      ) ?? [];
    const manager =
      stationUsers.find((user) => user.role === "MANAGER") ??
      stationUsers.find((user) => user.role === "OWNER");
    if (manager) {
      const configuredAssignments = config?.dispensers.flatMap((d) =>
        d.nozzles.map((n) => ({ nozzleId: n.id, userId: n.attendantAssignment?.userId ?? manager.id })),
      ) ?? [];
      const assignedAttendants = [...new Set(configuredAssignments.map(row => row.userId))];
      setManagerId(manager.id);
      setUserIds([...new Set([manager.id, ...assignedAttendants])]);
      setNozzleAssignments(configuredAssignments);
    }
  };
  const active = useMemo(
    () => data?.shifts.find((s) => s.status === "OPEN"),
    [data],
  );
  const selected = data?.stations.find((s) => s.id === stationId);
  const config = selected?.configurations[0];
  const stationUsers =
    data?.users.filter(
      (user) => user.role === "OWNER" || user.stationIds.includes(stationId),
    ) ?? [];
  const attendants = stationUsers.filter((user) => user.role === "STAFF");
  useEffect(() => {
    if (active) {
      setCloseTanks(
        active.tankReadings.map((r) => ({
          id: r.tankId,
          value: Number(r.openingDip),
        })),
      );
      setCloseNozzles(
        active.nozzleReadings.map((r) => ({
          id: r.nozzleId,
          value: Number(r.openingMeter),
        })),
      );
      setCloseCollections(
        active.nozzleAssignments.map((assignment) => ({
          id: assignment.nozzleId,
          value: Number(assignment.collectionAmount ?? 0),
        })),
      );
      setCloseCash(Number(active.openingCash));
    }
  }, [active?.id]);
  const replace = (
    items: Reading[],
    id: string,
    value: number,
    setter: (items: Reading[]) => void,
  ) =>
    setter(items.map((item) => (item.id === id ? { ...item, value } : item)));
  const assignAttendant = (nozzleId: string, userId: string) => {
    setNozzleAssignments((current) =>
      current.map((assignment) =>
        assignment.nozzleId === nozzleId
          ? { ...assignment, userId }
          : assignment,
      ),
    );
    if (userId)
      setUserIds((current) =>
        current.includes(userId) ? current : [...current, userId],
      );
  };
  async function open() {
    if (!stationId || !managerId) {
      setError("Choose a station and manager.");
      return;
    }
    if (
      !nozzleAssignments.length ||
      nozzleAssignments.some((assignment) => !assignment.userId)
    ) {
      setError("Assign an attendant to every active nozzle before opening the shift.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.openShift({
        stationId,
        managerId,
        userIds,
        nozzleAssignments,
        openingCash,
        tankReadings: openTanks,
        nozzleReadings: openNozzles,
        notes,
      });
      setNotes("");
      load();
    } catch (e) {
      setError(
        e instanceof ApiRequestError ? e.message : "Unable to open shift.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function close() {
    if (!active) return;
    setSaving(true);
    setError("");
    try {
      await api.closeShift(active.id, {
        closingCash: closeCash,
        tankReadings: closeTanks,
        nozzleReadings: closeNozzles,
        nozzleCollections: closeCollections.map((item) => ({
          nozzleId: item.id,
          amount: item.value,
        })),
        notes,
      });
      setNotes("");
      load();
    } catch (e) {
      setError(
        e instanceof ApiRequestError ? e.message : "Unable to close shift.",
      );
    } finally {
      setSaving(false);
    }
  }
  if (!data)
    return (
      <main className="page">
        {loadError ? (
          <section className="empty-state" role="alert">
            <h2>Shift workspace did not load</h2>
            <p>{loadError}</p>
            <button className="primary small" onClick={() => void load()}>
              Try again
            </button>
          </section>
        ) : (
          <div className="loading">
            <span />
            <p>Preparing shift workspace…</p>
          </div>
        )}
      </main>
    );
  if (active)
    return (
      <main className="page">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Open shift · #{active.shiftNumber}</span>
            <h1>{active.station.name} is running</h1>
            <p>
              Manager: {active.manager.name}. Enter only the closing readings
              when the shift ends.
            </p>
          </div>
          <span className="shift-status open">
            <Clock3 size={15} /> Open now
          </span>
        </div>
        {error && <div className="form-error">{error}</div>}
        <ShiftTimes shift={active} closing />
        <section className="shift-grid">
          <article className="reading-panel">
            <h2>Close the shift</h2>
            <p>
              FuelLedger compares these readings with the opening figures
              automatically.
            </p>
            <Field
              label="Actual closing cash"
              value={closeCash}
              onChange={setCloseCash}
            />
            <Readings
              title="Closing tank readings"
              items={active.tankReadings.map((r) => ({
                id: r.tankId,
                label: `${r.tank.code} · ${r.tank.product.code}`,
                opening: Number(r.openingDip),
              }))}
              values={closeTanks}
              onChange={(v) =>
                replace(closeTanks, v.id, v.value, setCloseTanks)
              }
            />
            <div className="nozzle-closing">
              <div className="nozzle-closing-heading">
                <div>
                  <h3>Nozzle closing & staff collection</h3>
                  <p>
                    Enter the closing meter and money handed over. Fuel sales are
                    calculated and added to Sales automatically.
                  </p>
                </div>
                <span>
                  Total handed over
                  <strong>{money(closeCollections.reduce((sum, item) => sum + item.value, 0))}</strong>
                </span>
              </div>
              <div className="nozzle-closing-table">
                <div className="nozzle-closing-head" aria-hidden="true">
                  <span>Nozzle & product</span>
                  <span>Attendant</span>
                  <span>Opening meter (L)</span>
                  <span>Closing meter (L)</span>
                  <span>Collection (₹)</span>
                </div>
                {active.nozzleReadings.map((reading) => {
                  const assignment = active.nozzleAssignments.find(
                    (item) => item.nozzleId === reading.nozzleId,
                  );
                  return (
                    <div className="nozzle-closing-row" key={reading.nozzleId}>
                      <span className="nozzle-identity">
                        <b>{meterLabel(reading.nozzle.dispenser, reading.nozzle)}</b>
                        <small>{reading.nozzle.product.name}</small>
                      </span>
                      <span className="nozzle-attendant" data-label="Attendant">
                        {assignment?.user.name ?? "Not assigned"}
                      </span>
                      <span className="opening-meter" data-label="Opening meter (L)">
                        {Number(reading.openingMeter).toLocaleString("en-IN")}
                      </span>
                      <label data-label="Closing meter (L)">
                        <input
                          aria-label={`Closing meter in litres for ${reading.nozzle.code}`}
                          type="number"
                          min={Number(reading.openingMeter)}
                          step="0.001"
                          value={closeNozzles.find((item) => item.id === reading.nozzleId)?.value ?? 0}
                          onChange={(event) =>
                            replace(closeNozzles, reading.nozzleId, Number(event.target.value), setCloseNozzles)
                          }
                        />
                      </label>
                      <label className="collection-field" data-label="Collection (₹)">
                        <input
                          aria-label={`Collection in rupees from ${assignment?.user.name ?? reading.nozzle.code}`}
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={closeCollections.find((item) => item.id === reading.nozzleId)?.value || ""}
                          onChange={(event) =>
                            replace(
                              closeCollections,
                              reading.nozzleId,
                              event.target.value === "" ? 0 : Number(event.target.value),
                              setCloseCollections,
                            )
                          }
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
            <label className="field">
              <span>Close note (optional)</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <button
              className="primary"
              disabled={saving}
              onClick={() => void close()}
            >
              <LockKeyhole size={17} /> Close & review shift
            </button>
          </article>
          <ShiftSummary
            shift={active}
            closingCash={closeCash}
            closeNozzles={closeNozzles}
            staffCollections={closeCollections.reduce((sum, item) => sum + item.value, 0)}
          />
        </section>
      </main>
    );
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Shift operations</span>
          <h1>Start a shift in minutes</h1>
          <p>
            Capture the starting point once. Everything else can follow from the
            equipment and transactions.
          </p>
        </div>
        <span className="shift-status ready">
          <CheckCircle2 size={15} /> Ready to open
        </span>
      </div>
      {error && <div className="form-error">{error}</div>}
      <section className="shift-grid">
        <article className="reading-panel">
          <h2>Open shift</h2>
          <p className="time-note">
            <Clock3 /> Opening time is captured automatically when you open the
            shift.
          </p>
          <div className="form-grid compact">
            <label className="field">
              <span>Station</span>
              <select
                value={stationId}
                onChange={(e) => {
                  const next = data.stations.find(
                    (s) => s.id === e.target.value,
                  );
                  if (next) selectStation(next);
                }}
              >
                {data.stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Shift manager</span>
              <select
                value={managerId}
                onChange={(e) => setManagerId(e.target.value)}
              >
                {stationUsers
                  .filter((user) => ["OWNER", "MANAGER"].includes(user.role))
                  .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.role.toLowerCase()}
                  </option>
                  ))}
              </select>
            </label>
          </div>
          <Field
            label="Opening cash"
            value={openingCash}
            onChange={setOpeningCash}
          />
          <Readings
            title="Opening tank readings"
            items={
              config?.tanks.map((t) => ({
                id: t.id,
                label: `${t.code} · ${t.product.code}`,
                opening: Number(selected?.lastClosing?.tankReadings.find(reading=>reading.id===t.id)?.value??selected?.availableTankStock.find(reading=>reading.id===t.id)?.value??t.openingStock),
              })) ?? []
            }
            values={openTanks}
            onChange={(v) => replace(openTanks, v.id, v.value, setOpenTanks)}
            locked
          />
          <section className="opening-nozzle-table">
            <h3>Opening meter readings & attendants</h3>
            <div className="opening-nozzle-head" aria-hidden="true">
              <span>Nozzle & product</span>
              <span>Assigned attendant</span>
              <span>Opening meter (L)</span>
            </div>
            {config?.dispensers.flatMap((dispenser) =>
              dispenser.nozzles.map((nozzle) => {
                const reading = openNozzles.find((item) => item.id === nozzle.id);
                const assignment = nozzleAssignments.find(
                  (item) => item.nozzleId === nozzle.id,
                );
                return (
                  <div className="opening-nozzle-row" key={nozzle.id}>
                    <span>
                      <b>{meterLabel(dispenser, nozzle)}</b>
                      <small>{nozzle.product.name}</small>
                    </span>
                    <label>
                      <small>Assigned attendant</small>
                      <select
                        value={assignment?.userId ?? ""}
                        onChange={(event) =>
                          assignAttendant(nozzle.id, event.target.value)
                        }
                      >
                        <option value="">Choose attendant</option>
                        {attendants.map((attendant) => (
                          <option key={attendant.id} value={attendant.id}>
                            {attendant.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="opening-nozzle-value">
                      <small>Opening meter (L)</small>
                      <output>
                        {(reading?.value ?? 0).toLocaleString("en-IN")} L
                      </output>
                    </span>
                  </div>
                );
              }),
            )}
            {!attendants.length && (
              <p className="opening-nozzle-help">
                Add attendants in Staff & access to make them available here.
              </p>
            )}
          </section>
          <label className="field">
            <span>Opening note (optional)</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button
            className="primary"
            disabled={saving || !stationId}
            onClick={() => void open()}
          >
            <Play size={17} /> Open shift
          </button>
        </article>
        <article className="manager-card">
          <span className="metric-icon green">
            <Fuel />
          </span>
          <span className="eyebrow">Simple by design</span>
          <h2>A calm start. A clear finish.</h2>
          <p>
            Pick the station and people, confirm cash and readings, then open.
            At close, enter the final readings and FuelLedger makes the summary.
          </p>
        </article>
      </section>
      <section className="recent-shifts">
        <h2>Recent shifts</h2>
        {data.shifts
          .filter((s) => s.status !== "OPEN")
          .map((s) => (
            <div key={s.id}>
              <span>
                <strong>
                  #{s.shiftNumber} · {s.station.name}
                </strong>
                <small>
                  Opened {captured(s.openedAt)} · Closed{" "}
                  {s.closedAt ? captured(s.closedAt) : "—"}
                </small>
              </span>
              <span>{s.status.replaceAll("_", " ")}</span>
              <span>{s.summary.fuelVolume.toLocaleString()} L metered</span>
            </div>
          ))}
        {!data.shifts.length && <p>No shifts yet. Open the first one above.</p>}
      </section>
    </main>
  );
}
function Readings({
  title,
  items,
  values,
  onChange,
  locked = false,
}: {
  title: string;
  items: Array<{ id: string; label: string; opening: number }>;
  values: Reading[];
  onChange(value: Reading): void;
  locked?: boolean;
}) {
  return (
    <section className="shift-readings">
      <h3>{title}</h3>
      {items.map((item) => {
        const value = values.find((v) => v.id === item.id)?.value ?? 0;
        return (
          <label key={item.id}>
            <span>
              <strong>{item.label}</strong>
              <small>
                {locked
                  ? "Automatically from previous shift closing"
                  : `Opening: ${item.opening.toLocaleString()}`}
              </small>
            </span>
            {locked ? (
              <output>{value.toLocaleString("en-IN")} L</output>
            ) : (
              <input
                type="number"
                min="0"
                value={value}
                onChange={(e) =>
                  onChange({ id: item.id, value: Number(e.target.value) })
                }
              />
            )}
          </label>
        );
      })}
    </section>
  );
}
function ShiftSummary({
  shift,
  closingCash,
  closeNozzles,
  staffCollections,
}: {
  shift: Shift;
  closingCash: number;
  closeNozzles: Reading[];
  staffCollections: number;
}) {
  const volume = shift.nozzleReadings.reduce(
    (sum, r) =>
      sum +
      Math.max(
        0,
        (closeNozzles.find((x) => x.id === r.nozzleId)?.value ??
          Number(r.openingMeter)) - Number(r.openingMeter),
      ),
    0,
  );
  return (
    <article className="shift-summary">
      <span className="eyebrow">Shift summary preview</span>
      <h2>Here’s what we captured</h2>
      <div>
        <span>Opening cash</span>
        <strong>{money(shift.openingCash)}</strong>
      </div>
      <div>
        <span>Closing cash</span>
        <strong>{money(closingCash)}</strong>
      </div>
      <div>
        <span>Metered volume</span>
        <strong>
          {volume.toLocaleString(undefined, { maximumFractionDigits: 3 })} L
        </strong>
      </div>
      <div>
        <span>Staff collections handed over</span>
        <strong>{money(staffCollections)}</strong>
      </div>
      <div>
        <span>Readings</span>
        <strong>
          {shift.nozzleReadings.length} nozzles · {shift.tankReadings.length}{" "}
          tanks
        </strong>
      </div>
    </article>
  );
}
