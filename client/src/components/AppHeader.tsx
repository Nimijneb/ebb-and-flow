import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { EbAndFlowLogo } from "./EbAndFlowLogo";
import { ThemeToggle } from "../theme";

function IconMenuClosed({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function IconMenuOpen({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

type AppHeaderProps = {
  left: ReactNode;
};

export function AppHeader({ left }: AppHeaderProps) {
  const { logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      const el = wrapRef.current;
      if (el && !el.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [menuOpen]);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
      isActive
        ? "bg-accent/15 text-accent"
        : "text-ink hover:bg-paper/80 dark:hover:bg-black/30"
    }`;

  return (
    <header className="chromatic-header sticky top-0 z-20 overflow-visible border-b border-border bg-card/90 backdrop-blur-md">
      <div className="safe-x safe-t mx-auto max-w-3xl pb-2 sm:pb-4">
        <div className="relative flex h-[4.25rem] items-center justify-between sm:h-[4.5rem]">
          <div className="pointer-events-none relative z-20 flex h-full min-w-0 max-w-[min(13rem,46%)] flex-col justify-center overflow-hidden pr-1 sm:max-w-[min(18rem,44%)] sm:pr-2">
            <div className="pointer-events-auto min-w-0 max-w-full">{left}</div>
          </div>
          <Link
            to="/"
            className="absolute left-1/2 top-1/2 z-10 flex max-w-[min(calc(100%-5.5rem),12rem)] -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-lg outline-none ring-accent/40 transition hover:opacity-90 focus-visible:ring-2 sm:max-w-none sm:gap-2"
          >
            <EbAndFlowLogo decorative className="shrink-0 text-ink" />
            <span className="min-w-0 truncate font-display text-base font-semibold text-ink sm:text-xl">
              Ebb and Flow
            </span>
          </Link>
          <div
            className="relative z-20 flex shrink-0 items-center justify-end"
            ref={wrapRef}
          >
            <button
              type="button"
              id="app-header-menu-button"
              aria-expanded={menuOpen}
              aria-controls="app-header-nav-menu"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMenuOpen((o) => !o)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-paper/40 text-ink shadow-sm transition hover:border-accent/35 hover:bg-paper/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 dark:border-border dark:bg-black/25 dark:hover:bg-black/40"
            >
              {menuOpen ? (
                <IconMenuOpen className="h-5 w-5" />
              ) : (
                <IconMenuClosed className="h-5 w-5" />
              )}
            </button>
            {menuOpen ? (
              <div
                id="app-header-nav-menu"
                role="navigation"
                aria-label="App navigation"
                className="neon-panel absolute right-0 top-[calc(100%+0.25rem)] z-50 min-w-[13.5rem] rounded-2xl border border-border bg-card py-2 shadow-lg dark:shadow-[0_0_40px_rgba(0,240,255,0.12)]"
              >
                <NavLink
                  to="/schedules"
                  className={navLinkClass}
                  onClick={() => setMenuOpen(false)}
                >
                  Schedules
                </NavLink>
                <NavLink
                  to="/settings"
                  className={navLinkClass}
                  onClick={() => setMenuOpen(false)}
                >
                  Settings
                </NavLink>
                <div className="mx-2 my-2 border-t border-border" />
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-sm font-medium text-muted">Theme</span>
                  <ThemeToggle className="!h-9 !w-9" />
                </div>
                <div className="border-t border-border px-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                    }}
                    className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink transition hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
