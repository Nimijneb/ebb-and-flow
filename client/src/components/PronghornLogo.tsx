/**
 * Line-art mark: pronghorn arched off the ground, leaping toward a readable envelope.
 * Uses currentColor for light/dark themes.
 */
export function PronghornLogo({
  className = "",
  decorative = false,
}: {
  className?: string;
  /** When true, hide from assistive tech (pair with visible “Pronghorn” text). */
  decorative?: boolean;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 280 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : "Pronghorn"}
    >
      {!decorative ? <title>Pronghorn</title> : null}
      {/* Ground */}
      <path
        d="M 6 90 L 150 90"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* Pronghorn — arched leap, hind feet on / just leaving ground */}
      <path
        d="M 22 90 Q 38 52 58 38 Q 76 24 94 30 Q 102 20 110 28"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Forked horn */}
      <path
        d="M 110 28 L 114 10 M 108 22 L 124 8"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Belly / underline of arch */}
      <path
        d="M 38 52 Q 62 46 96 56"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Hind legs — push-off */}
      <path
        d="M 18 90 L 12 90 M 26 90 L 32 74 M 36 88 L 44 70"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Forelegs — reaching forward, clear gap before envelope */}
      <path
        d="M 94 50 L 124 44 M 88 56 L 118 54"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Tail */}
      <path
        d="M 22 90 Q 10 78 8 66"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Envelope — body + flap + fold lines */}
      <path
        d="M 168 60 L 168 94 L 268 94 L 268 60"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 168 60 L 218 16 L 268 60"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 218 16 L 218 60"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 168 94 L 218 60 L 268 94"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Opening / mouth line */}
      <path
        d="M 188 60 L 218 78 L 248 60"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
