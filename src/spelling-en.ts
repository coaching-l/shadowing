import nspell from "nspell";
import { correctionEdits, applyCorrectionEdits } from "./correction-review";
import aff from "../node_modules/dictionary-en/index.aff?raw";
import dic from "../node_modules/dictionary-en/index.dic?raw";
import gbAff from "../node_modules/dictionary-en-gb/index.aff?raw";
import gbDic from "../node_modules/dictionary-en-gb/index.dic?raw";
const american = nspell(aff, dic),
  british = nspell(gbAff, gbDic);
export const englishWordKnown = (word: string) =>
  [word, word.toLowerCase()].some(
    (w) => american.correct(w) || british.correct(w),
  );
const normalize = (word: string) => word.replaceAll("’", "'").toLowerCase();
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
const groups = [
  "their there they're",
  "your you're",
  "its it's",
  "than then",
  "affect effect",
  "loose lose",
  "no know",
  "to too two",
  "here hear",
  "weather whether",
  "accept except",
  "form from",
  "advice advise",
  "quiet quite",
  "am is are",
  "was were",
  "have has",
  "do does",
  "cant can't",
  "wont won't",
  "dont don't doesn't",
  "doesnt doesn't",
  "isnt isn't",
  "arent aren't",
  "wasnt wasn't",
  "werent weren't",
  "hasnt hasn't",
  "havent haven't",
  "hadnt hadn't",
  "didnt didn't",
  "couldnt couldn't",
  "shouldnt shouldn't",
  "wouldnt wouldn't",
  "im i'm",
  "ive i've",
  "ill i'll",
  "youre you're",
  "youve you've",
  "theyre they're",
  "weve we've",
].map((s) => new Set(s.split(" ")));
const languages = new Set([
  "english",
  "chinese",
  "japanese",
  "french",
  "german",
  "spanish",
  "korean",
]);
const forms = (word: string) =>
  new Set([
    word,
    ...(word.endsWith("s") ? [word.slice(0, -1)] : []),
    ...(word.endsWith("es") ? [word.slice(0, -2)] : []),
    ...(word.endsWith("ies") ? [word.slice(0, -3) + "y"] : []),
    ...(word.endsWith("ing")
      ? [word.slice(0, -3), word.slice(0, -3) + "e"]
      : []),
  ]);
export function protectedEnglishRanges(
  text: string,
): { start: number; end: number }[] {
  const pattern =
    /https?:\/\/[^\s<>"“”]+|www\.[^\s<>"“”]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|`[^`]*`|\b(?:Dr|Mr|Mrs|Ms|Prof)\.\s+[A-Z][A-Za-z'’-]*(?:\s+[A-Z][A-Za-z'’-]*)*|\b[A-Z]{2,}(?:-[A-Za-z0-9]+)*\b|\b[A-Za-z]*[a-z][A-Z][A-Za-z]*\b|\b\d[\w.,:/%+-]*/g;
  return [...text.matchAll(pattern)].map((m) => ({
    start: m.index!,
    end: m.index! + m[0].length,
  }));
}
type Word = { value: string; start: number; end: number };
function words(text: string): Word[] {
  return [...text.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)].map(
    (m) => ({ value: m[0], start: m.index!, end: m.index! + m[0].length }),
  );
}
// Use model context to choose words. Never use the dictionary's first suggestion.
export function filterEnglishCorrection(
  original: string,
  proposed: string,
): string {
  const a = words(original),
    b = words(proposed);
  if (!a.length || !b.length || a.length > 200 || b.length > 250)
    return original;
  const rows = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  );
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      rows[i][j] = Math.min(
        rows[i - 1][j - 1] +
          (normalize(a[i - 1].value) === normalize(b[j - 1].value) ? 0 : 1),
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
      );
  const replacements: { start: number; end: number; text: string }[] = [];
  const protectedRanges = protectedEnglishRanges(original);
  const protectedWord = (word: Word) =>
    protectedRanges.some((r) => word.start < r.end && word.end > r.start);
  const operations: { source?: Word; target?: Word; match: boolean }[] = [];
  let i = a.length,
    j = b.length;
  while (i || j) {
    if (
      i &&
      j &&
      rows[i][j] ===
        rows[i - 1][j - 1] +
          (normalize(a[i - 1].value) === normalize(b[j - 1].value) ? 0 : 1)
    ) {
      const source = a[--i],
        target = b[--j];
      operations.push({
        source,
        target,
        match: normalize(source.value) === normalize(target.value),
      });
    } else if (i && rows[i][j] === rows[i - 1][j] + 1)
      operations.push({ source: a[--i], match: false });
    else operations.push({ target: b[--j], match: false });
  }
  operations.reverse();
  function replaceWord(source: Word, target: Word) {
    const s = normalize(source.value),
      t = normalize(target.value);
    if (
      protectedWord(source) ||
      !/^[A-Za-z]+(?:['’][A-Za-z]+)*$/.test(source.value) ||
      !/^[A-Za-z]+(?:['’][A-Za-z]+)*$/.test(target.value)
    )
      return;
    if (s === t) {
      if (source.value === "i" && target.value === "I")
        replacements.push({ start: source.start, end: source.end, text: "I" });
      return;
    }
    const known = englishWordKnown(source.value),
      sourceForms = forms(s),
      inflection = [...forms(t)].some(
        (x) => x.length >= 2 && sourceForms.has(x),
      );
    const sameGroup = groups.some((g) => g.has(s) && g.has(t));
    if (
      distance(s, t) > Math.max(2, Math.min(3, Math.floor(s.length * 0.3))) &&
      !sameGroup &&
      !inflection
    )
      return;
    if (known && !groups.some((g) => g.has(s) && g.has(t)) && !inflection)
      return;
    if (!englishWordKnown(target.value)) return;
    if (
      /^[A-Z]/.test(source.value) &&
      source.start > 0 &&
      !/[.!?\n]\s*$/.test(original.slice(0, source.start)) &&
      !known &&
      !languages.has(t)
    )
      return;
    let replacement = source.value.includes("’")
      ? target.value.replaceAll("'", "’")
      : target.value;
    if (/^[A-Z]/.test(source.value))
      replacement = replacement[0].toUpperCase() + replacement.slice(1);
    replacements.push({
      start: source.start,
      end: source.end,
      text: replacement,
    });
  }
  for (let k = 0; k < operations.length; ) {
    const op = operations[k];
    if (op.match) {
      replaceWord(op.source!, op.target!);
      k++;
      continue;
    }
    let end = k;
    while (end < operations.length && !operations[end].match) end++;
    const source = operations
        .slice(k, end)
        .flatMap((x) => (x.source ? [x.source] : [])),
      target = operations
        .slice(k, end)
        .flatMap((x) => (x.target ? [x.target] : []));
    if (source.length === target.length)
      source.forEach((word, index) => replaceWord(word, target[index]));
    else if (
      source.length === 1 &&
      target.length > 1 &&
      target.length <= 3 &&
      !protectedWord(source[0]) &&
      !englishWordKnown(source[0].value) &&
      target.every((w) => englishWordKnown(w.value)) &&
      distance(
        normalize(source[0].value),
        target.map((w) => normalize(w.value)).join(""),
      ) <= 1
    ) {
      // A genuine split typo such as "alot" -> "a lot", not an arbitrary insertion.
      replacements.push({
        start: source[0].start,
        end: source[0].end,
        text: target.map((w) => w.value).join(" "),
      });
    } else if (target.length === 0) {
      const duplicateWords = new Set([
        "have",
        "has",
        "is",
        "are",
        "was",
        "were",
        "the",
        "a",
        "an",
        "to",
        "of",
        "in",
        "on",
        "for",
        "with",
      ]);
      for (const word of source) {
        if (!duplicateWords.has(normalize(word.value)) || protectedWord(word))
          continue;
        const index = a.indexOf(word),
          previous = a[index - 1],
          next = a[index + 1];
        if (
          previous &&
          normalize(previous.value) === normalize(word.value) &&
          /^ +$/.test(original.slice(previous.end, word.start))
        )
          replacements.push({ start: previous.end, end: word.end, text: "" });
        else if (
          next &&
          normalize(next.value) === normalize(word.value) &&
          /^ +$/.test(original.slice(word.end, next.start))
        )
          replacements.push({ start: word.start, end: next.start, text: "" });
      }
    }
    k = end;
  }
  let result = original;
  for (const change of replacements.sort((x, y) => y.start - x.start))
    result =
      result.slice(0, change.start) + change.text + result.slice(change.end);
  return result;
}

export function stableEnglishCorrection(
  original: string,
  candidate: string,
  secondPass: string,
): string {
  const edits = correctionEdits(original, candidate, "en"),
    disagreements = correctionEdits(candidate, secondPass, "en");
  const protectedRanges = protectedEnglishRanges(candidate);
  const equivalent: Record<string, string> = {
    "can't": "cannot",
    "won't": "willnot",
    "don't": "donot",
    "doesn't": "doesnot",
    "isn't": "isnot",
    "aren't": "arenot",
    "wasn't": "wasnot",
    "weren't": "werenot",
    "haven't": "havenot",
    "hasn't": "hasnot",
    "didn't": "didnot",
    "i'm": "iam",
    "i've": "ihave",
  };
  const normalizedWords = (value: string) =>
    words(value)
      .map((w) => equivalent[normalize(w.value)] ?? normalize(w.value))
      .join(" ");
  const unstable = disagreements.filter(
    (edit) =>
      normalizedWords(edit.original) !== normalizedWords(edit.replacement) &&
      !protectedRanges.some(
        (range) => edit.start < range.end && edit.end > range.start,
      ),
  );
  let delta = 0;
  const accepted = edits.map((edit) => {
    const start = edit.start + delta,
      end = start + edit.replacement.length;
    delta += edit.replacement.length - (edit.end - edit.start);
    const overlaps = unstable.filter(
      (change) => change.start < end && change.end > start,
    );
    const articles = new Set(["a", "an", "the"]);
    if (
      !englishWordKnown(edit.original) &&
      articles.has(normalize(edit.replacement)) &&
      overlaps.every(
        (change) =>
          articles.has(normalize(change.original)) &&
          articles.has(normalize(change.replacement)),
      )
    )
      return true;
    return overlaps.length === 0;
  });
  return applyCorrectionEdits(original, edits, accepted);
}

// PDF text extraction can separate ligatures or wrap a word into fragments.
// Rejoin existing letters only when the complete word exists in either dictionary.
export function repairEnglishFragments(text: string): string {
  const ranges = protectedEnglishRanges(text),
    tokens = words(text),
    repairs: { start: number; end: number; text: string }[] = [];
  const protectedToken = (token: Word) =>
    ranges.some((r) => token.start < r.end && token.end > r.start);
  for (let i = 0; i < tokens.length; ) {
    const first = tokens[i];
    if (
      protectedToken(first) ||
      !/^[A-Za-z\uFB00-\uFB06]+$/.test(first.value)
    ) {
      i++;
      continue;
    }
    let best: { last: number; text: string } | undefined;
    for (let j = i + 1; j < Math.min(tokens.length, i + 4); j++) {
      const current = tokens[j],
        gap = text.slice(tokens[j - 1].end, current.start);
      if (
        protectedToken(current) ||
        !/^[A-Za-z\uFB00-\uFB06]+$/.test(current.value)
      )
        break;
      const soft =
        /^[ \t\u00a0\u2000-\u200a\u202f]*(?:\u00ad|-[ \t]*\r?\n)[ \t\u00a0]*$/.test(
          gap,
        );
      if (
        !soft &&
        (!/^[\s\u00a0]+$/.test(gap) || (gap.match(/\n/g)?.length ?? 0) > 1)
      )
        break;
      const parts = tokens.slice(i, j + 1),
        combined = parts.map((t) => t.value.normalize("NFKC")).join("");
      if (combined.length > 40) break;
      const hasBrokenPart = parts.some(
        (t) => !englishWordKnown(t.value.normalize("NFKC")),
      );
      if (
        (soft || hasBrokenPart) &&
        parts.some((t) => t.value.length <= 3) &&
        englishWordKnown(combined)
      ) {
        const lower = combined.toLowerCase();
        best = {
          last: j,
          text: /^[A-Z]/.test(first.value)
            ? lower[0].toUpperCase() + lower.slice(1)
            : lower,
        };
      }
    }
    if (best) {
      repairs.push({
        start: first.start,
        end: tokens[best.last].end,
        text: best.text,
      });
      i = best.last + 1;
      continue;
    }
    const expanded = first.value.normalize("NFKC");
    if (expanded !== first.value && englishWordKnown(expanded))
      repairs.push({ start: first.start, end: first.end, text: expanded });
    i++;
  }
  let result = text;
  for (const repair of repairs.reverse())
    result =
      result.slice(0, repair.start) + repair.text + result.slice(repair.end);
  return result;
}
