import type { Lang } from "./core";
export const MAX_PROOFREADING_CHARS = 5000;
export const PROOFREADING_CHUNK_CHARS = 300;

// Preserve every character, including whitespace; English words must stay intact.
export function proofreadingChunks(text: string, lang: Lang): string[] {
  if (text.length > MAX_PROOFREADING_CHARS)
    throw Error(
      "タイポ確認は5,000文字までです。本文で5,000文字以内の範囲を選択してください。",
    );
  const chunks: string[] = [];
  let current = "";
  function append(part: string) {
    if (current.length + part.length > PROOFREADING_CHUNK_CHARS) {
      if (current) chunks.push(current);
      current = "";
    }
    current += part;
  }
  for (const { segment } of new Intl.Segmenter(lang, {
    granularity: "sentence",
  }).segment(text)) {
    if (segment.length <= PROOFREADING_CHUNK_CHARS) {
      append(segment);
      continue;
    }
    const parts =
      lang === "en"
        ? (segment.match(/[A-Za-z]+(?:['’][A-Za-z]+)*|[^A-Za-z]+/gu) ?? [])
        : [segment];
    for (const part of parts) {
      if (part.length <= PROOFREADING_CHUNK_CHARS) append(part);
      else {
        if (lang === "en" && /^[A-Za-z]/.test(part))
          throw Error(
            "300文字を超える長い単語があります。PDFの改行や単語のつながりを確認してください。",
          );
        for (const char of part) append(char);
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
