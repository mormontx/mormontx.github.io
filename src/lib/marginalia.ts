/**
 * FIG. 01 on Marginalia as Dialogue: one paragraph of a TOK essay across five
 * drafts. At each draft the reader chooses: a question in the margin, or a
 * grade. A question gets an answer in a smaller hand, and the next draft
 * rewrites the questioned sentence. A grade gets read, and nothing else does.
 *
 * Illustrative: the essay, questions and replies are written for this figure.
 */
export type Hand = 'teacher' | 'student' | 'peer';

export interface MarginNote {
  hand: Hand;
  text: string;
  /** Sentence (0-based) the note is written against. */
  anchor: number;
}

export interface Draft {
  sentences: string[];
  /** Sentence this draft rewrote in answer to the last question. */
  revised?: number;
  /** Written into the margin as the draft arrives (answers to her questions). */
  arrives?: MarginNote[];
  /** What the reader can ask of this draft, and what comes back. */
  question?: { anchor: number; text: string; reply: string };
  grade: string;
}

export const ESSAY_TITLE = 'Is certainty the aim of the natural sciences?';

const S0 = [
  'Science gives us certain knowledge, because experiments do not lie.',
  "Newton's laws were proven by experiment, which is why we still use them.",
  'As Popper argues, a theory must be falsifiable to count as science.',
  'So the natural sciences produce knowledge that is certain.',
];

/** Each questioned sentence opens a paragraph; these follow it, unchanged. */
export const SUPPORT = [
  'A result written in a lab book reads the same tomorrow as it did today.',
  'Engineers still use them to build bridges and to send probes to Mars.',
  'If no result could ever count against a claim, the claim is doing no work.',
  'That is what separates science from opinion.',
];

const R0 = 'Experiments do not lie, but they can be misread, and the reading is ours.';
const R1 = "Newton's laws were never proven so much as not yet broken; Einstein found where they bend.";
const R2 = "Popper's test is a promise rather than a proof: a theory counts as science because it says what would break it.";
const R3 = 'So the natural sciences produce knowledge that is reliable because it is provisional, certain only about how it could be wrong.';

export const DRAFTS: Draft[] = [
  {
    sentences: S0,
    question: {
      anchor: 0,
      text: 'What would this sentence say if it could contradict you?',
      reply: "That an experiment can't lie, but I can misread it? Then the lie would be mine.",
    },
    grade: 'C+',
  },
  {
    sentences: [R0, S0[1], S0[2], S0[3]],
    revised: 0,
    question: {
      anchor: 1,
      text: 'Proven for whom, and until when?',
      reply: "Until Einstein, I suppose. So was Newton ever proven, or only not yet wrong? I can't tell if that is the same thing.",
    },
    grade: 'B−',
  },
  {
    sentences: [R0, R1, S0[2], S0[3]],
    revised: 1,
    arrives: [{ hand: 'teacher', anchor: 1, text: 'Not yet wrong is a good place for a law to live.' }],
    question: {
      anchor: 2,
      text: 'Who is speaking in this sentence: you, or the author you are quoting?',
      reply: "Popper. I've been hiding behind him. What I think is that falsifiable is a promise, not a proof.",
    },
    grade: 'B',
  },
  {
    sentences: [R0, R1, R2, S0[3]],
    revised: 2,
    question: {
      anchor: 3,
      text: 'Does your last sentence still believe your third?',
      reply: 'No, it does not. Can a conclusion admit that it is provisional and still be a conclusion? I want to say yes.',
    },
    grade: 'B+',
  },
  {
    sentences: [R0, R1, R2, R3],
    revised: 3,
    arrives: [
      { hand: 'teacher', anchor: 3, text: 'Yes. I think that is what a good one does.' },
      { hand: 'peer', anchor: 3, text: 'This line made me rewrite mine. — R.' },
    ],
    grade: 'A−',
  },
];

/** The sentence a revised draft replaced, for the pencil diff. */
export function previousSentence(draft: number, index: number): string | null {
  if (draft === 0) return null;
  const before = DRAFTS[draft - 1].sentences[index];
  return before === DRAFTS[draft].sentences[index] ? null : before;
}

export const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export type MarginPhase = 'choose' | 'writing' | 'answered' | 'graded' | 'final' | 'final-graded';

export function marginStatus(phase: MarginPhase, draft: number): string {
  switch (phase) {
    case 'writing':
      return 'A question in pencil: it neither praises nor condemns.';
    case 'answered':
      return draft === 0
        ? 'She answered in the margin, in a smaller hand, as if replying to a letter.'
        : draft === 1
          ? 'Then she asked a question back.'
          : 'Her handwriting is getting steadier, the way a voice does when it stops asking permission.';
    case 'graded':
      return 'She flipped to the grade and read nothing else. The margin stayed empty, and the next draft would be this one again.';
    case 'final':
      return 'By the fifth draft the margin is the liveliest part of the page, and it has started to speak in more than two voices.';
    case 'final-graded':
      return 'The grade, when it finally came, was almost an afterthought: a number at the end of a conversation it had not been invited to.';
    default:
      return draft === 0
        ? 'You are the reader. Ask a question in the margin, or write a grade.'
        : 'The questioned sentence has been rewritten. Read the new draft, then choose again.';
  }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The draft's paragraphs, with the pencil diff on the sentence it rewrote. */
export function paragraphHTML(draft: number, opts: { target?: number | null; noted?: ReadonlySet<number> } = {}): string {
  const d = DRAFTS[draft];
  return d.sentences
    .map((text, i) => {
      const cls = ['mg-s'];
      if (opts.target === i) cls.push('is-target');
      if (opts.noted?.has(i)) cls.push('has-note');
      const before = d.revised === i ? previousSentence(draft, i) : null;
      const body = before
        ? `<del class="mg-del">${esc(before)}</del> <ins class="mg-ins">${esc(text)}</ins>`
        : esc(text);
      return `<p><span class="${cls.join(' ')}" data-s="${i}">${body}<sup class="mg-ref">${i + 1}</sup></span> ${esc(SUPPORT[i])}</p>`;
    })
    .join('');
}
