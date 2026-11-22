import { useEffect, useRef, useState } from 'react';
import { noteForSlot, TEACHER_SLOT } from './roomScore';
import { createWhaleBus, scheduleWhaleCall } from './whaleVoice';

export interface RoomAudio {
  enabled: boolean;
  ready: boolean;
  toggle: () => void;
  playVoice: (slot: number) => void;
  playChord: (slots: number[]) => void;
}

type AudioContextCtor = typeof AudioContext;

/** Room graph: gentle lowpass after the whale bus. */
const BUS_LOWPASS_HZ = 2200;
const BUS_LOWPASS_Q = 0.7;
const DRY_GAIN = 1;

/** Echo: 0.42s delay, 0.42 feedback through a 1800Hz lowpass, ~0.35 wet. */
const DELAY_TIME = 0.42;
const DELAY_FEEDBACK = 0.42;
const DELAY_TONE_HZ = 1800;
const DELAY_WET = 0.35;

/** Reverb: 3.5s of decaying low-passed stereo noise, ~0.5 wet. */
const REVERB_SECONDS = 3.5;
const REVERB_CUTOFF_HZ = 2200;
const REVERB_WET = 0.5;

const MASTER_GAIN = 0.28;

/**
 * The whale fundamental for a slot: `noteForSlot` transposed an octave up so
 * students sing at roughly 260-900Hz, while the teacher's slot stays at its
 * already-low note (about 155Hz) for contrast.
 */
function whaleFrequency(slot: number): number | null {
  const note = noteForSlot(slot);
  if (!note) return null;
  return slot === TEACHER_SLOT ? note.frequency : note.frequency * 2;
}

/** Synthesise a 3.5s stereo reverb impulse: low-passed, exponentially decaying noise. */
function synthesizeImpulse(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * REVERB_SECONDS));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const alpha =
    1 - Math.exp(-(2 * Math.PI * REVERB_CUTOFF_HZ) / ctx.sampleRate);
  const decayRate = Math.log(1000) / REVERB_SECONDS; // -> -60dB at the tail

  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last += alpha * (white - last); // one-pole lowpass
      data[i] = last * Math.exp(-decayRate * (i / ctx.sampleRate));
    }
  }
  return buffer;
}

/**
 * Optional room sound, muted by default. The `AudioContext` is created lazily
 * inside the first toggle-on gesture, so no audio hardware is touched before
 * the visitor explicitly asks for sound.
 */
export function useRoomAudio(): RoomAudio {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const enabledRef = useRef(false);
  const readyRef = useRef(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const busRef = useRef<GainNode | null>(null);

  const setRunning = (ctx: AudioContext) => {
    const running = ctx.state === 'running';
    readyRef.current = running;
    setReady(running);
  };

  const ensureContext = () => {
    if (ctxRef.current) return;
    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextCtor })
        .webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    ctx.onstatechange = () => setRunning(ctx);

    // voices -> whale bus -> lowpass -> [dry, delay, reverb] -> compressor -> master
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.25;

    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
    compressor.connect(master);

    // Dry path.
    const dry = ctx.createGain();
    dry.gain.value = DRY_GAIN;
    dry.connect(compressor);

    // Echo path with a low-passed feedback loop.
    const delay = ctx.createDelay(2);
    delay.delayTime.value = DELAY_TIME;
    const delayWet = ctx.createGain();
    delayWet.gain.value = DELAY_WET;
    const delayFeedback = ctx.createGain();
    delayFeedback.gain.value = DELAY_FEEDBACK;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = DELAY_TONE_HZ;
    delayTone.Q.value = 0.7;
    delay.connect(delayWet);
    delayWet.connect(compressor);
    delay.connect(delayFeedback);
    delayFeedback.connect(delayTone);
    delayTone.connect(delay);

    // Reverb path.
    const convolver = ctx.createConvolver();
    convolver.buffer = synthesizeImpulse(ctx);
    const reverbWet = ctx.createGain();
    reverbWet.gain.value = REVERB_WET;
    convolver.connect(reverbWet);
    reverbWet.connect(compressor);

    // The shared lowpass that makes the whole pod sit underwater.
    const busLowpass = ctx.createBiquadFilter();
    busLowpass.type = 'lowpass';
    busLowpass.frequency.value = BUS_LOWPASS_HZ;
    busLowpass.Q.value = BUS_LOWPASS_Q;
    busLowpass.connect(dry);
    busLowpass.connect(delay);
    busLowpass.connect(convolver);

    const bus = createWhaleBus(ctx, busLowpass);

    ctxRef.current = ctx;
    masterRef.current = master;
    busRef.current = bus;

    if (import.meta.env.DEV) {
      (window as unknown as {
        __roomAudioDebug?: { ctx: AudioContext; master: GainNode };
      }).__roomAudioDebug = { ctx, master };
    }
  };

  const toggle = () => {
    const next = !enabledRef.current;
    enabledRef.current = next;
    setEnabled(next);

    if (!next) {
      readyRef.current = false;
      setReady(false);
      return;
    }

    ensureContext();
    const ctx = ctxRef.current;
    const bus = busRef.current;
    if (!ctx || !bus) return;

    ctx
      .resume()
      .then(() => {
        setRunning(ctx);
        // Unambiguous confirmation: one short, low teacher call.
        const teacherFrequency = whaleFrequency(TEACHER_SLOT);
        if (ctx.state === 'running' && teacherFrequency != null) {
          scheduleWhaleCall(ctx, bus, {
            frequency: teacherFrequency,
            duration: 1.2,
            gain: 0.9,
          });
        }
      })
      .catch(() => setRunning(ctx));
  };

  const playVoice = (slot: number) => {
    if (!enabledRef.current) return;
    const ctx = ctxRef.current;
    const bus = busRef.current;
    if (!ctx || !bus) return;
    const frequency = whaleFrequency(slot);
    if (frequency == null) return;

    const play = () => {
      scheduleWhaleCall(ctx, bus, { frequency });
    };

    // Resume before every play: browsers may suspend a context after a while.
    if (ctx.state !== 'running') {
      ctx
        .resume()
        .then(play)
        .catch(() => undefined);
    } else {
      play();
    }
  };

  const playChord = (slots: number[]) => {
    if (!enabledRef.current) return;
    slots.forEach((slot, index) => {
      window.setTimeout(() => playVoice(slot), index * 140);
    });
  };

  useEffect(() => {
    return () => {
      const ctx = ctxRef.current;
      const master = masterRef.current;
      if (ctx) {
        try {
          master?.disconnect();
        } catch {
          /* noop */
        }
        ctx.onstatechange = null;
        ctx.close().catch(() => undefined);
      }
      ctxRef.current = null;
      masterRef.current = null;
      busRef.current = null;
    };
  }, []);

  return { enabled, ready, toggle, playVoice, playChord };
}
