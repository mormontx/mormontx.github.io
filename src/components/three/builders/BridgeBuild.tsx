import { useRef } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { SCENE, type Vec3 } from '../../../data/scene';
import { BarPool, clamp01, easeOut, getMaterials, hide, placeBar, type Act, type BuildSpec } from './kit';

/**
 * 04 — Marginalia as Dialogue, as a bridge across the margin. The teacher's
 * bank and the student's face each other over a gap. Each question builds a
 * segment out from the teacher's side, in pencil; each reply builds one back
 * from the student's, in a smaller hand. Under a challenge an open half-span
 * sags, because it is carrying the load alone; once the two meet, the span
 * carries it. After that, classmates put up the railings.
 */
export const BRIDGE = {
  half: 1.6, // half the gap
  seg: 0.4,
  segs: 4,
  deckY: 0.9,
  deckT: 0.08,
  deckW: 0.7,
  abutW: 0.8,
  abutD: 1.1,
  mastX: 1.85,
  mastH: 1.25,
  growMs: 650,
  replyMs: 1100,
  loadMs: 1900,
  rails: 2,
  posts: 9,
} as const;

export interface BridgeState {
  teacher: number[];
  student: number[];
  closedAt: number | null;
  rails: number[];
  load: { at: number } | null;
  unload: { at: number; closed: boolean; t: number; st: number } | null;
  pending: boolean;
  questions: number;
  replies: number;
  challenges: number;
  last: 'start' | 'question' | 'reply' | 'met' | 'rail' | 'full' | 'sag' | 'carried' | 'gap';
}

const PAST = -1e9;

const reply: Act<BridgeState> = (s, now) => {
  const student = [...s.student, now];
  const met = s.teacher.length >= BRIDGE.segs && student.length >= BRIDGE.segs;
  return {
    state: {
      ...s,
      student,
      replies: s.replies + 1,
      pending: false,
      closedAt: met ? now + BRIDGE.growMs : s.closedAt,
      last: met ? 'met' : 'reply',
    },
  };
};

const release: Act<BridgeState> = (s, now) => ({
  state: {
    ...s,
    load: null,
    unload: { at: now, closed: s.closedAt != null, t: s.teacher.length, st: s.student.length },
  },
});

export const bridgeSpec: BuildSpec<BridgeState> = {
  init: () => ({
    teacher: [],
    student: [],
    closedAt: null,
    rails: [],
    load: null,
    unload: null,
    pending: false,
    questions: 0,
    replies: 0,
    challenges: 0,
    last: 'start',
  }),
  demo: () => ({
    ...bridgeSpec.init(0),
    teacher: [PAST, PAST, PAST, PAST],
    student: [PAST, PAST, PAST, PAST],
    closedAt: PAST,
    rails: [PAST, PAST],
  }),
  question: (s, now) => {
    if (s.pending || s.load) return null;
    if (s.closedAt != null) {
      if (s.rails.length >= BRIDGE.rails) return { state: { ...s, last: 'full' } };
      return { state: { ...s, rails: [...s.rails, now], questions: s.questions + 1, last: 'rail' } };
    }
    return {
      state: { ...s, teacher: [...s.teacher, now], questions: s.questions + 1, pending: true, last: 'question' },
      then: { ms: BRIDGE.replyMs, act: reply },
    };
  },
  challenge: (s, now) => {
    if (s.pending || s.load) return null;
    return {
      state: {
        ...s,
        challenges: s.challenges + 1,
        load: { at: now },
        unload: null,
        last: s.closedAt != null ? 'carried' : s.teacher.length ? 'sag' : 'gap',
      },
      then: { ms: BRIDGE.loadMs, act: release },
    };
  },
  view: (s) => {
    const gap = Math.max(0, 2 * BRIDGE.half - (s.teacher.length + s.student.length) * BRIDGE.seg);
    let note: string;
    switch (s.last) {
      case 'question':
        note = 'A question goes out from the teacher’s bank, in pencil.';
        break;
      case 'reply':
        note =
          s.replies === 1
            ? 'An answer comes back from the other bank, in a smaller hand, as if replying to a letter.'
            : 'Another answer comes back. Each exchange closes the gap from both sides at once.';
        break;
      case 'met':
        note = 'The two hands meet in the middle. The margin is no longer a gap; it is a span.';
        break;
      case 'rail':
        note =
          s.rails.length === 1
            ? 'Classmates start writing in the margin too: a railing goes up along one side.'
            : 'And along the other. The margin now speaks in more than two voices.';
        break;
      case 'full':
        note = 'Every voice is in the margin now. Challenge it.';
        break;
      case 'sag':
        note = 'Under a challenge, each half-span sags. Each one is still carrying the load alone.';
        break;
      case 'carried':
        note = 'Met in the middle, the span carries what neither bank could carry alone.';
        break;
      case 'gap':
        note = 'A challenge with no question under it falls straight through the margin.';
        break;
      default:
        note = 'Two banks of a margin, with nothing between them. Raise a question and see what comes back.';
    }
    const busy = s.pending || Boolean(s.load);
    return {
      question: { label: 'Raise a question', inert: busy || (s.closedAt != null && s.rails.length >= BRIDGE.rails) },
      challenge: { label: 'Pose a challenge', inert: busy },
      note,
      stats: [
        ['Questions', String(s.questions)],
        ['Replies', String(s.replies)],
        ['Gap', `${gap.toFixed(1)} m`],
        ['Challenges', String(s.challenges)],
      ],
    };
  },
  framing: () => ({ center: [0, 0.95, 0], verticalExtent: 1.1, horizontalExtent: 2.7, fitRatio: 0.85 }),
};

/* ------------------------------------------------------------------ */

const STAYS = 2; // one each side of the deck
const SIDE = BRIDGE.segs * (1 + STAYS); // deck segments and their stays

export function BridgeModel({ state }: { state: BridgeState }) {
  const { plaster, ink, accent, tint } = getMaterials();
  const ref = useRef(state);
  ref.current = state;
  const pool = useRef<Array<THREE.Mesh | null>>([]);
  const railPool = useRef<Array<THREE.Mesh | null>>([]);
  const joint = useRef<THREE.Mesh>(null);
  const weights = useRef<Array<THREE.Mesh | null>>([]);

  useFrame(() => {
    const s = ref.current;
    const t = performance.now();
    const { half, seg, deckY, deckT, deckW, mastX, mastH } = BRIDGE;
    const closed = s.closedAt != null && t >= s.closedAt;
    const nT = s.teacher.length;
    const nS = s.student.length;

    // How hard the challenge is pressing, and in which configuration.
    let amp = 0;
    let shape = { closed, t: nT, st: nS };
    if (s.load) {
      amp = easeOut((t - s.load.at) / 500);
    } else if (s.unload) {
      const e = t - s.unload.at;
      amp = e > 1500 ? 0 : Math.exp(-e / 240) * Math.cos(e / 95);
      shape = { closed: s.unload.closed, t: s.unload.t, st: s.unload.st };
    }

    /** Deflection (down) at x along the gap. */
    const sag = (x: number) => {
      if (amp === 0) return 0;
      if (shape.closed) {
        const xi = (x + half) / (2 * half);
        return amp * 0.03 * (1 - Math.cos(2 * Math.PI * xi)) * 0.5;
      }
      const left = x < 0;
      const n = left ? shape.t : shape.st;
      if (n === 0) return 0;
      const L = n * seg;
      const r = Math.min(L, left ? x + half : half - x);
      const tip = amp * 0.035 * n * n;
      return (tip * (3 * L * r * r - r * r * r)) / (2 * L * L * L);
    };
    const deck = (x: number): Vec3 => [x, deckY - sag(x), 0];

    const bars = pool.current;
    const build = (side: 0 | 1, born: number[]) => {
      const sign = side === 0 ? 1 : -1; // teacher builds +x from the left bank
      const root = -sign * half;
      const mast: Vec3 = [-sign * mastX, deckY + mastH, 0];
      for (let i = 0; i < BRIDGE.segs; i += 1) {
        const at = side * SIDE + i * (1 + STAYS);
        const d = bars[at];
        const stayA = bars[at + 1];
        const stayB = bars[at + 2];
        if (i >= born.length) {
          if (d) d.visible = false;
          if (stayA) stayA.visible = false;
          if (stayB) stayB.visible = false;
          continue;
        }
        const p = clamp01((t - born[i]) / BRIDGE.growMs);
        const x0 = root + sign * i * seg;
        const x1 = root + sign * (i + 1) * seg;
        if (d) d.material = side === 0 ? plaster : tint;
        placeBar(d, deck(x0), deck(x1), deckT, easeOut(p), deckW);
        // Stays from the mast to the segment's far end, on both deck edges.
        const tipX = x0 + (x1 - x0) * easeOut(p);
        const tipY = deckY - sag(tipX) + deckT / 2;
        const sg = clamp01((p - 0.35) / 0.65);
        for (const [k, z] of [
          [stayA, deckW / 2 - 0.03],
          [stayB, -deckW / 2 + 0.03],
        ] as const) {
          if (!k) continue;
          k.material = side === 0 ? ink : accent;
          placeBar(k, mast, [tipX, tipY, z], side === 0 ? 0.018 : 0.014, sg);
          k.castShadow = false;
        }
      }
    };
    build(0, s.teacher);
    build(1, s.student);

    // Where the two hands meet: a joint across the deck.
    const j = joint.current;
    if (j) {
      if (s.closedAt == null || t < s.closedAt) {
        j.visible = false;
      } else {
        const g = easeOut((t - s.closedAt) / 400);
        const y = deckY - sag(0) + deckT / 2 + 0.01;
        placeBar(j, [0, y, -deckW / 2 - 0.02], [0, y, deckW / 2 + 0.02], 0.03, g, 0.04);
      }
    }

    // Railings: the classmates' voices, posts first and then the rail.
    const rails = railPool.current;
    for (let r = 0; r < BRIDGE.rails; r += 1) {
      const at = r * (BRIDGE.posts + 1);
      if (r >= s.rails.length) {
        for (let k = 0; k <= BRIDGE.posts; k += 1) {
          const m = rails[at + k];
          if (m) m.visible = false;
        }
        continue;
      }
      const e = t - s.rails[r];
      const z = (r === 0 ? 1 : -1) * (deckW / 2 - 0.04);
      for (let k = 0; k < BRIDGE.posts; k += 1) {
        const x = -half + (k * (2 * half)) / (BRIDGE.posts - 1);
        const y = deckY - sag(x) + deckT / 2;
        const m = rails[at + k];
        if (m) m.material = ink;
        placeBar(m, [x, y, z], [x, y + 0.3, z], 0.022, easeOut((e - k * 70) / 250));
      }
      const top = rails[at + BRIDGE.posts];
      if (top) top.material = ink;
      const y = (x: number) => deckY - sag(x) + deckT / 2 + 0.3;
      placeBar(top, [-half, y(-half), z], [half, y(half), z], 0.022, easeOut((e - 650) / 500));
    }

    // The challenge: weights set down where the bridge must carry them.
    const ws = weights.current;
    const showLoad = s.load || (s.unload && t - s.unload.at < 400);
    const places: Array<{ x: number; y: number }> = [];
    if (showLoad) {
      if (shape.closed) {
        places.push({ x: 0, y: deckY - sag(0) + deckT / 2 });
      } else {
        if (shape.t > 0) places.push({ x: -half + shape.t * seg - 0.15, y: 0 });
        if (shape.st > 0) places.push({ x: half - shape.st * seg + 0.15, y: 0 });
        for (const pl of places) pl.y = deckY - sag(pl.x) + deckT / 2;
        if (!places.length) places.push({ x: 0, y: 0 }); // nothing to stand on: the floor
      }
    }
    ws.forEach((m, i) => {
      if (!m) return;
      const pl = places[i];
      if (!pl) {
        m.visible = false;
        return;
      }
      const drop = s.load ? 1 - easeOut((t - s.load.at) / 420) : 0;
      const fade = s.unload ? 1 - clamp01((t - s.unload.at) / 400) : 1;
      m.visible = fade > 0.02;
      m.scale.setScalar(Math.max(0.001, fade));
      m.position.set(pl.x, pl.y + 0.13 * fade + drop * 1.1, 0);
    });

    hide(bars, 2 * SIDE);
  });

  const { half, deckY, abutW, abutD, mastX, mastH } = BRIDGE;
  return (
    <group>
      {/* The two banks: the teacher's (left) and the student's (right). */}
      {[-1, 1].map((sgn) => (
        <group key={sgn}>
          <mesh material={plaster} position={[sgn * (half + abutW / 2), deckY / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[abutW, deckY, abutD]} />
            <Edges threshold={20} color={SCENE.palette.ink} />
          </mesh>
          <mesh
            material={sgn < 0 ? ink : accent}
            position={[sgn * mastX, deckY + mastH / 2, 0]}
            castShadow
          >
            <boxGeometry args={[0.07, mastH, 0.07]} />
          </mesh>
        </group>
      ))}
      <BarPool count={2 * SIDE} pool={pool} />
      <BarPool count={BRIDGE.rails * (BRIDGE.posts + 1)} pool={railPool} />
      <mesh ref={joint} material={accent} visible={false} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      {[0, 1].map((i) => (
        <mesh
          key={i}
          ref={(node) => {
            weights.current[i] = node;
          }}
          material={ink}
          visible={false}
          castShadow
        >
          <boxGeometry args={[0.26, 0.26, 0.26]} />
        </mesh>
      ))}
    </group>
  );
}
