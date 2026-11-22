/**
 * Pure music model for the Dialectic Room score.
 *
 * The room's eighteen mirrors are mapped onto a C minor pentatonic scale
 * (C, E♭, F, G, B♭) spread across four octaves. The teacher's mirror sits one
 * octave lower than its mapped note, and the gap slot (the absent voice)
 * returns `null` — silence.
 *
 * This module is deliberately free of React/three so it stays trivially
 * testable and side-effect free.
 */

export interface RoomNote {
  /** MIDI note number (equal temperament). */
  midi: number;
  /** Pitch-class name without an octave, e.g. 'E♭'. */
  name: string;
  /** Frequency in Hz (A4 = 440). */
  frequency: number;
}

const GAP_SLOT = 15;
export const TEACHER_SLOT = 7;
const SLOT_COUNT = 19;

/** Semitone offsets of C minor pentatonic above the root. */
const PENTATONIC_SEMITONES = [0, 3, 5, 7, 10];

/** Pitch-class names indexed by `midi % 12`. */
const PITCH_CLASSES = [
  'C',
  'C♯',
  'D',
  'E♭',
  'E',
  'F',
  'F♯',
  'G',
  'A♭',
  'A',
  'B♭',
  'B',
];

const ROOT_MIDI = 48; // C3

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function noteForMirror(index: number): RoomNote {
  const octave = Math.floor(index / PENTATONIC_SEMITONES.length);
  const degree =
    PENTATONIC_SEMITONES[index % PENTATONIC_SEMITONES.length];
  const midi = ROOT_MIDI + octave * 12 + degree;
  return {
    midi,
    name: PITCH_CLASSES[midi % 12],
    frequency: midiToFrequency(midi),
  };
}

/**
 * The note for a monolith slot (0..18). The gap slot returns `null` and the
 * teacher's slot is transposed one octave lower than its mapped note.
 */
export function noteForSlot(slot: number): RoomNote | null {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) return null;
  if (slot === GAP_SLOT) return null;

  const mirrorIndex = slot < GAP_SLOT ? slot : slot - 1;
  const base = noteForMirror(mirrorIndex);

  if (slot === TEACHER_SLOT) {
    const midi = base.midi - 12;
    return {
      midi,
      name: PITCH_CLASSES[midi % 12],
      frequency: midiToFrequency(midi),
    };
  }

  return base;
}
