import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import CanvasHost from './CanvasHost';
import InterferenceField, {
  type VoiceEvent,
} from './InterferenceField';
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
import { noteForSlot } from '../../lib/roomScore';
import { useRoomAudio } from '../../lib/useRoomAudio';
import {
  DialecticRoomModel,
  MONOLITH_PERSPECTIVES,
  MONOLITH_TEACHER_SLOT,
} from './structures/StructureModels';

const DESKTOP_QUERY = '(min-width: 1024px)';
const MODEL_SCALE = 1.15;
const CHORD_MAX = 8;
const CHORD_TTL_MS = 10000;
const SHINE_MS = 2000;

// Mirror ring geometry. These mirror the private constants in
// StructureModels.tsx so the floor's emitters land under the mirrors. Only the
// teacher slot is exported from that module, hence the local duplicates.
const MONOLITH_SLOTS = 19;
const MONOLITH_RADIUS = 2.1;
const MONOLITH_TEACHER_OUTWARD = 0.3;
const VOICE_RING_SIZE = 8;

const QUESTION_CURSOR = 'url(/cursors/question.svg) 12 12, crosshair';
const CLEF_CURSOR = 'url(/cursors/clef.svg) 13 16, pointer';

const HERO_CAMERA = {
  lookAt: [0, 0.7, 0] as [number, number, number],
  downAngleDeg: 20,
  azimuthDeg: 28,
  fitRatio: 0.82,
  verticalExtent: 2.2,
  horizontalExtent: 3.0,
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The Dialectic Room as a live hero instrument. The ring idles on a slow
 * rotation, dolls in and fades to paper with scroll (damped, gated on reduced
 * motion), and reacts to mirror hover/click plus the ASK A QUESTION wave. All
 * interaction state lives here; the model itself only renders.
 */
export default function TectonicField() {
  const { ref, progress } = useScrollOutProgress<HTMLDivElement>();
  const [desktop, setDesktop] = useState(false);
  const [canvasMounted, setCanvasMounted] = useState(false);

  const audio = useRoomAudio();

  const [chord, setChordState] = useState<number[]>([]);
  const chordRef = useRef<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [shine, setShine] = useState(0);
  const [wave, setWave] = useState(0);
  const [waveRunning, setWaveRunning] = useState(false);
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);

  const expiresAt = useRef(new Map<number, number>());
  const chordTimers = useRef(new Map<number, number>());
  const shineTimer = useRef<number | null>(null);

  // Ring buffer of the last `VOICE_RING_SIZE` voice events feeding the
  // interference floor. Mutated in place; a negative `firedAt` marks an empty
  // slot.
  const voiceRing = useRef<VoiceEvent[] | null>(null);
  if (voiceRing.current === null) {
    voiceRing.current = new Array<VoiceEvent>(VOICE_RING_SIZE);
    for (let i = 0; i < VOICE_RING_SIZE; i += 1) {
      voiceRing.current[i] = { x: 0, z: 0, firedAt: -1 };
    }
  }
  const voiceCursor = useRef(0);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    return () => {
      for (const id of chordTimers.current.values()) window.clearTimeout(id);
      if (shineTimer.current != null) window.clearTimeout(shineTimer.current);
    };
  }, []);

  const setChord = (next: number[]) => {
    chordRef.current = next;
    setChordState(next);
  };

  const clearSlotTimer = (slot: number) => {
    const id = chordTimers.current.get(slot);
    if (id != null) {
      window.clearTimeout(id);
      chordTimers.current.delete(slot);
    }
    expiresAt.current.delete(slot);
  };

  const removeFromChord = (slot: number) => {
    clearSlotTimer(slot);
    setChord(chordRef.current.filter((s) => s !== slot));
  };

  const addToChord = (slot: number) => {
    clearSlotTimer(slot);
    const next = [slot, ...chordRef.current.filter((s) => s !== slot)];
    while (next.length > CHORD_MAX) {
      const dropped = next.pop();
      if (dropped != null) clearSlotTimer(dropped);
    }
    setChord(next);

    const now = performance.now();
    const at = now + CHORD_TTL_MS;
    expiresAt.current.set(slot, at);
    const id = window.setTimeout(() => {
      chordTimers.current.delete(slot);
      if (expiresAt.current.get(slot) === at) {
        expiresAt.current.delete(slot);
        setChord(chordRef.current.filter((s) => s !== slot));
      }
    }, CHORD_TTL_MS);
    chordTimers.current.set(slot, id);
  };

  const pulseShine = () => {
    setShine(1);
    if (shineTimer.current != null) window.clearTimeout(shineTimer.current);
    shineTimer.current = window.setTimeout(() => setShine(0), SHINE_MS);
  };

  // Record a voice event at the mirror's paper position. The ring's slow idle
  // rotation is ignored (the field is anchored to the floor), so the local XZ
  // frame is used directly; MODEL_SCALE brings it into world units.
  const pushVoice = (slot: number) => {
    const ring = voiceRing.current;
    if (!ring) return;
    const angle = (slot / MONOLITH_SLOTS) * Math.PI * 2;
    const radius =
      slot === MONOLITH_TEACHER_SLOT
        ? MONOLITH_RADIUS + MONOLITH_TEACHER_OUTWARD
        : MONOLITH_RADIUS;
    ring[voiceCursor.current] = {
      x: Math.cos(angle) * radius * MODEL_SCALE,
      z: Math.sin(angle) * radius * MODEL_SCALE,
      firedAt: performance.now(),
    };
    voiceCursor.current = (voiceCursor.current + 1) % VOICE_RING_SIZE;
  };

  const handleHover = (slot: number | null) => setHoveredSlot(slot);
  const handleVoice = (slot: number) => {
    pushVoice(slot);
    audio.playVoice(slot);
  };

  const handleSelect = (slot: number) => {
    if (slot === MONOLITH_TEACHER_SLOT) {
      setSelected(null);
      pulseShine();
      return;
    }

    if (chordRef.current.includes(slot)) {
      removeFromChord(slot);
      setSelected((prev) => (prev === slot ? null : prev));
    } else {
      addToChord(slot);
      setSelected(slot);
      handleVoice(slot);
    }
  };

  const handleWaveComplete = () => setWaveRunning(false);
  const handleAsk = () => {
    if (waveRunning) return;
    setWave((w) => w + 1);
    setWaveRunning(true);
  };
  const handleToggleSound = () => audio.toggle();
  const closeCard = () => setSelected(null);

  // QA-only surface: lets a CDP script drive the exact handlers the mirror
  // meshes call (onClick -> handleSelect, onPointerOver -> handleHover). Gated
  // to the dev server so it never ships in the production bundle.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__heroDebug = {
        select: handleSelect,
        hover: handleHover,
        ask: handleAsk,
        toggleSound: handleToggleSound,
        closeCard,
      };
    }
  });

  const readout = useMemo(() => {
    if (chord.length === 0) return 'VOICES 00 · SILENCE';
    const names = chord
      .map((slot) => noteForSlot(slot)?.name)
      .filter((name): name is string => Boolean(name));
    return `VOICES ${String(chord.length).padStart(2, '0')} · ${names.join(' ')}`;
  }, [chord]);

  const resolutionVisible = chord.length >= 4;
  const [resolutionMounted, setResolutionMounted] = useState(false);
  const [resolutionOpacity, setResolutionOpacity] = useState(0);

  useEffect(() => {
    if (resolutionVisible) {
      setResolutionMounted(true);
      const raf = requestAnimationFrame(() => setResolutionOpacity(1));
      return () => cancelAnimationFrame(raf);
    }

    setResolutionOpacity(0);
    const timer = window.setTimeout(() => setResolutionMounted(false), 320);
    return () => window.clearTimeout(timer);
  }, [resolutionVisible]);

  return (
    <div ref={ref} className="relative h-full w-full">
      {/* Canvas band: fixed height on mobile, full bleed on lg. The cursor is
          swapped here (not per-mesh) so the hot-spot never flickers. */}
      <div
        className="relative h-[min(56svh,380px)] lg:absolute lg:inset-0 lg:h-auto"
        style={{ cursor: hoveredSlot != null ? CLEF_CURSOR : QUESTION_CURSOR }}
      >
        <div className="hero-canvas-mask absolute inset-0">
          <CanvasHost
            className="h-full w-full"
            fallback={<SceneFallback />}
            onCanvasMount={() => setCanvasMounted(true)}
          >
            <StudioLights />
            <PaperGround />
            <InterferenceField emitters={voiceRing} />
            <ContactShadow
              radius={2.7}
              scale={[1.25, 0.95, 1]}
              opacity={0.5}
            />
            <SceneFog />
            <HeroRing
              progress={desktop ? progress : 0}
              chord={chord}
              selected={selected}
              shine={shine}
              wave={wave}
              onHoverSlot={handleHover}
              onSelect={handleSelect}
              onVoice={handleVoice}
              onWaveComplete={handleWaveComplete}
            />
          </CanvasHost>
        </div>

        {/* Mobile caption sits inside the canvas band (above the mask). */}
        {canvasMounted && (
          <p className="meta pointer-events-none absolute bottom-3 right-4 max-w-[15rem] text-right lg:hidden">
            MODEL 01 — THE DIALECTIC ROOM · SCALE 1:50 · N.T.S.
          </p>
        )}
      </div>

      {/* Controls: under the canvas on mobile, bottom-left on lg. */}
      {canvasMounted && (
        <div className="relative z-10 mt-3 px-6 sm:px-8 lg:absolute lg:bottom-4 lg:left-4 lg:mt-0 lg:px-0">
          <div className="flex min-w-0 flex-col items-start gap-2">
            {resolutionMounted && (
              <p
                aria-hidden={!resolutionVisible}
                className="meta text-accent"
                style={{
                  opacity: resolutionOpacity,
                  transition: 'opacity 320ms ease',
                }}
              >
                THE ROOM HOLDS THE CHORD
              </p>
            )}
            <p className="meta text-ink">{readout}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleAsk}
                disabled={waveRunning}
                className="meta inline-flex min-h-[44px] shrink-0 items-center border border-hairline px-3 py-2 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                ASK A QUESTION
              </button>
              <button
                type="button"
                onClick={handleToggleSound}
                aria-pressed={audio.enabled}
                className="meta inline-flex min-h-[44px] shrink-0 items-center border border-hairline px-3 py-2 transition-colors hover:border-accent hover:text-accent"
              >
                {audio.enabled ? 'SOUND ON' : 'SOUND OFF'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop caption, right-aligned in the bottom bar. */}
      {canvasMounted && (
        <p className="meta pointer-events-none absolute bottom-4 right-4 hidden max-w-[15rem] text-right lg:block">
          MODEL 01 — THE DIALECTIC ROOM · SCALE 1:50 · N.T.S.
        </p>
      )}

      {/* Reflection card, top-right. */}
      {canvasMounted && selected != null && (
        <div className="absolute right-4 top-4 z-20 w-[min(20rem,calc(100%-2rem))] border border-hairline bg-paper p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="meta text-accent">REFLECTION</p>
            <button
              type="button"
              onClick={closeCard}
              className="meta inline-flex shrink-0 items-center border border-hairline px-2 py-1 transition-colors hover:border-accent hover:text-accent"
            >
              CLOSE
            </button>
          </div>
          <p className="mt-3 font-serif text-base italic leading-snug text-ink/90">
            {MONOLITH_PERSPECTIVES[selected]}
          </p>
        </div>
      )}
    </div>
  );
}

interface HeroRingProps {
  progress: number;
  chord: number[];
  selected: number | null;
  shine: number;
  wave: number;
  onHoverSlot: (slot: number | null) => void;
  onSelect: (slot: number) => void;
  onVoice: (slot: number) => void;
  onWaveComplete: () => void;
}

function HeroRing({
  progress,
  chord,
  selected,
  shine,
  wave,
  onHoverSlot,
  onSelect,
  onVoice,
  onWaveComplete,
}: HeroRingProps) {
  const reducedMotion = useReducedMotion();
  const group = useRef<THREE.Group>(null);
  const camera = useThree(
    (state) => state.camera,
  ) as THREE.PerspectiveCamera;
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const aspect = size.width / Math.max(1, size.height);

  const base = useRef<{ x: number; y: number; z: number } | null>(null);
  const current = useRef({ camZ: 0, camY: 0, rotY: 0, fade: 0 });
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
    current.current = { camZ: 0, camY: 0, rotY: 0, fade: 0 };
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

    idle.current += delta * 0.045;

    c.fade = damp(c.fade, target, lambda);
    c.camZ = damp(c.camZ, 2.4 - 4.6 * target, lambda);
    c.camY = damp(c.camY, 0.2 * target, lambda);
    c.rotY = damp(c.rotY, 0.1 * target, lambda);

    camera.position.x = b.x;
    camera.position.y = b.y + c.camY;
    camera.position.z = b.z + c.camZ;
    camera.lookAt(lookX, lookY + c.camY * 0.5, lookZ);

    g.rotation.y = idle.current + c.rotY;

    const fadeOut = smoothstep(0.55, 0.82, c.fade);
    gl.domElement.style.opacity = String(1 - fadeOut);
  });

  return (
    <group ref={group} scale={MODEL_SCALE}>
      <DialecticRoomModel
        active={false}
        chord={chord}
        selected={selected}
        shine={shine}
        wave={wave}
        onHoverSlot={onHoverSlot}
        onSelect={onSelect}
        onVoice={onVoice}
        onWaveComplete={onWaveComplete}
      />
    </group>
  );
}
