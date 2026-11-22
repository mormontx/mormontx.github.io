import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
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
import { BUILDS } from '../builders';
import { getStudioEnvironment } from '../studioEnvironment';

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
  // reflectivity, so no two catch the room the same way. They carry the studio
  // environment themselves, so they reflect it in any scene.
  const gl = useThree((state) => state.gl);
  const studio = useMemo(() => getStudioEnvironment(gl), [gl]);
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
        envMap: studio,
      });
    });
    return { list, baseEnv };
  }, [studio]);

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

export interface StructureModelProps {
  number: number;
  active?: boolean;
  /** Reserved for a future higher-detail pass; keeps the API stable. */
  detail?: boolean;
}

export interface StructureModelConfig {
  lookAt: Vec3;
  downAngleDeg: number;
  /** Turn the camera around the model (degrees); 0 looks from the front. */
  azimuthDeg?: number;
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
    // The frame as the archive shows it: five storeys, the lower three braced.
    lookAt: [0, 1.85, 0],
    downAngleDeg: 14,
    verticalExtent: 2.2,
    horizontalExtent: 1.2,
    shadowRadius: 1.9,
    shadowScale: [1.2, 1.0, 1],
  },
  3: {
    // The scaffold: four lifts tied in, a fifth untied, the idea through three.
    lookAt: [0, 1.9, 0],
    downAngleDeg: 14,
    verticalExtent: 2.25,
    horizontalExtent: 1.25,
    shadowRadius: 2.0,
    shadowScale: [1.2, 1.0, 1],
  },
  4: {
    // The bridge, met in the middle, with both railings up.
    lookAt: [0, 1.0, 0],
    downAngleDeg: 18,
    azimuthDeg: 40,
    verticalExtent: 1.2,
    horizontalExtent: 2.1,
    shadowRadius: 3.0,
    shadowScale: [1.6, 0.6, 1],
  },
};

/**
 * One of the four teaching structures on the paper ground, for the archive
 * plate. The room of mirrors is modelled here; the other three come from the builders,
 * shown in a partly built state. No assets; everything is low-poly.
 */
export default function StructureModel({ number, active = false }: StructureModelProps) {
  const config = MODEL_CONFIG[number] ?? MODEL_CONFIG[1];

  // 02–04 are built by questions; the archive shows each one partway built.
  const build = BUILDS[number];
  const demo = useMemo(() => build?.spec.demo(), [build]);
  const model =
    build && demo ? (
      <ActiveGroup active={active}>
        <build.Model state={demo} />
      </ActiveGroup>
    ) : (
      <DialecticRoomModel active={active} />
    );

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
        azimuthDeg={config.azimuthDeg ?? 0}
        fitRatio={0.8}
      />
      {model}
    </>
  );
}
