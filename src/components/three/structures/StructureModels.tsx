import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
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
import { BUILDS } from '../builders';

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

/**
 * Where the room's attention is, in world space. While `engaged`, every
 * occupied chair turns to face (x, z); once released, the chairs turn back to
 * face each other. `snap` sets the yaw instantly on the next frame.
 */
export interface RoomAttention {
  x: number;
  z: number;
  engaged: boolean;
  snap?: boolean;
  /** Draw sight lines from each occupied chair to (x, z). */
  showLines?: boolean;
}

/** Shortest signed angle from `from` to `to`, in (−π, π]. */
function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function DialecticRoomModel({
  active = false,
  explode = 0,
  attention,
}: {
  active?: boolean;
  explode?: number;
  attention?: React.RefObject<RoomAttention>;
}) {
  const { plaster, accent } = getShared();
  const seatGeo = useMemo(() => new THREE.BoxGeometry(0.34, 0.06, 0.34), []);
  const backGeo = useMemo(() => new THREE.BoxGeometry(0.34, 0.52, 0.05), []);

  const chairs = useMemo(() => {
    const SLOTS = 19; // one empty slot = the gap
    const GAP_SLOT = 15;
    const ACCENT_SLOT = 7;
    const RADIUS = 2.1;

    return Array.from({ length: SLOTS }, (_, slot) => {
      if (slot === GAP_SLOT) return null;
      const angle = (slot / SLOTS) * Math.PI * 2;
      const x = Math.cos(angle) * RADIUS;
      const z = Math.sin(angle) * RADIUS;
      const outward = slot === ACCENT_SLOT ? 0.34 : 0;
      return {
        key: slot,
        position: [x + Math.cos(angle) * outward, 0, z + Math.sin(angle) * outward] as Vec3,
        dir: [Math.cos(angle), Math.sin(angle)] as const,
        // A chair's front is its local −z; this yaw turns it to the centre.
        rotationY: Math.PI / 2 - angle,
        accent: slot === ACCENT_SLOT,
      };
    });
  }, []);

  const ringRef = useRef<THREE.Group>(null);
  const tiltRef = useRef<THREE.Group>(null);
  const chairRefs = useRef<Array<THREE.Group | null>>([]);
  const reduced = useReducedMotion();
  const explodeRef = useRef(explode);
  explodeRef.current = explode;
  const explodeAnim = useRef(0);
  const focus = useMemo(() => new THREE.Vector3(), []);

  // Sight lines: one hairline per occupied chair, seat → teacher.
  const occupied = useMemo(() => chairs.filter((c) => c && !c.accent).length, [chairs]);
  const sightGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(new Float32Array(occupied * 6), 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    return geo;
  }, [occupied]);
  const sightMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: SCENE.palette.accent,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const sightRef = useRef<THREE.LineSegments>(null);
  useEffect(
    () => () => {
      sightGeo.dispose();
      sightMat.dispose();
    },
    [sightGeo, sightMat],
  );

  // The room's attention: chairs turn toward the "teacher", then back inward.
  useFrame((_, delta) => {
    const att = attention?.current;
    const tilt = tiltRef.current;
    if (reduced || !att || !tilt) return;

    // Bring the world-space point into the ring's own (tilted, rotating) frame.
    focus.set(att.x, 0, att.z);
    tilt.worldToLocal(focus);

    const lines = sightRef.current;
    const pos = sightGeo.attributes.position as THREE.BufferAttribute;
    let seg = 0;

    chairs.forEach((chair, index) => {
      const g = chairRefs.current[index];
      // The empty chair has nobody in it, so it never turns.
      if (!chair || !g || chair.accent) return;
      // Sight line from the front edge of the seat to the teacher.
      const fx = -Math.sin(g.rotation.y);
      const fz = -Math.cos(g.rotation.y);
      pos.setXYZ(seg * 2, g.position.x + fx * 0.17, 0.4, g.position.z + fz * 0.17);
      pos.setXYZ(seg * 2 + 1, focus.x, focus.y + 0.01, focus.z);
      seg += 1;
      const dx = focus.x - g.position.x;
      const dz = focus.z - g.position.z;
      const dist = Math.hypot(dx, dz);
      const target = att.engaged ? Math.atan2(-dx, -dz) : chair.rotationY;
      if (att.snap) {
        g.rotation.y = target;
        return;
      }
      // Engaged: nearer chairs turn first. Released: the far side of the room
      // lets go first, and the chairs nearest the teacher hold on longest.
      const rate = att.engaged
        ? 7 / (1 + dist * 0.45)
        : 0.7 + 1.5 * Math.min(1, dist / 4.5);
      g.rotation.y += angleDelta(g.rotation.y, target) * (1 - Math.exp(-rate * delta));
    });
    att.snap = false;

    pos.needsUpdate = true;
    const want = att.showLines ? 0.4 : 0;
    sightMat.opacity = damp(sightMat.opacity, want, 1 - Math.exp(-(want ? 6 : 2.5) * delta));
    if (lines) lines.visible = sightMat.opacity > 0.01;
  });

  useFrame((_, delta) => {
    const ring = ringRef.current;
    if (reduced || !ring) return;

    const target = explodeRef.current;
    // No-op while fully assembled and settled.
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

    ring.position.y = e * 0.12;

    chairs.forEach((chair, index) => {
      const g = chairRefs.current[index];
      if (!chair || !g) return;
      g.position.x = chair.position[0] + chair.dir[0] * e * 0.9;
      g.position.z = chair.position[2] + chair.dir[1] * e * 0.9;
    });
  });

  return (
    <ActiveGroup active={active}>
      <group ref={ringRef}>
        <group ref={tiltRef} rotation-x={0.105}>
          {attention && (
            <lineSegments
              ref={sightRef}
              geometry={sightGeo}
              material={sightMat}
              visible={false}
              frustumCulled={false}
            />
          )}
          {chairs.map(
            (chair, index) =>
              chair && (
                <group
                  key={chair.key}
                  ref={(node) => {
                    chairRefs.current[index] = node;
                  }}
                  position={chair.position}
                  rotation-y={chair.rotationY}
                >
                  <mesh
                    geometry={seatGeo}
                    material={chair.accent ? accent : plaster}
                    position={[0, 0.34, 0]}
                    castShadow
                    receiveShadow
                  />
                  <mesh
                    geometry={backGeo}
                    material={chair.accent ? accent : plaster}
                    position={[0, 0.76, 0.16]}
                    castShadow
                    receiveShadow
                  />
                </group>
              ),
          )}
        </group>
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
 * plate. The room is modelled here; the other three come from the builders,
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
