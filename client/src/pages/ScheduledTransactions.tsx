import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { AppHeader } from "../components/AppHeader";
import { HelpPopover } from "../components/HelpPopover";
import { HeaderUserLeft } from "../components/HeaderUserLeft";
import type { EnvelopeSummary } from "./Dashboard";

type ScheduleRow = {
  id: number;
  envelope_id: number;
  envelope_name: string;
  day_of_month: number;
  type: "ebb" | "flow";
  amount_cents: number;
  note: string;
  enabled: boolean;
  last_run_month: string | null;
};

function formatMoney(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function ScheduledTransactions() {
  const { user } = useAuth();
  const [envelopes, setEnvelopes] = useState<EnvelopeSummary[]>([]);
  const editableEnvelopes = envelopes.filter((e) => e.can_edit);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [envelopeId, setEnvelopeId] = useState<number | "">("");
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [type, setType] = useState<"ebb" | "flow">("ebb");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("Scheduled");
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editEnvelopeId, setEditEnvelopeId] = useState<number | "">("");
  const [editDay, setEditDay] = useState(1);
  const [editType, setEditType] = useState<"ebb" | "flow">("ebb");
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [envData, schedData] = await Promise.all([
        api<{ envelopes: EnvelopeSummary[] }>("/api/envelopes"),
        api<{ schedules: ScheduleRow[] }>("/api/schedules"),
      ]);
      setEnvelopes(envData.envelopes);
      setSchedules(schedData.schedules);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (envelopeId === "") return;
    const raw = amount.replace(/[^0-9.]/g, "");
    const dollars = parseFloat(raw || "0");
    const cents = Math.round(dollars * 100);
    if (cents <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await api("/api/schedules", {
        method: "POST",
        body: JSON.stringify({
          envelope_id: envelopeId,
          day_of_month: dayOfMonth,
          type,
          amount_cents: cents,
          note: note.trim() || "Scheduled",
          enabled: true,
        }),
      });
      setAmount("");
      setNote("Scheduled");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save schedule");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(s: ScheduleRow) {
    setEditingId(s.id);
    setEditEnvelopeId(s.envelope_id);
    setEditDay(s.day_of_month);
    setEditType(s.type);
    setEditAmount((s.amount_cents / 100).toFixed(2));
    setEditNote(s.note);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditBusy(false);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (editingId === null || editEnvelopeId === "") return;
    const raw = editAmount.replace(/[^0-9.]/g, "");
    const dollars = parseFloat(raw || "0");
    const cents = Math.round(dollars * 100);
    if (cents <= 0) return;
    setEditBusy(true);
    setError(null);
    try {
      await api(`/api/schedules/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          envelope_id: editEnvelopeId,
          day_of_month: editDay,
          type: editType,
          amount_cents: cents,
          note: editNote.trim() || "Scheduled",
        }),
      });
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update");
    } finally {
      setEditBusy(false);
    }
  }

  async function toggleEnabled(s: ScheduleRow) {
    setError(null);
    try {
      await api(`/api/schedules/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update");
    }
  }

  async function removeSchedule(id: number) {
    if (!confirm("Remove this scheduled transaction?")) return;
    setError(null);
    try {
      await api(`/api/schedules/${id}`, { method: "DELETE" });
      if (editingId === id) cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  if (loading) {
    return (
      <div className="min-h-[100dvh] w-full min-w-0 overflow-x-hidden bg-paper">
        <AppHeader left={<HeaderUserLeft user={user} />} />
        <main className="safe-x safe-b page-y mx-auto w-full min-w-0 max-w-3xl">
          <Link
            to="/"
            className="mb-4 inline-block text-sm font-medium text-accent hover:underline"
          >
            ← Dashboard
          </Link>
          <p className="text-muted">Loading…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] w-full min-w-0 overflow-x-hidden bg-paper">
      <AppHeader left={<HeaderUserLeft user={user} />} />

      <main className="safe-x safe-b page-y mx-auto w-full min-w-0 max-w-3xl">
        <Link
          to="/"
          className="mb-4 inline-block text-sm font-medium text-accent hover:underline"
        >
          ← Dashboard
        </Link>
        <h1 className="font-display mb-6 text-2xl font-semibold text-ink sm:mb-8 sm:text-3xl">
          <HelpPopover
            content={
              <span>
                Each month on the day you choose (or the last day of the month if
                that day does not exist), the app records one Ebb or Flow. You can
                target any envelope you can see—shared household envelopes or your
                private ones. Times use the server&apos;s local time zone.
              </span>
            }
          >
            <span className="font-display text-2xl font-semibold sm:text-3xl">
              Scheduled transactions
            </span>
          </HelpPopover>
        </h1>

        {error && (
          <div
            className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm dark:border-red-400/60 dark:bg-red-950/70 dark:text-red-50 dark:shadow-[0_0_32px_rgba(255,60,120,0.45),0_0_60px_rgba(239,68,68,0.2)]"
            role="alert"
          >
            {error}
          </div>
        )}

        <section className="neon-panel mb-8 rounded-2xl border border-border bg-card p-4 shadow-sm sm:mb-10 sm:p-6">
          <h2 className="font-display text-base font-semibold text-ink sm:text-lg">
            Add schedule
          </h2>
          <form onSubmit={addSchedule} className="mt-4 space-y-4">
            <label className="block text-sm font-medium text-ink">
              Envelope
              <select
                className="input-field mt-1"
                value={envelopeId === "" ? "" : String(envelopeId)}
                onChange={(e) =>
                  setEnvelopeId(
                    e.target.value === "" ? "" : Number(e.target.value)
                  )
                }
                required
              >
                <option value="">Select…</option>
                {editableEnvelopes.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                    {env.shared_with_household ? " (shared)" : " (private)"}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="block w-full min-w-0 sm:max-w-[12rem]">
                <span className="text-sm font-medium text-ink">Day of month</span>
                <select
                  className="input-field mt-1"
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Number(e.target.value))}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="flex min-h-[44px] items-center gap-6 border-0 p-0 sm:pb-1">
                <legend className="sr-only">Transaction type</legend>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-base touch-manipulation">
                  <input
                    type="radio"
                    name="schedtype"
                    checked={type === "ebb"}
                    onChange={() => setType("ebb")}
                    className="h-5 w-5 accent-warm"
                  />
                  <span className="text-warm">Ebb</span>
                </label>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-base touch-manipulation">
                  <input
                    type="radio"
                    name="schedtype"
                    checked={type === "flow"}
                    onChange={() => setType("flow")}
                    className="h-5 w-5 accent-flow"
                  />
                  <span className="text-flow">Flow</span>
                </label>
              </fieldset>
              <label className="block w-full min-w-0 sm:max-w-xs sm:flex-1">
                <span className="text-sm font-medium text-ink">Amount</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="input-field mt-1"
                  required
                />
              </label>
            </div>
            <label className="block text-sm font-medium text-ink">
              Description (optional)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Scheduled"
                maxLength={500}
                className="input-field mt-1"
              />
            </label>
            <button
              type="submit"
              disabled={
                submitting ||
                envelopeId === "" ||
                Math.round(
                  parseFloat(amount.replace(/[^0-9.]/g, "") || "0") * 100
                ) <= 0
              }
              className="btn-primary touch-manipulation"
            >
              {submitting ? "Saving…" : "Add schedule"}
            </button>
          </form>
        </section>

        <section>
          <h2 className="font-display text-base font-semibold text-ink sm:text-lg">
            Your schedules
          </h2>
          {schedules.length === 0 ? (
            <p className="neon-panel mt-4 rounded-xl border border-dashed border-border bg-paper/50 px-4 py-8 text-center text-muted dark:border-[rgba(0,245,255,0.45)] dark:bg-black/30 dark:text-[#d4c4f0]">
              No schedules yet.
            </p>
          ) : (
            <ul className="neon-panel mt-4 divide-y divide-border rounded-2xl border border-border bg-card">
              {schedules.map((s) => (
                <li key={s.id} className="px-4 py-4 sm:px-5">
                  {editingId === s.id ? (
                    <form onSubmit={saveEdit} className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block text-sm font-medium text-ink">
                          Envelope
                          <select
                            className="input-field mt-1"
                            value={
                              editEnvelopeId === ""
                                ? ""
                                : String(editEnvelopeId)
                            }
                            onChange={(e) =>
                              setEditEnvelopeId(
                                e.target.value === ""
                                  ? ""
                                  : Number(e.target.value)
                              )
                            }
                            required
                          >
                            {envelopes
                              .filter(
                                (e) =>
                                  e.can_edit || e.id === editEnvelopeId
                              )
                              .map((env) => (
                                <option key={env.id} value={env.id}>
                                  {env.name}
                                  {env.shared_with_household
                                    ? " (shared)"
                                    : " (private)"}
                                  {!env.can_edit ? " (view only)" : ""}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="block text-sm font-medium text-ink">
                          Day of month
                          <select
                            className="input-field mt-1"
                            value={editDay}
                            onChange={(e) => setEditDay(Number(e.target.value))}
                          >
                            {Array.from({ length: 31 }, (_, i) => i + 1).map(
                              (d) => (
                                <option key={d} value={d}>
                                  {d}
                                </option>
                              )
                            )}
                          </select>
                        </label>
                      </div>
                      <fieldset className="flex min-h-[44px] items-center gap-6 border-0 p-0">
                        <legend className="sr-only">Type</legend>
                        <label className="flex cursor-pointer items-center gap-2 text-base">
                          <input
                            type="radio"
                            name={`edittype-${s.id}`}
                            checked={editType === "ebb"}
                            onChange={() => setEditType("ebb")}
                            className="h-5 w-5 accent-warm"
                          />
                          <span className="text-warm">Ebb</span>
                        </label>
                        <label className="flex cursor-pointer items-center gap-2 text-base">
                          <input
                            type="radio"
                            name={`edittype-${s.id}`}
                            checked={editType === "flow"}
                            onChange={() => setEditType("flow")}
                            className="h-5 w-5 accent-flow"
                          />
                          <span className="text-flow">Flow</span>
                        </label>
                      </fieldset>
                      <label className="block text-sm font-medium text-ink">
                        Amount
                        <input
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          inputMode="decimal"
                          className="input-field mt-1"
                          required
                        />
                      </label>
                      <label className="block text-sm font-medium text-ink">
                        Description
                        <input
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          maxLength={500}
                          className="input-field mt-1"
                          required
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={
                            editBusy ||
                            editEnvelopeId === "" ||
                            Math.round(
                              parseFloat(
                                editAmount.replace(/[^0-9.]/g, "") || "0"
                              ) * 100
                            ) <= 0
                          }
                          className="btn-primary min-h-11"
                        >
                          {editBusy ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={editBusy}
                          className="btn-secondary min-h-11"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-ink">
                          {s.envelope_name} · Day {s.day_of_month} ·{" "}
                          <span
                            className={
                              s.type === "ebb" ? "text-warm" : "text-flow"
                            }
                          >
                            {s.type === "ebb" ? "Ebb" : "Flow"}
                          </span>
                          {" · "}
                          <span
                            className={
                              s.type === "ebb" ? "text-warm" : "text-flow"
                            }
                          >
                            {formatMoney(s.amount_cents)}
                          </span>
                        </p>
                        <p className="mt-1 text-sm text-muted">{s.note}</p>
                        <p className="mt-1 text-xs text-muted">
                          Last run:{" "}
                          {s.last_run_month ?? "—"}
                          {!s.enabled ? " · Paused" : ""}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-4">
                          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                            <input
                              type="checkbox"
                              checked={s.enabled}
                              onChange={() => void toggleEnabled(s)}
                              className="h-5 w-5 accent-accent"
                            />
                            Enabled
                          </label>
                          <button
                            type="button"
                            onClick={() => startEdit(s)}
                            className="text-sm font-medium text-accent hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeSchedule(s.id)}
                            className="text-sm font-medium text-red-700 hover:underline dark:text-red-400"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
