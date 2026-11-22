/**
 * Statics for FIG. 01 on The Unstable Prompt: five equal blocks stacked on a
 * table, each free to slide. A joint holds while the centre of mass of every
 * block above it sits over the block (or table) below; past that edge, the
 * load above tips about the corner. Pure functions only, so the build can
 * render the starting stack and the browser re-solves it live.
 *
 * Positions are block-centre offsets from the table edge, in block lengths (L).
 */
export const STACK = {
  edgeX: 330, // svg x of the table edge (the plumb line)
  tableLeft: 40,
  tableY: 292, // table top
  length: 200, // svg units per block length
  height: 38,
  min: -0.9, // keep every block inside the drawing
  max: 1.75,
  critical: 0.05, // L of spare that counts as "about to buckle"
} as const;

export const BLOCKS = [
  { week: 'W1', name: 'The prompt' },
  { week: 'W3', name: 'A rewrite' },
  { week: 'W5', name: 'Competing readings' },
  { week: 'W7', name: "The students' own" },
  { week: 'W14', name: 'The revised brief' },
] as const;

/** Leans further toward the top, like the sketch; the joint under W7 is tightest. */
export const STACK_START = [-0.42, -0.34, -0.24, 0.08, 0.26];

/** The furthest five blocks can reach past the edge: ½(1 + ½ + ⅓ + ¼ + ⅕). */
export const MAX_REACH = 0.5 * (1 + 1 / 2 + 1 / 3 + 1 / 4 + 1 / 5);

export interface Joint {
  /** Index of the lowest block this joint carries (0 = the table joint). */
  index: number;
  /** Centre of mass of the blocks above, in L. */
  com: number;
  /** Spare before the joint buckles, in L (negative = buckled). */
  spare: number;
  /** Which corner the load would tip over. */
  side: 1 | -1;
  /** Pivot corner in svg units. */
  pivot: { x: number; y: number };
  /** Where to draw the plumb: from the load's centre of mass down to the joint. */
  plumb: { x: number; y1: number; y2: number };
  /** Where the BUCKLE tag sits: clear of the blocks either side of the joint. */
  tag: { x: number; y: number; anchor: 'start' | 'end' };
  name: string;
}

export interface StackState {
  xs: number[];
  joints: Joint[];
  weakest: Joint;
  failed: Joint | null;
  reach: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const blockTop = (i: number) => STACK.tableY - (i + 1) * STACK.height;
export const blockLeft = (x: number) => STACK.edgeX + (x - 0.5) * STACK.length;

export function jointName(index: number): string {
  return index === 0 ? 'the table edge' : `the joint under ${BLOCKS[index].week}`;
}

export function analyse(xsRaw: readonly number[]): StackState {
  const S = STACK;
  const xs = xsRaw.map((x) => clamp(x, S.min, S.max));
  const n = xs.length;
  const joints: Joint[] = [];

  for (let j = 0; j < n; j += 1) {
    const above = xs.slice(j);
    const com = above.reduce((a, b) => a + b, 0) / above.length;
    const y2 = j === 0 ? S.tableY : blockTop(j - 1);
    // Centre of mass height of the blocks above: the middle of that sub-stack.
    const y1 = (blockTop(n - 1) + y2) / 2;
    let spare: number;
    let side: 1 | -1;
    let pivot: { x: number; y: number };
    if (j === 0) {
      // The table runs off to the left; only its right edge can be passed.
      spare = -com;
      side = 1;
      pivot = { x: S.edgeX, y: S.tableY };
    } else {
      const support = xs[j - 1];
      side = com >= support ? 1 : -1;
      spare = 0.5 - Math.abs(com - support);
      pivot = { x: S.edgeX + (support + 0.5 * side) * S.length, y: y2 };
    }
    // The tag goes past the outer ends of the two blocks that meet here.
    const near = xs.slice(Math.max(0, j - 1), j + 1);
    const tagX =
      side > 0
        ? Math.max(pivot.x + 22, ...near.map((x) => S.edgeX + (x + 0.5) * S.length + 12))
        : Math.min(pivot.x - 22, ...near.map((x) => S.edgeX + (x - 0.5) * S.length - 12));
    joints.push({
      index: j,
      com,
      spare,
      side,
      pivot,
      plumb: { x: S.edgeX + com * S.length, y1, y2 },
      tag: { x: tagX, y: y2 + 4, anchor: side > 0 ? 'start' : 'end' },
      name: jointName(j),
    });
  }

  const weakest = joints.reduce((w, jt) => (jt.spare < w.spare ? jt : w), joints[0]);
  // The lowest buckled joint takes everything above it down.
  const failed = joints.find((jt) => jt.spare < 0) ?? null;
  const reach = Math.max(...xs.map((x) => x + 0.5));

  return { xs, joints, weakest, failed, reach };
}

const fmtL = (v: number) => `${v < -0.005 ? '−' : ''}${Math.abs(v).toFixed(2)} L`;

export interface StackReadout {
  reach: string;
  weakest: string;
  spare: string;
  revisions: string;
  note: string;
  aria: string;
}

export function readout(s: StackState, revisions: number, lastFailure: string | null): StackReadout {
  const w = s.weakest;
  let note: string;
  if (lastFailure) {
    note = `${capital(lastFailure)} buckled. The cohort rebuilt the stack from the last version that stood. That counts as revision ${revisions}.`;
  } else if (s.reach >= MAX_REACH - 0.05) {
    note = `That is about as far as five blocks can reach: half of 1 + ½ + ⅓ + ¼ + ⅕, or ${MAX_REACH.toFixed(2)} block lengths.`;
  } else if (s.reach > 1) {
    note =
      'The revised brief now sits entirely past the table edge, and the stack still stands. Each joint only has to carry the weight above it.';
  } else if (w.spare < STACK.critical) {
    note = `The weight above ${w.name} is almost past the edge below it. One more answer and it buckles.`;
  } else {
    note =
      'A joint holds while the weight above it stays over the block below. Drag a block to load an assumption; the blocks above ride along.';
  }
  return {
    reach: fmtL(s.reach),
    weakest: w.index === 0 ? 'Table edge' : `Under ${BLOCKS[w.index].week}`,
    spare: fmtL(Math.max(0, w.spare)),
    revisions: String(revisions),
    note,
    aria: `Reach past the table edge ${s.reach.toFixed(2)} block lengths. Weakest joint: ${w.name}, ${Math.max(0, w.spare).toFixed(2)} block lengths to spare.`,
  };
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
