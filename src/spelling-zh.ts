import { pinyin } from "pinyin-pro";
import { Converter } from "opencc-js/t2cn";
const simplify = Converter({ from: "t", to: "cn" });
const shapeGroups = [
  "己已巳",
  "未末",
  "土士",
  "日目曰",
  "人入",
  "干千",
  "乌鸟",
  "王玉",
  "天夭",
  "要耍",
  "候侯",
  "辨辩瓣辫",
].map((x) => new Set([...x]));
const pronunciations = new Map<string, string[]>();
function sounds(char: string): string[] {
  let value = pronunciations.get(char);
  if (!value) {
    value = pinyin(char, { type: "array", toneType: "none", multiple: true });
    pronunciations.set(char, value);
  }
  return value;
}
function oneApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      if (++edits > 1) return false;
      if (a.length >= b.length) i++;
      if (a.length <= b.length) j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
export function plausibleChineseChange(
  original: string,
  replacement: string,
): boolean {
  if (original === replacement || simplify(original) === simplify(replacement))
    return false;
  if (shapeGroups.some((g) => g.has(original) && g.has(replacement)))
    return true;
  return sounds(original).some((a) =>
    sounds(replacement).some(
      (b) =>
        a === b ||
        (a[0] === b[0] && a.length >= 3 && b.length >= 3 && oneApart(a, b)),
    ),
  );
}
export type HanPosition = {
  start: number;
  end: number;
  token: number;
  original: string;
};
export function mapHanPositions(
  text: string,
  encode: (value: string) => number[],
): { ids: number[]; positions: HanPosition[] } {
  const ids: number[] = [],
    positions: HanPosition[] = [];
  for (const match of text.matchAll(/\p{Script=Han}|[^\p{Script=Han}]+/gu)) {
    const part = match[0],
      tokens = encode(part);
    if (/^\p{Script=Han}$/u.test(part) && tokens.length === 1)
      positions.push({
        start: match.index!,
        end: match.index! + part.length,
        token: ids.length + 1,
        original: part,
      });
    ids.push(...tokens);
  }
  return { ids, positions };
}
export function protectedChineseRanges(
  text: string,
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (const match of text.matchAll(
    /(?:姓名|联系人|名叫|叫作|作者|讲师)(?:是|为|[:：]\s*)?([\p{Script=Han}]{2,4})/gu,
  )) {
    const start = match.index! + match[0].lastIndexOf(match[1]);
    ranges.push({ start, end: start + match[1].length });
  }
  for (const match of text.matchAll(
    /([\p{Script=Han}]{2,4})(?:老师|教授|医生|先生|女士)/gu,
  ))
    ranges.push({ start: match.index!, end: match.index! + match[1].length });
  return ranges;
}
export function chineseChangeConfidence(
  scores: Float32Array,
  offset: number,
  size: number,
  originalId: number,
): { best: number; probability: number; margin: number } {
  let best = 0;
  for (let j = 1; j < size; j++)
    if (scores[offset + j] > scores[offset + best]) best = j;
  const peak = scores[offset + best];
  let sum = 0;
  for (let j = 0; j < size; j++) sum += Math.exp(scores[offset + j] - peak);
  return {
    best,
    probability: 1 / sum,
    margin: peak - scores[offset + originalId],
  };
}
