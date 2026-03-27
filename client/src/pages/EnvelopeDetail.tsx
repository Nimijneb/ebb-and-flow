import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { EbAndFlowLogo } from "../components/EbAndFlowLogo";
import { ThemeToggle } from "../theme";

type Envelope = {
  id: number;
  name: string;
  balance_cents: number;
  created_at: string;
  shared_with_household: boolean;
};

type TransactionRow = {
  id: number;
  amount_cents: number;
  note: string | null;
  created_at: string;
  recorded_by_username: string;
};

function formatMoney(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** `datetime-local` value in the browser's local zone */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EnvelopeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"ebb" | "flow">("ebb");
  /** Stored as `note` in the API; label in UI is merchant / description. */
  const [merchantOrDescription, setMerchantOrDescription] = useState("");
  /** Empty = server uses current time when recording */
  const [transactionDate, setTransactionDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editType, setEditType] = useState<"ebb" | "flow">("ebb");
  const [editNote, setEditNote] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const data = await api<{
        envelope: Envelope;
        transactions: TransactionRow[];
      }>(`/api/envelopes/${id}`);
      setEnvelope(data.envelope);
      setTransactions(data.transactions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setEnvelope(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addTransaction(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    const raw = amount.replace(/[^0-9.]/g, "");
    const dollars = parseFloat(raw || "0");
    const cents = Math.round(dollars * 100);
    const detail = merchantOrDescription.trim();
    if (cents <= 0 || !detail) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        amount_cents: cents,
        type,
        note: detail,
      };
      if (transactionDate.trim()) {
        const d = new Date(transactionDate);
        if (!Number.isNaN(d.getTime())) {
          payload.created_at = d.toISOString();
        }
      }
      await api(`/api/envelopes/${id}/transactions`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setAmount("");
      setMerchantOrDescription("");
      setTransactionDate("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add transaction");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(t: TransactionRow) {
    setEditingId(t.id);
    setEditAmount((Math.abs(t.amount_cents) / 100).toFixed(2));
    setEditType(t.amount_cents < 0 ? "ebb" : "flow");
    setEditNote((t.note ?? "").trim());
    setEditDate(toDatetimeLocalValue(t.created_at));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditAmount("");
    setEditNote("");
    setEditDate("");
    setEditBusy(false);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!id || editingId === null) return;
    const raw = editAmount.replace(/[^0-9.]/g, "");
    const dollars = parseFloat(raw || "0");
    const cents = Math.round(dollars * 100);
    const detail = editNote.trim();
    if (cents <= 0 || !detail) return;
    const when = new Date(editDate);
    if (!editDate.trim() || Number.isNaN(when.getTime())) {
      setError("Choose a valid date and time for this transaction.");
      return;
    }
    setEditBusy(true);
    setError(null);
    try {
      await api(`/api/envelopes/${id}/transactions/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          amount_cents: cents,
          type: editType,
          note: detail,
          created_at: when.toISOString(),
        }),
      });
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update transaction");
    } finally {
      setEditBusy(false);
    }
  }

  async function deleteTransaction(txId: number) {
    if (!id) return;
    if (!confirm("Delete this transaction? This cannot be undone.")) return;
    setError(null);
    try {
      await api(`/api/envelopes/${id}/transactions/${txId}`, {
        method: "DELETE",
      });
      if (editingId === txId) cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete transaction");
    }
  }

  function startRename() {
    if (!envelope) return;
    setRenameName(envelope.name);
    setRenameOpen(true);
  }

  function cancelRename() {
    setRenameOpen(false);
    setRenameBusy(false);
  }

  async function saveRename(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !renameName.trim()) return;
    setRenameBusy(true);
    setError(null);
    try {
      await api(`/api/envelopes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: renameName.trim() }),
      });
      cancelRename();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename envelope");
    } finally {
      setRenameBusy(false);
    }
  }

  async function removeEnvelope() {
    if (!id || !envelope) return;
    if (
      !confirm(
        `Delete “${envelope.name}” and all its transactions? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await api(`/api/envelopes/${id}`, { method: "DELETE" });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (loading) {
    return (
      <div className="safe-x safe-t flex min-h-[100dvh] items-center justify-center bg-paper">
        <p className="text-muted">Loading…</p>
      </div>
    );
  }

  if (!envelope) {
    return (
      <div className="safe-x safe-b safe-t mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-muted">{error ?? "Envelope not found."}</p>
        <Link
          to="/"
          className="mt-4 inline-block min-h-11 py-2 text-accent hover:underline"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-paper">
      <header className="chromatic-header sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur-md">
        <div className="safe-x safe-t mx-auto grid max-w-3xl grid-cols-[1fr_auto_1fr] items-center gap-2 pb-3 sm:gap-3 sm:pb-4">
          <div className="min-w-0 justify-self-start">
            <Link
              to="/"
              className="mb-1 inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline"
            >
              ← Dashboard
            </Link>
            <p className="truncate text-sm text-muted">{user?.username}</p>
          </div>
          <div className="flex min-w-0 items-center justify-center gap-2 justify-self-center px-0.5">
            <EbAndFlowLogo decorative className="shrink-0 text-ink" />
            <p className="font-display text-lg font-semibold text-ink sm:text-xl">
              Ebb and Flow
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end justify-self-end gap-0.5 sm:gap-1">
            <ThemeToggle />
            <button
              type="button"
              onClick={logout}
              className="btn-ghost shrink-0 text-sm sm:text-base"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="safe-x safe-b page-y mx-auto w-full max-w-3xl">
        <div className="mb-6 sm:mb-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 flex-1">
              {renameOpen ? (
                <form
                  onSubmit={saveRename}
                  className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-3"
                >
                  <label className="min-w-0 flex-1 text-sm font-medium text-ink">
                    Envelope name
                    <input
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      maxLength={120}
                      autoFocus
                      className="input-field mt-1 font-display text-xl font-semibold text-ink sm:text-2xl"
                    />
                  </label>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={renameBusy || !renameName.trim()}
                      className="btn-primary min-h-11"
                    >
                      {renameBusy ? "Saving…" : "Save name"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelRename}
                      disabled={renameBusy}
                      className="btn-secondary min-h-11"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <h1 className="font-display break-words text-2xl font-semibold leading-tight text-ink sm:text-3xl">
                  {envelope.name}
                </h1>
              )}
            </div>
            {!renameOpen && (
              <div className="flex shrink-0 flex-wrap items-center gap-4 self-start sm:pt-1">
                <button
                  type="button"
                  onClick={startRename}
                  className="text-sm font-medium text-accent hover:underline"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={removeEnvelope}
                  className="text-sm font-medium text-red-700 hover:underline dark:text-red-400"
                >
                  Delete envelope
                </button>
              </div>
            )}
          </div>
          <p className="mt-2 text-sm text-muted">
            {envelope.shared_with_household ? (
              <>Shared with your household · anyone here can view and add activity</>
            ) : (
              <>
                <span className="font-medium text-warm">Private</span>
                {" · "}
                only you can see this envelope and its transactions
              </>
            )}
          </p>
          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Current balance
            </p>
            <p className="font-display text-3xl font-semibold tabular-nums text-ink sm:text-4xl">
              {formatMoney(envelope.balance_cents)}
            </p>
          </div>
        </div>

        <section className="neon-panel mb-8 rounded-2xl border border-border bg-card p-4 shadow-sm sm:mb-10 sm:p-6">
          <h2 className="font-display text-base font-semibold text-ink sm:text-lg">
            Add transaction
          </h2>
          <p className="mt-1 text-sm text-muted">
            Ebb removes money from this envelope; Flow adds money back. Leave
            date empty to use now, or set a past date for something you forgot to
            enter earlier.
          </p>
          <form onSubmit={addTransaction} className="mt-4 space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="block w-full min-w-0 sm:max-w-xs sm:flex-1">
                <span className="text-sm font-medium text-ink">Amount</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  enterKeyHint="done"
                  className="input-field mt-1"
                />
              </label>
              <fieldset className="flex min-h-[44px] items-center gap-6 border-0 p-0 sm:pb-1">
                <legend className="sr-only">Transaction type</legend>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-base touch-manipulation">
                  <input
                    type="radio"
                    name="txtype"
                    checked={type === "ebb"}
                    onChange={() => setType("ebb")}
                    className="h-5 w-5 accent-warm"
                  />
                  <span>Ebb</span>
                </label>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-base touch-manipulation">
                  <input
                    type="radio"
                    name="txtype"
                    checked={type === "flow"}
                    onChange={() => setType("flow")}
                    className="h-5 w-5 accent-accent"
                  />
                  <span>Flow</span>
                </label>
              </fieldset>
            </div>
            <label className="block text-sm font-medium text-ink">
              Merchant or description
              <input
                value={merchantOrDescription}
                onChange={(e) => setMerchantOrDescription(e.target.value)}
                placeholder="Store name, landlord, gift, transfer…"
                required
                maxLength={500}
                autoComplete="off"
                className="input-field mt-1"
              />
            </label>
            <label className="block w-full max-w-md text-sm font-medium text-ink">
              Date and time (optional)
              <input
                type="datetime-local"
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
                className="input-field mt-1"
              />
            </label>
            <button
              type="submit"
              disabled={
                submitting ||
                !merchantOrDescription.trim() ||
                Math.round(
                  parseFloat(amount.replace(/[^0-9.]/g, "") || "0") * 100
                ) <= 0
              }
              className="btn-primary w-full touch-manipulation sm:w-auto"
            >
              {submitting ? "Saving…" : "Record transaction"}
            </button>
          </form>
        </section>

        {error && (
          <div
            className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm dark:border-red-400/60 dark:bg-red-950/70 dark:text-red-50 dark:shadow-[0_0_32px_rgba(255,60,120,0.45),0_0_60px_rgba(239,68,68,0.2)]"
            role="alert"
          >
            {error}
          </div>
        )}

        <section className="pb-2">
          <h2 className="font-display text-base font-semibold text-ink sm:text-lg">
            Activity
          </h2>
          {transactions.length === 0 ? (
            <p className="neon-panel mt-4 rounded-xl border border-dashed border-border bg-paper/50 px-4 py-8 text-center text-muted dark:border-[rgba(0,245,255,0.45)] dark:bg-black/30 dark:text-[#d4c4f0]">
              No transactions yet.
            </p>
          ) : (
            <ul className="neon-panel mt-4 divide-y divide-border rounded-2xl border border-border bg-card">
              {transactions.map((t) => (
                <li key={t.id} className="px-4 py-4 sm:px-5">
                  {editingId === t.id ? (
                    <form onSubmit={saveEdit} className="space-y-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                        <label className="block w-full min-w-0 sm:max-w-[12rem]">
                          <span className="text-sm font-medium text-ink">Amount</span>
                          <input
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            inputMode="decimal"
                            className="input-field mt-1"
                          />
                        </label>
                        <fieldset className="flex min-h-[44px] items-center gap-6 border-0 p-0 sm:pb-1">
                          <legend className="sr-only">Transaction type</legend>
                          <label className="flex cursor-pointer items-center gap-2 text-base">
                            <input
                              type="radio"
                              name={`edittype-${t.id}`}
                              checked={editType === "ebb"}
                              onChange={() => setEditType("ebb")}
                              className="h-5 w-5 accent-warm"
                            />
                            Ebb
                          </label>
                          <label className="flex cursor-pointer items-center gap-2 text-base">
                            <input
                              type="radio"
                              name={`edittype-${t.id}`}
                              checked={editType === "flow"}
                              onChange={() => setEditType("flow")}
                              className="h-5 w-5 accent-accent"
                            />
                            Flow
                          </label>
                        </fieldset>
                      </div>
                      <label className="block text-sm font-medium text-ink">
                        Merchant or description
                        <input
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          required
                          maxLength={500}
                          className="input-field mt-1"
                        />
                      </label>
                      <label className="block w-full max-w-md text-sm font-medium text-ink">
                        Date and time
                        <input
                          type="datetime-local"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          className="input-field mt-1"
                          required
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={
                            editBusy ||
                            !editNote.trim() ||
                            !editDate.trim() ||
                            Math.round(
                              parseFloat(editAmount.replace(/[^0-9.]/g, "") || "0") * 100
                            ) <= 0
                          }
                          className="btn-primary min-h-11"
                        >
                          {editBusy ? "Saving…" : "Save changes"}
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
                        <p className="break-words font-medium text-ink">
                          {t.note
                            ? `${t.note} · ${t.amount_cents < 0 ? "Ebb" : "Flow"}`
                            : t.amount_cents < 0
                              ? "Ebb"
                              : "Flow"}
                        </p>
                        <p className="mt-0.5 break-words text-xs text-muted">
                          {new Date(t.created_at).toLocaleString()} ·{" "}
                          {t.recorded_by_username}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => startEdit(t)}
                            className="text-sm font-medium text-accent hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteTransaction(t.id)}
                            className="text-sm font-medium text-red-700 hover:underline dark:text-red-400"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <p
                        className={`shrink-0 font-display text-lg font-semibold tabular-nums sm:text-xl ${
                          t.amount_cents < 0 ? "text-warm" : "text-accent"
                        }`}
                      >
                        {t.amount_cents < 0 ? "−" : "+"}
                        {formatMoney(Math.abs(t.amount_cents))}
                      </p>
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
