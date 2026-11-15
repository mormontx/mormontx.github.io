import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type RefObject,
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { SCENE, type Vec3 } from '../../data/scene';
import { fitCamera, type FitCameraResult } from '../../lib/cameraFit';
import { damp } from '../../lib/useScrollProgress';
import { useReducedMotion } from '../../lib/useReducedMotion';
import CanvasHost from './CanvasHost';
import {
  ContactShadow,
  PaperGround,
  StudioLights,
} from './SceneKit';
import {
  DialecticRoomModel,
  MarginaliaDialogueModel,
  MODEL_CONFIG,
  ScaffoldingSilenceModel,
  UnstablePromptModel,
} from './structures/StructureModels';

const pad = (n: number) => String(n).padStart(2, '0');

const SR_DESCRIPTIONS: Record<number, string> = {
  1: 'Interactive three-dimensional model of The Dialectic Room: eighteen chairs in a ring with one empty seat. Use the Exploded view button to separate the chairs.',
  2: 'Interactive three-dimensional model of The Unstable Prompt: five stacked plates with a marked critical joint. Use the Exploded view button to separate the plates.',
  3: 'Interactive three-dimensional model of Scaffolding Silence: a grid of posts around a missing centre member. Use the Exploded view button to lift and splay the posts.',
  4: 'Interactive three-dimensional model of Marginalia as Dialogue: a central page with six margin sheets connected by hairlines. Use the Exploded view button to lift the sheets away from the page.',
};

interface StructureViewerProps {
  number: number;
  title: string;
  sketch?: string;
}

interface ViewerApi {
  reset: () => void;
}

interface Framing {
  center: Vec3;
  verticalExtent: number;
  horizontalExtent: number;
}

interface ViewerFraming {
  assembled: Framing;
  exploded: Framing;
}

const FOV = 32;
const FIT_RATIO = 0.65;
const DOWN_ANGLE_DEG = 21;
const AZIMUTH_DEG = 30;
const FOG_NEAR = 22;
const FOG_FAR = 80;

/**
 * Per-model framing boxes (half-extents around `center`, world units).
 * `horizontalExtent` is the projected half-width at the 30° azimuth so the
 * wide-format camera does not over-pad. The assembled box fills ~65% of the
 * binding axis; the exploded box is what the camera dollies out to on toggle.
 */
const VIEWER_FRAMING: Record<number, ViewerFraming> = {
  1: {
    assembled: { center: [0, 0.05, 0], verticalExtent: 0.6, horizontalExtent: 2.6 },
    exploded: { center: [0, 0.1, 0], verticalExtent: 0.65, horizontalExtent: 3.5 },
  },
  2: {
    assembled: { center: [-0.15, 0.05, 0], verticalExtent: 0.55, horizontalExtent: 1.4 },
    exploded: { center: [-0.15, 1.0, 0], verticalExtent: 1.6, horizontalExtent: 2.3 },
  },
  3: {
    assembled: { center: [0, 1.1, 0], verticalExtent: 1.7, horizontalExtent: 1.4 },
    exploded: { center: [0, 1.55, 0], verticalExtent: 1.8, horizontalExtent: 1.7 },
  },
  4: {
    assembled: { center: [0, -0.05, 0], verticalExtent: 0.25, horizontalExtent: 2.0 },
    exploded: { center: [0, 0.3, 0], verticalExtent: 0.55, horizontalExtent: 2.7 },
  },
};

type ViewerFit = FitCameraResult & { center: Vec3 };

/** Mirrors CanvasHost's probe so the chrome can hide interactive controls. */
function useWebGL2(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    let value = false;
    try {
      const probe = document.createElement('canvas');
      value = Boolean(probe.getContext('webgl2'));
    } catch {
      value = false;
    }
    setSupported(value);
  }, []);

  return supported;
}

function CameraRig({
  framing,
  exploded,
  idle,
  apiRef,
}: {
  framing: ViewerFraming;
  exploded: boolean;
  idle: boolean;
  apiRef: RefObject<ViewerApi | null>;
}) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const events = useThree((state) => state.events);
  const gl = useThree((state) => state.gl);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls> | null>(null);
  const fits = useRef<{ assembled: ViewerFit; exploded: ViewerFit } | null>(
    null,
  );
  const dollyRef = useRef(false);
  const explodedRef = useRef(exploded);
  explodedRef.current = exploded;
  const mounted = useRef(false);
  const [bounds, setBounds] = useState<{ min: number; max: number } | null>(
    null,
  );

  // Compute both framings once from the initial aspect; never refit on resize.
  useLayoutEffect(() => {
    if (fits.current || size.width === 0 || size.height === 0) return;
    const aspect = size.width / size.height;

    const fitOne = (f: Framing): ViewerFit => {
      const result = fitCamera({
        aspect,
        fov: FOV,
        verticalExtent: f.verticalExtent,
        horizontalExtent: f.horizontalExtent,
        fitRatio: FIT_RATIO,
        downAngleDeg: DOWN_ANGLE_DEG,
        azimuthDeg: AZIMUTH_DEG,
        lookAt: f.center,
      });
      return { ...result, center: f.center };
    };

    const assembled = fitOne(framing.assembled);
    const exploded = fitOne(framing.exploded);
    fits.current = { assembled, exploded };

    camera.position.set(
      assembled.position[0],
      assembled.position[1],
      assembled.position[2],
    );
    camera.lookAt(
      assembled.center[0],
      assembled.center[1],
      assembled.center[2],
    );

    setBounds({
      min: assembled.distance * 0.6,
      max: exploded.distance * 1.8,
    });
  }, [camera, framing, size.width, size.height]);

  // Trigger a dolly whenever the explode toggle flips (not on first mount).
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    dollyRef.current = true;
  }, [exploded]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    const f = fits.current;
    if (!controls || !f || !dollyRef.current) return;

    const target = explodedRef.current ? f.exploded : f.assembled;
    const lambda = 1 - Math.exp(-6 * delta); // ~400ms settle

    controls.target.x = damp(controls.target.x, target.center[0], lambda);
    controls.target.y = damp(controls.target.y, target.center[1], lambda);
    controls.target.z = damp(controls.target.z, target.center[2], lambda);

    const dx = camera.position.x - controls.target.x;
    const dy = camera.position.y - controls.target.y;
    const dz = camera.position.z - controls.target.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const next = damp(dist, target.distance, lambda);
    const scale = next / (dist || 0.0001);
    camera.position.x = controls.target.x + dx * scale;
    camera.position.y = controls.target.y + dy * scale;
    camera.position.z = controls.target.z + dz * scale;

    if (Math.abs(dist - target.distance) < target.distance * 0.01) {
      dollyRef.current = false;
    }
  });

  useEffect(() => {
    apiRef.current = {
      reset: () => {
        const controls = controlsRef.current;
        const f = fits.current;
        if (!controls || !f) return;
        const target = explodedRef.current ? f.exploded : f.assembled;
        camera.position.set(
          target.position[0],
          target.position[1],
          target.position[2],
        );
        controls.target.set(target.center[0], target.center[1], target.center[2]);
        controls.update();
        dollyRef.current = false;
      },
    };

    return () => {
      apiRef.current = null;
    };
  }, [apiRef, camera]);

  // OrbitControls sets touch-action: none on the r3f element; restore pan-y so
  // a vertical swipe scrolls the page while horizontal drags still orbit.
  useEffect(() => {
    const dom = events.connected;
    if (dom instanceof HTMLElement) {
      dom.style.touchAction = 'pan-y';
    }
    gl.domElement.style.touchAction = 'pan-y';
  }, [events, gl]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={framing.assembled.center}
      enablePan={false}
      enableDamping
      dampingFactor={0.075}
      rotateSpeed={0.65}
      minDistance={bounds ? bounds.min : 0.1}
      maxDistance={bounds ? bounds.max : 100}
      minPolarAngle={0.45}
      maxPolarAngle={1.25}
      autoRotate={idle}
      autoRotateSpeed={3.35}
    />
  );
}

function StructureViewerFallback({
  number,
  title,
  sketch,
}: {
  number: number;
  title: string;
  sketch?: string;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center p-5 sm:p-8">
      <div className="relative flex h-full w-full max-w-3xl items-center justify-center overflow-hidden border border-hairline bg-paper">
        {sketch ? (
          <img
            src={sketch}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-[0.08]"
          />
        ) : null}
        <p
          aria-hidden="true"
          className="pointer-events-none select-none font-mono leading-none text-ink/[0.06]"
          style={{ fontSize: 'clamp(3rem, 11vw, 8rem)', letterSpacing: '0.14em' }}
        >
          MODEL {pad(number)}
        </p>
        <div className="absolute inset-x-0 bottom-0 px-6 pb-6 text-center">
          <p className="font-display text-2xl text-ink sm:text-3xl">{title}</p>
          <p className="meta mt-2">STATIC FRAME · USE THE PLATES BELOW</p>
        </div>
      </div>
    </div>
  );
}

export default function StructureViewer({
  number,
  title,
  sketch,
}: StructureViewerProps) {
  const reduced = useReducedMotion();
  const webgl = useWebGL2();
  const config = MODEL_CONFIG[number] ?? MODEL_CONFIG[1];
  const framing = VIEWER_FRAMING[number] ?? VIEWER_FRAMING[1];
  const apiRef = useRef<ViewerApi | null>(null);
  const idleRef = useRef(true);
  const [idle, setIdle] = useState(true);
  const [exploded, setExploded] = useState(false);
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const stopIdle = useCallback(() => {
    if (idleRef.current) {
      idleRef.current = false;
      setIdle(false);
    }
  }, []);

  const handleExplode = useCallback(() => {
    setExploded((value) => !value);
  }, []);

  const handleReset = useCallback(() => {
    apiRef.current?.reset();
  }, []);

  const interactive = webgl === true && !reduced;
  const explodeValue = exploded ? 1 : 0;

  const model = useMemo(() => {
    switch (number) {
      case 1:
        return <DialecticRoomModel explode={explodeValue} />;
      case 2:
        return <UnstablePromptModel explode={explodeValue} />;
      case 3:
        return <ScaffoldingSilenceModel explode={explodeValue} />;
      default:
        return <MarginaliaDialogueModel explode={explodeValue} />;
    }
  }, [number, explodeValue]);

  return (
    <div className="border border-hairline bg-paper" data-structure-viewer>
      <div
        className="relative h-[46vh] min-h-[320px] lg:h-[clamp(380px,52vh,560px)]"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={stopIdle}
        onWheel={stopIdle}
      >
        <CanvasHost
          className="h-full w-full"
          camera={{ fov: FOV }}
          fallback={
            <StructureViewerFallback
              number={number}
              title={title}
              sketch={sketch}
            />
          }
        >
          <StudioLights />
          <PaperGround />
          <ContactShadow
            radius={config.shadowRadius}
            scale={config.shadowScale}
            opacity={0.6}
          />
          {/* Viewer-specific fog: longer range so the far edge stays crisp. */}
          <fog attach="fog" args={[SCENE.fog.color, FOG_NEAR, FOG_FAR]} />
          <CameraRig
            framing={framing}
            exploded={exploded}
            idle={idle && interactive}
            apiRef={apiRef}
          />
          {model}
        </CanvasHost>
      </div>

      <footer className="border-t border-hairline px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="meta min-w-0 text-accent">
            MODEL {pad(number)} — {title.toUpperCase()}
          </p>
          {interactive ? (
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:shrink-0">
              <button
                type="button"
                aria-pressed={exploded}
                onClick={handleExplode}
                className="meta inline-flex min-h-[44px] items-center border border-hairline px-3 py-2 transition-colors hover:border-accent hover:text-accent"
              >
                {exploded ? 'ASSEMBLED VIEW' : 'EXPLODED VIEW'}
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="meta inline-flex min-h-[44px] items-center border border-hairline px-3 py-2 transition-colors hover:border-accent hover:text-accent"
              >
                RESET VIEW
              </button>
              <span className="meta whitespace-nowrap">
                {coarse
                  ? 'DRAG TO ORBIT · PINCH TO ZOOM'
                  : 'DRAG TO ORBIT · SCROLL TO ZOOM'}
              </span>
            </div>
          ) : null}
        </div>
      </footer>

      <p className="sr-only">
        {SR_DESCRIPTIONS[number] ??
          `Interactive three-dimensional model of ${title}. Use the Exploded view button to separate the parts.`}
      </p>
    </div>
  );
}
