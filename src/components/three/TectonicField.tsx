import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { DialecticRoomModel } from './structures/StructureModels';

const DESKTOP_QUERY = '(min-width: 1024px)';
const MODEL_SCALE = 1.25;

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
        <>
          <p className="meta pointer-events-none absolute bottom-4 right-4 lg:hidden">
            MODEL 01 — THE DIALECTIC ROOM
          </p>
          <p className="meta pointer-events-none absolute bottom-4 right-4 hidden lg:block">
            MODEL 01 — THE DIALECTIC ROOM · SCALE 1:50 · N.T.S.
          </p>
        </>
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

    const fadeOut = smoothstep(0.55, 0.82, c.fade);
    gl.domElement.style.opacity = String(1 - fadeOut);
  });

  return (
    <group ref={group} scale={MODEL_SCALE}>
      <DialecticRoomModel active={false} />
    </group>
  );
}
