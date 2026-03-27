import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { HelpPopover } from "../components/HelpPopover";
import { HeaderUserLeft } from "../components/HeaderUserLeft";
import { api } from "../api";
import { useAuth } from "../auth";

export function Settings() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [memberFormValid, setMemberFormValid] = useState(false);
  const [creatingMember, setCreatingMember] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [opening, setOpening] = useState("");
  const [shareWithHousehold, setShareWithHousehold] = useState(true);
  const [assignedUserId, setAssignedUserId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (user?.id != null) {
      setAssignedUserId((prev) => (prev === null ? user.id : prev));
    }
  }, [user?.id]);

  function syncMemberFormValidity(form: HTMLFormElement) {
    const fd = new FormData(form);
    const username = String(fd.get("newMemberUsername") ?? "").trim();
    const password = String(fd.get("newMemberPassword") ?? "");
    setMemberFormValid(username.length > 0 && password.length >= 8);
  }

  async function createEnvelope(e: React.FormEvent) {
    e.preventDefault();
    const raw = opening.replace(/[^0-9.]/g, "");
    const dollars = parseFloat(raw || "0");
    const cents = Math.round(dollars * 100);
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        opening_balance_cents: cents,
        shared_with_household: shareWithHousehold,
      };
      if (
        shareWithHousehold &&
        user?.is_admin &&
        assignedUserId != null
      ) {
        body.assigned_user_id = assignedUserId;
      }
      await api("/api/envelopes", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setName("");
      setOpening("");
      setShareWithHousehold(true);
      setAssignedUserId(user?.id ?? null);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create envelope");
    } finally {
      setCreating(false);
    }
  }

  async function createFamilyAccount(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const username = String(fd.get("newMemberUsername") ?? "").trim();
    const password = String(fd.get("newMemberPassword") ?? "");
    const isAdmin = fd.get("newMemberIsAdmin") === "on";
    if (!user?.is_admin || !username || password.length < 8) return;
    setCreatingMember(true);
    setError(null);
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          is_admin: isAdmin,
        }),
      });
      form.reset();
      setMemberFormValid(false);
      await refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setCreatingMember(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-paper">
      <AppHeader left={<HeaderUserLeft user={user} />} />

      <main className="safe-x safe-b page-y mx-auto w-full max-w-3xl">
        <Link
          to="/"
          className="mb-4 inline-block text-sm font-medium text-accent hover:underline"
        >
          ← Dashboard
        </Link>
        <div className="mb-6 sm:mb-8">
          <h1 className="font-display text-2xl font-semibold text-ink sm:text-3xl">
            <HelpPopover
              content={
                <span>
                  Add envelopes and manage who can sign in. New accounts are
                  created by an administrator, not a public sign-up page.
                </span>
              }
            >
              <span className="font-display text-2xl font-semibold sm:text-3xl">
                Settings
              </span>
            </HelpPopover>
          </h1>
        </div>
        {error && (
          <div
            className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm dark:border-red-400/60 dark:bg-red-950/70 dark:text-red-50 dark:shadow-[0_0_32px_rgba(255,60,120,0.45),0_0_60px_rgba(239,68,68,0.2)]"
            role="alert"
          >
            {error}
          </div>
        )}

        {user?.household && (
          <>
            <section className="neon-panel mb-8 rounded-2xl border border-border bg-card p-4 shadow-sm sm:mb-10 sm:p-6">
              <h2 className="font-display text-base font-semibold text-ink sm:text-lg">
                <HelpPopover
                  content={
                    <span>
                      Set a starting balance, then add Ebb and Flow on the
                      envelope page.
                    </span>
                  }
                >
                  <span className="font-display text-base font-semibold sm:text-lg">
                    New envelope
                  </span>
                </HelpPopover>
              </h2>
              <form onSubmit={createEnvelope} className="mt-4 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="block min-w-0 flex-1 text-sm font-medium text-ink">
                    Name
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Groceries"
                      className="input-field mt-1"
                    />
                  </label>
                  <label className="block w-full text-sm font-medium text-ink sm:w-40 sm:shrink-0">
                    Starting balance
                    <input
                      value={opening}
                      onChange={(e) => setOpening(e.target.value)}
                      placeholder="0.00"
                      inputMode="decimal"
                      className="input-field mt-1"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={creating || !name.trim()}
                    className="btn-primary w-full touch-manipulation sm:w-auto"
                  >
                    {creating ? "Adding…" : "Add"}
                  </button>
                </div>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-paper/60 p-3 dark:bg-black/20">
                  <input
                    type="checkbox"
                    checked={shareWithHousehold}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setShareWithHousehold(checked);
                      if (checked && user?.id != null) {
                        setAssignedUserId(user.id);
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
                          Shared envelopes are visible to everyone; the assigned
                          user can add and edit (admins can always edit). Uncheck
                          for a private envelope only you can see.
                        </span>
                      }
                    >
                      <span className="shrink-0 text-xs text-muted" aria-label="About sharing">
                        ⓘ
                      </span>
                    </HelpPopover>
                  </span>
                </label>
                {user.is_admin && shareWithHousehold && user.household ? (
                  <label className="block text-sm font-medium text-ink">
                    <span className="flex items-center gap-1.5">
                      Assigned user
                      <HelpPopover
                        variant="plain"
                        content={
                          <span>
                            Who can add transactions and edit this shared envelope
                            (you remain the creator).
                          </span>
                        }
                      >
                        <span className="text-xs font-normal text-muted" aria-label="About assignment">
                          ⓘ
                        </span>
                      </HelpPopover>
                    </span>
                    <select
                      value={assignedUserId ?? user.id}
                      onChange={(e) =>
                        setAssignedUserId(Number(e.target.value))
                      }
                      className="input-field mt-1"
                    >
                      {[...user.household.members]
                        .sort((a, b) =>
                          a.username.localeCompare(b.username, undefined, {
                            sensitivity: "base",
                          })
                        )
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.username}
                            {m.is_admin ? " (admin)" : ""}
                            {m.id === user.id ? " — you" : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}
              </form>
            </section>

            <section className="neon-panel mb-8 rounded-2xl border border-border bg-card p-4 shadow-sm sm:mb-10 sm:p-6">
              <h2 className="font-display text-base font-semibold text-ink sm:text-lg">
                <HelpPopover
                  content={
                    <span>Accounts that share envelopes and activity.</span>
                  }
                >
                  <span className="font-display text-base font-semibold sm:text-lg">
                    Users
                  </span>
                </HelpPopover>
              </h2>
              {user.is_admin ? (
                <form
                  onSubmit={createFamilyAccount}
                  onInput={(ev) =>
                    syncMemberFormValidity(ev.currentTarget as HTMLFormElement)
                  }
                  className="neon-panel mt-4 rounded-xl border border-border bg-paper/80 p-3 dark:bg-black/25 sm:p-4"
                >
                  <p className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
                    <span>Add user</span>
                    <HelpPopover
                      variant="plain"
                      content={
                        <span>
                          Creates a login. Share the password with them securely.
                        </span>
                      }
                    >
                      <span className="text-[10px] normal-case" aria-label="About adding users">
                        ⓘ
                      </span>
                    </HelpPopover>
                  </p>
                  <div className="mt-3 flex flex-col gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <label className="block min-w-0 flex-1 text-sm font-medium text-ink">
                        Username
                        <input
                          name="newMemberUsername"
                          type="text"
                          autoComplete="off"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          className="input-field mt-1"
                        />
                      </label>
                      <label className="block w-full text-sm font-medium text-ink sm:w-44 sm:shrink-0">
                        Password
                        <input
                          name="newMemberPassword"
                          type="password"
                          autoComplete="new-password"
                          minLength={8}
                          spellCheck={false}
                          className="input-field mt-1"
                        />
                      </label>
                    </div>
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-paper/60 p-3 dark:bg-black/20">
                      <input
                        type="checkbox"
                        name="newMemberIsAdmin"
                        className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
                      />
                      <span className="flex min-w-0 flex-1 items-start justify-between gap-2 text-sm text-ink">
                        <span className="font-medium">Administrator</span>
                        <HelpPopover
                          variant="plain"
                          content={
                            <span>
                              Can edit any shared envelope, assign who manages
                              shared envelopes, and create accounts.
                            </span>
                          }
                        >
                          <span className="shrink-0 text-xs text-muted" aria-label="About administrators">
                            ⓘ
                          </span>
                        </HelpPopover>
                      </span>
                    </label>
                    <button
                      type="submit"
                      disabled={creatingMember || !memberFormValid}
                      className="btn-primary w-full touch-manipulation sm:w-auto sm:self-start"
                    >
                      {creatingMember ? "Creating…" : "Create account"}
                    </button>
                  </div>
                </form>
              ) : (
                <p className="mt-4 text-sm text-muted">
                  Ask an administrator to create an account if someone new needs
                  access.
                </p>
              )}
              <div className="mt-6">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Who has access
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {user.household.members.map((m) => (
                    <li
                      key={m.id}
                      className="max-w-full break-all rounded-full border border-border bg-paper px-3 py-1.5 text-sm text-ink dark:border-[rgba(0,245,255,0.55)] dark:bg-black/40 dark:shadow-[0_0_20px_rgba(0,240,255,0.45),0_0_40px_rgba(200,79,255,0.2)]"
                    >
                      {m.username}
                      {m.is_admin ? (
                        <span className="ml-1.5 text-xs font-medium text-accent">
                          admin
                        </span>
                      ) : null}
                      {m.id === user.id ? (
                        <span className="ml-1 text-muted">(you)</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
