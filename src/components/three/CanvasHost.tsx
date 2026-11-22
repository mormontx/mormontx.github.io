import { Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Canvas } from '@react-three/fiber';
import type { ThreeElement } from '@react-three/fiber';
import { SCENE } from '../../data/scene';
import { useInView } from '../../lib/useInView';
import { useReducedMotion } from '../../lib/useReducedMotion';

export type CameraOverride = Omit<
  Partial<ThreeElement<typeof THREE.PerspectiveCamera>>,
  'args'
>;

export interface CanvasHostProps {
  children: ReactNode;
  /** Perspective camera overrides merged over the scene defaults. */
  camera?: CameraOverride;
  className?: string;
  /** Rendered instead of the WebGL canvas when WebGL is unavailable (or motion is reduced). */
  fallback?: ReactNode;
  /** Forces on-demand rendering regardless of viewport state. */
  paused?: boolean;
  /** Called once the WebGL canvas has actually mounted. */
  onCanvasMount?: () => void;
}

/**
 * Reusable WebGL canvas wrapper. Detects WebGL support on mount and falls back
 * to a static plate when unsupported. Pauses the render loop while offscreen,
 * and respects `prefers-reduced-motion` by serving the static fallback.
 * SSR-safe: all browser access happens inside effects.
 */
export default function CanvasHost({
  children,
  camera,
  className,
  fallback = null,
  paused = false,
  onCanvasMount,
}: CanvasHostProps) {
  const reducedMotion = useReducedMotion();
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const { ref, inView } = useInView<HTMLDivElement>();

  useEffect(() => {
    let supported = false;
    try {
      const probe = document.createElement('canvas');
      // three r163+ (including 0.187) requires WebGL2.
      supported = Boolean(probe.getContext('webgl2'));
    } catch {
      supported = false;
    }
    setWebgl(supported);
  }, []);

  const canvasMounted = webgl === true && !reducedMotion;

  useEffect(() => {
    if (canvasMounted) onCanvasMount?.();
  }, [canvasMounted, onCanvasMount]);

  // During SSR, before the probe resolves, when WebGL is unsupported, or when
  // motion is reduced, serve the static plate rather than an empty box.
  const showFallback = webgl !== true || reducedMotion;
  const frameloop = !paused && inView && !reducedMotion ? 'always' : 'demand';

  return (
    <div ref={ref} className={className} aria-hidden="true">
      {showFallback ? (
        fallback
      ) : (
        <Canvas
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true }}
          shadows="soft"
          frameloop={frameloop}
          camera={{
            fov: SCENE.camera.fov,
            near: SCENE.camera.near,
            far: SCENE.camera.far,
            position: SCENE.camera.position,
            ...camera,
          }}
          onCreated={({ gl, scene, camera: activeCamera }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = SCENE.render.toneMappingExposure;
            gl.outputColorSpace = THREE.SRGBColorSpace;

            // A neutral studio environment so mirror-like materials have
            // something to reflect (the monoliths depend on this).
            const pmrem = new THREE.PMREMGenerator(gl);
            const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
            scene.environment = envMap;

            activeCamera.lookAt(
              SCENE.camera.lookAt[0],
              SCENE.camera.lookAt[1],
              SCENE.camera.lookAt[2],
            );
          }}
        >
          <Suspense fallback={null}>{children}</Suspense>
        </Canvas>
      )}
    </div>
  );
}
