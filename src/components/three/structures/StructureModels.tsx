import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Edges, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { SCENE, type Vec3 } from '../../../data/scene';
import { useReducedMotion } from '../../../lib/useReducedMotion';
import { damp } from '../../../lib/useScrollProgress';
import {
  ContactShadow,
  FitCamera,
  PaperGround,
  SceneFog,
  StudioLights,
} from '../SceneKit';

interface SharedAssets {
  plaster: THREE.MeshStandardMaterial;
  ink: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
}

let shared: SharedAssets | null = null;

/** One set of materials shared by all four structure models. */
function getShared(): SharedAssets {
  if (!shared) {
    shared = {
      plaster: new THREE.MeshStandardMaterial({
        color: SCENE.palette.plaster,
        roughness: 0.92,
        metalness: 0,
      }),
      ink: new THREE.MeshStandardMaterial({
        color: SCENE.palette.ink,
        roughness: 0.85,
        metalness: 0,
      }),
      accent: new THREE.MeshStandardMaterial({
        color: SCENE.palette.accent,
        roughness: 0.7,
        metalness: 0,
      }),
    };
  }
  return shared;
}

function frameLambda(delta: number): number {
  return 1 - Math.exp(-6 * delta);
}

/**
 * Wraps a model and applies the shared `active` motion: a small lift plus a
 * gentle rotation toward the camera. Damped in useFrame, disabled under
 * reduced motion.
 */
function ActiveGroup({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<THREE.Group>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useFrame((_, delta) => {
    const group = ref.current;
    if (reduced || !group) return;
    const lambda = frameLambda(delta);
    const targetY = activeRef.current ? 0.12 : 0;
    const targetRotY = activeRef.current ? 0.14 : 0;
    group.position.y = damp(group.position.y, targetY, lambda);
    group.rotation.y = damp(group.rotation.y, targetRotY, lambda);
  });

  return <group ref={ref}>{children}</group>;
}

/* ------------------------------------------------------------------ */
/* 01 — The Dialectic Room                                            */
/* ------------------------------------------------------------------ */

const MONOLITH_SLOTS = 19; // 18 mirrors + one gap = the absent voice
const MONOLITH_GAP_SLOT = 15;
export const MONOLITH_TEACHER_SLOT = 7;
const MONOLITH_RADIUS = 2.1;
const MONOLITH_TEACHER_OUTWARD = 0.3;

const RIPPLE_COUNT = 6;
const RIPPLE_IDS = [0, 1, 2, 3, 4, 5];
const EMPTY_SCORE: readonly number[] = [];

export const MONOLITH_PERSPECTIVES: string[] = [
  'Reflects the question back as a series of smaller questions.',
  'Bends the light toward the example that broke.',
  'Holds the light still until an answer arrives.',
  'Splits the light into cause and consequence.',
  'Turns the light back toward the one who asked.',
  'Softens the light so the quiet student can look.',
  'Angles the light at the weakest assumption.',
  'The teacher adds no light — only polishes the mirrors until they shine.',
  'Scatters the light across the whole room.',
  'Focuses the light into a single sharp doubt.',
  'Bounces the light off yesterday\u2019s reading.',
  'Lets the light pass through unchanged.',
  'Breaks the light into evidence and belief.',
  'Carries the light to the person who hasn\u2019t spoken.',
  'Warms the light so a disagreement can cool.',
  'The empty place — light falls straight through.',
  'Repeats the light back at a slower pace.',
  'Refracts the light into many possible answers.',
  'Returns the light only after a long silence.',
];

let monolithPoolTexture: THREE.CanvasTexture | null = null;
function getMonolithPoolTexture(): THREE.CanvasTexture {
  if (monolithPoolTexture) return monolithPoolTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  monolithPoolTexture = texture;
  return texture;
}

export function DialecticRoomModel({
  active = false,
  chord,
  explode = 0,
  onHoverSlot,
  onSelect,
  onVoice,
  onWaveComplete,
  selected = null,
  shine = 0,
  wave,
}: {
  active?: boolean;
  /** Slots that have recently spoken, most recent first. */
  chord?: number[];
  explode?: number;
  onHoverSlot?: (slot: number | null) => void;
  onSelect?: (slot: number) => void;
  onVoice?: (slot: number) => void;
  onWaveComplete?: () => void;
  selected?: number | null;
  shine?: number;
  /** Increment to trigger a question-wave around the ring. */
  wave?: number;
}) {
  const poolTexture = useMemo(() => getMonolithPoolTexture(), []);
  const monoGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const rippleGeo = useMemo(() => new THREE.RingGeometry(0.944, 1, 48), []);
  const gapGeo = useMemo(() => new THREE.RingGeometry(0.92, 1, 64), []);
  const inkColor = useMemo(() => new THREE.Color(SCENE.palette.ink), []);
  const accentColor = useMemo(() => new THREE.Color(SCENE.palette.accent), []);

  const gapPos = useMemo(() => {
    const angle = (MONOLITH_GAP_SLOT / MONOLITH_SLOTS) * Math.PI * 2;
    return [
      Math.cos(angle) * MONOLITH_RADIUS,
      Math.sin(angle) * MONOLITH_RADIUS,
    ] as const;
  }, []);

  // Mirror monoliths: each one is a slightly different tint, gloss and
  // reflectivity, so no two catch the room the same way.
  const materials = useMemo(() => {
    const tones = ['#EAE6DC', '#E4DED2', '#EEE9DF', '#E2DCD0', '#E9E3D7', '#E6E0D4'];
    const baseEnv: number[] = [];
    const list = Array.from({ length: MONOLITH_SLOTS }, (_, slot) => {
      const teacher = slot === MONOLITH_TEACHER_SLOT;
      const base = teacher ? 1.35 : 0.85 + (slot % 5) * 0.14;
      baseEnv.push(base);
      return new THREE.MeshPhysicalMaterial({
        color: teacher ? '#B0566A' : tones[slot % tones.length],
        metalness: teacher ? 1 : 0.9 + (slot % 3) * 0.05,
        roughness: teacher ? 0.05 : 0.08 + (slot % 4) * 0.05,
        envMapIntensity: base,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        emissive: teacher ? '#5A1620' : '#000000',
        emissiveIntensity: teacher ? 0.6 : 0,
      });
    });
    return { list, baseEnv };
  }, []);

  const monoliths = useMemo(() => {
    return Array.from({ length: MONOLITH_SLOTS }, (_, slot) => {
      if (slot === MONOLITH_GAP_SLOT) return null;
      const angle = (slot / MONOLITH_SLOTS) * Math.PI * 2;
      const outward = slot === MONOLITH_TEACHER_SLOT ? MONOLITH_TEACHER_OUTWARD : 0;
      const height = 1.25 + ((slot * 7) % 5) * 0.16;
      const lean = (((slot * 13) % 5) - 2) * 0.03;
      return {
        key: slot,
        position: [
          Math.cos(angle) * (MONOLITH_RADIUS + outward),
          0,
          Math.sin(angle) * (MONOLITH_RADIUS + outward),
        ] as Vec3,
        dir: [Math.cos(angle), Math.sin(angle)] as const,
        rotationY: angle,
        height,
        lean,
        isTeacher: slot === MONOLITH_TEACHER_SLOT,
      };
    });
  }, []);

  const ringRef = useRef<THREE.Group>(null);
  const monoRefs = useRef<Array<THREE.Group | null>>([]);
  const reduced = useReducedMotion();
  const explodeRef = useRef(explode);
  explodeRef.current = explode;
  const explodeAnim = useRef(0);
  const shineRef = useRef(shine);
  shineRef.current = shine;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const shineAnim = useRef(0);

  // Score state — every new feature is inert unless its prop is supplied, so
  // the index and dossier viewers (which pass only active/selected/shine) keep
  // their original behaviour.
  const chordRef = useRef<readonly number[]>(EMPTY_SCORE);
  chordRef.current = chord ?? EMPTY_SCORE;
  const waveRef = useRef(wave ?? 0);
  waveRef.current = wave ?? 0;
  const onVoiceRef = useRef(onVoice);
  onVoiceRef.current = onVoice;
  const onWaveCompleteRef = useRef(onWaveComplete);
  onWaveCompleteRef.current = onWaveComplete;

  const hoveredRef = useRef<number | null>(null);
  const hoverAnim = useRef<number[]>(
    Array.from({ length: MONOLITH_SLOTS }, () => 0),
  );
  const chordAnim = useRef<number[]>(
    Array.from({ length: MONOLITH_SLOTS }, () => 0),
  );
  const flashAnim = useRef<number[]>(
    Array.from({ length: MONOLITH_SLOTS }, () => 0),
  );

  const rippleRefs = useRef<Array<THREE.Mesh | null>>([]);
  const rippleMaterials = useMemo(
    () =>
      Array.from(
        { length: RIPPLE_COUNT },
        () =>
          new THREE.MeshBasicMaterial({
            color: SCENE.palette.ink,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            toneMapped: false,
          }),
      ),
    [],
  );
  const rippleStates = useRef(
    Array.from({ length: RIPPLE_COUNT }, () => ({
      active: false,
      t: 0,
      x: 0,
      z: 0,
      teacher: false,
    })),
  );
  const rippleCursor = useRef(0);

  const gapRingRef = useRef<THREE.Mesh>(null);
  const gapRingMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: SCENE.palette.accent,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const gapChordAnim = useRef(0);
  const gapPulseAnim = useRef(0);

  const clock = useRef(0);
  const prevChordRef = useRef<readonly number[]>(EMPTY_SCORE);
  const lastWaveRef = useRef(wave ?? 0);
  const waveRunRef = useRef<{ step: number; elapsed: number } | null>(null);
  const ripplesEnabled = chord != null || wave != null;

  const triggerRipple = (slot: number) => {
    const index = rippleCursor.current;
    rippleCursor.current = (index + 1) % RIPPLE_COUNT;
    const state = rippleStates.current[index];
    const teacher = slot === MONOLITH_TEACHER_SLOT;
    const angle = (slot / MONOLITH_SLOTS) * Math.PI * 2;
    const radius = teacher ? MONOLITH_RADIUS + MONOLITH_TEACHER_OUTWARD : MONOLITH_RADIUS;
    state.active = true;
    state.t = 0;
    state.x = Math.cos(angle) * radius;
    state.z = Math.sin(angle) * radius;
    state.teacher = teacher;

    const material = rippleMaterials[index];
    material.color.copy(teacher ? accentColor : inkColor);
    material.opacity = 0.28;

    const mesh = rippleRefs.current[index];
    if (mesh) {
      mesh.position.set(state.x, 0.015, state.z);
      mesh.scale.setScalar(0.35);
      mesh.visible = true;
    }
  };

  useFrame((_, delta) => {
    const ring = ringRef.current;
    if (reduced || !ring) return;

    const lambda = frameLambda(delta);
    clock.current += delta;

    // Smooth the teacher's "polish" pulse.
    shineAnim.current = damp(shineAnim.current, shineRef.current, lambda);

    // Explode (spread the mirrors apart).
    const target = explodeRef.current;
    let e = 0;
    if (target !== 0 || explodeAnim.current !== 0) {
      explodeAnim.current = damp(explodeAnim.current, target, lambda);
      if (target === 0 && Math.abs(explodeAnim.current) < 0.0005) {
        explodeAnim.current = 0;
      }
      e = explodeAnim.current;
      ring.position.y = e * 0.12;
      monoliths.forEach((m, index) => {
        const g = monoRefs.current[index];
        if (!m || !g) return;
        g.position.x = m.position[0] + m.dir[0] * e * 0.9;
        g.position.z = m.position[2] + m.dir[1] * e * 0.9;
        g.position.y = e * 0.3;
      });
    }

    // Hover / chord / flash easing. All inert when the score props are absent.
    const chord = chordRef.current;
    const hovered = hoveredRef.current;
    const flashDecay = 1 - Math.exp(-9 * delta);
    for (let slot = 0; slot < MONOLITH_SLOTS; slot += 1) {
      if (slot === MONOLITH_GAP_SLOT) continue;

      hoverAnim.current[slot] = damp(
        hoverAnim.current[slot],
        hovered === slot ? 1 : 0,
        lambda,
      );
      chordAnim.current[slot] = damp(
        chordAnim.current[slot],
        chord.includes(slot) ? 1 : 0,
        lambda,
      );
      flashAnim.current[slot] = damp(flashAnim.current[slot], 0, flashDecay);

      const g = monoRefs.current[slot];
      if (!g) continue;
      const h = hoverAnim.current[slot];
      g.rotation.x = 0.09 * h;
      g.position.y = e * 0.3 + 0.04 * h;
    }

    // Materials: combine shine, selection, chord, hover and flash.
    const s = shineAnim.current;
    const sel = selectedRef.current;
    materials.list.forEach((mat, slot) => {
      if (slot === MONOLITH_GAP_SLOT) return;
      const teacher = slot === MONOLITH_TEACHER_SLOT;
      const base = materials.baseEnv[slot];
      const c = chordAnim.current[slot];
      const h = hoverAnim.current[slot];
      const f = flashAnim.current[slot];

      const envBoost = h * 0.5 + c * 0.45;
      if (teacher) {
        const pulse = c * (0.5 + 0.5 * Math.sin(clock.current * 6));
        mat.envMapIntensity = base + s * 0.4 + envBoost;
        mat.emissiveIntensity = 0.6 + s * 0.9 + pulse * 0.7 + f * 0.5;
      } else {
        mat.envMapIntensity =
          base + s * 0.9 + (sel === slot ? 0.6 : 0) + envBoost;
        mat.emissiveIntensity =
          s * 0.35 + (sel === slot ? 0.28 : 0) + c * 0.26 + f * 0.5;
        mat.emissive.set(
          sel === slot || c > 0.01 || f > 0.01 ? '#FFF3DE' : '#000000',
        );
      }
    });

    // Advance the ripple pool (reused round-robin, no per-frame allocations).
    for (let i = 0; i < RIPPLE_COUNT; i += 1) {
      const state = rippleStates.current[i];
      if (!state.active) continue;
      state.t += delta;
      const mesh = rippleRefs.current[i];
      if (!mesh) continue;
      const k = state.t / 1.5;
      if (k >= 1) {
        state.active = false;
        mesh.visible = false;
        continue;
      }
      mesh.scale.setScalar(0.35 + (3.4 - 0.35) * k);
      rippleMaterials[i].opacity = 0.28 * (1 - k);
    }

    // Each newly added chord voice emits one ripple.
    if (ripplesEnabled) {
      const previous = prevChordRef.current;
      if (chord !== previous) {
        for (const slot of chord) {
          if (!previous.includes(slot)) triggerRipple(slot);
        }
        prevChordRef.current = chord;
      }
    }

    // The gap slot (the absent voice) resolves as a soft ash-pink ring once
    // at least four voices are sounding.
    gapChordAnim.current = damp(
      gapChordAnim.current,
      chord.length >= 4 ? 1 : 0,
      lambda,
    );
    gapPulseAnim.current = damp(
      gapPulseAnim.current,
      0,
      1 - Math.exp(-4 * delta),
    );
    const gapMesh = gapRingRef.current;
    if (gapMesh) {
      const gc = gapChordAnim.current;
      const gp = gapPulseAnim.current;
      gapMesh.position.y = 0.015 + gc * 0.055 + gp * 0.08;
      gapMesh.scale.setScalar(0.9 + gc * 0.35 + gp * 0.7);
      gapRingMaterial.opacity = Math.max(gc * 0.5, gp * 0.6);
      gapMesh.visible = gapRingMaterial.opacity > 0.01;
    }

    // Question-wave: walks the ring at 70ms intervals from `useFrame` time.
    // Each mirror briefly lights and fires `onVoice`; the gap pulses once and
    // the wave completes after the full ring has been voiced.
    if (waveRef.current !== lastWaveRef.current) {
      lastWaveRef.current = waveRef.current;
      waveRunRef.current = { step: 0, elapsed: 0 };
    }
    const run = waveRunRef.current;
    if (run) {
      run.elapsed += delta;
      while (run.step < MONOLITH_SLOTS && run.elapsed >= run.step * 0.07) {
        const slot = run.step;
        if (slot === MONOLITH_GAP_SLOT) {
          gapPulseAnim.current = 1;
        } else {
          flashAnim.current[slot] = 1;
          onVoiceRef.current?.(slot);
        }
        run.step += 1;
      }
      if (run.step >= MONOLITH_SLOTS) {
        waveRunRef.current = null;
        onWaveCompleteRef.current?.();
      }
    }
  });

  return (
    <ActiveGroup active={active}>
      <group ref={ringRef}>
        <group rotation-x={0.08}>
          {monoliths.map(
            (m, index) =>
              m && (
                <group
                  key={m.key}
                  ref={(node) => {
                    monoRefs.current[index] = node;
                  }}
                  position={m.position}
                  rotation-y={m.rotationY}
                >
                  <mesh
                    geometry={monoGeo}
                    material={materials.list[m.key]}
                    position={[0, m.height / 2, 0]}
                    rotation-z={m.lean}
                    scale={[0.34, m.height, 0.14]}
                    castShadow
                    receiveShadow
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect?.(m.key);
                    }}
                    onPointerOver={(e) => {
                      e.stopPropagation();
                      hoveredRef.current = m.key;
                      onHoverSlot?.(m.key);
                    }}
                    onPointerOut={() => {
                      hoveredRef.current = null;
                      onHoverSlot?.(null);
                    }}
                  />

                  {/* the teacher always leaves a little red pool; a selected
                      student leaves a white pool of their own reflection */}
                  {m.isTeacher || selected === m.key ? (
                    <mesh
                      position={[0, 0.02, 0]}
                      rotation-x={-Math.PI / 2}
                      scale={[2.2, 2.2, 1]}
                    >
                      <planeGeometry args={[1, 1]} />
                      <meshBasicMaterial
                        map={poolTexture}
                        color={m.isTeacher ? '#B0566A' : '#FFFFFF'}
                        transparent
                        opacity={m.isTeacher ? 0.35 : 0.55}
                        depthWrite={false}
                      />
                    </mesh>
                  ) : null}
                </group>
              ),
          )}
        </group>

        {ripplesEnabled && (
          <>
            {RIPPLE_IDS.map((index) => (
              <mesh
                key={`ripple-${index}`}
                ref={(node) => {
                  rippleRefs.current[index] = node;
                }}
                geometry={rippleGeo}
                material={rippleMaterials[index]}
                rotation-x={-Math.PI / 2}
                visible={false}
              />
            ))}
            <mesh
              ref={gapRingRef}
              geometry={gapGeo}
              material={gapRingMaterial}
              rotation-x={-Math.PI / 2}
              position={[gapPos[0], 0.015, gapPos[1]]}
              visible={false}
            />
          </>
        )}
      </group>
    </ActiveGroup>
  );
}

/* ------------------------------------------------------------------ */
/* 02 — The Unstable Prompt                                           */
/* ------------------------------------------------------------------ */

let paperTexture: THREE.CanvasTexture | null = null;

/** Cached 1024×1024 paper texture: a typeset page — a rectangular text block
 *  with clear margins, fine ragged lines that average into grey at distance,
 *  and a soft top-to-bottom gradient so the unlit sheet still has form. */
function getPaperTexture(): THREE.CanvasTexture {
  if (paperTexture) return paperTexture;
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Warm paper base with a subtle vertical gradient: ~1.03 at the top edge to
  // ~0.94 at the bottom, so the sheet reads as lit even though the material is
  // unlit (toneMapped: false).
  const base = [242, 237, 228]; // #F2EDE4
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(
    0,
    `rgb(${Math.min(255, Math.round(base[0] * 1.03))}, ${Math.min(255, Math.round(base[1] * 1.03))}, ${Math.min(255, Math.round(base[2] * 1.03))})`,
  );
  grad.addColorStop(
    1,
    `rgb(${Math.round(base[0] * 0.94)}, ${Math.round(base[1] * 0.94)}, ${Math.round(base[2] * 0.94)})`,
  );
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const ink = (alpha: number) => `rgba(26, 26, 26, ${alpha})`;

  // Text block geometry: left/right margins ~12%, top margin ~10%.
  const left = 0.12 * size;
  const blockWidth = 0.76 * size; // 0.12 → 0.88

  // Seeded PRNG so the ragged-right widths are stable across reloads.
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Short heading rule (not full width).
  const heading = (y: number) => {
    ctx.fillStyle = ink(0.26);
    ctx.fillRect(left, Math.round(y * size), Math.round(blockWidth * 0.4), 9);
  };

  // A paragraph line: 1.5–2px tall, ink 10–12%, ragged right edge.
  const line = (y: number, widthMin: number, widthMax: number) => {
    const h = 1.5 + rand() * 0.5;
    const w = widthMin + rand() * (widthMax - widthMin);
    ctx.fillStyle = ink(0.1 + rand() * 0.02);
    ctx.fillRect(left, Math.round(y * size), Math.round(blockWidth * w), h);
  };

  heading(0.13);

  let y = 0.18;
  for (let i = 0; i < 24; i += 1) {
    line(y, 0.55, 0.95);
    y += 7 / size;
  }

  heading(0.55);

  y = 0.6;
  for (let i = 0; i < 20; i += 1) {
    line(y, 0.55, 0.95);
    y += 7 / size;
  }

  // Closing paragraph: a few short lines.
  for (let i = 0; i < 5; i += 1) {
    line(y, 0.28, 0.55);
    y += 7 / size;
  }

  // ±2 level per-pixel noise to kill banding.
  const imageData = ctx.getImageData(0, 0, size, size);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = Math.floor(Math.random() * 5) - 2;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
  ctx.putImageData(imageData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  paperTexture = texture;
  return texture;
}

// Precarious cantilever pose and stress-contour / buckle parameters for the
// unstable prompt. Module-scope so the per-frame path stays allocation-free.
const PLATE_LEAN = [1, 1.8, 3.25, 5.85, 8].map(
  (deg) => (deg * Math.PI) / 180,
);
const PLATE_X = [-0.3, -0.12, 0.06, 0.26, 0.46]; // cantilevered x centres
const JOINT_X = 0.94; // critical joint, plate-local x (outer edge)
const JOINT_Z = 0.36; // critical joint, plate-local z (front, visible at 21°)
const STRESS_RADII = [0.04, 0.07, 0.1, 0.13, 0.16];
const STRESS_ARC_START = Math.PI + 0.55; // gap faces the plate interior (−x)
const STRESS_ARC_SPAN = Math.PI * 2 - 1.1; // ~298° hairline arc
const STRESS_ARC_SEGMENTS = 48;
const BUCKLE_PERIOD = 9; // seconds per full buckle cycle
const BUCKLE_SLIP = 1.2; // slip-outward ramp
const BUCKLE_RECOVER = 1.6; // damped-spring recovery with overshoot
const BUCKLE_SLIP_X = 0.035; // top-two-plate outward slip
const BUCKLE_SLIP_TILT = (0.6 * Math.PI) / 180; // extra lean during slip

export function UnstablePromptModel({
  active = false,
  progress = 0,
  explode = 0,
}: {
  active?: boolean;
  progress?: number;
  explode?: number;
}) {
  const { accent } = getShared();
  const paperTex = useMemo(() => getPaperTexture(), []);
  const plateGeo = useMemo(() => new THREE.BoxGeometry(1.9, 0.055, 1.05), []);
  const stressGeo = useMemo(() => new THREE.BoxGeometry(0.05, 0.07, 0.02), []);
  const loadPath = useMemo(
    () => [[PLATE_X[0], 0, 0], [PLATE_X[4], 0.76, 0]] as Vec3[],
    [],
  );

  // Concentric photoelastic fringe arcs around the critical joint, generated in
  // plate 3's local frame so they inherit its lean and explode/buckle motion.
  const contourArcs = useMemo(
    () =>
      STRESS_RADII.map((radius) => {
        const points: Vec3[] = [];
        for (let i = 0; i <= STRESS_ARC_SEGMENTS; i += 1) {
          const angle =
            STRESS_ARC_START + (i / STRESS_ARC_SEGMENTS) * STRESS_ARC_SPAN;
          points.push([Math.cos(angle) * radius, 0, Math.sin(angle) * radius]);
        }
        return points;
      }),
    [],
  );

  // Unlit paper so the texture (rulings, header, margin) renders exactly as
  // drawn instead of being washed out by the bright studio lights and the ACES
  // exposure in CanvasHost. `toneMapped: false` keeps the ink/paper contrast.
  const plateMaterial = useMemo(() => {
    const material = new THREE.MeshBasicMaterial({
      map: paperTex,
      color: new THREE.Color('#E9E3D6'),
      toneMapped: false,
    });
    return material;
  }, [paperTex]);

  // Ash-pink stress marker: full-opacity accent with a low emissive base and a
  // lean-driven brightening that never washes out to pale pink.
  const stressMaterial = useMemo(() => {
    const material = accent.clone();
    material.emissive = new THREE.Color(SCENE.palette.accent);
    material.emissiveIntensity = 0.15;
    return material;
  }, [accent]);

  const plates = PLATE_LEAN;

  const tipRef = useRef<THREE.Group>(null);
  const plateRefs = useRef<Array<THREE.Group | null>>([]);
  const contourRefs = useRef<Array<THREE.Mesh | null>>([]);
  const reduced = useReducedMotion();
  const clock = useRef(0);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const progressAnim = useRef(0);
  const explodeRef = useRef(explode);
  explodeRef.current = explode;
  const explodeAnim = useRef(0);

  useFrame((_, delta) => {
    const group = tipRef.current;
    if (reduced || !group) return;
    const lambda = frameLambda(delta);
    clock.current += delta;
    const t = clock.current;

    // Slow structural sway; `progress` can tip the whole stack an extra 2°.
    const swayZ = Math.sin(t * 0.55) * 0.007;
    const swayX = Math.sin(t * 0.37 + 1.2) * 0.004;
    progressAnim.current = damp(
      progressAnim.current,
      progressRef.current * 0.035,
      lambda,
    );
    group.rotation.z = progressAnim.current + swayZ;
    group.rotation.x = swayX;

    // Slow buckle cycle: every BUCKLE_PERIOD seconds the top two plates slip
    // outward for BUCKLE_SLIP, then recover over BUCKLE_RECOVER with a damped
    // spring overshoot. Pure elapsed-time math, no allocations.
    const cycle = t % BUCKLE_PERIOD;
    let buckle = 0;
    let slipPulse = 0;
    if (cycle <= BUCKLE_SLIP) {
      const k = cycle / BUCKLE_SLIP;
      const slip = k * k * (3 - 2 * k); // smoothstep 0 → 1
      buckle = slip;
      slipPulse = slip;
    } else if (cycle <= BUCKLE_SLIP + BUCKLE_RECOVER) {
      const r = (cycle - BUCKLE_SLIP) / BUCKLE_RECOVER;
      // Under-damped spring: decays to ~0 by r = 1 with a ~10% overshoot.
      const spring = Math.exp(-5.5 * r) * Math.cos(7.5 * r);
      buckle = spring;
      slipPulse = Math.max(0, spring);
    }

    const slipX = BUCKLE_SLIP_X * buckle;
    const extraTilt = BUCKLE_SLIP_TILT * buckle;

    const plate3 = plateRefs.current[3];
    const plate4 = plateRefs.current[4];
    if (plate3) plate3.rotation.z = plates[3] + extraTilt;
    if (plate4) {
      plate4.rotation.z =
        plates[4] + extraTilt + Math.sin(t * 0.55 - 0.9) * 0.006;
    }

    // The critical joint flashes accent at the moment the top plates slip.
    stressMaterial.emissiveIntensity =
      0.2 + Math.abs(group.rotation.z) * 6 + slipPulse * 1.1;

    // Photoelastic fringes: base 0.3, rising a little with lean/progress and
    // peaking at the slip — the innermost two flash harder than the outer ones.
    const load = Math.min(
      1,
      Math.abs(group.rotation.z) * 8 + progressRef.current * 0.9,
    );
    const baseOpacity = 0.3 + load * 0.08;
    for (let i = 0; i < contourRefs.current.length; i += 1) {
      const line = contourRefs.current[i];
      if (!line) continue;
      const flash = slipPulse * (i <= 1 ? 0.25 : 0.15);
      (line.material as THREE.Material).opacity = Math.min(
        0.58,
        baseOpacity + flash,
      );
    }

    const target = explodeRef.current;
    if (target === 0 && explodeAnim.current === 0) {
      // At rest the plates keep their JSX positions; only the buckle slip moves
      // the top two.
      if (plate3) plate3.position.x = PLATE_X[3] + slipX;
      if (plate4) plate4.position.x = PLATE_X[4] + slipX;
      return;
    }

    explodeAnim.current = damp(explodeAnim.current, target, lambda);
    if (target === 0 && Math.abs(explodeAnim.current) < 0.0005) {
      explodeAnim.current = 0;
    }
    const e = explodeAnim.current;

    for (let index = 0; index < plates.length; index += 1) {
      const plate = plateRefs.current[index];
      if (!plate) continue;
      const buckleX = index >= 3 ? slipX : 0;
      plate.position.x = PLATE_X[index] + index * 0.25 * e + buckleX;
      plate.position.y = index * 0.17 + 0.05 + index * 0.5 * e;
    }
  });

  return (
    <ActiveGroup active={active}>
      <group ref={tipRef}>
        {plates.map((lean, index) => (
          <group
            key={index}
            ref={(node) => {
              plateRefs.current[index] = node;
            }}
            position={[PLATE_X[index], index * 0.17 + 0.05, 0]}
            rotation-z={lean}
          >
            <mesh
              geometry={plateGeo}
              material={plateMaterial}
              castShadow
              receiveShadow
            >
              <Edges threshold={20} color="#1A1A1A" />
            </mesh>

            {/* critical joint tab + photoelastic fringes, on plate 3's face at
                its raised outer corner (they lean and detach with the plate) */}
            {index === 3 && (
              <>
                <mesh
                  geometry={stressGeo}
                  material={stressMaterial}
                  position={[JOINT_X, 0.0625, JOINT_Z]}
                >
                  <Edges threshold={20} color={SCENE.palette.ink} />
                </mesh>
                <group position={[JOINT_X, 0.03, JOINT_Z]}>
                  {contourArcs.map((points, i) => (
                    <Line
                      key={`stress-arc-${i}`}
                      ref={(node) => {
                        contourRefs.current[i] =
                          node as unknown as THREE.Mesh | null;
                      }}
                      points={points}
                      color={SCENE.palette.accent}
                      lineWidth={1.5}
                      transparent
                      opacity={0.35}
                    />
                  ))}
                </group>
              </>
            )}
          </group>
        ))}

        {/* dashed ink load path along the cantilever's centre */}
        <Line
          points={loadPath}
          color={SCENE.palette.ink}
          lineWidth={1}
          dashed
          dashSize={0.035}
          gapSize={0.03}
          transparent
          opacity={0.5}
          depthTest={false}
        />
      </group>
    </ActiveGroup>
  );
}

/* ------------------------------------------------------------------ */
/* 03 — Scaffolding Silence                                           */
/* ------------------------------------------------------------------ */

export function ScaffoldingSilenceModel({
  active = false,
  explode = 0,
}: {
  active?: boolean;
  explode?: number;
}) {
  const { plaster } = getShared();
  const memberGeo = useMemo(() => new THREE.BoxGeometry(0.12, 2.6, 0.12), []);
  const baseGeo = useMemo(() => new THREE.BoxGeometry(2.0, 0.05, 2.0), []);

  const reduced = useReducedMotion();
  const baseRef = useRef<THREE.Mesh>(null);
  const refs = useRef<Array<THREE.Mesh | null>>([]);
  const clock = useRef(0);
  const explodeRef = useRef(explode);
  explodeRef.current = explode;
  const explodeAnim = useRef(0);

  const members = useMemo(() => {
    const list: Array<{
      key: string;
      x: number;
      z: number;
      neighbor: boolean;
    }> = [];
    for (const x of [-1, 0, 1]) {
      for (const z of [-1, 0, 1]) {
        if (x === 0 && z === 0) continue; // the missing member
        list.push({
          key: `${x}:${z}`,
          x,
          z,
          neighbor: Math.abs(x) + Math.abs(z) === 1,
        });
      }
    }
    return list;
  }, []);

  useFrame((_, delta) => {
    if (reduced) return;
    clock.current += delta;
    const breathe = Math.sin(clock.current * 0.8) * 0.03;

    const target = explodeRef.current;
    const settled = target === 0 && explodeAnim.current === 0;
    if (!settled) {
      explodeAnim.current = damp(
        explodeAnim.current,
        target,
        frameLambda(delta),
      );
      if (target === 0 && Math.abs(explodeAnim.current) < 0.0005) {
        explodeAnim.current = 0;
      }
    }
    const e = explodeAnim.current;

    members.forEach((member, index) => {
      const mesh = refs.current[index];
      if (!mesh) return;
      if (member.neighbor) {
        // Keep the pre-existing idle breathe around the missing centre.
        mesh.position.x = member.x * 0.8 * (1 + breathe);
        mesh.position.z = member.z * 0.8 * (1 + breathe);
        mesh.position.y = 1.3 + 0.9 * e;
      } else if (!settled) {
        // Outer (corner) members splay away from the centre when exploded.
        mesh.position.x = member.x * 0.8 + member.x * 0.35 * e;
        mesh.position.z = member.z * 0.8 + member.z * 0.35 * e;
        mesh.position.y = 1.3 + 0.9 * e;
      }
    });

    if (!settled && baseRef.current) {
      baseRef.current.position.y = 0.025 - 0.04 * e;
    }
  });

  return (
    <ActiveGroup active={active}>
      <group>
        <mesh
          ref={baseRef}
          geometry={baseGeo}
          material={plaster}
          position={[0, 0.025, 0]}
          receiveShadow
          castShadow
        />
        {members.map((member, index) => (
          <mesh
            key={member.key}
            ref={(node) => {
              refs.current[index] = node;
            }}
            geometry={memberGeo}
            material={plaster}
            position={[member.x * 0.8, 1.3, member.z * 0.8]}
            castShadow
            receiveShadow
          >
            {member.neighbor && active && (
              <Edges threshold={20} color={SCENE.palette.accent} />
            )}
          </mesh>
        ))}
      </group>
    </ActiveGroup>
  );
}

/* ------------------------------------------------------------------ */
/* 04 — Marginalia as Dialogue                                        */
/* ------------------------------------------------------------------ */

export function MarginaliaDialogueModel({
  active = false,
  explode = 0,
}: {
  active?: boolean;
  explode?: number;
}) {
  const { plaster } = getShared();
  const pageGeo = useMemo(() => new THREE.BoxGeometry(1.6, 0.02, 2.2), []);
  const sheetGeo = useMemo(() => new THREE.BoxGeometry(0.5, 0.02, 0.68), []);
  // Slightly darker sheet faces so overlapping sheets read separately from the
  // page without changing the shared plaster palette.
  const sheetMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#E2DCD1',
        roughness: 0.92,
        metalness: 0,
      }),
    [],
  );

  const sheets = useMemo(
    () =>
      [
        { pos: [-1.15, 0.02, -1.0], rot: 0.35 },
        { pos: [1.2, 0.03, -0.9], rot: -0.4 },
        { pos: [-1.05, 0.2, 1.05], rot: -0.25 },
        { pos: [1.1, 0.16, 1.1], rot: 0.3 },
        { pos: [-0.5, 0.42, -0.3], rot: 0.12 },
        { pos: [0.6, 0.34, 0.2], rot: -0.18 },
      ] as const,
    [],
  );

  const hairlines = useMemo(
    () =>
      sheets.map((sheet) => ({
        from: [sheet.pos[0], sheet.pos[1], sheet.pos[2]] as Vec3,
        to: [
          sheet.pos[0] * 0.18,
          sheet.pos[1] + 0.03,
          sheet.pos[2] * 0.18,
        ] as Vec3,
        // Stable reference so drei's <Line> does not rebuild its geometry.
        points: [
          [sheet.pos[0], sheet.pos[1], sheet.pos[2]],
          [sheet.pos[0] * 0.18, sheet.pos[1] + 0.03, sheet.pos[2] * 0.18],
        ] as Vec3[],
      })),
    [sheets],
  );

  const sheetRefs = useRef<Array<THREE.Mesh | null>>([]);
  const lineRefs = useRef<Array<THREE.Mesh | null>>([]);
  const reduced = useReducedMotion();
  const explodeRef = useRef(explode);
  explodeRef.current = explode;
  const explodeAnim = useRef(0);

  useFrame((_, delta) => {
    if (reduced) return;

    const target = explodeRef.current;
    if (target === 0 && explodeAnim.current === 0) return;

    explodeAnim.current = damp(
      explodeAnim.current,
      target,
      frameLambda(delta),
    );
    if (target === 0 && Math.abs(explodeAnim.current) < 0.0005) {
      explodeAnim.current = 0;
    }
    const e = explodeAnim.current;

    sheets.forEach((sheet, index) => {
      const mesh = sheetRefs.current[index];
      if (!mesh) return;
      mesh.position.x = sheet.pos[0] * (1 + 0.5 * e);
      mesh.position.y = sheet.pos[1] + 0.6 * e;
      mesh.position.z = sheet.pos[2] * (1 + 0.5 * e);
    });

    hairlines.forEach((_, index) => {
      const lineMesh = lineRefs.current[index];
      if (!lineMesh) return;
      // Stretch the connector while it still reads as a hairline, then hide it.
      lineMesh.visible = e <= 0.5;
      if (!lineMesh.visible) return;

      const geometry = lineMesh.geometry as THREE.BufferGeometry;
      const start = geometry.getAttribute(
        'instanceStart',
      ) as THREE.InterleavedBufferAttribute;
      const data = start.data as THREE.InterleavedBuffer;
      const arr = data.array as Float32Array;
      const sheet = sheets[index];
      arr[0] = sheet.pos[0] * (1 + 0.5 * e);
      arr[1] = sheet.pos[1] + 0.6 * e;
      arr[2] = sheet.pos[2] * (1 + 0.5 * e);
      data.needsUpdate = true;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    });
  });

  return (
    <ActiveGroup active={active}>
      <group>
        <mesh
          geometry={pageGeo}
          material={plaster}
          position={[0, 0.01, 0]}
          castShadow
          receiveShadow
        >
          <Edges threshold={20} color={SCENE.palette.ink} />
        </mesh>
        {sheets.map((sheet, index) => (
          <mesh
            key={index}
            ref={(node) => {
              sheetRefs.current[index] = node;
            }}
            geometry={sheetGeo}
            material={sheetMaterial}
            position={sheet.pos}
            rotation-y={sheet.rot}
            castShadow
            receiveShadow
          >
            <Edges threshold={20} color={SCENE.palette.ink} />
          </mesh>
        ))}
        {hairlines.map((line, index) => (
          <Line
            key={`line-${index}`}
            ref={(node) => {
              lineRefs.current[index] = node as unknown as THREE.Mesh | null;
            }}
            points={line.points}
            color={SCENE.palette.ink}
            lineWidth={1}
            transparent
            opacity={0.7}
          />
        ))}
      </group>
    </ActiveGroup>
  );
}

/* ------------------------------------------------------------------ */

export interface StructureModelProps {
  number: number;
  active?: boolean;
  /** Optional 0..1 progress used by a few models for a subtle extra motion. */
  progress?: number;
  /** Reserved for a future higher-detail pass; keeps the API stable. */
  detail?: boolean;
}

export interface StructureModelConfig {
  lookAt: Vec3;
  downAngleDeg: number;
  verticalExtent: number;
  horizontalExtent: number;
  shadowRadius: number;
  shadowScale: Vec3;
}

export const MODEL_CONFIG: Record<number, StructureModelConfig> = {
  1: {
    lookAt: [0, 0.45, 0],
    downAngleDeg: 20,
    verticalExtent: 0.85,
    horizontalExtent: 2.3,
    shadowRadius: 2.5,
    shadowScale: [1.1, 1.0, 1],
  },
  2: {
    lookAt: [0, 0.5, 0],
    downAngleDeg: 13,
    verticalExtent: 0.95,
    horizontalExtent: 1.4,
    shadowRadius: 1.9,
    shadowScale: [1.3, 0.9, 1],
  },
  3: {
    lookAt: [0, 0.9, 0],
    downAngleDeg: 11,
    verticalExtent: 1.5,
    horizontalExtent: 1.1,
    shadowRadius: 2.0,
    shadowScale: [1.2, 1.0, 1],
  },
  4: {
    lookAt: [0, 0.4, 0],
    downAngleDeg: 16,
    verticalExtent: 1.05,
    horizontalExtent: 1.5,
    shadowRadius: 2.2,
    shadowScale: [1.3, 1.0, 1],
  },
};

/**
 * One of four literal-but-abstract teaching structures, modelled procedurally
 * on the paper ground. No assets; every model is low-poly and shares the same
 * plaster/ink/accent materials.
 */
export default function StructureModel({
  number,
  active = false,
  progress = 0,
}: StructureModelProps) {
  const config = MODEL_CONFIG[number] ?? MODEL_CONFIG[1];

  let model: React.ReactNode;
  switch (number) {
    case 1:
      model = <DialecticRoomModel active={active} />;
      break;
    case 2:
      model = <UnstablePromptModel active={active} progress={progress} />;
      break;
    case 3:
      model = <ScaffoldingSilenceModel active={active} />;
      break;
    case 4:
      model = <MarginaliaDialogueModel active={active} />;
      break;
    default:
      model = <DialecticRoomModel active={active} />;
  }

  return (
    <>
      <StudioLights />
      <PaperGround />
      <ContactShadow
        radius={config.shadowRadius * 0.85}
        scale={config.shadowScale}
        opacity={0.18}
      />
      <SceneFog />
      <FitCamera
        verticalExtent={config.verticalExtent}
        horizontalExtent={config.horizontalExtent}
        lookAt={config.lookAt}
        downAngleDeg={config.downAngleDeg}
        fitRatio={0.8}
      />
      {model}
    </>
  );
}
