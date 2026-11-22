/** Two-digit plate number: 4 → "04". */
export const pad = (n: number) => String(n).padStart(2, '0');

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];

/** A count spelled out for prose ("four"), falling back to digits past twenty. */
export const countWord = (n: number) => WORDS[n] ?? String(n);

/** Same as countWord, capitalised for the start of a sentence ("Four"). */
export const CountWord = (n: number) => {
  const word = countWord(n);
  return word.charAt(0).toUpperCase() + word.slice(1);
};
