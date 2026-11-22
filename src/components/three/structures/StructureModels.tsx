import { useEffect, useMemo, useRef } from 'react';
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
  attention?: React.MutableRefObject<RoomAttention>;
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
/* 02 — The Unstable Prompt                                           */
/* ------------------------------------------------------------------ */

export function UnstablePromptModel({
  active = false,
  progress = 0,
  explode = 0,
}: {
  active?: boolean;
  progress?: number;
  explode?: number;
}) {
  const { plaster, accent } = getShared();
  const plateGeo = useMemo(() => new THREE.BoxGeometry(1.9, 0.1, 1.05), []);
  const jointGeo = useMemo(() => new THREE.BoxGeometry(1.94, 0.018, 1.08), []);

  const plates = [0, 0.025, 0.05, 0.075, 0.14];

  const tipRef = useRef<THREE.Group>(null);
  const plateRefs = useRef<Array<THREE.Group | null>>([]);
  const jointRef = useRef<THREE.Mesh>(null);
  const reduced = useReducedMotion();
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const explodeRef = useRef(explode);
  explodeRef.current = explode;
  const explodeAnim = useRef(0);

  useFrame((_, delta) => {
    const group = tipRef.current;
    if (reduced || !group) return;
    const lambda = frameLambda(delta);
    // `progress` can tip the whole stack an extra 2°.
    group.rotation.z = damp(
      group.rotation.z,
      progressRef.current * 0.035,
      lambda,
    );

    const target = explodeRef.current;
    if (target === 0 && explodeAnim.current === 0) return;

    explodeAnim.current = damp(explodeAnim.current, target, lambda);
    if (target === 0 && Math.abs(explodeAnim.current) < 0.0005) {
      explodeAnim.current = 0;
    }
    const e = explodeAnim.current;

    for (let index = 0; index < plates.length; index += 1) {
      const plate = plateRefs.current[index];
      if (!plate) continue;
      plate.position.x = index * 0.16 - 0.32 + index * 0.25 * e;
      plate.position.y = index * 0.17 + 0.05 + index * 0.5 * e;
    }

    const joint = jointRef.current;
    if (joint) {
      // The critical joint belongs to plate 3 and detaches with it.
      joint.position.x = 3 * 0.16 - 0.32 + 3 * 0.25 * e;
      joint.position.y = 3 * 0.17 + 0.1 + 3 * 0.5 * e;
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
            position={[index * 0.16 - 0.32, index * 0.17 + 0.05, 0]}
            rotation-z={lean}
          >
            <mesh geometry={plateGeo} material={plaster} castShadow receiveShadow>
              <Edges threshold={20} color={SCENE.palette.ink} />
            </mesh>
          </group>
        ))}
        {/* critical joint marker */}
        <mesh
          ref={jointRef}
          geometry={jointGeo}
          material={accent}
          position={[3 * 0.16 - 0.32, 3 * 0.17 + 0.1, 0]}
          rotation-z={0.075}
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
    horizontalExtent: 1.2,
    shadowRadius: 1.9,
    shadowScale: [1.3, 0.9, 1],
  },
  3: {
    // Members are 2.6 tall (y 0 → 2.6); frame the full height plus headroom so
    // the tops are never cropped in the archive plate.
    lookAt: [0, 1.15, 0],
    downAngleDeg: 11,
    verticalExtent: 1.7,
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
