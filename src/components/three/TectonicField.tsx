import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import CanvasHost from './CanvasHost';
import {
  ContactShadow,
  PaperGround,
  SceneFog,
  StudioLights,
} from './SceneKit';
import SceneFallback from './SceneFallback';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { useScrollOutProgress } from '../../lib/useScrollOutProgress';
import { damp } from '../../lib/useScrollProgress';
import { fitCamera } from '../../lib/cameraFit';
import { DialecticRoomModel, type RoomAttention } from './structures/StructureModels';
import { SCENE } from '../../data/scene';

const DESKTOP_QUERY = '(min-width: 1024px)';
const MODEL_SCALE = 1.25;

/** How long the room keeps watching after the cursor stops (ms). */
const HOLD_MOUSE = 1400;
/** A tap holds the room's attention a little longer (ms). */
const HOLD_TOUCH = 2200;
/** Opening beat: chairs face the front like rows, then turn inward (ms). */
const INTRO_MS = 1800;
/** Furthest the teacher can stand from the ring's centre (world units). */
const MAX_REACH = 9;

const HERO_CAMERA = {
  lookAt: [0, 0.6, 0] as [number, number, number],
  downAngleDeg: 22,
  azimuthDeg: 30,
  fitRatio: 0.8,
  verticalExtent: 1.6,
  horizontalExtent: 2.95,
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * A single large Dialectic Room model on the paper ground. The ring idles on
 * a slow rotation and dolls in with scroll; both are damped and gated on
 * reduced motion. No per-frame allocations.
 *
 * The cursor (or a tap) is the teacher: while it moves, the chairs turn to
 * face it; once it stops, they turn back to face each other.
 */
export default function TectonicField() {
  const { ref, progress } = useScrollOutProgress<HTMLDivElement>();
  const [desktop, setDesktop] = useState(false);
  const [canvasMounted, setCanvasMounted] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return (
    <div ref={ref} className="relative h-full w-full">
      <div className="hero-canvas-mask absolute inset-0">
        <CanvasHost
          className="h-full w-full"
          fallback={<SceneFallback />}
          onCanvasMount={() => setCanvasMounted(true)}
        >
          <StudioLights />
          <PaperGround />
          <ContactShadow
            radius={2.7}
            scale={[1.25, 0.95, 1]}
            opacity={0.7}
          />
          <SceneFog />
          <HeroRing progress={desktop ? progress : 0} />
        </CanvasHost>
      </div>

      {canvasMounted && (
        <div className="pointer-events-none absolute bottom-4 right-4 text-right">
          <p className="meta text-accent">
            <span className="lg:hidden">Tap to teach · wait to listen</span>
            <span className="hidden lg:inline">Move to teach · stop to listen</span>
          </p>
          <p className="meta mt-1 lg:hidden">MODEL 01 — THE DIALECTIC ROOM</p>
          <p className="meta mt-1 hidden lg:block">
            MODEL 01 — THE DIALECTIC ROOM · SCALE 1:50 · N.T.S.
          </p>
        </div>
      )}
    </div>
  );
}

function HeroRing({ progress }: { progress: number }) {
  const reducedMotion = useReducedMotion();
  const group = useRef<THREE.Group>(null);
  const camera = useThree(
    (state) => state.camera,
  ) as THREE.PerspectiveCamera;
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const aspect = size.width / Math.max(1, size.height);

  const base = useRef<{ x: number; y: number; z: number } | null>(null);

  // --- the teacher: pointer state, projected onto the ground each frame ---
  const attention = useRef<RoomAttention>({ x: 0, z: 0, engaged: true, snap: true });
  const pointer = useRef({ x: 0, y: 0, at: -Infinity, hold: HOLD_MOUSE });
  const introUntil = useRef(0);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const marker = useRef<THREE.Group>(null);
  const markerMaterial = useMemo(
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

  useEffect(() => {
    if (reducedMotion) return;
    const hero = gl.domElement.closest('section') ?? gl.domElement;
    const inside = (e: PointerEvent) => {
      const r = hero.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return; // touch scrolls; a tap is handled below
      if (!inside(e)) {
        pointer.current.at = -Infinity; // left the hero: let the room go
        return;
      }
      pointer.current = { x: e.clientX, y: e.clientY, at: performance.now(), hold: HOLD_MOUSE };
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !inside(e)) return;
      pointer.current = { x: e.clientX, y: e.clientY, at: performance.now(), hold: HOLD_TOUCH };
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [gl, reducedMotion]);

  useEffect(() => () => markerMaterial.dispose(), [markerMaterial]);
  const current = useRef({ camZ: 0, camY: 0, rotY: 0, spread: 0, fade: 0 });
  const idle = useRef(0);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  const { lookAt, downAngleDeg, azimuthDeg, fitRatio, verticalExtent, horizontalExtent } =
    HERO_CAMERA;
  const lookX = lookAt[0];
  const lookY = lookAt[1];
  const lookZ = lookAt[2];

  useLayoutEffect(() => {
    const result = fitCamera({
      aspect,
      fov: camera.fov,
      verticalExtent,
      horizontalExtent,
      fitRatio,
      downAngleDeg,
      azimuthDeg,
      lookAt: [lookX, lookY, lookZ],
    });

    camera.position.set(
      result.position[0],
      result.position[1],
      result.position[2],
    );
    camera.lookAt(lookX, lookY, lookZ);

    base.current = {
      x: result.position[0],
      y: result.position[1],
      z: result.position[2],
    };

    // Opening beat: the chairs start out facing the front of the room — the
    // viewer's side, like rows — then turn inward once the intro ends.
    if (introUntil.current === 0) {
      const len = Math.hypot(result.position[0], result.position[2]) || 1;
      attention.current = {
        x: (result.position[0] / len) * 6,
        z: (result.position[2] / len) * 6,
        engaged: true,
        snap: true,
      };
      introUntil.current = performance.now() + INTRO_MS;
    }
    current.current = { camZ: 0, camY: 0, rotY: 0, spread: 0, fade: 0 };
  }, [
    aspect,
    azimuthDeg,
    camera,
    downAngleDeg,
    fitRatio,
    horizontalExtent,
    lookX,
    lookY,
    lookZ,
    verticalExtent,
  ]);

  useFrame((_, delta) => {
    const g = group.current;
    const b = base.current;
    if (reducedMotion || !g || !b) return;

    const c = current.current;
    const lambda = 1 - Math.exp(-6 * delta);
    const target = progressRef.current;

    if (!reducedMotion) {
      idle.current += delta * 0.04;
    }

    c.fade = damp(c.fade, target, lambda);
    c.camZ = damp(c.camZ, 2.5 - 5.0 * target, lambda);
    c.camY = damp(c.camY, 0.25 * target, lambda);
    c.rotY = damp(c.rotY, 0.12 * target, lambda);
    c.spread = damp(c.spread, 1 + 0.03 * target, lambda);

    camera.position.x = b.x;
    camera.position.y = b.y + c.camY;
    camera.position.z = b.z + c.camZ;
    camera.lookAt(lookX, lookY + c.camY * 0.5, lookZ);

    g.rotation.y = idle.current + c.rotY;
    g.scale.setScalar(c.spread);

    // The teacher: follow the pointer while it is active, else let go.
    const now = performance.now();
    const p = pointer.current;
    const att = attention.current;
    const teaching = now - p.at < p.hold;
    if (teaching) {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(
        ((p.x - rect.left) / rect.width) * 2 - 1,
        -((p.y - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      // Above the horizon the ray never meets the floor: keep the last spot.
      if (ray.ray.intersectPlane(ground, hit)) {
        const reach = Math.hypot(hit.x, hit.z);
        const k = reach > MAX_REACH ? MAX_REACH / reach : 1;
        att.x = hit.x * k;
        att.z = hit.z * k;
      }
      att.engaged = true;
      att.showLines = true;
    } else {
      att.engaged = now < introUntil.current;
      att.showLines = false;
    }

    const m = marker.current;
    if (m) {
      m.position.set(att.x, 0.012, att.z);
      const show = teaching ? 0.9 : 0;
      markerMaterial.opacity = damp(markerMaterial.opacity, show, 1 - Math.exp(-8 * delta));
      m.visible = markerMaterial.opacity > 0.01;
    }

    const fadeOut = smoothstep(0.55, 0.82, c.fade);
    gl.domElement.style.opacity = String(1 - fadeOut);
  });

  return (
    <>
      <group ref={group} scale={MODEL_SCALE}>
        <DialecticRoomModel active={false} attention={attention} />
      </group>
      {/* Where the teacher stands: a drafting mark on the floor. */}
      <group ref={marker} rotation-x={-Math.PI / 2} visible={false}>
        <mesh material={markerMaterial}>
          <ringGeometry args={[0.2, 0.225, 48]} />
        </mesh>
        <mesh material={markerMaterial}>
          <planeGeometry args={[0.7, 0.014]} />
        </mesh>
        <mesh material={markerMaterial} rotation-z={Math.PI / 2}>
          <planeGeometry args={[0.7, 0.014]} />
        </mesh>
      </group>
    </>
  );
}
