import { useRef } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { SCENE, type Vec3 } from '../../../data/scene';
import { BarPool, clamp01, easeOut, getMaterials, hide, placeBar, type Act, type BuildSpec } from './kit';

/**
 * 02 — The Unstable Prompt, as a frame the cohort builds. It starts as one
 * bare storey: the prompt. Every question raised puts another storey on top,
 * unbraced, so the frame gets taller and weaker. A challenge pushes on the
 * top; the lowest unbraced storey racks and its columns bow, and then the
 * cohort braces it where it failed. Learning here is the frame getting
 * stronger exactly where it was challenged.
 */
export const FRAME = {
  w: 0.7, // half the plan width
  h: 0.72, // storey height
  base: 0.08,
  col: 0.085,
  beam: 0.07,
  brace: 0.03,
  max: 6,
  growMs: 750,
  buckleMs: 1500,
  heldMs: 1100,
  freshMs: 1800,
} as const;

const PAST = -1e9;
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

interface Storey {
  born: number;
  bracedAt: number | null;
}

export interface FrameState {
  storeys: Storey[];
  questions: number;
  challenges: number;
  repairs: number;
  sway: { at: number; storey: number | null } | null;
  settle: { at: number; storey: number | null } | null;
  last: 'start' | 'question' | 'full' | 'buckling' | 'repaired' | 'held';
  focus: number;
}

const release: Act<FrameState> = (s, now) => {
  const k = s.sway?.storey ?? null;
  return {
    state: {
      ...s,
      storeys: k == null ? s.storeys : s.storeys.map((st, i) => (i === k ? { ...st, bracedAt: now } : st)),
      sway: null,
      settle: { at: now, storey: k },
      repairs: s.repairs + (k == null ? 0 : 1),
      last: k == null ? 'held' : 'repaired',
    },
  };
};

export const frameSpec: BuildSpec<FrameState> = {
  init: () => ({
    storeys: [{ born: PAST, bracedAt: null }],
    questions: 0,
    challenges: 0,
    repairs: 0,
    sway: null,
    settle: null,
    last: 'start',
    focus: 0,
  }),
  demo: () => ({
    ...frameSpec.init(0),
    storeys: [0, 1, 2, 3, 4].map((i) => ({ born: PAST, bracedAt: i < 3 ? PAST : null })),
  }),
  question: (s, now) => {
    if (s.sway) return null;
    if (s.storeys.length >= FRAME.max) return { state: { ...s, last: 'full' } };
    return {
      state: {
        ...s,
        storeys: [...s.storeys, { born: now, bracedAt: null }],
        questions: s.questions + 1,
        last: 'question',
        focus: s.storeys.length,
      },
    };
  },
  challenge: (s, now) => {
    if (s.sway) return null;
    // The lowest unbraced storey carries the most weight above it: it goes first.
    const k = s.storeys.findIndex((st) => st.bracedAt == null);
    const storey = k < 0 ? null : k;
    return {
      state: {
        ...s,
        challenges: s.challenges + 1,
        sway: { at: now, storey },
        settle: null,
        last: storey == null ? 'held' : 'buckling',
        focus: k,
      },
      then: { ms: storey == null ? FRAME.heldMs : FRAME.buckleMs, act: release },
    };
  },
  view: (s) => {
    const n = s.storeys.length;
    const braced = s.storeys.filter((st) => st.bracedAt != null).length;
    const busy = Boolean(s.sway);
    const ord = ORD[s.focus] ?? 'top';
    let note: string;
    switch (s.last) {
      case 'question':
        note =
          n === 2
            ? 'A first reading goes up on top of the prompt, unbraced. The frame is taller now, more ambitious, and weaker.'
            : `A ${ORD[n - 1]} storey goes up. Every question makes the frame taller; none of them makes it stronger.`;
        break;
      case 'full':
        note = 'Six storeys: a term of questions. Now challenge it until every storey is braced.';
        break;
      case 'buckling':
        note = `The challenge finds the ${ord} storey. It racks sideways and its columns bow.`;
        break;
      case 'repaired':
        note =
          braced < n
            ? `The cohort braces the ${ord} storey where it failed, and it is stronger now than before it buckled. Challenge it again.`
            : `The cohort braces the ${ord} storey where it failed. Every storey has now been tested and braced.`;
        break;
      case 'held':
        note = 'Every storey is braced. The challenge runs down the braces into the ground, and the frame holds.';
        break;
      default:
        note =
          'The prompt: one bare storey, braced by nothing. Raise a question to build on it, or challenge it and see where it gives.';
    }
    return {
      question: { label: 'Raise a question', inert: busy || n >= FRAME.max },
      challenge: { label: 'Pose a challenge', inert: busy },
      note,
      stats: [
        ['Storeys', String(n)],
        ['Questions', String(s.questions)],
        ['Challenges', String(s.challenges)],
        ['Braced', `${braced} of ${n}`],
      ],
    };
  },
  framing: (s) => {
    const top = FRAME.base + s.storeys.length * FRAME.h;
    return {
      center: [0, top / 2 + 0.05, 0],
      verticalExtent: top / 2 + 0.3,
      horizontalExtent: 1.6,
      fitRatio: 0.8,
    };
  },
};

/* ------------------------------------------------------------------ */

const CORNERS: Array<[number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
const PER = 20; // 8 column halves, 4 beams, 8 braces
const SQRT1_2 = Math.SQRT1_2;

export function FrameModel({ state }: { state: FrameState }) {
  const { plaster, ink, accent } = getMaterials();
  const ref = useRef(state);
  ref.current = state;
  const pool = useRef<Array<THREE.Mesh | null>>([]);
  const shaft = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Mesh>(null);
  const X = useRef<number[]>(new Array(FRAME.max + 1).fill(0));

  useFrame(() => {
    const s = ref.current;
    const t = performance.now();
    const n = s.storeys.length;
    const { w, h, base } = FRAME;

    // How hard the frame is being pushed, and which storey is giving way.
    let amp = 0;
    let crit: number | null = null;
    let fresh = false;
    if (s.sway) {
      const e = t - s.sway.at;
      amp = easeOut(e / 450) * (1 + 0.05 * Math.sin(e / 70));
      crit = s.sway.storey;
    } else if (s.settle) {
      const e = t - s.settle.at;
      amp = e > 1600 ? 0 : Math.exp(-e / 260) * Math.cos(e / 110);
      crit = s.settle.storey;
      fresh = e < 500;
    }
    const pushing = Boolean(s.sway);

    const xs = X.current;
    xs[0] = 0;
    for (let i = 0; i < n; i += 1) {
      const braced = s.storeys[i].bracedAt != null;
      const factor = crit === i ? 1 : braced ? 0.04 : 0.3;
      xs[i + 1] = xs[i] + 0.2 * amp * factor;
    }
    const bow = crit != null ? 0.09 * amp : 0;

    const corner = (level: number, c: number): Vec3 => [
      CORNERS[c][0] * w + xs[level],
      base + level * h,
      CORNERS[c][1] * w,
    ];

    const bars = pool.current;
    for (let i = 0; i < n; i += 1) {
      const st = s.storeys[i];
      const p = clamp01((t - st.born) / FRAME.growMs);
      const colGrow = clamp01(p / 0.6);
      const beamGrow = clamp01((p - 0.55) / 0.45);
      const at = i * PER;
      const failing = crit === i && (pushing || fresh);

      for (let c = 0; c < 4; c += 1) {
        const lo = corner(i, c);
        const hi = corner(i + 1, c);
        const a = bars[at + c * 2];
        const b = bars[at + c * 2 + 1];
        const mat = failing ? accent : plaster;
        if (a) a.material = mat;
        if (b) b.material = mat;
        if (colGrow < 1) {
          placeBar(a, lo, hi, FRAME.col, colGrow);
          if (b) b.visible = false;
        } else {
          const k = crit === i ? bow : 0;
          const mid: Vec3 = [
            (lo[0] + hi[0]) / 2 + CORNERS[c][0] * SQRT1_2 * k,
            (lo[1] + hi[1]) / 2,
            (lo[2] + hi[2]) / 2 + CORNERS[c][1] * SQRT1_2 * k,
          ];
          placeBar(a, lo, mid, FRAME.col);
          placeBar(b, mid, hi, FRAME.col);
        }
        const beam = bars[at + 8 + c];
        if (beam) beam.material = plaster;
        placeBar(beam, corner(i + 1, c), corner(i + 1, (c + 1) % 4), FRAME.beam, beamGrow);
      }

      // Cross-braces on all four faces, once the cohort has put them in.
      for (let f = 0; f < 4; f += 1) {
        const d1 = bars[at + 12 + f * 2];
        const d2 = bars[at + 13 + f * 2];
        if (st.bracedAt == null) {
          if (d1) d1.visible = false;
          if (d2) d2.visible = false;
          continue;
        }
        const g = clamp01((t - st.bracedAt) / 500);
        const nx = (CORNERS[f][0] + CORNERS[(f + 1) % 4][0]) / 2;
        const nz = (CORNERS[f][1] + CORNERS[(f + 1) % 4][1]) / 2;
        const off = (v: Vec3): Vec3 => [v[0] + nx * 0.03, v[1], v[2] + nz * 0.03];
        const mat = (pushing && crit == null) || t - st.bracedAt < FRAME.freshMs ? accent : ink;
        if (d1) d1.material = mat;
        if (d2) d2.material = mat;
        placeBar(d1, off(corner(i, f)), off(corner(i + 1, (f + 1) % 4)), FRAME.brace, g);
        placeBar(d2, off(corner(i, (f + 1) % 4)), off(corner(i + 1, f)), FRAME.brace, g);
      }
    }
    hide(bars, n * PER);

    // The challenge: a push at the top, drawn as an arrow.
    const showArrow = pushing || (s.settle != null && t - s.settle.at < 500);
    const sh = shaft.current;
    const hd = head.current;
    if (sh && hd) {
      if (!showArrow) {
        sh.visible = false;
        hd.visible = false;
      } else {
        const y = base + n * h - 0.12;
        const tip = -w + xs[n] - 0.1;
        const k = pushing ? easeOut((t - s.sway!.at) / 300) : 1 - clamp01((t - s.settle!.at) / 500);
        placeBar(sh, [tip - 0.85, y, 0], [tip - 0.2, y, 0], 0.05, k);
        hd.visible = k > 0.98;
        hd.position.set(tip - 0.1, y, 0);
      }
    }
  });

  return (
    <group>
      <mesh material={plaster} position={[0, FRAME.base / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.1, FRAME.base, 2.1]} />
        <Edges threshold={20} color={SCENE.palette.ink} />
      </mesh>
      <BarPool count={FRAME.max * PER} pool={pool} />
      <mesh ref={shaft} material={accent} visible={false} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <mesh ref={head} material={accent} rotation-z={-Math.PI / 2} visible={false}>
        <coneGeometry args={[0.1, 0.24, 20]} />
      </mesh>
    </group>
  );
}
