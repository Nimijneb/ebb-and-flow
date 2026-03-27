import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PronghornLogo } from "../components/PronghornLogo";
import { api } from "../api";
import { useAuth } from "../auth";
import { ThemeToggle } from "../theme";

export function ManageHousehold() {
  const { user, logout, refreshUser } = useAuth();
  const [householdName, setHouseholdName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [memberFormValid, setMemberFormValid] = useState(false);
  const [creatingMember, setCreatingMember] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [opening, setOpening] = useState("");
  const [shareWithHousehold, setShareWithHousehold] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (user?.household?.name) setHouseholdName(user.household.name);
  }, [user?.household?.name]);

  async function saveHouseholdName(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !householdName.trim()) return;
    setSavingName(true);
    setError(null);
    try {
      await api("/api/household", {
        method: "PATCH",
        body: JSON.stringify({ name: householdName.trim() }),
      });
      await refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update name");
    } finally {
      setSavingName(false);
    }
  }

  function syncMemberFormValidity(form: HTMLFormElement) {
    const fd = new FormData(form);
    const username = String(fd.get("newMemberUsername") ?? "").trim();
    const password = String(fd.get("newMemberPassword") ?? "");
    setMemberFormValid(username.length > 0 && password.length >= 8);
  }

  async function createFamilyAccount(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const username = String(fd.get("newMemberUsername") ?? "").trim();
    const password = String(fd.get("newMemberPassword") ?? "");
    if (!user?.is_admin || !username || password.length < 8) return;
    setCreatingMember(true);
    setError(null);
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
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

  async function createEnvelope(e: React.FormEvent) {
    e.preventDefault();
    const raw = opening.replace(/[^0-9.]/g, "");
    const dollars = parseFloat(raw || "0");
    const cents = Math.round(dollars * 100);
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api("/api/envelopes", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          opening_balance_cents: cents,
          shared_with_household: shareWithHousehold,
        }),
      });
      setName("");
      setOpening("");
      setShareWithHousehold(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-paper">
      <header className="chromatic-header sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur-md">
        <div className="safe-x safe-t mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 pb-3 sm:pb-4">
          <div className="min-w-0 flex-1">
            <Link
              to="/"
              className="mb-1 inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline"
            >
              ← Dashboard
            </Link>
            <div className="flex items-center gap-2">
              <PronghornLogo
                decorative
                className="h-8 w-auto shrink-0 text-ink"
              />
              <p className="font-display text-lg font-semibold text-ink sm:text-xl">
                Manage household
              </p>
            </div>
            <p className="truncate text-sm text-muted">{user?.username}</p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
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
        {error && (
          <div
            className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm dark:border-red-400/60 dark:bg-red-950/70 dark:text-red-50 dark:shadow-[0_0_32px_rgba(255,60,120,0.45),0_0_60px_rgba(239,68,68,0.2)]"
            role="alert"
          >
            {error}
          </div>
        )}

        {user?.household && (
          <section className="neon-panel mb-8 rounded-2xl border border-border bg-card p-4 shadow-sm sm:mb-10 sm:p-6">
            <h2 className="font-display text-base font-semibold text-ink sm:text-lg">
              Household
            </h2>
            <p className="mt-1 text-sm text-muted">
              Shared envelopes and their activity are visible to everyone here.
              Envelopes can also be private to just you — set that when you
              create one below. New member accounts are created by an
              administrator, not a public sign-up page.
            </p>
            <form
              onSubmit={saveHouseholdName}
              className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <label className="block min-w-0 flex-1 text-sm font-medium text-ink">
                Name
                <input
                  value={householdName}
                  onChange={(e) => setHouseholdName(e.target.value)}
                  placeholder="The Smith family"
                  className="input-field mt-1"
                />
              </label>
              <button
                type="submit"
                disabled={
                  savingName ||
                  !householdName.trim() ||
                  householdName.trim() === user.household.name
                }
                className="btn-secondary w-full shrink-0 sm:w-auto"
              >
                {savingName ? "Saving…" : "Save name"}
              </button>
            </form>
            {user.is_admin ? (
              <form
                onSubmit={createFamilyAccount}
                onInput={(ev) =>
                  syncMemberFormValidity(ev.currentTarget as HTMLFormElement)
                }
                className="neon-panel mt-6 rounded-xl border border-border bg-paper/80 p-3 dark:bg-black/25 sm:p-4"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Add a family member
                </p>
                <p className="mt-1 text-sm text-muted">
                  Creates a login for your household. Share the password with
                  them securely.
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
                Ask your household admin to create an account if someone new
                needs access.
              </p>
            )}
            <div className="mt-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Members
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
        )}

        <section className="neon-panel mb-8 rounded-2xl border border-border bg-card p-4 shadow-sm sm:mb-10 sm:p-6">
          <h2 className="font-display text-base font-semibold text-ink sm:text-lg">
            New envelope
          </h2>
          <p className="mt-1 text-sm text-muted">
            Set a starting balance, then add debits and credits on the envelope
            page.
          </p>
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
                onChange={(e) => setShareWithHousehold(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
              />
              <span>
                <span className="block text-sm font-medium text-ink">
                  Share with household
                </span>
                <span className="mt-0.5 block text-sm text-muted">
                  Uncheck for a private envelope only you can see and manage.
                </span>
              </span>
            </label>
          </form>
        </section>
      </main>
    </div>
  );
}
