import { useId, useMemo, type CSSProperties } from 'react'

// Animated backdrop for the sign-in page: a night sky with twinkling stars and
// the odd shooting star over a city skyline, and a self-driving car cruising
// down the road with its headlights on. Purely decorative (aria-hidden), and
// every animation is `motion-safe:` so it holds still for reduced-motion users.

/** Small seeded random generator, so the scene looks the same on every visit. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Building = { x: number; w: number; h: number; windows: { x: number; y: number; color: string; twinkle: boolean; delay: number }[] }

/** A row of buildings across a 1200-wide skyline, with some lit windows. */
function skyline(seed: number, minH: number, maxH: number, litChance: number): Building[] {
  const r = seeded(seed)
  const out: Building[] = []
  for (let x = -10; x < 1210; ) {
    const w = 38 + r() * 72
    const h = minH + r() * (maxH - minH) * (r() < 0.18 ? 1.35 : 1)
    const windows: Building['windows'] = []
    for (let wy = 300 - h + 12; wy < 300 - 14; wy += 15) {
      for (let wx = x + 7; wx < x + w - 9; wx += 12) {
        if (r() < litChance) {
          windows.push({
            x: wx,
            y: wy,
            color: r() < 0.8 ? '#ffd58a' : '#7df3e8',
            twinkle: r() < 0.18,
            delay: -r() * 8,
          })
        }
      }
    }
    out.push({ x, w, h, windows })
    x += w + 2 + r() * 8
  }
  return out
}

/** Twinkling stars scattered over the top part of the screen. */
function StarField({ seed, count, maxTop }: { seed: number; count: number; maxTop: number }) {
  const stars = useMemo(() => {
    const r = seeded(seed)
    return Array.from({ length: count }, () => ({
      left: r() * 100,
      top: r() * maxTop,
      size: r() < 0.86 ? 1 + r() * 1.1 : 2 + r() * 1.2,
      duration: 2.5 + r() * 5,
      delay: -r() * 7,
      dim: 0.12 + r() * 0.3,
    }))
  }, [seed, count, maxTop])

  return stars.map((s, i) => (
    <span
      key={i}
      className="absolute rounded-full bg-white motion-safe:animate-twinkle"
      style={
        {
          left: `${s.left}%`,
          top: `${s.top}%`,
          width: s.size,
          height: s.size,
          opacity: s.dim,
          animationDuration: `${s.duration}s`,
          animationDelay: `${s.delay}s`,
          '--dim': s.dim,
          boxShadow: s.size > 2 ? '0 0 6px rgb(255 255 255 / 0.7)' : undefined,
        } as CSSProperties
      }
    />
  ))
}

/** Shooting stars: each streaks down-left once per cycle, at different times. */
function ShootingStars({ streaks }: { streaks: { top: string; left: string; delay: string; duration: string }[] }) {
  return streaks.map((s, i) => (
    <div key={i} className="absolute" style={{ top: s.top, left: s.left, transform: 'rotate(152deg)', transformOrigin: 'left center' }}>
      <span
        className="block h-[2px] w-36 rounded-full bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.95))] opacity-0 motion-safe:animate-shoot"
        style={{ animationDelay: s.delay, animationDuration: s.duration }}
      />
    </div>
  ))
}

/** A palm tree silhouette standing at (x, bottom of a 300-tall viewBox), leaning by `lean`. */
function Palm({ x, height, lean }: { x: number; height: number; lean: number }) {
  const top = 300 - height
  const tx = x + lean // where the trunk ends and the fronds start
  const frond = (dx: number, dy: number, droop: number) =>
    `M${tx} ${top} C ${tx + dx * 0.4} ${top + dy * 0.2 - 18}, ${tx + dx * 0.8} ${top + dy * 0.5 - 8}, ${tx + dx} ${top + dy + droop}
     C ${tx + dx * 0.75} ${top + dy * 0.45 + 2}, ${tx + dx * 0.35} ${top + dy * 0.15 - 6}, ${tx} ${top} Z`
  return (
    <g fill="#03060c" stroke="#03060c">
      <path d={`M${x} 300 C ${x + lean * 0.2} ${300 - height * 0.45}, ${x + lean * 0.7} ${300 - height * 0.8}, ${tx} ${top}`} fill="none" strokeWidth="7" strokeLinecap="round" />
      <path d={frond(78, 20, 26)} />
      <path d={frond(-74, 18, 30)} />
      <path d={frond(62, -26, 8)} />
      <path d={frond(-58, -30, 10)} />
      <path d={frond(14, -46, 0)} />
      <path d={frond(-26, 36, 34)} />
      <circle cx={tx} cy={top + 4} r="6" />
    </g>
  )
}

/** Signed-in Preferences backdrop: a calm Miami night by the water. */
export function BayNight() {
  const moonMask = useId()
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 overflow-hidden bg-[linear-gradient(180deg,#02040b_0%,#050b1a_45%,#0a1631_80%,#081226_100%)]"
    >
      {/* Milky Way: a faint band across the sky, with extra stars */}
      <div className="absolute left-[-25%] top-[2%] h-[40vh] w-[150%] -rotate-[16deg] bg-[radial-gradient(ellipse_at_center,rgb(170_190_255/0.11),rgb(120_150_255/0.04)_40%,transparent_70%)] blur-md" />
      <StarField seed={23} count={110} maxTop={70} />
      <StarField seed={41} count={70} maxTop={45} />
      <ShootingStars
        streaks={[
          { top: '12%', left: '70%', delay: '3s', duration: '13s' },
          { top: '6%', left: '40%', delay: '9s', duration: '17s' },
        ]}
      />

      {/* Crescent moon with a soft glow */}
      <svg className="absolute right-[14%] top-[9%] size-[72px] drop-shadow-[0_0_28px_rgb(255_244_214/0.35)]" viewBox="0 0 72 72">
        <defs>
          <mask id={moonMask}>
            <rect width="72" height="72" fill="black" />
            <circle cx="36" cy="36" r="30" fill="white" />
            <circle cx="50" cy="28" r="26" fill="black" />
          </mask>
        </defs>
        <circle cx="36" cy="36" r="30" fill="#f4efdf" mask={`url(#${moonMask})`} />
      </svg>

      {/* The bay: dark water with a faint horizon line */}
      <div className="absolute inset-x-0 bottom-0 h-[16vh] border-t border-[#7df3e8]/10 bg-[linear-gradient(180deg,#07122a,#02050c)]" />

      {/* Moonlight shimmering on the water, under the moon */}
      <div className="absolute bottom-[2vh] right-[calc(14%+16px)] flex h-[13vh] w-10 flex-col items-center justify-start gap-[7px]">
        {[36, 28, 34, 20, 26, 14, 22, 10, 16].map((w, i) => (
          <span
            key={i}
            className="h-[2px] rounded-full bg-[#f4efdf] motion-safe:animate-twinkle"
            style={{ width: w, opacity: 0.35, animationDuration: `${2.2 + (i % 3) * 0.9}s`, animationDelay: `${-i * 0.4}s`, '--dim': 0.12 } as CSSProperties}
          />
        ))}
      </div>

      {/* Palm trees on the shore at both edges (the middle stays clear for the cards) */}
      <svg className="absolute bottom-[12vh] left-0 h-[36vh] w-auto" viewBox="0 0 260 300" preserveAspectRatio="xMinYMax meet">
        <ellipse cx="70" cy="306" rx="150" ry="22" fill="#03060c" />
        <Palm x={48} height={250} lean={22} />
        <Palm x={120} height={190} lean={-14} />
      </svg>
      <svg className="absolute bottom-[12vh] right-0 h-[30vh] w-auto -scale-x-100" viewBox="0 0 260 300" preserveAspectRatio="xMinYMax meet">
        <ellipse cx="70" cy="306" rx="140" ry="20" fill="#03060c" />
        <Palm x={56} height={235} lean={18} />
        <Palm x={138} height={170} lean={-20} />
      </svg>
    </div>
  )
}

/** Sign-in backdrop: night sky over a city, with a self-driving car on the road. */
export function NightScene() {
  const beamId = useId()
  const { far, near } = useMemo(() => ({ far: skyline(3, 90, 230, 0), near: skyline(8, 50, 150, 0.2) }), [])

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 overflow-hidden bg-[linear-gradient(180deg,#02040b_0%,#060d1f_50%,#0b1830_78%,#0a1426_100%)]"
    >
      <StarField seed={11} count={120} maxTop={60} />
      <ShootingStars
        streaks={[
          { top: '8%', left: '78%', delay: '1s', duration: '11s' },
          { top: '18%', left: '52%', delay: '6s', duration: '15s' },
          { top: '4%', left: '30%', delay: '10s', duration: '19s' },
        ]}
      />

      {/* City glow on the horizon */}
      <div className="absolute inset-x-0 bottom-0 h-[45vh] bg-[radial-gradient(ellipse_at_bottom,rgb(46_230_214/0.12),rgb(59_140_255/0.05)_45%,transparent_72%)]" />

      {/* Skyline: a hazy far row, then a darker near row with lit windows */}
      <svg className="absolute inset-x-0 bottom-16 h-[34vh] w-full" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMax slice">
        {far.map((b, i) => (
          <rect key={i} x={b.x} y={300 - b.h} width={b.w} height={b.h} fill="#0d1a30" opacity={0.85} />
        ))}
      </svg>
      <svg className="absolute inset-x-0 bottom-16 h-[24vh] w-full" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMax slice">
        {near.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={300 - b.h} width={b.w} height={b.h} fill="#070d19" />
            {b.windows.map((w, j) => (
              <rect
                key={j}
                x={w.x}
                y={w.y}
                width={5}
                height={7}
                rx={1}
                fill={w.color}
                opacity={0.55}
                className={w.twinkle ? 'motion-safe:animate-twinkle' : undefined}
                style={w.twinkle ? ({ animationDuration: '7s', animationDelay: `${w.delay}s`, '--dim': 0.1 } as CSSProperties) : undefined}
              />
            ))}
          </g>
        ))}
      </svg>

      {/* Road */}
      <div className="absolute inset-x-0 bottom-0 h-16 border-t border-white/5 bg-[#04070d]">
        <div className="absolute inset-x-0 top-[30px] h-[3px] bg-[repeating-linear-gradient(90deg,rgb(255_255_255/0.35)_0_30px,transparent_30px_72px)] motion-safe:animate-road" />
        {/* Other traffic in the far lane: taillights drifting past */}
        {[
          { delay: '0s', duration: '9s' },
          { delay: '-4s', duration: '12s' },
          { delay: '-7s', duration: '10s' },
        ].map((t, i) => (
          <div key={i} className="absolute left-[110%] top-2 flex gap-[18px] motion-safe:animate-drive-by" style={{ animationDelay: t.delay, animationDuration: t.duration }}>
            <span className="h-[3px] w-2 rounded-full bg-[#ff4d4d] shadow-[0_0_8px_#ff4d4d]" />
            <span className="h-[3px] w-2 rounded-full bg-[#ff4d4d] shadow-[0_0_8px_#ff4d4d]" />
          </div>
        ))}
      </div>

      {/* The car: a minimal white self-driving car with its roof sensor and headlights on */}
      <div className="absolute bottom-[14px] left-[6%] motion-safe:animate-bob sm:left-[10%]">
        <svg width="440" height="62" viewBox="0 0 440 62" className="block overflow-visible">
          <defs>
            <linearGradient id={beamId} x1="146" y1="0" x2="440" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#eafcff" stopOpacity="0.55" />
              <stop offset="0.5" stopColor="#7df3e8" stopOpacity="0.14" />
              <stop offset="1" stopColor="#7df3e8" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Headlight beam: starts at the lamp and spreads forward, angled slightly toward the road */}
          <polygon points="146,33 146,37 440,60 440,18" fill={`url(#${beamId})`} />
          <g style={{ filter: 'drop-shadow(0 6px 14px rgb(0 0 0 / 0.6))' }}>
          {/* Roof sensor dome */}
          <rect x="68" y="4" width="20" height="8" rx="4" fill="#dfe6ee" />
          <rect x="71" y="7" width="14" height="2.5" rx="1.2" fill="#2ee6d6" opacity="0.9" />
          {/* Body */}
          <path
            d="M8 40c0-8 6-11 16-12l16-11c4-3 10-4 18-4h34c8 0 14 2 20 8l10 7c10 1 18 4 20 9v6c0 3-2 4-5 4H12c-3 0-4-2-4-4Z"
            fill="#eef2f6"
          />
          {/* Windows */}
          <path d="M45 20l13-4h34c6 0 10 2 14 6l6 5H43Z" fill="#0b1220" />
          <rect x="76" y="16" width="2" height="11" fill="#eef2f6" />
          {/* Side sensor and accent stripe */}
          <circle cx="132" cy="34" r="2.4" fill="#2ee6d6" />
          <rect x="30" y="37" width="96" height="1.5" rx="0.75" fill="#2ee6d6" opacity="0.55" />
          {/* Lights */}
          <rect x="143" y="33" width="6" height="3.5" rx="1.5" fill="#ffffff" />
          <rect x="7" y="33" width="4" height="4" rx="1.5" fill="#ff4d4d" />
          {/* Wheels */}
          <circle cx="36" cy="49" r="9.5" fill="#06090f" stroke="#2b3340" strokeWidth="2" />
          <circle cx="36" cy="49" r="3.5" fill="#8b95a5" />
          <circle cx="120" cy="49" r="9.5" fill="#06090f" stroke="#2b3340" strokeWidth="2" />
          <circle cx="120" cy="49" r="3.5" fill="#8b95a5" />
          </g>
        </svg>
      </div>
    </div>
  )
}
