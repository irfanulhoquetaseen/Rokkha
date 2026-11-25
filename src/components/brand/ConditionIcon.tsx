/** Simple, flat 24x24 inline SVG icons for the 8 supported conditions (zero client bundle impact). */
export function ConditionIcon({ code, className = "size-6" }: { code: string; className?: string }) {
  const base = {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.85,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    className,
  };

  switch (code) {
    case "STROKE": // Brain
      return (
        <svg {...base}>
          <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
          <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
          <path d="M9 12a2 2 0 0 1 3-1.73A2 2 0 0 1 15 12" />
        </svg>
      );
    case "HEART_ATTACK": // Heart + ECG pulse
      return (
        <svg {...base}>
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
          <path d="M7.5 11.5h2l1.5-2.5 2 5 1.5-2.5h2" />
        </svg>
      );
    case "TRAUMA": // Emergency medical cross shield
      return (
        <svg {...base}>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M12 8v8" />
          <path d="M8 12h8" />
        </svg>
      );
    case "DENGUE": // Mosquito
      return (
        <svg {...base}>
          <ellipse cx="12" cy="13" rx="2.5" ry="4.5" />
          <circle cx="12" cy="7" r="1.5" />
          <path d="M12 5.5V3" />
          <path d="M9.5 11C6 9.5 3.5 10.5 3 13c2 .8 4.5.6 6.5-.4" />
          <path d="M14.5 11c3.5-1.5 6-.5 6.5 2-2 .8-4.5.6-6.5-.4" />
          <path d="M9.8 14.5 6 19" />
          <path d="M14.2 14.5 18 19" />
          <path d="M10.5 16.5 9 20.5" />
          <path d="M13.5 16.5 15 20.5" />
        </svg>
      );
    case "BREATHING": // Lungs
      return (
        <svg {...base}>
          <path d="M12 3v7" />
          <path d="M12 10 8.5 12" />
          <path d="M12 10l3.5 2" />
          <path d="M8.5 8.5C5.2 8.8 3.5 11.8 3.5 16.2c0 2.3 1.2 3.8 3.3 3.8 2 0 3.2-1.1 3.2-3.2V11.2c0-1.6-.6-2.8-1.5-2.7Z" />
          <path d="M15.5 8.5c3.3.3 5 3.3 5 7.7 0 2.3-1.2 3.8-3.3 3.8-2 0-3.2-1.1-3.2-3.2v-5.6c0-1.6.6-2.8 1.5-2.7Z" />
        </svg>
      );
    case "PREGNANCY": // Mother & child heart
      return (
        <svg {...base}>
          <circle cx="12" cy="5.5" r="2.2" />
          <path d="M9 10.5c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.5v2.2c1.2.9 1.8 2.2 1.5 3.8-.4 2-2.2 3.5-4.5 3.5s-4.1-1.5-4.5-3.5c-.3-1.6.3-2.9 1.5-3.8Z" />
          <circle cx="12" cy="15.2" r="1.4" />
        </svg>
      );
    case "SNAKEBITE": // Coiled snake
      return (
        <svg {...base}>
          <path d="M17.5 6.5a2 2 0 0 1 2 2c0 1.4-1.5 2-3.5 2.2-2.8.3-6 .8-6 3.3 0 2 2.2 3 5.5 3 2.5 0 4.5 1.1 4.5 2.8 0 1.2-1.2 2.2-3.5 2.2H6.5C4.5 22 3.5 20.8 3.5 19.3" />
          <path d="M19.5 6.5 21 5" />
          <circle cx="16.5" cy="7.5" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "ANIMAL_BITE": // Dog silhouette / head
      return (
        <svg {...base}>
          <path d="M7 9 5.2 4.8a.8.8 0 0 1 1.1-1L9.5 6h5l3.2-2.2a.8.8 0 0 1 1.1 1L17 9v4.5a5 5 0 0 1-10 0V9Z" />
          <circle cx="9.8" cy="11.2" r="0.7" fill="currentColor" stroke="none" />
          <circle cx="14.2" cy="11.2" r="0.7" fill="currentColor" stroke="none" />
          <path d="M10.8 14.5h2.4L12 16l-1.2-1.5Z" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return (
        <svg {...base}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8" />
          <path d="M8 12h8" />
        </svg>
      );
  }
}
