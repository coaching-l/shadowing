import { diffWordsWithSpace, diffChars } from "diff";
import type { Lang } from "./core";
export type CorrectionEdit = {
  start: number;
  end: number;
  original: string;
  replacement: string;
};
export function correctionEdits(
  original: string,
  proposed: string,
  lang: Lang,
): CorrectionEdit[] {
  const parts =
    lang === "en"
      ? diffWordsWithSpace(original, proposed)
      : diffChars(original, proposed);
  const edits: CorrectionEdit[] = [];
  let offset = 0,
    start = 0,
    removed = "",
    added = "";
  function flush() {
    if (removed || added)
      edits.push({
        start,
        end: start + removed.length,
        original: removed,
        replacement: added,
      });
    removed = "";
    added = "";
  }
  for (const part of parts) {
    if (part.added || part.removed) {
      if (!removed && !added) start = offset;
      if (part.removed) {
        removed += part.value;
        offset += part.value.length;
      } else added += part.value;
    } else {
      flush();
      offset += part.value.length;
    }
  }
  flush();
  // Word-fragment repair may otherwise appear as a replacement plus deletion,
  // separated by an unchanged space. They must be accepted/rejected together.
  const atomic: CorrectionEdit[] = [];
  for (const edit of edits) {
    const previous = atomic.at(-1);
    const gap = previous ? original.slice(previous.end, edit.start) : "";
    if (
      previous &&
      /^\s*$/.test(gap) &&
      (!previous.original ||
        !previous.replacement ||
        !edit.original ||
        !edit.replacement)
    ) {
      previous.original += gap + edit.original;
      previous.replacement += gap + edit.replacement;
      previous.end = edit.end;
    } else atomic.push({ ...edit });
  }
  return atomic;
}
export function applyCorrectionEdits(
  original: string,
  edits: CorrectionEdit[],
  accepted: boolean[],
): string {
  let result = original;
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i];
    if (accepted[i])
      result =
        result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}
