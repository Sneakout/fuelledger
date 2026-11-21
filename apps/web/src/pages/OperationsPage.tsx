import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Beaker, CheckCircle2, Clock3, Fuel, LockKeyhole, Play, RefreshCw } from "lucide-react";
import {
  ApiRequestError,
  api,
  type ClosingNozzleReading,
  type Reading,
  type Shift,
  type ShiftBootstrap,
  type ShiftReceipt,
  type ShiftDetail,
  type ShiftStation,
} from "../lib/api";
import { useStation } from "../components/StationProvider";
import { formatIndiaDateTime } from "../lib/india-time";
const money = (value: string | number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value));
const cashMoney = (value: string | number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
const captured = (value: string) => `${formatIndiaDateTime(value)} IST`;
const meterLabel = (
  dispenser: { code: string; location: string | null },
  nozzle: { code: string; product: { code: string } },
) =>
  `${dispenser.code} / ${nozzle.code} · ${nozzle.product.code}${
    dispenser.location ? ` · ${dispenser.location}` : ""
  }`;
const litres = (value: number) => `${value.toLocaleString("en-IN", { maximumFractionDigits: 3 })} L`;
function bridgeValues(shift: Shift, tankId: string, actual: number, closingMeters: Reading[], testing: ClosingNozzleReading[]) {
  const tank = shift.tankReadings.find((reading) => reading.tankId === tankId)!;
  const nozzleIds = new Set(tank.stockBridge.nozzles.map((nozzle) => nozzle.id));
  const contributions = shift.nozzleReadings.filter((reading) => nozzleIds.has(reading.nozzleId)).map((reading) => {
    const test = testing.find((item) => item.id === reading.nozzleId);
    const quantity = test?.testingQuantity ?? 0;
    const closing = closingMeters.find((item) => item.id === reading.nozzleId)?.value ?? Number(reading.openingMeter);
    return {
      id: reading.nozzleId,
      code: tank.stockBridge.nozzles.find((nozzle) => nozzle.id === reading.nozzleId)?.code ?? reading.nozzle.code,
      sales: tank.stockBridge.nozzles.find(nozzle => nozzle.id === reading.nozzleId)?.counter ? 0 : Math.max(0, closing - Number(reading.openingMeter) - quantity),
      testingLoss: test?.testingReturned === false ? quantity : 0,
    };
  });
  const sales = tank.stockBridge.postedSales !== undefined ? Number(tank.stockBridge.postedSales) : Number(tank.stockBridge.counterSales ?? 0) + contributions.reduce((sum, item) => sum + item.sales, 0);
  const testingLoss = tank.stockBridge.postedTestingLoss !== undefined ? Number(tank.stockBridge.postedTestingLoss) : contributions.reduce((sum, item) => sum + item.testingLoss, 0);
  const expected = Number(tank.openingDip) + Number(tank.stockBridge.received) + Number(tank.stockBridge.adjustments) - sales - testingLoss;
  return { tank, contributions, sales, testingLoss, expected, difference: actual - expected };
}
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
        step="0.01"
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
      <p>Times are captured by FuelNerve’s server and cannot be edited.</p>
    </section>
  );
}
export function OperationsPage() {
  const navigate = useNavigate();
  const { selectedStationId, selectStation: selectWorkspaceStation } = useStation();
  const editedOpeningTanks = useRef(new Set<string>());
  const receiptHistory = useRef<HTMLDetailsElement>(null);
  const requestedShiftId = new URLSearchParams(window.location.search).get("shiftId");
  const [data, setData] = useState<ShiftBootstrap | null>(null),
    [stationId, setStationId] = useState(""),
    [managerId, setManagerId] = useState(""),
    [userIds, setUserIds] = useState<string[]>([]),
    [nozzleAssignments, setNozzleAssignments] = useState<
      Array<{ nozzleId: string; userId: string }>
    >([]),
    [openingCash, setOpeningCash] = useState(0),
    [cashAdded, setCashAdded] = useState(0),
    [cashRemoved, setCashRemoved] = useState(0),
    [cashReason, setCashReason] = useState(""),
    [refreshingCash, setRefreshingCash] = useState(false),
    [cashRefreshStatus, setCashRefreshStatus] = useState(""),
    [openTanks, setOpenTanks] = useState<Reading[]>([]),
    [openNozzles, setOpenNozzles] = useState<Reading[]>([]),
    [closeCash, setCloseCash] = useState(0),
    [closeTanks, setCloseTanks] = useState<Reading[]>([]),
    [closeNozzles, setCloseNozzles] = useState<Reading[]>([]),
    [testingReadings, setTestingReadings] = useState<ClosingNozzleReading[]>([]),
    [closeCollections, setCloseCollections] = useState<Reading[]>([]),
    [notes, setNotes] = useState(""),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [saving, setSaving] = useState(false),
    [refreshingStock, setRefreshingStock] = useState(false),
    [stockRefreshStatus, setStockRefreshStatus] = useState("");
  const load = async () => {
    setLoadError("");
    let timeoutId: number | undefined;
    try {
      const result = await Promise.race([
        api.shiftBootstrap(true),
        new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(
            () => reject(new Error("SHIFT_WORKSPACE_TIMEOUT")),
            15_000,
          );
        }),
      ]);
      setData(result);
      const requestedStationId = result.shifts.find(shift => shift.id === requestedShiftId)?.station.id;
      const station =
        result.stations.find(item => item.id === requestedStationId) ??
        result.stations.find((item) => item.id === (stationId || selectedStationId)) ??
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
    editedOpeningTanks.current.clear();
    setStockRefreshStatus("");
    setStationId(station.id);
    const config = station.configurations[0];
    const last = station.lastClosing;
    setOpeningCash(Number(last?.closingCash ?? 0));
    setCashAdded(0);
    setCashRemoved(0);
    setCashReason("");
    setCashRefreshStatus("");
    setOpenTanks(
      config?.tanks.map((t) => ({ id: t.id, value: Number(station.availableTankStock.find(reading => reading.id === t.id)?.expectedOpening ?? t.openingStock) })) ??
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
        d.nozzles.map((n) => {
          const prior = last?.nozzleAssignments?.find(row => row.nozzleId === n.id)?.userId;
          const candidate = prior ?? n.attendantAssignment?.userId;
          return { nozzleId: n.id, userId: stationUsers.some(user => user.id === candidate) ? candidate! : manager.id };
        }),
      ) ?? [];
      const assignedAttendants = [...new Set(configuredAssignments.map(row => row.userId))];
      setManagerId(manager.id);
      setUserIds([...new Set([manager.id, ...assignedAttendants])]);
      setNozzleAssignments(configuredAssignments);
    }
  };
  const active = useMemo(
    () => data?.shifts.find(s => s.status === "OPEN" && s.station.id === stationId),
    [data, stationId],
  );
  const selected = data?.stations.find((s) => s.id === stationId);
  const config = selected?.configurations[0];
  const priorCash = selected?.lastClosing?.closingCash == null ? null : Number(selected.lastClosing.closingCash);
  const expectedCash = priorCash === null ? null : (Math.round(priorCash * 100) + Math.round(cashAdded * 100) - Math.round(cashRemoved * 100)) / 100;
  const cashDifference = expectedCash === null ? null : (Math.round(openingCash * 100) - Math.round(expectedCash * 100)) / 100;
  const cashReasonRequired = cashAdded > 0 || cashRemoved > 0 || (cashDifference !== null && Math.abs(cashDifference) >= 0.01) || (!!selected?.lastClosing && priorCash === null);
  async function refreshCash() {
    setRefreshingCash(true);
    setCashRefreshStatus("");
    try {
      const updated = await api.shiftBootstrap(true);
      const station = updated.stations.find(item => item.id === stationId);
      if (!station) throw new Error("Fuel station unavailable");
      setData(updated);
      // Preserve the physical count and the user's explanation for review.
      setCashRefreshStatus("Previous closing cash refreshed. Your counted cash and handover entries have been kept for review.");
    } catch {
      setError("Unable to refresh the cash handover. Try again.");
    } finally { setRefreshingCash(false); }
  }
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
      setTestingReadings(
        active.nozzleReadings.map((r) => ({
          id: r.nozzleId,
          value: Number(r.openingMeter),
          testingQuantity: Number(r.testingQuantity ?? 0),
          testingReturned: r.testingReturned ?? true,
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
  const refreshStock = async (validationMessage?: string) => {
    setRefreshingStock(true);
    if (!validationMessage) setError("");
    setStockRefreshStatus("");
    try {
      const updated = await api.shiftBootstrap(true);
      const station = updated.stations.find(item => item.id === stationId);
      if (!station) throw new Error("This fuel station is no longer available.");
      const openingChanged = station.availableTankStock.some(tank =>
        Number(tank.expectedOpening) !== Number(selected?.availableTankStock.find(before => before.id === tank.id)?.expectedOpening),
      );
      setData(updated);
      setOpenTanks(current => current.map(reading => {
        const after = station.availableTankStock.find(tank => tank.id === reading.id);
        if (!after || editedOpeningTanks.current.has(reading.id)) return reading;
        return { ...reading, value: Number(after.expectedOpening) };
      }));
      if (!active && !validationMessage) setStockRefreshStatus(
        openingChanged ? "Expected opening stock updated." : "Stock refreshed. The expected opening is unchanged.",
      );
    } catch (error) {
      setError(validationMessage ?? (error instanceof ApiRequestError ? error.message : "Unable to refresh stock. Try again."));
    } finally {
      setRefreshingStock(false);
    }
  };
  const refreshStockButton = <button type="button" className="secondary small" disabled={refreshingStock || saving || !stationId} onClick={() => void refreshStock()}>
    <RefreshCw size={15} /> {refreshingStock ? "Refreshing stock…" : "Refresh stock"}
  </button>;
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
      setError("Choose a fuel station and manager.");
      return;
    }
    if (expectedCash !== null && expectedCash < 0) {
      setError("Cash removed cannot exceed previous closing cash plus cash added.");
      return;
    }
    if (cashReasonRequired && !cashReason.trim()) {
      setError("Add a cash handover reason before opening this shift.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.openShift({
        stationId,
        managerId,
        userIds,
        nozzleAssignments: nozzleAssignments.filter((assignment) => assignment.userId),
        openingCash,
        cashHandover: {
          previousShiftId: selected?.lastClosing?.shiftId ?? null,
          previousClosingCash: priorCash,
          added: cashAdded,
          removed: cashRemoved,
          reason: cashReason,
        },
        tankReadings: openTanks,
        nozzleReadings: openNozzles,
        notes,
      });
      setNotes("");
      await load();
    } catch (e) {
      const message = e instanceof ApiRequestError ? e.message : "Unable to open shift.";
      setError(message);
      if (e instanceof ApiRequestError && e.code === "OPENING_TANK_VARIANCE_NOTE_REQUIRED") await refreshStock(message);
      if (e instanceof ApiRequestError && e.code === "CASH_HANDOVER_STALE") await refreshCash();
    } finally {
      setSaving(false);
    }
  }
  async function close() {
    if (!active) return;
    setSaving(true);
    setError("");
    try {
      const { shift } = await api.closeShift(active.id, {
        closingCash: closeCash,
        tankReadings: closeTanks,
        nozzleReadings: closeNozzles.map((reading) => {
          const testing = testingReadings.find((item) => item.id === reading.id);
          return {
            ...reading,
            testingQuantity: testing?.testingQuantity ?? 0,
            testingReturned: testing?.testingReturned ?? true,
          };
        }),
        nozzleCollections: closeCollections.map((item) => ({
          nozzleId: item.id,
          amount: item.value,
        })),
        notes,
      });
      navigate(`/reconciliation?shiftId=${encodeURIComponent(shift.id)}`);
    } catch (e) {
      const message = e instanceof ApiRequestError ? e.message : "Unable to close shift.";
      setError(message);
      if (e instanceof ApiRequestError && ["TANK_READING_UNCHANGED", "STOCK_VARIANCE_NOTE_REQUIRED"].includes(e.code)) await refreshStock(message);
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
        {error && <div className="form-error" role="alert">{error}</div>}
        <ShiftTimes shift={active} closing />
        <section className="shift-grid">
          <article className="reading-panel">
            <h2>Close the shift</h2>
            <p>
              FuelNerve compares these readings with the opening figures
              automatically.
            </p>
            <Field
              label="Physical cash counted at closing (₹)"
              value={closeCash}
              onChange={setCloseCash}
            />
            <p className="time-note">Count all notes and coins remaining, including starting cash. Excludes UPI, card and customer credit.</p>
            <div className="nozzle-closing">
              <div className="nozzle-closing-heading">
                <div>
                  <h3>Closing nozzle meter readings</h3>
                  <p>
                    Enter each closing meter and the physical cash handed over by the employee. Exclude UPI, card and credit. Fuel sales
                    are calculated and added to Sales automatically.
                  </p>
                </div>
                <span>
                  Physical cash handed over
                  <strong>{money(closeCollections.reduce((sum, item) => sum + item.value, 0))}</strong>
                </span>
              </div>
              <div className="nozzle-closing-table">
                <div className="nozzle-closing-head" aria-hidden="true">
                  <span>Nozzle & product</span>
                  <span>Attendant</span>
                  <span>Opening meter (L)</span>
                  <span>Closing meter (L)</span>
                  <span>Physical cash handed over (₹)</span>
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
                      <label className="collection-field" data-label="Physical cash handed over (₹)">
                        <input
                          aria-label={`Physical cash handed over in rupees from ${assignment?.user.name ?? reading.nozzle.code}`}
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
                      <details className="testing-entry">
                        <summary>
                          <span><Beaker size={14} /> Testing / calibration</span>
                          <small>
                            {(testingReadings.find((item) => item.id === reading.nozzleId)?.testingQuantity ?? 0) > 0
                              ? `${testingReadings.find((item) => item.id === reading.nozzleId)?.testingQuantity.toLocaleString("en-IN")} L recorded`
                              : "No testing"}
                          </small>
                        </summary>
                        <div className="testing-entry-fields">
                          <label>
                            <span>Testing quantity (L)</span>
                            <input
                              aria-label={`Testing quantity in litres for ${reading.nozzle.code}`}
                              type="number"
                              min="0"
                              max={Math.max(0, (closeNozzles.find((item) => item.id === reading.nozzleId)?.value ?? Number(reading.openingMeter)) - Number(reading.openingMeter))}
                              step="0.001"
                              value={testingReadings.find((item) => item.id === reading.nozzleId)?.testingQuantity || ""}
                              placeholder="0"
                              onChange={(event) =>
                                setTestingReadings((current) =>
                                  current.map((item) => item.id === reading.nozzleId
                                    ? { ...item, testingQuantity: event.target.value === "" ? 0 : Number(event.target.value) }
                                    : item),
                                )
                              }
                            />
                          </label>
                          <fieldset>
                            <legend>Where did the tested fuel go?</legend>
                            <label>
                              <input
                                type="radio"
                                name={`testing-return-${reading.nozzleId}`}
                                checked={testingReadings.find((item) => item.id === reading.nozzleId)?.testingReturned ?? true}
                                onChange={() => setTestingReadings((current) => current.map((item) => item.id === reading.nozzleId ? { ...item, testingReturned: true } : item))}
                              />
                              Returned to tank
                            </label>
                            <label>
                              <input
                                type="radio"
                                name={`testing-return-${reading.nozzleId}`}
                                checked={!(testingReadings.find((item) => item.id === reading.nozzleId)?.testingReturned ?? true)}
                                onChange={() => setTestingReadings((current) => current.map((item) => item.id === reading.nozzleId ? { ...item, testingReturned: false } : item))}
                              />
                              Not returned
                            </label>
                          </fieldset>
                          <p>
                            Sale volume: <strong>{Math.max(0,
                              (closeNozzles.find((item) => item.id === reading.nozzleId)?.value ?? Number(reading.openingMeter)) -
                              Number(reading.openingMeter) -
                              (testingReadings.find((item) => item.id === reading.nozzleId)?.testingQuantity ?? 0),
                            ).toLocaleString("en-IN")} L</strong>
                          </p>
                        </div>
                      </details>
                    </div>
                  );
                })}
              </div>
            </div>
            <ClosingStockBridge
              action={refreshStockButton}
              shift={active}
              actuals={closeTanks}
              closingMeters={closeNozzles}
              testing={testingReadings}
              tolerance={data.stockVarianceTolerance}
              onChange={(v) => replace(closeTanks, v.id, v.value, setCloseTanks)}
            />
            <label className="field">
              <span>Closing note {active.tankReadings.some((reading) => {
                const actual = closeTanks.find((item) => item.id === reading.tankId)?.value ?? Number(reading.openingDip);
                return Math.abs(bridgeValues(active, reading.tankId, actual, closeNozzles, testingReadings).difference) > data.stockVarianceTolerance + 0.001;
              }) ? "(required for stock difference)" : "(optional)"}</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <button
              className="primary"
              disabled={saving || refreshingStock}
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
        <ReceiptHistory key={active.station.id} stationId={active.station.id} tolerance={data.stockVarianceTolerance} />
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
      {error && <div className="form-error" role="alert">{error}</div>}
      <section className="shift-grid">
        <article className="reading-panel">
          <h2>Open shift</h2>
          <p className="time-note">
            <Clock3 /> Opening time is captured automatically when you open the
            shift.
          </p>
          <div className="form-grid compact">
            <label className="field">
              <span>Fuel station</span>
              <select
                value={stationId}
                disabled={refreshingStock || saving}
                onChange={(e) => {
                  const next = data.stations.find(
                    (s) => s.id === e.target.value,
                  );
                  if (next) {
                    selectWorkspaceStation(next.id);
                    selectStation(next);
                  }
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
          <section className="opening-cash-bridge">
            <div className="section-heading">
              <div><h3>{selected?.lastClosing ? "Opening cash handover" : "Starting cash"}</h3>
                <p>{selected?.lastClosing ? "Count the cash available at the start of this shift." : "How much cash are you starting this shift with? Enter ₹0 if there is no cash."}</p>
              </div>
              <button type="button" className="secondary small" disabled={refreshingCash || saving} onClick={() => void refreshCash()}><RefreshCw size={15} />{refreshingCash ? "Refreshing cash…" : "Refresh cash"}</button>
            </div>
            {selected?.lastClosing && <p>Previous shift #{selected.lastClosing.shiftNumber} · {captured(selected.lastClosing.closedAt)}</p>}
            {selected?.lastClosing && <div className="opening-cash-totals">
              <div><span>Previous actual closing cash</span><strong>{priorCash === null ? "Not recorded" : cashMoney(priorCash)}</strong></div>
              <div><span>Expected opening cash</span><strong>{expectedCash === null ? "Starting count required" : cashMoney(expectedCash)}</strong></div>
              <div><span>Counted difference</span><strong>{cashDifference === null ? "No previous count to compare" : cashDifference === 0 ? "Match" : `${cashDifference > 0 ? "+" : "−"}${cashMoney(Math.abs(cashDifference))}`}</strong></div>
            </div>}
            <div className="form-grid">
              <Field label="Physical cash at start (₹)" value={openingCash} onChange={setOpeningCash} />
            </div>
            <p>Required · Notes and coins available before sales begin, including change for customers. Enter ₹0 if none. Excludes UPI, card and credit.</p>
            <details className="opening-cash-details" open={cashReasonRequired || undefined}>
              <summary>Cash added, removed or handed over (if applicable)</summary>
              <p>Leave these at ₹0 unless cash was added or taken away before this shift.</p>
            <div className="form-grid">
              <Field label="Cash added between shifts (₹)" value={cashAdded} onChange={setCashAdded} />
              <Field label="Cash removed between shifts (₹)" value={cashRemoved} onChange={setCashRemoved} />
            </div>
            <label className="field"><span>Cash handover reason{cashReasonRequired ? " *" : " (optional)"}</span>
              <textarea value={cashReason} onChange={event => setCashReason(event.target.value)} required={cashReasonRequired} maxLength={500} placeholder="For example, cash handed to the owner or float added; explain any counted difference." />
            </label>
            <p>This explains the cash handover. Record related expenses, payments or bank transactions separately.</p>
            </details>
            {cashRefreshStatus && <p role="status">{cashRefreshStatus}</p>}
          </section>
          <section className="opening-nozzle-table">
            <h3>Opening nozzle meter readings</h3>
            <p className="opening-nozzle-help">
              Confirm custody now. These assignments are locked when the shift opens and remain unchanged until it closes.
            </p>
            <div className="opening-nozzle-head" aria-hidden="true">
              <span>Nozzle & product</span>
              <span>Attendant (optional)</span>
              <span>Meter reading</span>
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
                      <small>Assigned attendant · optional</small>
                      <select
                        value={assignment?.userId ?? ""}
                        onChange={(event) =>
                          assignAttendant(nozzle.id, event.target.value)
                        }
                      >
                        <option value="">No fixed attendant</option>
                        {attendants.map((attendant) => (
                          <option key={attendant.id} value={attendant.id}>
                            {attendant.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="opening-nozzle-value">
                      <small>Meter reading</small>
                      <output>
                        {(reading?.value ?? 0).toLocaleString("en-IN")}
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
          <Readings
            title="Opening tank readings"
            action={refreshStockButton}
            items={config?.tanks.map(tank => ({
              id: tank.id,
              label: `${tank.code} · ${tank.product.code}`,
              opening: Number(tank.openingStock),
              balance: selected?.availableTankStock.find(reading => reading.id === tank.id),
              lastClosingAt: selected?.lastClosing?.closedAt,
            })) ?? []}
            values={openTanks}
            refreshStatus={stockRefreshStatus}
            onReviewReceipts={() => {
              const history = receiptHistory.current;
              if (!history) return;
              history.open = true;
              history.querySelector("summary")?.focus();
              history.scrollIntoView?.({ block: "start" });
            }}
            onUseExpected={reading => {
              editedOpeningTanks.current.delete(reading.id);
              replace(openTanks, reading.id, reading.value, setOpenTanks);
            }}
            onChange={v => {
              editedOpeningTanks.current.add(v.id);
              replace(openTanks, v.id, v.value, setOpenTanks);
            }}
          />
          <label className="field">
            <span>Opening note (optional)</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button
            className="primary"
            disabled={saving || refreshingStock || !stationId}
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
            Pick the fuel station and people, confirm cash and readings, then open.
            At close, enter the final readings and FuelNerve makes the summary.
          </p>
        </article>
      </section>
      {stationId && <ReceiptHistory key={stationId} stationId={stationId} tolerance={data.stockVarianceTolerance} detailsRef={receiptHistory} />}
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
function receiptPeriod(receipt: ShiftReceipt) {
  if (receipt.period === "OVERLAP") return "Overlapping shifts · review timing";
  if (receipt.period === "DURING") return `Received during shift #${receipt.shiftNumber}`;
  if (receipt.shiftNumber !== null) {
    return receipt.period === "BEFORE_FIRST" ? `Before the first shift · #${receipt.shiftNumber}` : `Between shifts · before shift #${receipt.shiftNumber}`;
  }
  return receipt.period === "BEFORE_FIRST" ? "Before the first shift" : "Between shifts · awaiting next opening";
}

function ReceiptHistory({ stationId, tolerance, detailsRef }: { stationId: string; tolerance: number; detailsRef?: React.Ref<HTMLDetailsElement> }) {
  const [receipts, setReceipts] = useState<ShiftReceipt[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shift, setShift] = useState<ShiftDetail | null>(null);
  const [loadingShift, setLoadingShift] = useState(false);

  async function load(before?: string) {
    setLoading(true);
    setError("");
    if (!before) setShift(null);
    try {
      const page = await api.tankReceiptHistory(stationId, before);
      setReceipts(current => before ? [...(current ?? []), ...page.receipts.filter(receipt => !current?.some(row => row.id === receipt.id))] : page.receipts);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setError(error instanceof ApiRequestError ? error.message : "Unable to load tank receipts. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function viewShift(shiftId: string) {
    setLoadingShift(true);
    setError("");
    try {
      setShift(await api.shiftDetails(shiftId));
    } catch (error) {
      setError(error instanceof ApiRequestError ? error.message : "Unable to load the shift readings. Try again.");
    } finally {
      setLoadingShift(false);
    }
  }

  return <details ref={detailsRef} className="recent-shifts operations-receipts" onToggle={event => {
    if (event.currentTarget.open && receipts === null && !loading && !error) void load();
  }}>
    <summary>Tank receipt history</summary>
    <p>See which deliveries arrived during a shift or between shifts, using their physical receipt times.</p>
    <section className="operations-receipt-content" aria-busy={loading || loadingShift}>
      {error && <p role="alert">{error}</p>}
      <button className="secondary small" type="button" disabled={loading} onClick={() => void load()}>
        <RefreshCw size={15} /> {loading ? "Loading receipts…" : "Refresh receipts"}
      </button>
      {receipts?.length === 0 && <p>No posted tank receipts for this fuel station.</p>}
      {receipts?.length ? <ul>{receipts.map(receipt => <li key={receipt.id}>
        <div>
          <strong>{receipt.tank && receipt.product ? `${receipt.tank} · ${receipt.product}` : "Tank mapping needs review"} · {receipt.unit === "LITRE" ? litres(Number(receipt.quantity)) : Number(receipt.quantity).toLocaleString("en-IN")}</strong>
          <small>{[receipt.reference, receipt.supplier, captured(receipt.occurredAt)].filter(Boolean).join(" · ")}</small>
          <small>{receiptPeriod(receipt)}{receipt.correctedLate ? " · Receipt time corrected after readings were saved" : receipt.recordedLate ? " · Recorded after readings were saved" : ""}</small>
          {receipt.tankInShift === false && <small>That shift has no saved reading for this tank. The receipt is in book stock.</small>}
          {receipt.receiptScopeMismatch && <small>The linked receipt belongs to a different fuel station or account. Review this stock movement.</small>}
          {receipt.timingMismatch && <small>The purchase receipt time differs from the stock movement time. Review the source.</small>}
        </div>
        <div className="operations-receipt-actions">
          {receipt.shiftId && <button className="secondary small" type="button" disabled={loadingShift} onClick={() => void viewShift(receipt.shiftId!)}>
            View shift #{receipt.shiftNumber}
          </button>}
          {receipt.previousShift && <button className="secondary small" type="button" disabled={loadingShift} onClick={() => void viewShift(receipt.previousShift!.id)}>
            View previously affected shift #{receipt.previousShift.number}
          </button>}
        </div>
      </li>)}</ul> : null}
      {nextCursor && <button className="secondary small" type="button" disabled={loading} onClick={() => void load(nextCursor)}>Show older receipts</button>}
      {shift && <section className="operations-receipt-shift" ref={element => element?.scrollIntoView({ block: "nearest" })}>
        <div className="operations-section-header">
          <h3>Shift #{shift.shiftNumber} · {captured(shift.openedAt)}</h3>
          <button type="button" className="secondary small" onClick={() => setShift(null)}>Close shift details</button>
        </div>
        {shift.openingStockReview.length > 0 && <>
          <h4>Opening tank readings</h4>
          <ul>{shift.openingStockReview.map(reading => <li key={reading.code}>
            <div><strong>{reading.code}</strong><small>Receipts before opening {litres(Number(reading.received))} · Expected opening {litres(Number(reading.expectedOpening))} · Saved dip {litres(Number(reading.actual))}</small></div>
          </li>)}</ul>
        </>}
        {shift.receiptTimingChanges.length > 0 && <ul>{shift.receiptTimingChanges.map(change => <li key={change.id}>
          <div><strong>{change.receipt.referenceNo ?? "Stock receipt"} · Receipt time moved out of this shift</strong>
          <small>Previously {captured(change.previousReceivedAt)} · Corrected to {captured(change.receivedAt)}</small></div>
        </li>)}</ul>}
        {shift.closedAt ? <ClosingStockBridge shift={shift}
          actuals={shift.tankReadings.flatMap(reading => reading.closingDip === null ? [] : [{ id: reading.tankId, value: Number(reading.closingDip) }])}
          closingMeters={shift.nozzleReadings.flatMap(reading => reading.closingMeter === null ? [] : [{ id: reading.nozzleId, value: Number(reading.closingMeter) }])}
          testing={shift.nozzleReadings.map(reading => ({ id: reading.nozzleId, value: Number(reading.closingMeter), testingQuantity: Number(reading.testingQuantity), testingReturned: reading.testingReturned }))}
          tolerance={tolerance}
        /> : <p>This shift is open. The closing readings will be available here after it closes.</p>}
      </section>}
    </section>
  </details>;
}

function ClosingStockBridge({ shift, actuals, closingMeters, testing, tolerance, onChange, action }: {
  shift: Shift;
  actuals: Reading[];
  closingMeters: Reading[];
  testing: ClosingNozzleReading[];
  tolerance: number;
  onChange?(value: Reading): void;
  action?: React.ReactNode;
}) {
  return <section className="closing-stock-bridge">
    <div className="closing-stock-heading">
      <div><h3>Closing tank readings</h3><p>{onChange ? "Enter the measured dip. Provisional book stock below includes the nozzle readings and testing entered here; it is confirmed only when you save the shift." : "Expected stock uses the saved opening dip and posted stock movements."}</p></div>
      {action}
      <small>Allowed difference: {litres(tolerance)}</small>
    </div>
    <div className="stock-bridge-table">
      <div className="stock-bridge-head" aria-hidden="true">
        <span>Tank</span><span>Opening</span><span>Received</span><span>Sales</span><span>Testing / loss</span><span>Expected</span><span>Actual dip</span><span>Difference</span>
      </div>
      {shift.tankReadings.map((reading) => {
        const actual = actuals.find((item) => item.id === reading.tankId)?.value ?? (onChange ? Number(reading.openingDip) : null);
        const bridge = bridgeValues(shift, reading.tankId, actual ?? 0, closingMeters, testing);
        const outside = actual !== null && Math.abs(bridge.difference) > tolerance + 0.001;
        return <div className={`stock-bridge-row ${outside ? "has-variance" : ""}`} key={reading.tankId}>
          <span className="stock-bridge-tank" data-label="Tank"><b>{reading.tank.code}</b><small>{reading.tank.product.code}</small></span>
          <span data-label="Opening">{litres(Number(reading.openingDip))}</span>
          <span data-label="Received">
            <b>{litres(Number(reading.stockBridge.received))}</b>
            {reading.stockBridge.deliveries.length > 0 && <details><summary>View {reading.stockBridge.deliveries.length} {reading.stockBridge.deliveries.length === 1 ? "delivery" : "deliveries"}</summary>{reading.stockBridge.deliveries.map((delivery) => <small key={delivery.id}>{[delivery.reference, delivery.supplier, litres(Number(delivery.quantity)), captured(delivery.occurredAt), delivery.correctedLate ? "Time corrected after closing" : delivery.recordedLate ? "Recorded after closing" : null].filter(Boolean).join(" · ")}</small>)}</details>}
          </span>
          <span data-label="Sales">
            <b>{litres(bridge.sales)}</b>
            {onChange && bridge.contributions.length > 0 && <details><summary>View nozzles</summary>{bridge.contributions.map((item) => <small key={item.id}>{item.code} · {litres(item.sales)}</small>)}</details>}
          {Number(reading.stockBridge.counterSales ?? 0) > 0 && <small>Includes {litres(Number(reading.stockBridge.counterSales))} counter sales</small>}</span>
          <span data-label="Testing / loss">
            <b>{litres(bridge.testingLoss)}</b>
            <small>{bridge.testingLoss > 0 ? "Not returned" : "No stock consumed"}</small>
          </span>
          <span data-label="Expected"><b>{litres(bridge.expected)}</b>{Math.abs(Number(reading.stockBridge.adjustments)) > 0.001 && <small>Includes {Number(reading.stockBridge.adjustments) > 0 ? "+" : ""}{litres(Number(reading.stockBridge.adjustments))} approved adjustments</small>}</span>
          {onChange ? <label data-label="Actual dip"><input aria-label={`Actual closing dip in litres for ${reading.tank.code}`} type="number" min="0" step="0.001" value={actual ?? ""} onChange={(event) => onChange({ id: reading.tankId, value: Number(event.target.value) })}/></label>
            : <span data-label="Actual dip">{actual === null ? "Unavailable" : litres(actual)}</span>}
          <span className={outside ? "stock-difference variance" : "stock-difference"} data-label="Difference"><b>{actual === null ? "—" : `${bridge.difference > 0 ? "+" : ""}${litres(bridge.difference)}`}</b>{actual !== null && <small>{outside ? (onChange ? "Explain in closing note" : "Outside tolerance") : "Within tolerance"}</small>}</span>
        </div>;
      })}
    </div>
    <p className="stock-bridge-help">A difference is highlighted for investigation only. Closing the shift does not create a stock adjustment.</p>
  </section>;
}
function Readings({
  title, items, values, onChange, onUseExpected, onReviewReceipts, action, refreshStatus,
}: {
  title: string;
  items: Array<{ id: string; label: string; opening: number; balance?: ShiftStation["availableTankStock"][number] | undefined; lastClosingAt?: string | undefined }>;
  values: Reading[];
  onChange(value: Reading): void;
  onUseExpected(value: Reading): void;
  onReviewReceipts(): void;
  action: React.ReactNode;
  refreshStatus: string;
}) {
  const hasBookDifference = items.some(({ balance }) => balance &&
    Math.abs(Number(balance.value) - Number(balance.expectedOpening)) > 0.001);
  return (
    <section className="shift-readings">
      <div className="operations-section-header"><h3>{title}</h3>{action}</div>
      <div className="opening-stock-status" role="status">{refreshStatus}</div>
      {hasBookDifference && <div className="opening-stock-help">
        <p><strong>Book stock and expected opening differ.</strong> Expected opening starts with the last measured closing dip and includes stock movements since then. Book stock reflects the full stock history. Check the receipt times and enter the dip measured at opening.</p>
        <button type="button" className="secondary small" onClick={onReviewReceipts}>Review tank receipt history</button>
      </div>}
      {items.map(({ id, label, opening, balance, lastClosingAt }) => {
        const value = values.find(reading => reading.id === id)?.value ?? 0;
        const expected = Number(balance?.expectedOpening ?? opening);
        const difference = value - expected;
        const bookDifference = balance ? Number(balance.value) - expected : 0;
        return (
          <div className="opening-tank-reading" key={id}>
            <label>
              <span>
                <strong>{label}</strong>
                {balance && <>
                  <small>{balance.checkpoint ? `${balance.checkpoint.source} · ${balance.checkpoint.date}${balance.checkpoint.at ? ` · ${captured(balance.checkpoint.at)}` : " · morning"} · ${litres(Number(balance.lastActual))}` : balance.lastActual == null ? "Using book stock before opening" : `Last actual closing ${litres(Number(balance.lastActual))} · ${captured(lastClosingAt!)}`}</small>
                  <small>{balance.checkpoint ? "Received since measurement" : balance.lastActual == null ? "Receipts before opening" : "Received between shifts"} {litres(Number(balance.received))} · Adjustments {litres(Number(balance.adjustments))}{Number(balance.netOther) !== 0 && ` · Other movements ${litres(Number(balance.netOther))}`}</small>
                </>}
                <small><b>{balance?.checkpoint?.incomplete ? "Available before unrecorded sales" : "Expected opening"} {litres(expected)}</b>{balance && ` · Book stock now ${litres(Number(balance.value))}`}</small>
                {balance?.stockIssues?.map(issue=><small className="form-error" key={issue}>{issue}</small>)}
                {Math.abs(bookDifference) > 0.001 && <small>Book stock is {litres(Math.abs(bookDifference))} {bookDifference > 0 ? "higher" : "lower"}.</small>}
              </span>
              <span className="opening-tank-input">
                <small>Actual opening dip (L)</small>
                <input aria-label={`Actual opening dip in litres for ${label}`} type="number" min="0" step="0.001" value={value}
                  onChange={event => onChange({ id, value: Number(event.target.value) })}
                />
              </span>
            </label>
            {Math.abs(difference) > 0.001 && <div className="operations-section-header opening-dip-difference">
              <small>Actual dip differs by {litres(Math.abs(difference))}. Add an opening note.</small>
              <button type="button" className="secondary small" aria-label={`Reset to expected opening for ${label}`} onClick={() => onUseExpected({ id, value: expected })}>Reset to expected opening</button>
            </div>}
          </div>
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
      {shift.openingCashHandover && <details>
        <summary>Opening cash handover</summary>
        <p>Previous closing: {shift.openingCashHandover.previousClosingCash === null ? "Not recorded" : cashMoney(shift.openingCashHandover.previousClosingCash)} · Added: {cashMoney(shift.openingCashHandover.added)} · Removed: {cashMoney(shift.openingCashHandover.removed)}</p>
        <p>Expected: {shift.openingCashHandover.expectedOpening === null ? "First count / previous count unavailable" : cashMoney(shift.openingCashHandover.expectedOpening)} · Counted: {cashMoney(shift.openingCashHandover.actualOpening)}{shift.openingCashHandover.difference !== null && ` · Difference: ${cashMoney(shift.openingCashHandover.difference)}`}</p>
        {shift.openingCashHandover.reason && <p>{shift.openingCashHandover.reason}</p>}
      </details>}
      <div>
        <span>Physical cash at start</span>
        <strong>{cashMoney(shift.openingCash)}</strong>
      </div>
      <div>
        <span>Physical cash at closing</span>
        <strong>{cashMoney(closingCash)}</strong>
      </div>
      <div>
        <span>Metered volume</span>
        <strong>
          {volume.toLocaleString(undefined, { maximumFractionDigits: 3 })} L
        </strong>
      </div>
      <div>
        <span>Physical cash handed over by staff</span>
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
