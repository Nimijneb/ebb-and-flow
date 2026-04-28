import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { EbAndFlowLogo } from "../components/EbAndFlowLogo";
import { ThemeToggle } from "../theme";

export function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const username = String(fd.get("username") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      const pw = form.querySelector<HTMLInputElement>('input[name="password"]');
      if (pw) pw.value = "";
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain bg-paper">
      <div
        className="login-backdrop pointer-events-none fixed inset-0 opacity-[0.35] dark:opacity-[0.55]"
        aria-hidden
      />
      <div className="safe-x safe-t relative z-[1] mx-auto flex w-full max-w-md flex-1 flex-col justify-start pt-6 pb-40 sm:justify-center sm:py-16 sm:pb-16">
        <div className="mb-4 flex justify-end sm:mb-6">
          <ThemeToggle />
        </div>
        <div className="mb-8 text-center sm:mb-10">
          <h1 className="neon-login-icon mx-auto mb-4 inline-flex min-h-14 max-w-[min(100%,22rem)] items-center justify-center gap-3 rounded-2xl bg-accent px-4 py-2 shadow-lg shadow-teal-900/10 sm:px-5">
            <EbAndFlowLogo
              decorative
              className="shrink-0 text-white dark:text-[#06060c]"
            />
            <span className="font-display text-2xl font-semibold tracking-tight text-white dark:text-[#06060c] sm:text-3xl">
              Ebb and Flow
            </span>
          </h1>
          <p className="mt-2 px-1 text-sm text-muted sm:text-base">
            Sign in with the username your administrator created for you.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="neon-panel rounded-2xl border border-border bg-card p-5 shadow-xl shadow-stone-900/5 dark:shadow-[0_0_50px_rgba(255,46,196,0.35),0_0_80px_rgba(0,240,255,0.15)] sm:p-8"
          autoComplete="on"
        >
          {error && (
            <div
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-400/60 dark:bg-red-950/70 dark:text-red-50 dark:shadow-[0_0_28px_rgba(255,60,120,0.45)]"
              role="alert"
            >
              {error}
            </div>
          )}
          <label className="block text-sm font-medium text-ink" htmlFor="login-username">
            Username
            <input
              id="login-username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              required
              className="input-field mt-1"
            />
          </label>
          {/*
            Fully uncontrolled (no value/onChange): read via FormData on submit.
            Avoids React sync fighting the browser on password and username fields.
          */}
          <label className="mt-4 block text-sm font-medium text-ink" htmlFor="login-password">
            Password
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              required
              className="input-field mt-1"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary mt-6 w-full touch-manipulation py-3.5 disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
