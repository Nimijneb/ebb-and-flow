import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { AppHeader } from "../components/AppHeader";
import { HelpPopover } from "../components/HelpPopover";
import { HeaderUserLeft } from "../components/HeaderUserLeft";

export type EnvelopeSummary = {
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
  assigned_user_id: number;
  assigned_username: string;
};

function formatMoney(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

const ENVELOPES_HELP =
  "Shared envelopes are visible to everyone; only the assigned user (and administrators) can add or edit activity. Private envelopes are visible only to you. Cards marked View only are shared with the household but assigned to someone else.";

async function saveDashboardEnvelopeOrder(envelopeIds: number[]): Promise<void> {
  await api("/api/me/dashboard-envelope-order", {
    method: "PUT",
    body: JSON.stringify({ envelope_ids: envelopeIds }),
  });
}

export function Dashboard() {
  const { user } = useAuth();
  const [envelopes, setEnvelopes] = useState<EnvelopeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [orderEditMode, setOrderEditMode] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ envelopes: EnvelopeSummary[] }>("/api/envelopes");
      setEnvelopes(data.envelopes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = envelopes.reduce((s, e) => s + e.balance_cents, 0);

  const reorder = useCallback(
    (sourceId: number, targetId: number) => {
      if (sourceId === targetId) return;
      setEnvelopes((prev) => {
        const next = [...prev];
        const si = next.findIndex((x) => x.id === sourceId);
        const ti = next.findIndex((x) => x.id === targetId);
        if (si < 0 || ti < 0) return prev;
        const [removed] = next.splice(si, 1);
        next.splice(ti, 0, removed);
        const ids = next.map((x) => x.id);
        void saveDashboardEnvelopeOrder(ids).catch((err) => {
          setError(err instanceof Error ? err.message : "Could not save order");
          void load();
        });
        return next;
      });
    },
    [load]
  );

  const move = useCallback(
    (index: number, dir: -1 | 1) => {
      setEnvelopes((prev) => {
        const j = index + dir;
        if (j < 0 || j >= prev.length) return prev;
        const next = [...prev];
        [next[index], next[j]] = [next[j], next[index]];
        void saveDashboardEnvelopeOrder(next.map((x) => x.id)).catch((err) => {
          setError(err instanceof Error ? err.message : "Could not save order");
          void load();
        });
        return next;
      });
    },
    [load]
  );

  return (
    <div className="min-h-[100dvh] w-full min-w-0 overflow-x-clip bg-paper">
      <AppHeader left={<HeaderUserLeft user={user} />} />

      <main className="safe-x safe-b page-y mx-auto w-full min-w-0 max-w-3xl">
        {error && (
          <div
            className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm dark:border-red-400/60 dark:bg-red-950/70 dark:text-red-50 dark:shadow-[0_0_32px_rgba(255,60,120,0.45),0_0_60px_rgba(239,68,68,0.2)]"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="mb-6 rounded-2xl border border-border bg-gradient-to-br from-card to-accent-dim/30 p-4 shadow-sm neon-hero-total sm:mb-8 sm:p-6">
          <p className="text-sm font-medium text-muted">Total across envelopes</p>
          <p
            className={`font-display mt-1 text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl ${
              total < 0 ? "text-warm" : "text-ink"
            }`}
          >
            {formatMoney(total)}
          </p>
        </div>

        <section className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="font-display min-w-0 text-base font-semibold text-ink sm:text-lg">
              <HelpPopover content={ENVELOPES_HELP}>
                <span className="font-display text-base font-semibold sm:text-lg">
                  Envelopes
                </span>
              </HelpPopover>
            </h2>
            {!loading && envelopes.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setOrderEditMode((v) => {
                    if (v) setDraggingId(null);
                    return !v;
                  });
                }}
                className="shrink-0 rounded-lg border border-border bg-paper/80 px-2.5 py-1 text-xs font-medium text-muted transition hover:border-accent/50 hover:text-ink dark:border-[rgba(0,245,255,0.35)] dark:bg-black/30 dark:hover:text-[#e8e0ff]"
              >
                {orderEditMode ? "Done" : "Edit order"}
              </button>
            ) : null}
          </div>

          {loading ? (
            <p className="mt-4 text-muted">Loading…</p>
          ) : envelopes.length === 0 ? (
            <p className="neon-panel mt-4 rounded-xl border border-dashed border-border bg-paper/50 px-4 py-8 text-center text-muted dark:border-[rgba(0,245,255,0.45)] dark:bg-black/30 dark:text-[#d4c4f0]">
              No envelopes yet. Open{" "}
              <Link to="/settings" className="font-medium text-accent underline">
                Settings
              </Link>{" "}
              to add envelopes or users.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {envelopes.map((env, index) => (
                <li
                  key={env.id}
                  className={`flex ${orderEditMode ? "gap-1.5 sm:gap-2" : ""}`}
                  onDragOver={
                    orderEditMode
                      ? (e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }
                      : undefined
                  }
                  onDrop={
                    orderEditMode
                      ? (e) => {
                          e.preventDefault();
                          const raw = e.dataTransfer.getData("text/plain");
                          const sourceId = Number(raw);
                          if (!Number.isFinite(sourceId)) return;
                          reorder(sourceId, env.id);
                        }
                      : undefined
                  }
                >
                  {orderEditMode ? (
                    <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 sm:justify-start">
                      <button
                        type="button"
                        className="rounded px-1 py-0.5 text-muted hover:bg-stone-100 hover:text-ink disabled:opacity-30 dark:hover:bg-purple-950/60 dark:hover:text-[#e8e0ff]"
                        aria-label="Move up"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <span aria-hidden className="block text-xs leading-none">
                          ▲
                        </span>
                      </button>
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label="Drag to reorder"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", String(env.id));
                          e.dataTransfer.effectAllowed = "move";
                          setDraggingId(env.id);
                        }}
                        onDragEnd={() => setDraggingId(null)}
                        className="cursor-grab touch-none select-none rounded px-1 py-1 text-muted hover:bg-stone-100/80 hover:text-ink active:cursor-grabbing dark:hover:bg-purple-950/50 dark:hover:text-[#e8e0ff]"
                      >
                        <span aria-hidden className="block text-[10px] leading-none tracking-tighter">
                          ⋮⋮
                        </span>
                      </div>
                      <button
                        type="button"
                        className="rounded px-1 py-0.5 text-muted hover:bg-stone-100 hover:text-ink disabled:opacity-30 dark:hover:bg-purple-950/60 dark:hover:text-[#e8e0ff]"
                        aria-label="Move down"
                        disabled={index === envelopes.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <span aria-hidden className="block text-xs leading-none">
                          ▼
                        </span>
                      </button>
                    </div>
                  ) : null}
                  <Link
                    to={`/envelope/${env.id}`}
                    className={`neon-panel min-w-0 flex-1 flex flex-col gap-3 rounded-2xl border border-border bg-card px-3 py-4 shadow-sm transition active:bg-stone-50/80 dark:active:bg-purple-950/50 sm:flex-row sm:items-center sm:justify-between sm:px-5 hover:border-accent/40 hover:shadow-md dark:hover:border-[rgba(0,245,255,0.75)] dark:hover:shadow-[0_0_36px_rgba(0,240,255,0.35),0_0_60px_rgba(200,79,255,0.2)] ${
                      draggingId === env.id ? "opacity-50" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink">
                        {env.name}
                        <span
                          className={`ml-2 align-middle text-xs font-medium ${
                            env.shared_with_household ? "text-accent" : "text-private"
                          }`}
                        >
                          {env.shared_with_household ? "Shared" : "Private"}
                        </span>
                        {!env.can_edit ? (
                          <span className="ml-2 align-middle text-xs font-medium text-muted">
                            View only
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted">
                        Opened {new Date(env.created_at).toLocaleDateString()}
                        {env.shared_with_household ? (
                          <>
                            {" · "}
                            Manages: {env.assigned_username}
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-baseline justify-between gap-4 border-t border-border pt-3 sm:border-t-0 sm:pt-0 sm:text-right">
                      <span className="text-xs text-muted sm:hidden">Balance</span>
                      <p
                        className={`font-display text-xl font-semibold tabular-nums sm:text-2xl ${
                          env.balance_cents < 0 ? "text-warm" : "text-ink"
                        }`}
                      >
                        {formatMoney(env.balance_cents)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
