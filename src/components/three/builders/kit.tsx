import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { SCENE, type Vec3 } from '../../../data/scene';

/**
 * Shared kit for the three "built by questions" models: one unit box that
 * every member is scaled from, shared materials, a pool of member meshes the
 * models move imperatively each frame, and a small hook that runs a model's
 * actions (with their delayed follow-ups) from the viewer's buttons.
 */

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

interface Materials {
  plaster: THREE.MeshStandardMaterial;
  ink: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  /** The student's hand: plaster drawn toward the accent. */
  tint: THREE.MeshStandardMaterial;
  /** Pieces on their way down; opacity is driven per frame. */
  falling: THREE.MeshStandardMaterial;
  fallingLight: THREE.MeshStandardMaterial;
}

let materials: Materials | null = null;

export function getMaterials(): Materials {
  if (!materials) {
    const m = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });
    materials = {
      plaster: m(SCENE.palette.plaster),
      ink: m(SCENE.palette.ink, { roughness: 0.8 }),
      accent: m(SCENE.palette.accent, { roughness: 0.7 }),
      tint: m('#E7D3D6'),
      falling: m(SCENE.palette.ink, { transparent: true, opacity: 1, depthWrite: false }),
      fallingLight: m(SCENE.palette.plaster, { transparent: true, opacity: 1, depthWrite: false }),
    };
  }
  return materials;
}

const UP = new THREE.Vector3(0, 1, 0);
const dir = new THREE.Vector3();

/**
 * Lay a pooled box along the segment a → b, `thick` across, grown to `grow`
 * (0..1) of its length from a. Hides it when there is nothing to show.
 */
export function placeBar(
  mesh: THREE.Mesh | null | undefined,
  a: Vec3,
  b: Vec3,
  thick: number,
  grow = 1,
  depth = thick,
): void {
  if (!mesh) return;
  dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length();
  const g = Math.min(1, grow);
  if (len < 1e-5 || g <= 0.001) {
    mesh.visible = false;
    return;
  }
  dir.divideScalar(len);
  const l = len * g;
  mesh.visible = true;
  mesh.position.set(a[0] + (dir.x * l) / 2, a[1] + (dir.y * l) / 2, a[2] + (dir.z * l) / 2);
  mesh.quaternion.setFromUnitVectors(UP, dir);
  mesh.scale.set(thick, l, depth);
}

export function hide(meshes: Array<THREE.Mesh | null>, from = 0): void {
  for (let i = from; i < meshes.length; i += 1) {
    const m = meshes[i];
    if (m) m.visible = false;
  }
}

/** A fixed pool of member meshes, all hidden until a model places them. */
export function BarPool({
  count,
  pool,
  shadows = true,
}: {
  count: number;
  pool: React.RefObject<Array<THREE.Mesh | null>>;
  shadows?: boolean;
}) {
  const { plaster } = getMaterials();
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <mesh
          key={i}
          ref={(node) => {
            pool.current[i] = node;
          }}
          geometry={UNIT_BOX}
          material={plaster}
          castShadow={shadows}
          receiveShadow={shadows}
          visible={false}
          frustumCulled={false}
        />
      ))}
    </>
  );
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/* ------------------------------------------------------------------ */
/* Running a model's actions                                           */
/* ------------------------------------------------------------------ */

export interface Framing {
  center: Vec3;
  verticalExtent: number;
  horizontalExtent: number;
  /** How much of the view the structure may fill (0..1). */
  fitRatio?: number;
}

/** An action: the next state, and optionally a follow-up after `ms`. */
export type Act<S> = (state: S, now: number) => { state: S; then?: { ms: number; act: Act<S> } } | null;

export interface ButtonView {
  label: string;
  /** Visible but inert (keeps focus where it is). */
  inert: boolean;
}

export interface BuildView {
  question: ButtonView;
  challenge: ButtonView;
  note: string;
  stats: Array<[string, string]>;
}

export interface BuildSpec<S> {
  init: (now: number) => S;
  /** A finished-looking state for the archive plate. */
  demo: () => S;
  question: Act<S>;
  challenge: Act<S>;
  view: (state: S) => BuildView;
  framing: (state: S) => Framing;
}

export function useBuild<S>(spec: BuildSpec<S>) {
  const [state, setState] = useState<S>(() => spec.init(performance.now()));
  const ref = useRef(state);
  const timers = useRef<number[]>([]);

  const run = useCallback((act: Act<S>) => {
    const result = act(ref.current, performance.now());
    if (!result) return;
    ref.current = result.state;
    setState(result.state);
    const next = result.then;
    if (next) {
      const id = window.setTimeout(() => run(next.act), next.ms);
      timers.current.push(id);
    }
  }, []);

  const reset = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    const fresh = spec.init(performance.now());
    ref.current = fresh;
    setState(fresh);
  }, [spec]);

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  return {
    state,
    question: useCallback(() => run(spec.question), [run, spec]),
    challenge: useCallback(() => run(spec.challenge), [run, spec]),
    reset,
  };
}
