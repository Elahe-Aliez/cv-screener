// components/logo.tsx — the one mark: a document page with a four-point
// sparkle over its top-right corner. Document strokes follow currentColor;
// the sparkle is always brand teal.
//
// `thinking` runs the choreographed thinking animation (see globals.css):
// the document breathes its opacity while the sparkle glints — scale 0→1→0
// with a soft quarter-turn — on an offset rhythm. Static under
// prefers-reduced-motion. Document and sparkle live in their own <g> so the
// keyframes target them independently, transform/opacity only.

export function Logo({
  size = 22,
  thinking = false,
  className,
}: {
  size?: number;
  thinking?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={thinking ? `logo-thinking ${className ?? ""}` : className}
    >
      <g className="logo-doc">
        {/* page with folded corner */}
        <path
          d="M12.5 3.5H7a1.8 1.8 0 0 0-1.8 1.8v13.4A1.8 1.8 0 0 0 7 20.5h9a1.8 1.8 0 0 0 1.8-1.8V8.8L12.5 3.5Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path
          d="M12.5 3.5v5.3h5.3"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </g>
      <g className="logo-sparkle">
        {/* four-point sparkle, brand teal */}
        <path
          d="M18.6 1.6l.86 2.28 2.28.86-2.28.86-.86 2.28-.86-2.28-2.28-.86 2.28-.86.86-2.28Z"
          fill="var(--brand)"
        />
      </g>
    </svg>
  );
}
