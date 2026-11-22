import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { SCENE, type Vec3 } from '../../../data/scene';
import { BarPool, clamp01, easeOut, getMaterials, hide, placeBar, type Act, type BuildSpec } from './kit';

/**
 * 03 — Scaffolding Silence, as a scaffold around an empty centre. A question
 * starts a silence, and the next lift goes up only while nobody fills it:
 * standards, then ledgers, then boards. Hold the silence to the end and the
 * lift is tied in, and an idea rises through the empty middle. Fill it and
 * the half-built lift stands untied; a challenge then shakes it loose. Only
 * what was built in silence carries anything.
 */
export const SCAF = {
  s: 0.8, // grid spacing
  h: 0.75, // lift height
  base: 0.06,
  tube: 0.04,
  max: 5,
  silenceMs: 4500,
  ideaMs: 1000,
  swayMs: 1500,
  fallDelay: 650,
  fallMs: 1200,
  ring: 1.45,
} as const;

/* The order a lift goes up in: eight standards, eight ledgers, four boards. */
const RIM: Array<[number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];
type Part = { kind: 'standard' | 'ledger' | 'board'; i: number };
const PARTS: Part[] = [
  ...RIM.map((_, i) => ({ kind: 'standard' as const, i })),
  ...RIM.map((_, i) => ({ kind: 'ledger' as const, i })),
  ...[0, 1, 2, 3].map((i) => ({ kind: 'board' as const, i })),
];
const N = PARTS.length;

interface Lift {
  placed: number;
  tied: boolean;
}

export interface ScaffoldState {
  lifts: Lift[];
  ideas: number;
  ideaAt: number;
  silence: { lift: number; at: number; from: number } | null;
  falling: { lift: number; count: number; at: number } | null;
  sway: { at: number } | null;
  questions: number;
  held: number;
  filled: number;
  challenges: number;
  last: 'start' | 'silence' | 'held' | 'filled' | 'stood' | 'shed' | 'full';
}

const PAST = -1e9;

const complete =
  (at: number): Act<ScaffoldState> =>
  (s, now) => {
    if (s.silence?.at !== at) return null; // that silence was already filled
    const lifts = s.lifts.map((l, i) => (i === s.silence!.lift ? { placed: N, tied: true } : l));
    return {
      state: { ...s, lifts, silence: null, ideas: s.ideas + 1, ideaAt: now, held: s.held + 1, last: 'held' },
    };
  };

const settle: Act<ScaffoldState> = (s) => ({ state: { ...s, sway: null, falling: null } });

export const scaffoldSpec: BuildSpec<ScaffoldState> = {
  init: () => ({
    lifts: [{ placed: N, tied: true }],
    ideas: 0,
    ideaAt: PAST,
    silence: null,
    falling: null,
    sway: null,
    questions: 0,
    held: 0,
    filled: 0,
    challenges: 0,
    last: 'start',
  }),
  demo: () => ({
    ...scaffoldSpec.init(0),
    lifts: [
      { placed: N, tied: true },
      { placed: N, tied: true },
      { placed: N, tied: true },
      { placed: N, tied: true },
      { placed: 11, tied: false },
    ],
    ideas: 3,
  }),
  question: (s, now) => {
    if (s.silence || s.sway) return null;
    let lifts = s.lifts;
    let target = lifts.findIndex((l) => l.placed < N);
    if (target < 0) {
      if (lifts.length >= SCAF.max) return { state: { ...s, last: 'full' } };
      lifts = [...lifts, { placed: 0, tied: false }];
      target = lifts.length - 1;
    }
    return {
      state: {
        ...s,
        lifts,
        silence: { lift: target, at: now, from: lifts[target].placed },
        questions: s.questions + 1,
        last: 'silence',
      },
      then: { ms: SCAF.silenceMs, act: complete(now) },
    };
  },
  challenge: (s, now) => {
    // During a silence this button fills it.
    if (s.silence) {
      const { lift, at, from } = s.silence;
      const placed = Math.min(N - 1, from + Math.floor(clamp01((now - at) / SCAF.silenceMs) * (N - from)));
      return {
        state: {
          ...s,
          lifts: s.lifts.map((l, i) => (i === lift ? { placed, tied: false } : l)),
          silence: null,
          filled: s.filled + 1,
          last: 'filled',
        },
      };
    }
    if (s.sway) return null;
    const loose = s.lifts.findIndex((l) => !l.tied && l.placed > 0);
    return {
      state: {
        ...s,
        challenges: s.challenges + 1,
        sway: { at: now },
        falling: loose >= 0 ? { lift: loose, count: s.lifts[loose].placed, at: now + SCAF.fallDelay } : null,
        lifts: loose >= 0 ? s.lifts.map((l, i) => (i === loose ? { placed: 0, tied: false } : l)) : s.lifts,
        last: loose >= 0 ? 'shed' : 'stood',
      },
      then: { ms: SCAF.swayMs + (loose >= 0 ? SCAF.fallMs : 0), act: settle },
    };
  },
  view: (s) => {
    const tied = s.lifts.filter((l) => l.tied).length;
    let note: string;
    switch (s.last) {
      case 'silence':
        note = 'The question hangs in the room. While nobody fills the silence, the next lift goes up around it.';
        break;
      case 'held':
        note =
          s.ideas === 1
            ? 'The silence held. The lift is tied in, and an idea rises through the empty centre, whole.'
            : 'Another silence held, another lift tied in. The idea in the middle climbs with it.';
        break;
      case 'filled':
        note = 'Someone filled the silence. What went up in the hurry is standing, but nothing ties it in.';
        break;
      case 'stood':
        note = 'The challenge leans on everything that was built in silence, and all of it holds.';
        break;
      case 'shed':
        note = 'The challenge shakes loose what was rushed. Only what was built in silence is still standing.';
        break;
      case 'full':
        note = 'Five lifts, and an idea through the middle of them. The room keeps its own time now.';
        break;
      default:
        note = 'One lift stands around an empty centre. Raise a question, then let the silence do the building.';
    }
    return {
      question: {
        label: s.silence ? 'Holding the silence…' : 'Raise a question',
        inert: Boolean(s.silence || s.sway),
      },
      challenge: {
        label: s.silence ? 'Fill the silence' : 'Pose a challenge',
        inert: Boolean(s.sway),
      },
      note,
      stats: [
        ['Lifts tied', String(tied)],
        ['Silences held', String(s.held)],
        ['Filled', String(s.filled)],
        ['Challenges', String(s.challenges)],
      ],
    };
  },
  framing: (s) => {
    const levels = Math.max(1, s.lifts.length);
    const top = SCAF.base + levels * SCAF.h;
    return {
      center: [0, top / 2 + 0.05, 0],
      verticalExtent: top / 2 + 0.3,
      horizontalExtent: 1.65,
      fitRatio: 0.8,
    };
  },
};

/* ------------------------------------------------------------------ */

/** Small fixed jitter per part, so untied pieces sit visibly askew. */
const jitter = (lift: number, part: number, k: number) => {
  const v = Math.sin((lift * 31 + part * 17 + k * 7) * 12.9898) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
};

function partEnds(part: Part, y0: number, xs: (y: number) => number): { a: Vec3; b: Vec3; thick: number; depth: number } {
  const { s, h, tube } = SCAF;
  const y1 = y0 + h;
  if (part.kind === 'standard') {
    const [gx, gz] = RIM[part.i];
    return { a: [gx * s + xs(y0), y0, gz * s], b: [gx * s + xs(y1), y1, gz * s], thick: tube, depth: tube };
  }
  if (part.kind === 'ledger') {
    const [ax, az] = RIM[part.i];
    const [bx, bz] = RIM[(part.i + 1) % RIM.length];
    const y = y1 - 0.03;
    return { a: [ax * s + xs(y), y, az * s], b: [bx * s + xs(y), y, bz * s], thick: tube, depth: tube };
  }
  // Boards: a walkway on each side of the lift, leaving the centre open.
  const y = y1 + 0.005;
  const inset = s - 0.24;
  const len = s + 0.08;
  const x = xs(y);
  switch (part.i) {
    case 0:
      return { a: [-len + x, y, -inset], b: [len + x, y, -inset], thick: 0.035, depth: 0.4 };
    case 1:
      return { a: [inset + x, y, -len], b: [inset + x, y, len], thick: 0.4, depth: 0.035 };
    case 2:
      return { a: [len + x, y, inset], b: [-len + x, y, inset], thick: 0.035, depth: 0.4 };
    default:
      return { a: [-inset + x, y, len], b: [-inset + x, y, -len], thick: 0.4, depth: 0.035 };
  }
}

const RING_SEGMENTS = 72;

export function ScaffoldModel({ state }: { state: ScaffoldState }) {
  const { plaster, ink, accent, falling, fallingLight } = getMaterials();
  const ref = useRef(state);
  ref.current = state;
  const pool = useRef<Array<THREE.Mesh | null>>([]);
  const idea = useRef<THREE.Mesh>(null);

  // The silence, drawn as an arc on the floor that closes as it holds.
  const arc = useRef<Array<THREE.Mesh | null>>([]);
  const arcPoints = useMemo(
    () =>
      Array.from({ length: RING_SEGMENTS + 1 }, (_, i): Vec3 => {
        const a = (i / RING_SEGMENTS) * Math.PI * 2 - Math.PI / 2;
        return [Math.cos(a) * SCAF.ring, 0.02, Math.sin(a) * SCAF.ring];
      }),
    [],
  );

  useFrame(() => {
    const s = ref.current;
    const t = performance.now();
    const { base, h } = SCAF;

    // A challenge rocks the tower: hardly at all where it was tied in.
    let rock = 0;
    if (s.sway) {
      const e = t - s.sway.at;
      rock = Math.sin(e / 85) * Math.exp(-e / 700) * easeOut(e / 150);
    }
    const tiedTop = base + s.lifts.filter((l) => l.tied).length * h;
    const xs = (y: number) => rock * (0.012 * (y / Math.max(h, tiedTop)) + (y > tiedTop + 1e-3 ? 0.08 * ((y - tiedTop) / h) : 0));

    const bars = pool.current;
    s.lifts.forEach((lift, L) => {
      const y0 = base + L * h;
      let shown = lift.placed;
      let growing = -1;
      let grow = 1;
      if (s.silence && s.silence.lift === L) {
        const exact = s.silence.from + clamp01((t - s.silence.at) / SCAF.silenceMs) * (N - s.silence.from);
        shown = Math.min(N, Math.floor(exact) + 1);
        growing = Math.floor(exact);
        grow = exact - Math.floor(exact);
      }
      const loose = !lift.tied && !(s.silence && s.silence.lift === L);
      const fall = s.falling && s.falling.lift === L ? s.falling : null;
      const count = fall ? fall.count : shown;

      for (let k = 0; k < N; k += 1) {
        const mesh = bars[L * N + k];
        if (!mesh) continue;
        if (k >= count) {
          mesh.visible = false;
          continue;
        }
        const part = PARTS[k];
        const { a, b, thick, depth } = partEnds(part, y0, xs);
        if (loose || fall) {
          // Untied: nothing holds it square.
          b[0] += 0.035 * jitter(L, k, 1);
          b[2] += 0.035 * jitter(L, k, 2);
          b[1] -= part.kind === 'standard' ? 0 : 0.03 * Math.abs(jitter(L, k, 3));
        }
        let mat: THREE.Material = part.kind === 'board' ? plaster : ink;
        if (fall) {
          const e = (t - fall.at) / 1000;
          if (e < 0) {
            const shake = 0.025 * Math.sin(t / 35 + k);
            a[0] += shake;
            b[0] += shake;
          } else {
            const out = 0.6 * e;
            const drop = 3.2 * e * e;
            const dx = Math.sign(a[0] || jitter(L, k, 4)) * out;
            const dz = Math.sign(a[2] || jitter(L, k, 5)) * out;
            a[0] += dx;
            a[1] -= drop;
            a[2] += dz;
            b[0] += dx + 0.4 * e * jitter(L, k, 6);
            b[1] -= drop + 0.25 * e;
            b[2] += dz + 0.4 * e * jitter(L, k, 7);
            mat = part.kind === 'board' ? fallingLight : falling;
          }
        }
        mesh.material = mat;
        placeBar(mesh, a, b, thick, k === growing ? easeOut(grow) : 1, depth);
        if (a[1] < 0.02 && b[1] < 0.02 && fall) mesh.visible = false;
      }
    });
    hide(bars, s.lifts.length * N);

    if (s.falling) {
      const e = (t - s.falling.at) / SCAF.fallMs;
      const o = e < 0 ? 1 : 1 - clamp01(e);
      falling.opacity = o;
      fallingLight.opacity = o;
    }

    // The idea: rises through the empty centre, one lift per held silence.
    const ideaGrow = easeOut((t - s.ideaAt) / SCAF.ideaMs);
    const height = (s.ideas - 1 + ideaGrow) * h;
    placeBar(idea.current, [xs(base), base, 0], [xs(base + height), base + height, 0], 0.08, height > 0.01 ? 1 : 0);

    // The silence arc closes as the silence holds.
    const p = s.silence ? clamp01((t - s.silence.at) / SCAF.silenceMs) : 0;
    const lit = s.silence ? Math.floor(p * RING_SEGMENTS) : 0;
    arc.current.forEach((m, i) => {
      if (!m) return;
      if (i >= lit) {
        m.visible = false;
        return;
      }
      m.material = accent;
      placeBar(m, arcPoints[i], arcPoints[i + 1], 0.035, 1.04);
    });
  });

  return (
    <group>
      <mesh material={plaster} position={[0, SCAF.base / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.1, SCAF.base, 2.1]} />
        <Edges threshold={20} color={SCENE.palette.ink} />
      </mesh>
      <BarPool count={SCAF.max * N} pool={pool} />
      <mesh ref={idea} material={accent} castShadow visible={false} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <BarPool count={RING_SEGMENTS} pool={arc} shadows={false} />
    </group>
  );
}
