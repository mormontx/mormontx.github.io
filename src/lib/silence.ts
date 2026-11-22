/**
 * FIG. 01 on Scaffolding Silence: a score of the term above, the interval
 * itself below. Strike the bell and a timed silence begins; while it holds, a
 * quiet student's idea assembles bay by bay. Fill the silence and it falls.
 * Hold it and the idea arrives whole, and the room needs a little less time
 * the next round. Shared by the build (first paint) and the browser.
 *
 * Times are room seconds. The clock runs at SILENCE.speed room seconds per
 * real second so a three-minute interval takes ten.
 */
export const SILENCE = {
  speed: 18,
  firstNeed: 180,
  minNeed: 75,
  learn: 25, // each held round, the room needs this much less
  score: { left: 40, right: 760, base: 100, span: 1500 },
  wave: { left: 240, right: 600, y: 262, amp: 30, cycle: 12, decay: 2.6 },
  bell: { x: 190, y: 262 },
  tower: { x: 652, base: 306, width: 56, bay: 24, bays: 6 },
} as const;

export type ScoreEvent =
  | { kind: 'voice'; dur: number; h: number }
  | { kind: 'teacher'; dur: number }
  | { kind: 'idea'; dur: number }
  | { kind: 'silence'; dur: number; held: boolean };

/** Before the rule: fast voices back to back, and nothing between them. */
export const SCORE_START: ScoreEvent[] = [32, 44, 26, 48, 30, 40, 24, 46, 34, 38].map((h) => ({
  kind: 'voice',
  dur: 20,
  h,
}));

/** Deterministic tick heights for fast voices added later. */
export const voiceHeight = (n: number) => 26 + ((n * 37) % 23);

export const clock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The score as svg markup: ticks above the line, timed gaps bracketed below. */
export function scoreMarkup(events: readonly ScoreEvent[]): string {
  const { left, right, base, span } = SILENCE.score;
  const total = Math.max(
    span,
    events.reduce((t, e) => t + e.dur, 0),
  );
  const k = (right - left) / total;
  let t = 0;
  const out: string[] = [];
  for (const e of events) {
    const x = left + t * k;
    if (e.kind === 'voice') {
      out.push(`<line x1="${x.toFixed(1)}" y1="${base}" x2="${x.toFixed(1)}" y2="${base - e.h}" class="sil-voice"/>`);
    } else if (e.kind === 'teacher') {
      out.push(`<line x1="${x.toFixed(1)}" y1="${base}" x2="${x.toFixed(1)}" y2="${base - 36}" class="sil-teacher"/>`);
    } else if (e.kind === 'idea') {
      out.push(
        `<line x1="${x.toFixed(1)}" y1="${base}" x2="${x.toFixed(1)}" y2="${base - 62}" class="sil-idea"/>`,
        `<rect x="${(x - 3).toFixed(1)}" y="${base - 66}" width="6" height="6" class="sil-idea-cap"/>`,
      );
    } else {
      const x2 = x + e.dur * k;
      const w = x2 - x;
      const cls = e.held ? 'sil-gap' : 'sil-gap is-filled';
      out.push(
        `<path d="M ${x.toFixed(1)} ${base + 18} L ${(x + Math.min(6, w / 3)).toFixed(1)} ${base + 9} L ${(x2 - Math.min(6, w / 3)).toFixed(1)} ${base + 9} L ${x2.toFixed(1)} ${base + 18}" class="${cls}"/>`,
        `<circle cx="${x.toFixed(1)}" cy="${base}" r="2.5" class="sil-bell"/>`,
      );
      if (e.held) out.push(`<circle cx="${x2.toFixed(1)}" cy="${base}" r="2.5" class="sil-bell"/>`);
      if (w >= 26) {
        out.push(
          `<text x="${((x + x2) / 2).toFixed(1)}" y="${base + 32}" text-anchor="middle" class="sil-gap-label${e.held ? '' : ' is-filled'}">${Math.round(e.dur)}</text>`,
        );
      }
    }
    t += e.dur;
  }
  return out.join('');
}

/** The bell's ring, drawn across the interval: a decaying sine, up to `p` of it. */
export function wavePoints(p: number): string {
  const { left, right, y, amp, cycle, decay } = SILENCE.wave;
  const w = right - left;
  const end = Math.max(0, Math.min(1, p)) * w;
  const pts: string[] = [];
  for (let x = 0; x <= end; x += 1.5) {
    const v = amp * Math.exp((-decay * x) / w) * Math.sin((2 * Math.PI * x) / cycle);
    pts.push(`${(left + x).toFixed(1)},${(y - v).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** The envelope the ring will follow, as two faint curves. */
export function envelopePath(): string {
  const { left, right, y, amp, decay } = SILENCE.wave;
  const w = right - left;
  const curve = (sign: number) => {
    const pts: string[] = [];
    for (let x = 0; x <= w; x += 6) {
      pts.push(`${pts.length ? 'L' : 'M'} ${(left + x).toFixed(1)} ${(y - sign * amp * Math.exp((-decay * x) / w)).toFixed(1)}`);
    }
    return pts.join(' ');
  };
  return `${curve(1)} ${curve(-1)}`;
}

/** One bay of the idea's scaffold: two posts, a ledger and a cross-brace. */
export function bayPath(i: number): string {
  const { x, base, width, bay } = SILENCE.tower;
  const y1 = base - i * bay;
  const y2 = y1 - bay;
  return [
    `M ${x} ${y1} L ${x} ${y2}`,
    `M ${x + width} ${y1} L ${x + width} ${y2}`,
    `M ${x} ${y2} L ${x + width} ${y2}`,
    i % 2 === 0 ? `M ${x} ${y1} L ${x + width} ${y2}` : `M ${x + width} ${y1} L ${x} ${y2}`,
  ].join(' ');
}

export type Phase = 'idle' | 'silence' | 'held' | 'filled' | 'narrated';

export interface SilenceNoteInput {
  phase: Phase;
  p: number; // fraction of the current interval
  held: number;
  need: number;
}

export function silenceNote({ phase, p, held, need }: SilenceNoteInput): string {
  switch (phase) {
    case 'silence':
      if (p < 0.2) return 'The room falls silent. Nobody speaks, including the teacher.';
      if (p < 0.5) return 'Someone checks the clock. Someone looks hard at the table.';
      if (p < 0.85) return 'A student who has barely spoken this term is writing something down.';
      return 'Hold it. The idea is nearly whole.';
    case 'held':
      if (need <= SILENCE.minNeed)
        return 'The interval has shrunk to what the room needs. Nobody looks at the clock any more.';
      if (held >= 3)
        return 'The room has learned the pause. The fast speakers stop filling it; the slow thinkers know it is theirs.';
      return 'The bell. She reads the paragraph she wrote in the gap, and it is finished, with its edges intact.';
    case 'filled':
      return 'Someone filled the silence, and the idea fell with it. Strike the bell and we begin again.';
    case 'narrated':
      return 'The teacher narrated the pause, and quietly went back to leading. The idea never arrived.';
    default:
      return 'After every contribution, the room falls silent and waits. Strike the bell to start the interval.';
  }
}
