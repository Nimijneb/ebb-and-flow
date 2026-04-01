import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { AppHeader } from "../components/AppHeader";
import { HelpPopover } from "../components/HelpPopover";
import { HeaderUserLeft } from "../components/HeaderUserLeft";

type Envelope = {
  id: number;
  name: string;
  opening_balance_cents: number;
  balance_cents: number;
  created_at: string;
  shared_with_household: boolean;
  can_edit: boolean;
  created_by_user_id: number;
  owner_user_id: number;
  created_by_username: string;
  owner_username: string;
  /** Who may edit shared envelopes (non-admins); same as owner fields for private. */
  assigned_user_id: number;
  assigned_username: string;
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

/** Value for `input type="date"` from a stored ISO timestamp (local calendar date). */
function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD` from a date input → ISO string (noon local) for the API. */
function parseDateInputToIso(dateStr: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const local = new Date(y, mo - 1, day, 12, 0, 0, 0);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

export function EnvelopeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"ebb" | "flow">("ebb");
  /** Stored as `note` in the API; label in UI is merchant / description. */
  const [merchantOrDescription, setMerchantOrDescription] = useState("");
  /** Empty = server uses current time when recording */
  const [transactionDate, setTransactionDate] = useState(""); // YYYY-MM-DD
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editType, setEditType] = useState<"ebb" | "flow">("ebb");
  const [editNote, setEditNote] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const [envelopeEditOpen, setEnvelopeEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editShared, setEditShared] = useState(true);
  const [editAssignedId, setEditAssignedId] = useState(0);
  const [editBalanceDraft, setEditBalanceDraft] = useState("");
  const [envelopeSaveBusy, setEnvelopeSaveBusy] = useState(false);

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
        const iso = parseDateInputToIso(transactionDate);
        if (iso) payload.created_at = iso;
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
    setEditDate(toDateInputValue(t.created_at));
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
    const createdIso = parseDateInputToIso(editDate);
    if (!editDate.trim() || !createdIso) {
      setError("Choose a valid date for this transaction.");
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
          created_at: createdIso,
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

  function startEnvelopeEdit() {
    if (!envelope) return;
    setEditName(envelope.name);
    setEditShared(envelope.shared_with_household);
    setEditAssignedId(envelope.assigned_user_id);
    setEditBalanceDraft((envelope.balance_cents / 100).toFixed(2));
    setEnvelopeEditOpen(true);
  }

  function cancelEnvelopeEdit() {
    setEnvelopeEditOpen(false);
    setEnvelopeSaveBusy(false);
  }

  async function saveEnvelopeEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !envelope || !editName.trim()) return;
    setEnvelopeSaveBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (editName.trim() !== envelope.name) body.name = editName.trim();
      if (editShared !== envelope.shared_with_household) {
        body.shared_with_household = editShared;
      }
      if (
        user?.is_admin &&
        editShared &&
        editAssignedId !== envelope.assigned_user_id
      ) {
        body.assigned_user_id = editAssignedId;
      }
      if (user?.is_admin) {
        const rawBal = editBalanceDraft.replace(/[^0-9.-]/g, "");
        const dollars = parseFloat(rawBal || "0");
        if (!Number.isNaN(dollars)) {
          const cents = Math.round(dollars * 100);
          if (cents !== envelope.balance_cents) {
            body.current_balance_cents = cents;
          }
        }
      }
      if (Object.keys(body).length === 0) {
        cancelEnvelopeEdit();
        return;
      }
      await api(`/api/envelopes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      cancelEnvelopeEdit();
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save envelope settings"
      );
    } finally {
      setEnvelopeSaveBusy(false);
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
      <div className="safe-x safe-t flex min-h-[100dvh] w-full min-w-0 items-center justify-center overflow-x-clip bg-paper">
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

  const canEdit = envelope.can_edit;

  return (
    <div className="min-h-[100dvh] w-full min-w-0 overflow-x-clip bg-paper">
      <AppHeader left={<HeaderUserLeft user={user} />} />

      <main className="safe-x safe-b page-y mx-auto w-full min-w-0 max-w-3xl">
        <Link
          to="/"
          className="mb-4 inline-block text-sm font-medium text-accent hover:underline"
        >
          ← Dashboard
        </Link>
        <div className="mb-6 sm:mb-8">
          {envelopeEditOpen ? (
            <section className="neon-panel rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
              <h2 className="font-display text-lg font-semibold text-ink sm:text-xl">
                <HelpPopover
                  content={
                    <span>
                      Update the name, sharing, and (for shared envelopes) who
                      may add and edit activity. Administrators can assign any
                      household member to manage a shared envelope.
                    </span>
                  }
                >
                  <span className="font-display text-lg font-semibold sm:text-xl">
                    Edit envelope
                  </span>
                </HelpPopover>
              </h2>
              <form onSubmit={saveEnvelopeEdit} className="mt-4 space-y-4">
                <label className="block text-sm font-medium text-ink">
                  Name
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={120}
                    autoFocus
                    className="input-field mt-1 font-display text-xl font-semibold text-ink sm:text-2xl"
                  />
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-paper/60 p-3 dark:bg-black/20">
                  <input
                    type="checkbox"
                    checked={editShared}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setEditShared(next);
                      if (next && envelope) {
                        setEditAssignedId(envelope.assigned_user_id);
                      }
                    }}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
                  />
                  <span className="flex min-w-0 flex-1 items-start justify-between gap-2">
                    <span className="block text-sm font-medium text-ink">
                      Share with household
                    </span>
                    <HelpPopover
                      variant="plain"
                      content={
                        <span>
                          When shared, everyone can see it; only the assigned
                          user (and admins) can edit. When private, only you can
                          see and manage it.
                        </span>
                      }
                    >
                      <span
                        className="shrink-0 text-xs text-muted"
                        aria-label="About sharing"
                      >
                        ⓘ
                      </span>
                    </HelpPopover>
                  </span>
                </label>
                {user?.is_admin ? (
                  <label className="block text-sm font-medium text-ink">
                    <span className="flex items-center gap-1.5">
                      Current balance
                      <HelpPopover
                        variant="plain"
                        content={
                          <span>
                            Administrator-only: sets the total by adjusting
                            opening balance without new transactions. Others
                            change balance via Ebb and Flow below.
                          </span>
                        }
                      >
                        <span className="text-xs font-normal text-muted" aria-label="About balance edit">
                          ⓘ
                        </span>
                      </HelpPopover>
                    </span>
                    <input
                      value={editBalanceDraft}
                      onChange={(e) => setEditBalanceDraft(e.target.value)}
                      inputMode="decimal"
                      className="input-field mt-1 font-display text-xl font-semibold tabular-nums text-ink sm:text-2xl"
                    />
                  </label>
                ) : null}
                {user?.is_admin && editShared ? (
                  <label className="block text-sm font-medium text-ink">
                    <span className="flex items-center gap-1.5">
                      Assigned user (can add and edit)
                      <HelpPopover
                        variant="plain"
                        content={
                          <span>
                            Household members can see this envelope; only this
                            user can change it unless they’re an administrator.
                          </span>
                        }
                      >
                        <span className="text-xs font-normal text-muted" aria-label="About assignment">
                          ⓘ
                        </span>
                      </HelpPopover>
                    </span>
                    <select
                      className="input-field mt-1"
                      value={editAssignedId}
                      onChange={(e) =>
                        setEditAssignedId(Number(e.target.value))
                      }
                    >
                      {user.household.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.username}
                          {m.is_admin ? " (admin)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={envelopeSaveBusy || !editName.trim()}
                    className="btn-primary min-h-11"
                  >
                    {envelopeSaveBusy ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEnvelopeEdit}
                    disabled={envelopeSaveBusy}
                    className="btn-secondary min-h-11"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1">
                  <h1 className="font-display break-words text-2xl font-semibold leading-tight text-ink sm:text-3xl">
                    {envelope.name}
                  </h1>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 flex-wrap items-center gap-4 self-start sm:pt-1">
                    <button
                      type="button"
                      onClick={startEnvelopeEdit}
                      className="text-sm font-medium text-accent hover:underline"
                    >
                      Edit
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
              {!canEdit && (
                <p className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-lg border border-border bg-paper/80 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted dark:bg-black/25">
                    View only
                  </span>
                  <HelpPopover
                    variant="plain"
                    content={
                      envelope.shared_with_household ? (
                        <span>
                          Everyone in your household can see this shared
                          envelope, but only the assigned user and administrators
                          can add or change activity.
                        </span>
                      ) : (
                        <span>
                          You can see this envelope but only its owner can change
                          it.
                        </span>
                      )
                    }
                  >
                    <span className="text-xs text-muted" aria-label="About view-only">
                      ⓘ
                    </span>
                  </HelpPopover>
                </p>
              )}
              <p className="mt-2 text-sm text-ink">
                <HelpPopover
                  content={
                    envelope.shared_with_household ? (
                      <span>
                        Visible to your household.{" "}
                        <span className="font-medium text-ink">
                          {envelope.assigned_username}
                        </span>{" "}
                        can add and edit (administrators always can). Created by{" "}
                        <span className="font-medium text-ink">
                          {envelope.created_by_username}
                        </span>
                        .
                      </span>
                    ) : (
                      <span>
                        Only you can see and manage this envelope. Created by{" "}
                        <span className="font-medium text-ink">
                          {envelope.created_by_username}
                        </span>
                        .
                      </span>
                    )
                  }
                >
                  <span>
                    {envelope.shared_with_household ? (
                      <>
                        <span className="font-medium text-accent">Shared</span>
                        {" · "}
                        {envelope.assigned_username}
                      </>
                    ) : (
                      <span className="font-medium text-private">Private</span>
                    )}
                  </span>
                </HelpPopover>
              </p>
            </>
          )}
          {!envelopeEditOpen && (
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Current balance
              </p>
              <p
                className={`font-display mt-1 text-3xl font-semibold tabular-nums sm:text-4xl ${
                  envelope.balance_cents < 0 ? "text-warm" : "text-ink"
                }`}
              >
                {formatMoney(envelope.balance_cents)}
              </p>
            </div>
          )}
        </div>

        <section className="neon-panel mb-8 rounded-2xl border border-border bg-card p-4 shadow-sm sm:mb-10 sm:p-6">
          <h2 className="font-display text-base font-semibold text-ink sm:text-lg">
            <HelpPopover
              content={
                <span>
                  Ebb removes money from this envelope; Flow adds money back.
                  Leave date empty to use now, or set a past date for something
                  you forgot to enter earlier.
                </span>
              }
            >
              <span className="font-display text-base font-semibold sm:text-lg">
                Add transaction
              </span>
            </HelpPopover>
          </h2>
          {canEdit ? (
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
                  <span className="text-warm">Ebb</span>
                </label>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-base touch-manipulation">
                  <input
                    type="radio"
                    name="txtype"
                    checked={type === "flow"}
                    onChange={() => setType("flow")}
                    className="h-5 w-5 accent-flow"
                  />
                  <span className="text-flow">Flow</span>
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
              Date (optional)
              <input
                type="date"
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
          ) : (
            <p className="mt-4 text-sm text-muted">
              You don’t have permission to add transactions here.
            </p>
          )}
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
                            <span className="text-warm">Ebb</span>
                          </label>
                          <label className="flex cursor-pointer items-center gap-2 text-base">
                            <input
                              type="radio"
                              name={`edittype-${t.id}`}
                              checked={editType === "flow"}
                              onChange={() => setEditType("flow")}
                              className="h-5 w-5 accent-flow"
                            />
                            <span className="text-flow">Flow</span>
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
                        Date
                        <input
                          type="date"
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
                          {t.note ? (
                            <>
                              <span>{t.note}</span>
                              {" · "}
                              <span
                                className={
                                  t.amount_cents < 0 ? "text-warm" : "text-flow"
                                }
                              >
                                {t.amount_cents < 0 ? "Ebb" : "Flow"}
                              </span>
                            </>
                          ) : (
                            <span
                              className={
                                t.amount_cents < 0 ? "text-warm" : "text-flow"
                              }
                            >
                              {t.amount_cents < 0 ? "Ebb" : "Flow"}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 break-words text-xs text-muted">
                          {new Date(t.created_at).toLocaleDateString()} ·{" "}
                          {t.recorded_by_username}
                        </p>
                        {canEdit ? (
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
                        ) : null}
                      </div>
                      <p
                        className={`shrink-0 font-display text-lg font-semibold tabular-nums sm:text-xl ${
                          t.amount_cents < 0 ? "text-warm" : "text-flow"
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
