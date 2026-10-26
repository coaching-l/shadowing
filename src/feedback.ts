import type { Lang } from "./core";
export type Difference = {
  kind: "match" | "replace" | "missing" | "extra";
  expected: string;
  heard: string;
};
function tokens(text: string, lang: Lang): string[] {
  const normalized = text.normalize("NFKC").toLowerCase().replaceAll("’", "'");
  return (
    normalized.match(
      lang === "zh"
        ? /\p{Script=Han}|[\p{L}\p{N}]+/gu
        : /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu,
    ) ?? []
  );
}
export function compareTranscript(
  expected: string,
  heard: string,
  lang: Lang,
): Difference[] {
  const a = tokens(expected, lang),
    b = tokens(heard, lang);
  if (!a.length) throw Error("比較する原稿を入力してください。");
  if (!b.length)
    throw Error(
      "認識された文章がありません。録音を聴き、文字起こしを確認してください。",
    );
  if (a.length > 500 || b.length > 500)
    throw Error("短い原稿・録音に分けてください（比較上限500語・文字）。");
  const rows = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  );
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
      );
    }
  const differences: Difference[] = [];
  let i = a.length,
    j = b.length;
  while (i || j) {
    if (
      i &&
      j &&
      rows[i][j] === rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
    ) {
      differences.push({
        kind: a[i - 1] === b[j - 1] ? "match" : "replace",
        expected: a[--i],
        heard: b[--j],
      });
    } else if (i && rows[i][j] === rows[i - 1][j] + 1)
      differences.push({ kind: "missing", expected: a[--i], heard: "" });
    else differences.push({ kind: "extra", expected: "", heard: b[--j] });
  }
  return differences.reverse();
}
export function validateCorrection(
  original: string,
  candidate: string,
): string {
  const value = candidate.trim();
  if (
    !value ||
    value.includes("<|im_") ||
    value.length > original.length * 1.5 + 20
  )
    throw Error(
      "原文を保った修正候補を作れませんでした。範囲を短くしてお試しください。",
    );
  // Reject large rewrites, explanations and most truncated responses; always require human review.
  const a = [...original.trim()],
    b = [...value];
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
  if (row[b.length] > Math.max(3, Math.ceil(a.length * 0.25)))
    throw Error(
      "原文との差が大きいため候補を採用しませんでした。短い文で再確認してください。",
    );
  return (
    (original.match(/^\s*/)?.[0] ?? "") +
    value +
    (original.match(/\s*$/)?.[0] ?? "")
  );
}
export async function decodeRecording(blob: Blob): Promise<Float32Array> {
  if (blob.size > 10 * 1024 * 1024)
    throw Error(
      "フィードバック用の録音は10 MB・30秒までです。短い区間で録り直してください。",
    );
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (buffer.duration > 30.1 || buffer.duration < 0.4)
      throw Error(
        "フィードバック用の録音は0.4〜30秒です。短い区間で録り直してください。",
      );
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(buffer.duration * 16000),
      16000,
    );
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    const samples = (await offline.startRendering()).getChannelData(0).slice();
    const energy = Math.sqrt(
      samples.reduce((sum, x) => sum + x * x, 0) / samples.length,
    );
    if (!samples.every(Number.isFinite) || energy < 0.0001)
      throw Error(
        "録音が無音、または小さすぎます。マイクと音量を確認して録り直してください。",
      );
    return samples;
  } finally {
    await context.close();
  }
}

let chineseConverter: ((text: string) => string) | undefined;
export async function normalizeChineseComparison(
  text: string,
): Promise<string> {
  const { Converter } = await import("opencc-js/t2cn");
  chineseConverter ??= Converter({ from: "t", to: "cn" });
  return chineseConverter(text);
}
