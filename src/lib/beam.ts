/**
 * Statics for the About page's load-path figure: a beam on two supports, with
 * overhangs at both ends, carrying one point load. Pure functions only, so the
 * same numbers render at build time (no-JS) and update live in the browser.
 *
 * Drawing units: 100 svg units = 1 m. Forces in kN, moments in kN·m.
 * Sign convention: reactions positive upward; sagging moment positive.
 */
export const BEAM = {
  left: 80,
  right: 720,
  supportA: 200,
  supportB: 600,
  axisY: 128,
  unit: 100,
  load: 10,
  step: 4,
  loadTopY: 38,
  reactionTopY: 162,
  reactionScale: 3.4, // svg units per kN
  momentBaseY: 262,
  momentScale: 40 / 12, // svg units per kN·m (12 kN·m is the largest possible)
  maxDeflection: 24, // svg units at the worst load position
  nearSupport: 25, // svg units: "over a support"
} as const;

export const BEAM_START = 440; // 3.6 m from the left end: R1 4 kN, R2 6 kN

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Statics {
  xP: number;
  rA: number;
  rB: number;
  moment: (x: number) => number;
}

function statics(xPRaw: number): Statics {
  const { left, right, supportA: a, supportB: b, unit, load } = BEAM;
  const xP = clamp(xPRaw, left, right);
  // Moments about A: R_B · span = P · (xP − a)
  const rB = (load * (xP - a)) / (b - a);
  const rA = load - rB;
  // Bending moment at x from the forces to its left.
  const moment = (x: number) => {
    let m = 0;
    if (x > a) m += (rA * (x - a)) / unit;
    if (x > b) m += (rB * (x - b)) / unit;
    if (x > xP) m -= (load * (x - xP)) / unit;
    return m;
  };
  return { xP, rA, rB, moment };
}

/** Deflection (upward, arbitrary units) at each sample, zero at both supports. */
function rawDeflection(moment: (x: number) => number): number[] {
  const { left, right, supportA, supportB, step, unit } = BEAM;
  const h = step / unit;
  const n = Math.round((right - left) / step) + 1;
  const m = Array.from({ length: n }, (_, i) => moment(left + i * step));
  // EI·v'' = M, integrated twice from the left end, then a linear correction
  // so that v = 0 at both supports.
  const theta = [0];
  const v0 = [0];
  for (let i = 1; i < n; i += 1) {
    theta[i] = theta[i - 1] + ((m[i - 1] + m[i]) / 2) * h;
    v0[i] = v0[i - 1] + ((theta[i - 1] + theta[i]) / 2) * h;
  }
  const ia = Math.round((supportA - left) / step);
  const ib = Math.round((supportB - left) / step);
  const c2 = -(v0[ib] - v0[ia]) / ((ib - ia) * h);
  const c1 = -v0[ia] - c2 * ia * h;
  return v0.map((v, i) => v + c1 + c2 * i * h);
}

let deflectionScale: number | null = null;
/** One fixed scale for every load position, so the sag is comparable. */
function getDeflectionScale(): number {
  if (deflectionScale == null) {
    const worst = [BEAM.left, BEAM.right, (BEAM.supportA + BEAM.supportB) / 2]
      .flatMap((x) => rawDeflection(statics(x).moment))
      .reduce((acc, v) => Math.max(acc, Math.abs(v)), 0);
    deflectionScale = BEAM.maxDeflection / worst;
  }
  return deflectionScale;
}

const fmt = (n: number, digits = 1) => {
  const s = Math.abs(n).toFixed(digits);
  return n < -0.05 ? `−${s}` : s;
};

function arrow(x: number, fromY: number, toY: number): string {
  const dir = toY < fromY ? 1 : -1; // head points toward toY
  return `M ${x} ${fromY} L ${x} ${toY} M ${x - 4} ${toY + 7 * dir} L ${x} ${toY} L ${x + 4} ${toY + 7 * dir}`;
}

export interface BeamLayout {
  beamPoints: string;
  momentPath: string;
  load: { x: number; shaftEnd: number; head: string };
  reactions: Record<'a' | 'b', { path: string; label: string; uplift: boolean }>;
  failure: { x: number; beamY: number; momentY: number; labelX: number; labelY: number; anchor: 'start' | 'end' };
  readout: { position: string; ra: string; rb: string; peak: string; note: string };
  aria: { now: string; text: string };
}

/** Everything the figure needs for one load position, as svg attribute strings. */
export function layoutBeam(xPRaw: number): BeamLayout {
  const B = BEAM;
  const { xP, rA, rB, moment } = statics(xPRaw);
  const k = getDeflectionScale();
  const v = rawDeflection(moment);
  const yAt = (x: number) => {
    const t = (x - B.left) / B.step;
    const i = Math.min(v.length - 2, Math.max(0, Math.floor(t)));
    const f = t - i;
    return B.axisY - (v[i] * (1 - f) + v[i + 1] * f) * k;
  };

  const beamPoints = v
    .map((vi, i) => `${B.left + i * B.step},${(B.axisY - vi * k).toFixed(2)}`)
    .join(' ');

  // Moment diagram as a closed area; include the exact load point for a sharp apex.
  const xs: number[] = [];
  for (let x = B.left; x <= B.right; x += B.step) xs.push(x);
  if (!xs.includes(xP)) xs.push(xP);
  xs.sort((p, q) => p - q);
  const my = (x: number) => B.momentBaseY + moment(x) * B.momentScale;
  const momentPath = `M ${B.left} ${B.momentBaseY} ${xs
    .map((x) => `L ${x} ${my(x).toFixed(2)}`)
    .join(' ')} L ${B.right} ${B.momentBaseY} Z`;

  // Peak bending moment: under the load, or over a support when the load overhangs.
  const peakX = [xP, B.supportA, B.supportB].reduce((best, x) =>
    Math.abs(moment(x)) > Math.abs(moment(best)) ? x : best,
  );
  const peakM = moment(peakX);

  const tipY = yAt(xP);
  const reaction = (x: number, r: number, side: 'a' | 'b') => {
    const len = Math.abs(r) * B.reactionScale;
    const top = B.reactionTopY;
    const path = len < 1 ? '' : r > 0 ? arrow(x, top + len, top) : arrow(x, top, top + len);
    const name = side === 'a' ? 'R₁' : 'R₂';
    return {
      path,
      label: `${name} ${fmt(r)} kN${r < -0.05 ? ' · UPLIFT' : ''}`,
      uplift: r < -0.05,
    };
  };

  const anchor: 'start' | 'end' = peakX > 520 ? 'end' : 'start';
  const position = (xP - B.left) / B.unit;
  const support = (r: number) => (r < -0.05 ? `${fmt(r)} kN ↓` : `${fmt(r)} kN ↑`);

  let note: string;
  if (xP < B.supportA - B.nearSupport || xP > B.supportB + B.nearSupport) {
    note =
      'Past a support, the beam tips. The far support has to pull down to hold it, and the beam bends hardest over the near support.';
  } else if (
    Math.abs(xP - B.supportA) <= B.nearSupport ||
    Math.abs(xP - B.supportB) <= B.nearSupport
  ) {
    note = 'Over a support, the load goes almost straight to the ground, and the beam hardly bends.';
  } else {
    note =
      'Between the supports, both share the load and the nearer one takes more. The beam bends hardest right under the load.';
  }

  return {
    beamPoints,
    momentPath,
    load: {
      x: xP,
      shaftEnd: tipY - 3,
      head: `M -5 ${tipY - 12} L 0 ${tipY - 3} L 5 ${tipY - 12}`,
    },
    reactions: { a: reaction(B.supportA, rA, 'a'), b: reaction(B.supportB, rB, 'b') },
    failure: {
      x: peakX,
      beamY: yAt(peakX),
      momentY: my(peakX),
      labelX: peakX + (anchor === 'start' ? 10 : -10),
      labelY: my(peakX) + (peakM >= 0 ? 16 : -8),
      anchor,
    },
    readout: {
      position: `${position.toFixed(2)} m`,
      ra: support(rA),
      rb: support(rB),
      peak: `${fmt(Math.abs(peakM))} kN·m`,
      note,
    },
    aria: {
      now: position.toFixed(1),
      text: `Load ${position.toFixed(1)} metres from the left end. Left support ${fmt(rA)} kilonewtons, right support ${fmt(rB)} kilonewtons.`,
    },
  };
}
