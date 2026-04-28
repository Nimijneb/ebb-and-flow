import { useId, type ReactNode } from "react";

/** `w-max` + `max-w-*` — avoid `w: 100vw` on an absolutely positioned panel (iOS Safari overflow / “shrunk” layout). */
const panelClass =
  "pointer-events-none invisible absolute left-0 top-full z-30 mt-2 w-max max-w-[min(22rem,calc(100dvw-2rem))] rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm leading-snug text-muted opacity-0 shadow-lg transition-all duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 dark:border-[rgba(0,245,255,0.35)] dark:bg-[#120818] dark:text-[#c8b8e0] dark:shadow-[0_0_40px_rgba(0,240,255,0.2)]";

type Props = {
  /** Shown in the popover on hover / keyboard focus */
  content: ReactNode;
  /** Hover target */
  children: ReactNode;
  /** `underline` = dotted underline (section titles); `plain` = no extra styling (icons) */
  variant?: "underline" | "plain";
  className?: string;
};

/**
 * Accessible help: hover or focus the trigger to show longer copy without cluttering the layout.
 */
export function HelpPopover({
  content,
  children,
  variant = "underline",
  className = "",
}: Props) {
  const tooltipId = useId();

  const trigger =
    variant === "underline" ? (
      <span className="inline cursor-help border-b border-dotted border-muted transition-colors group-hover:border-ink">
        {children}
      </span>
    ) : (
      <span className="inline-flex cursor-help items-center text-muted">{children}</span>
    );

  return (
    <span
      className={`group relative inline-block max-w-full rounded outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${className}`}
      tabIndex={0}
      aria-describedby={tooltipId}
    >
      {trigger}
      <div id={tooltipId} role="tooltip" className={panelClass}>
        {content}
      </div>
    </span>
  );
}
