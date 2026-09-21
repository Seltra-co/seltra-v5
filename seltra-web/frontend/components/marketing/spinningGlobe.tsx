//seltra-web/frontend/components/marketing/SpinningGlobe.tsx

const LATITUDES = [-60, -30, 0, 30, 60]
const LONGITUDES = [0, 30, 60, 90, 120, 150]

const PINS = [
  { label: 'Accra', top: '46%', left: '38%', live: true },
  { label: 'Lagos', top: '54%', left: '46%', live: true },
  { label: 'San Francisco', top: '38%', left: '68%', live: false },
]

export function SpinningGlobe() {
  return (
    <div className="relative mx-auto flex h-[300px] w-[300px] items-center justify-center sm:h-[380px] sm:w-[380px]">
      <style>{`
        @keyframes seltra-globe-spin {
          from { transform: rotateY(0deg); }
          to { transform: rotateY(360deg); }
        }
        .seltra-globe-sphere {
          transform-style: preserve-3d;
          animation: seltra-globe-spin 16s linear infinite;
        }
        .seltra-globe-ring {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
        }
      `}</style>

      {/* outer glow */}
      <div className="absolute inset-0 rounded-full shadow-[0_0_90px_rgba(31,157,99,0.22)]" />

      {/* sphere shading for volume */}
      <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(31,157,99,0.22),transparent_62%)]" />
      <div className="pointer-events-none absolute inset-0 rounded-full border border-primary/20" />

      <div
        className="seltra-globe-sphere absolute inset-0"
        style={{ perspective: '900px' }}
      >
        {LATITUDES.map((deg) => (
          <div
            key={`lat-${deg}`}
            className="seltra-globe-ring border border-primary/25"
            style={{ transform: `rotateX(${deg}deg)` }}
          />
        ))}
        {LONGITUDES.map((deg) => (
          <div
            key={`lon-${deg}`}
            className="seltra-globe-ring border border-primary/15"
            style={{ transform: `rotateY(${deg}deg)` }}
          />
        ))}
      </div>

      {/* location pins */}
      {PINS.map((pin) => (
        <div
          key={pin.label}
          className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
          style={{ top: pin.top, left: pin.left }}
        >
          <span className="relative flex h-2.5 w-2.5">
            {pin.live && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            )}
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                pin.live ? 'bg-primary' : 'border border-muted-foreground/60 bg-background'
              }`}
            />
          </span>
          <span className="whitespace-nowrap font-mono text-[10px] text-muted-foreground">
            {pin.label}
          </span>
        </div>
      ))}
    </div>
  )
}