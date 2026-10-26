import nspell from "nspell";
// dictionary-en exports a Node file reader; Vite embeds the unchanged data files instead.
import aff from "../node_modules/dictionary-en/index.aff?raw";
import dic from "../node_modules/dictionary-en/index.dic?raw";
const dictionary = nspell(aff, dic);
function distance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        row[j] + 1,
        next[j - 1] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length];
}
export function correctEnglish(text: string): string {
  return text.replace(/[A-Za-z]+(?:['’][A-Za-z]+)*/g, (word) => {
    const normalized = word.replaceAll("’", "'");
    if (
      word.length < 3 ||
      /^[A-Z]{2,}$/.test(word) ||
      dictionary.correct(normalized)
    )
      return word;
    const suggestion = dictionary
      .suggest(normalized)
      .find(
        (candidate) =>
          /^[A-Za-z]+(?:'[A-Za-z]+)*$/.test(candidate) &&
          distance(normalized.toLowerCase(), candidate.toLowerCase()) <= 2,
      );
    if (!suggestion) return word;
    const result = /^[A-Z][a-z]/.test(word)
      ? suggestion[0].toUpperCase() + suggestion.slice(1)
      : suggestion;
    return word.includes("’") ? result.replaceAll("'", "’") : result;
  });
}
