/**
 * Pure whale-voice synthesis shared by the live room audio and the offline
 * WAV renderer.
 *
 * This module has no `window`/`document` access and only uses the
 * `BaseAudioContext` interface, so the exact same code runs against an
 * `AudioContext` (live playback) or an `OfflineAudioContext` (rendering).
 */

export interface WhaleCallOptions {
  /** Fundamental frequency in Hz. */
  frequency: number;
  /** Absolute start time in `ctx.currentTime` coordinates. */
  when?: number;
  /** Total call length in seconds (default 2.4). */
  duration?: number;
  /** Linear peak gain of the call's envelope (default 1). */
  gain?: number;
}

const DEFAULT_DURATION = 2.4;
const ATTACK = 0.18;
const RELEASE = 1.6;

/** Glide: 1.30x -> 1.0x at +0.9s -> 0.93x at +2.0s (slow whale fall). */
const GLIDE_HIGH = 1.3;
const GLIDE_MID_TIME = 0.9;
const GLIDE_LOW = 0.93;
const GLIDE_LOW_TIME = 2.0;

const HARMONIC_GAIN = 0.22; // second partial (2f) level relative to the fundamental
const VIBRATO_HZ = 4.5;
const VIBRATO_CENTS = 5; // detune depth in cents
const LOWPASS_HZ = 1200;
const LOWPASS_Q = 0.7;
const MIN_GAIN = 0.0001; // exponential tails land here, never at a clicky 0

/**
 * A shared gain node every whale call feeds into. Connect it once to the room
 * graph (or the offline destination) and pass it to `scheduleWhaleCall`.
 */
export function createWhaleBus(
  ctx: BaseAudioContext,
  destination: AudioNode,
): GainNode {
  const bus = ctx.createGain();
  bus.gain.value = 1;
  bus.connect(destination);
  return bus;
}

/**
 * Schedule one whale-like call: a gliding fundamental with a quiet second
 * harmonic, a slow vibrato, and a soft lowpass, wrapped in an exponential
 * envelope with no clicks or DC pops.
 */
export function scheduleWhaleCall(
  ctx: BaseAudioContext,
  bus: GainNode,
  opts: WhaleCallOptions,
): void {
  const f = opts.frequency;
  const duration = opts.duration ?? DEFAULT_DURATION;
  if (!(f > 0) || !(duration > 0)) return;

  const t0 = opts.when ?? ctx.currentTime;
  const gainPeak = opts.gain ?? 1;

  // Scale the fixed 2.4s shape proportionally when a shorter/longer call is
  // requested, so a short confirmation call still completes its glide.
  const k = duration / DEFAULT_DURATION;
  const attack = ATTACK * k;
  const release = RELEASE * k;
  const releaseStart = Math.max(attack, duration - release);
  const glideMid = GLIDE_MID_TIME * k;
  const glideLow = GLIDE_LOW_TIME * k;

  // Gliding fundamental.
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f * GLIDE_HIGH, t0);
  osc.frequency.exponentialRampToValueAtTime(f, t0 + glideMid);
  osc.frequency.exponentialRampToValueAtTime(f * GLIDE_LOW, t0 + glideLow);

  // Second partial at 2f, gliding with the fundamental for body.
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(2 * f * GLIDE_HIGH, t0);
  osc2.frequency.exponentialRampToValueAtTime(2 * f, t0 + glideMid);
  osc2.frequency.exponentialRampToValueAtTime(2 * f * GLIDE_LOW, t0 + glideLow);

  // Slow vibrato on the fundamental's pitch (detune is already in cents).
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = VIBRATO_HZ;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = VIBRATO_CENTS;
  lfo.connect(lfoGain);
  lfoGain.connect(osc.detune);

  // Envelope: clean attack, flat body, exponential tail.
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gainPeak, t0 + attack);
  env.gain.setValueAtTime(gainPeak, t0 + releaseStart);
  env.gain.exponentialRampToValueAtTime(MIN_GAIN, t0 + duration);

  // Underwater lowpass shared by both partials.
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = LOWPASS_HZ;
  lowpass.Q.value = LOWPASS_Q;

  // The harmonic sits ~0.22x under the fundamental, both through the envelope.
  const harmonicGain = ctx.createGain();
  harmonicGain.gain.value = HARMONIC_GAIN;

  osc.connect(env);
  osc2.connect(harmonicGain);
  harmonicGain.connect(env);
  env.connect(lowpass);
  lowpass.connect(bus);

  const stopAt = t0 + duration + 0.05;
  osc.start(t0);
  osc2.start(t0);
  lfo.start(t0);
  osc.stop(stopAt);
  osc2.stop(stopAt);
  lfo.stop(stopAt);
}
