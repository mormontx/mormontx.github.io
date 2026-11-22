import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ComponentType,
  type RefObject,
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { SCENE } from '../../data/scene';
import { fitCamera, type FitCameraResult } from '../../lib/cameraFit';
import { damp } from '../../lib/useScrollProgress';
import { useReducedMotion } from '../../lib/useReducedMotion';
import CanvasHost from './CanvasHost';
import { ContactShadow, PaperGround, StudioLights } from './SceneKit';
import { DialecticRoomModel, MODEL_CONFIG } from './structures/StructureModels';
import { useBuild, type BuildSpec, type Framing } from './builders/kit';
import { BUILDS } from './builders';

const pad = (n: number) => String(n).padStart(2, '0');

const SR_DESCRIPTIONS: Record<number, string> = {
  1: 'Interactive three-dimensional model of The Dialectic Room: eighteen chairs in a ring with one empty seat. Use the Exploded view button to separate the chairs.',
  2: 'Interactive model of The Unstable Prompt as a frame. Raise a question to add an unbraced storey; pose a challenge to push on the top, and the lowest unbraced storey buckles before the cohort braces it. The status line below describes each change.',
  3: 'Interactive model of Scaffolding Silence as a scaffold around an empty centre. Raise a question and the next lift goes up only while the silence holds; when a silence is held, an idea rises through the centre. Filling the silence leaves the lift untied, and a challenge shakes untied parts loose. The status line below describes each change.',
  4: 'Interactive model of Marginalia as Dialogue as a bridge across a margin. Each question builds a segment out from the teacher’s bank and each reply builds one back from the student’s, until they meet. A challenge loads the bridge: open half-spans sag, a closed span carries it. The status line below describes each change.',
};

interface StructureViewerProps {
  number: number;
  title: string;
  sketch?: string;
}

interface ViewerApi {
  reset: () => void;
}

const FOV = 32;
const FIT_RATIO = 0.65;
const DOWN_ANGLE_DEG = 21;
const AZIMUTH_DEG = 30;
const FOG_NEAR = 22;
const FOG_FAR = 80;

/** The Dialectic Room's two framings: assembled, and with the ring pulled apart. */
const ROOM_FRAMING: { assembled: Framing; exploded: Framing } = {
  assembled: { center: [0, 0.05, 0], verticalExtent: 0.6, horizontalExtent: 2.6 },
  exploded: { center: [0, 0.1, 0], verticalExtent: 0.65, horizontalExtent: 3.5 },
};

type ViewerFit = FitCameraResult & { center: Framing['center'] };

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

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return coarse;
}

/**
 * Orbit camera that frames `target`. When the target changes (the room is
 * exploded, or a structure grows) the camera dollies to the new fit along its
 * current direction, so the visitor's orbit angle is kept.
 */
function CameraRig({
  target,
  idle,
  apiRef,
}: {
  target: Framing;
  idle: boolean;
  apiRef: RefObject<ViewerApi | null>;
}) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const events = useThree((state) => state.events);
  const gl = useThree((state) => state.gl);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls> | null>(null);
  const fitRef = useRef<ViewerFit | null>(null);
  const dollyRef = useRef(false);
  const [initialCenter] = useState(target.center);
  const [bounds, setBounds] = useState<{ min: number; max: number } | null>(null);
  const ready = size.width > 0 && size.height > 0;
  const key = `${target.center.join(',')}|${target.verticalExtent}|${target.horizontalExtent}|${target.fitRatio}`;

  useLayoutEffect(() => {
    if (!ready) return;
    const result = fitCamera({
      aspect: size.width / size.height,
      fov: FOV,
      verticalExtent: target.verticalExtent,
      horizontalExtent: target.horizontalExtent,
      fitRatio: target.fitRatio ?? FIT_RATIO,
      downAngleDeg: DOWN_ANGLE_DEG,
      azimuthDeg: AZIMUTH_DEG,
      lookAt: target.center,
    });
    const fit = { ...result, center: target.center };
    const first = fitRef.current == null;
    fitRef.current = fit;
    if (first) {
      camera.position.set(fit.position[0], fit.position[1], fit.position[2]);
      camera.lookAt(fit.center[0], fit.center[1], fit.center[2]);
      setBounds({ min: fit.distance * 0.6, max: fit.distance * 2.6 });
    } else {
      dollyRef.current = true;
      setBounds((b) =>
        b ? { min: Math.min(b.min, fit.distance * 0.6), max: Math.max(b.max, fit.distance * 1.8) } : b,
      );
    }
    // Refit only when the framing changes, never on resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, camera]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    const fit = fitRef.current;
    if (!controls || !fit || !dollyRef.current) return;

    const lambda = 1 - Math.exp(-4 * delta);
    controls.target.x = damp(controls.target.x, fit.center[0], lambda);
    controls.target.y = damp(controls.target.y, fit.center[1], lambda);
    controls.target.z = damp(controls.target.z, fit.center[2], lambda);

    const dx = camera.position.x - controls.target.x;
    const dy = camera.position.y - controls.target.y;
    const dz = camera.position.z - controls.target.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const next = damp(dist, fit.distance, lambda);
    const scale = next / (dist || 0.0001);
    camera.position.x = controls.target.x + dx * scale;
    camera.position.y = controls.target.y + dy * scale;
    camera.position.z = controls.target.z + dz * scale;

    const centred =
      Math.abs(controls.target.y - fit.center[1]) < 0.01 && Math.abs(controls.target.x - fit.center[0]) < 0.01;
    if (centred && Math.abs(dist - fit.distance) < fit.distance * 0.01) {
      dollyRef.current = false;
    }
  });

  useEffect(() => {
    apiRef.current = {
      reset: () => {
        const controls = controlsRef.current;
        const fit = fitRef.current;
        if (!controls || !fit) return;
        camera.position.set(fit.position[0], fit.position[1], fit.position[2]);
        controls.target.set(fit.center[0], fit.center[1], fit.center[2]);
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
    if (dom instanceof HTMLElement) dom.style.touchAction = 'pan-y';
    gl.domElement.style.touchAction = 'pan-y';
  }, [events, gl]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={initialCenter}
      enablePan={false}
      enableDamping
      dampingFactor={0.075}
      rotateSpeed={0.65}
      minDistance={bounds ? bounds.min : 0.1}
      maxDistance={bounds ? bounds.max : 100}
      minPolarAngle={0.45}
      maxPolarAngle={1.25}
      autoRotate={idle}
      autoRotateSpeed={2.2}
    />
  );
}

function StructureViewerFallback({ number, title, sketch }: StructureViewerProps) {
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

const BUTTON =
  'meta inline-flex min-h-[44px] items-center border px-3 py-2 transition-colors hover:border-accent hover:text-accent';

/** The canvas, lights and orbit camera shared by both kinds of viewer. */
function Stage({
  number,
  title,
  sketch,
  target,
  idle,
  apiRef,
  onInteract,
  overlay,
  children,
}: StructureViewerProps & {
  target: Framing;
  idle: boolean;
  apiRef: RefObject<ViewerApi | null>;
  onInteract: () => void;
  /** Page-level UI laid over the drawing (outside the aria-hidden canvas). */
  overlay?: React.ReactNode;
  children: React.ReactNode;
}) {
  const config = MODEL_CONFIG[number] ?? MODEL_CONFIG[1];
  return (
    <div
      className="relative h-[46vh] min-h-[320px] lg:h-[clamp(380px,52vh,560px)]"
      style={{ touchAction: 'pan-y' }}
      onPointerDown={onInteract}
      onWheel={onInteract}
    >
      <CanvasHost
        className="h-full w-full"
        camera={{ fov: FOV }}
        fallback={<StructureViewerFallback number={number} title={title} sketch={sketch} />}
      >
        <StudioLights />
        <PaperGround />
        <ContactShadow radius={config.shadowRadius} scale={config.shadowScale} opacity={0.6} />
        {/* Viewer-specific fog: longer range so the far edge stays crisp. */}
        <fog attach="fog" args={[SCENE.fog.color, FOG_NEAR, FOG_FAR]} />
        <CameraRig target={target} idle={idle} apiRef={apiRef} />
        {children}
      </CanvasHost>
      {overlay}
    </div>
  );
}

function useIdle() {
  const ref = useRef(true);
  const [idle, setIdle] = useState(true);
  const stop = useCallback(() => {
    if (ref.current) {
      ref.current = false;
      setIdle(false);
    }
  }, []);
  return [idle, stop] as const;
}

/* ------------------------------------------------------------------ */
/* 01: the room, assembled or exploded                                */
/* ------------------------------------------------------------------ */

function RoomViewer({ number, title, sketch }: StructureViewerProps) {
  const reduced = useReducedMotion();
  const webgl = useWebGL2();
  const coarse = useCoarsePointer();
  const apiRef = useRef<ViewerApi | null>(null);
  const [idle, stopIdle] = useIdle();
  const [exploded, setExploded] = useState(false);
  const interactive = webgl === true && !reduced;

  return (
    <div className="border border-hairline bg-paper" data-structure-viewer>
      <Stage
        number={number}
        title={title}
        sketch={sketch}
        target={exploded ? ROOM_FRAMING.exploded : ROOM_FRAMING.assembled}
        idle={idle && interactive}
        apiRef={apiRef}
        onInteract={stopIdle}
      >
        <DialecticRoomModel explode={exploded ? 1 : 0} />
      </Stage>

      <footer className="border-t border-hairline px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="meta min-w-0 text-accent">
            MODEL {pad(number)} — {title.toUpperCase()}
          </p>
          {interactive ? (
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">
              <button
                type="button"
                aria-pressed={exploded}
                onClick={() => setExploded((v) => !v)}
                className={`${BUTTON} border-hairline`}
              >
                {exploded ? 'ASSEMBLED VIEW' : 'EXPLODED VIEW'}
              </button>
              <button type="button" onClick={() => apiRef.current?.reset()} className={`${BUTTON} border-hairline`}>
                RESET VIEW
              </button>
              <span className="meta whitespace-nowrap">
                {coarse ? 'DRAG TO ORBIT · PINCH TO ZOOM' : 'DRAG TO ORBIT · SCROLL TO ZOOM'}
              </span>
            </div>
          ) : null}
        </div>
      </footer>

      <p className="sr-only">{SR_DESCRIPTIONS[number]}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 02–04: structures built by raising questions and meeting challenges */
/* ------------------------------------------------------------------ */

function BuildViewer<S>({
  number,
  title,
  sketch,
  spec,
  Model,
}: StructureViewerProps & { spec: BuildSpec<S>; Model: ComponentType<{ state: S }> }) {
  const reduced = useReducedMotion();
  const webgl = useWebGL2();
  const coarse = useCoarsePointer();
  const apiRef = useRef<ViewerApi | null>(null);
  const [idle, stopIdle] = useIdle();
  const build = useBuild(spec);
  const view = spec.view(build.state);
  const framing = spec.framing(build.state);
  const interactive = webgl === true && !reduced;

  const act = (fn: () => void, inert: boolean) => () => {
    if (inert) return;
    stopIdle();
    fn();
  };

  return (
    <div className="border border-hairline bg-paper" data-structure-viewer data-build={number}>
      <Stage
        number={number}
        title={title}
        sketch={sketch}
        target={framing}
        idle={idle && interactive}
        apiRef={apiRef}
        onInteract={stopIdle}
        overlay={
          interactive ? (
            <>
              <p
                className="pointer-events-none absolute left-4 top-4 hidden max-w-[24rem] font-serif text-base italic leading-snug text-mute sm:block lg:left-5 lg:top-5"
                aria-hidden="true"
              >
                {view.note}
              </p>
              <div className="absolute inset-x-3 bottom-3 flex gap-2 sm:inset-x-auto sm:left-4 sm:bottom-4 lg:left-5 lg:bottom-5">
                <button
                  type="button"
                  aria-disabled={view.question.inert}
                  onClick={act(build.question, view.question.inert)}
                  className={`${BUTTON} justify-center border-accent bg-paper/90 text-accent backdrop-blur-sm aria-disabled:cursor-default aria-disabled:opacity-60 max-sm:flex-1`}
                  data-build-act="question"
                >
                  {view.question.label}
                </button>
                <button
                  type="button"
                  aria-disabled={view.challenge.inert}
                  onClick={act(build.challenge, view.challenge.inert)}
                  className={`${BUTTON} justify-center border-ink/40 bg-paper/90 text-ink backdrop-blur-sm aria-disabled:cursor-default aria-disabled:opacity-60 max-sm:flex-1`}
                  data-build-act="challenge"
                >
                  {view.challenge.label}
                </button>
              </div>
            </>
          ) : null
        }
      >
        <Model state={build.state} />
      </Stage>

      <footer className="border-t border-hairline px-4 py-4 sm:px-5">
        {interactive ? (
          <>
            {/* The live caption: drawn over the model on wider screens. */}
            <p className="max-w-[62ch] font-serif text-base italic text-mute sm:sr-only" aria-live="polite" data-build-note>
              {view.note}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 sm:mt-0">
              <dl className="flex flex-wrap gap-x-6 gap-y-1">
                {view.stats.map(([label, value]) => (
                  <div key={label} className="flex items-baseline gap-2">
                    <dt className="meta">{label}</dt>
                    <dd className="font-mono text-sm tabular-nums text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="-mx-3 flex items-center">
                <button type="button" onClick={build.reset} className={`${BUTTON} border-transparent`} data-build-act="reset">
                  Start over
                </button>
                <button type="button" onClick={() => apiRef.current?.reset()} className={`${BUTTON} border-transparent`}>
                  Reset view
                </button>
              </div>
            </div>
          </>
        ) : null}
        <div
          className={`flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between ${
            interactive ? 'mt-4 border-t border-hairline pt-3' : ''
          }`}
        >
          <p className="meta min-w-0 text-accent">
            MODEL {pad(number)} — {title.toUpperCase()}
          </p>
          {interactive ? (
            <span className="meta whitespace-nowrap">
              {coarse ? 'DRAG TO ORBIT · PINCH TO ZOOM' : 'DRAG TO ORBIT · SCROLL TO ZOOM'}
            </span>
          ) : null}
        </div>
      </footer>

      <p className="sr-only">{SR_DESCRIPTIONS[number]}</p>
    </div>
  );
}

export default function StructureViewer(props: StructureViewerProps) {
  const build = useMemo(() => BUILDS[props.number], [props.number]);
  if (!build) return <RoomViewer {...props} />;
  return <BuildViewer {...props} spec={build.spec} Model={build.Model} />;
}
