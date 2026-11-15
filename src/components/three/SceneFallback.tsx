const CX = 220;
const CY = 130;
const R = 78;
const SLOTS = 19;
const GAP_SLOT = 15;
const ACCENT_SLOT = 7;

const chairs = Array.from({ length: SLOTS }, (_, slot) => {
  if (slot === GAP_SLOT) return null;
  const a = (slot / SLOTS) * Math.PI * 2 - Math.PI / 2;
  return {
    slot,
    x: CX + Math.cos(a) * R,
    y: CY + Math.sin(a) * R,
    accent: slot === ACCENT_SLOT,
  };
});

/**
 * Static 2D plate for no-WebGL and `prefers-reduced-motion`. A clean plan
 * ring of eighteen chairs with one gap, drawn as a printed monograph plate.
 */
export default function SceneFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <figure className="w-full max-w-lg border border-hairline bg-paper p-4 sm:p-5">
        <svg
          viewBox="0 0 440 280"
          role="img"
          aria-label="Plan ring of eighteen chairs with one gap"
          className="block w-full"
        >
          <rect width="440" height="280" fill="#F9F8F6" />

          <defs>
            <radialGradient id="fbGrid" cx="50%" cy="52%" r="62%">
              <stop offset="0%" stopColor="#1A1A1A" stopOpacity="0.05" />
              <stop offset="72%" stopColor="#1A1A1A" stopOpacity="0.02" />
              <stop offset="100%" stopColor="#1A1A1A" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* drafting grid */}
          <g stroke="url(#fbGrid)" strokeWidth="1">
            {Array.from({ length: 23 }, (_, i) => (
              <line key={`v${i}`} x1={20 + i * 20} y1="0" x2={20 + i * 20} y2="280" />
            ))}
            {Array.from({ length: 15 }, (_, i) => (
              <line key={`h${i}`} x1="0" y1={20 + i * 18} x2="440" y2={20 + i * 18} />
            ))}
          </g>

          {/* soft ground shadow */}
          <ellipse cx={CX} cy={CY + 6} rx={R + 22} ry={R * 0.42} fill="#1A1A1A" opacity="0.07" />

          {/* the ring as a hairline datum */}
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#1A1A1A" strokeOpacity="0.28" strokeWidth="1" />

          {/* eighteen chairs, one gap */}
          {chairs.map((chair) =>
            chair ? (
              <g key={chair.slot}>
                <rect
                  x={chair.x - 4}
                  y={chair.y - 4}
                  width="8"
                  height="8"
                  fill={chair.accent ? '#A85D6B' : '#E8E4DC'}
                  stroke={chair.accent ? '#A85D6B' : '#1A1A1A'}
                  strokeWidth="1"
                />
                {/* back, tangent to the ring */}
                <line
                  x1={chair.x - 6}
                  y1={chair.y - 6}
                  x2={chair.x + 6}
                  y2={chair.y + 6}
                  stroke="#1A1A1A"
                  strokeOpacity="0.35"
                  strokeWidth="1"
                />
              </g>
            ) : null,
          )}

          {/* gap annotation */}
          <line
            x1={CX + Math.cos((GAP_SLOT / SLOTS) * Math.PI * 2 - Math.PI / 2) * (R - 14)}
            y1={CY + Math.sin((GAP_SLOT / SLOTS) * Math.PI * 2 - Math.PI / 2) * (R - 14)}
            x2={CX + Math.cos((GAP_SLOT / SLOTS) * Math.PI * 2 - Math.PI / 2) * (R + 14)}
            y2={CY + Math.sin((GAP_SLOT / SLOTS) * Math.PI * 2 - Math.PI / 2) * (R + 14)}
            stroke="#1A1A1A"
            strokeOpacity="0.16"
            strokeDasharray="2 3"
          />

          {/* centre datum */}
          <circle cx={CX} cy={CY} r="2.5" fill="#A85D6B" />
        </svg>
        <figcaption className="meta mt-3 flex items-baseline justify-between gap-4">
          <span>PLATE 00 — THE DIALECTIC ROOM · STATIC FRAME</span>
        </figcaption>
      </figure>
    </div>
  );
}
