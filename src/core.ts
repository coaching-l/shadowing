export type Lang = "en" | "zh";
export type Clip = {
  text: string;
  key: string;
  samples: Float32Array;
  rate: number;
};
export type Gap = {
  mode: "none" | "fixed" | "auto";
  seconds: number;
  min: number;
  max: number;
};
export type Span = { text: string; start: number; end: number };
export const NO_GAP: Gap = { mode: "none", seconds: 2, min: 1, max: 8 };
export function splitSentences(text: string, lang: Lang): string[] {
  const protectedText = text
    .replace(/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc)\./gi, (m) =>
      m.replaceAll(".", "\uE000"),
    )
    .replace(/\b(?:[A-Za-z]\.){2,}/g, (m) => m.replaceAll(".", "\uE000"))
    .replace(/(?<=\d)\.(?=\d)/g, "\uE000");
  // Intl handles closing quotes and Chinese punctuation; protect common abbreviations first.
  const parts = [
    ...new Intl.Segmenter(lang, { granularity: "sentence" }).segment(
      protectedText,
    ),
  ]
    .flatMap((x) => x.segment.split(/\n+/))
    .map((x) => x.replaceAll("\uE000", ".").trim())
    .filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const m = parts[i].match(/[「『（【]+$/u);
    if (m) {
      parts[i] = parts[i].slice(0, -m[0].length).trimEnd();
      parts[i + 1] = m[0] + parts[i + 1];
    }
  }
  return parts.filter(Boolean);
}
export function gapSeconds(duration: number, gap: Gap): number {
  if (gap.mode === "none") return 0;
  if (gap.mode === "fixed") return Math.max(0, Math.min(30, gap.seconds));
  return Math.max(gap.min, Math.min(gap.max, duration));
}
export function timeline(clips: Clip[], gap: Gap): Span[] {
  let cursor = 0;
  return clips.map((c, i) => {
    const start = cursor;
    const end = start + c.samples.length / c.rate;
    cursor = end + (i < clips.length - 1 ? gapSeconds(end - start, gap) : 0);
    return { text: c.text, start, end };
  });
}
export function validRange(a: number, b: number, duration: number) {
  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    a >= 0 &&
    b > a &&
    b <= duration + 1e-6
  );
}
export function mergeAudio(clips: Clip[], gap: Gap) {
  if (!clips.length) throw Error("音声がありません。");
  const rate = clips[0].rate;
  if (clips.some((c) => c.rate !== rate))
    throw Error("サンプルレートが異なります。");
  const spans = timeline(clips, gap);
  const length = Math.round(spans.at(-1)!.end * rate);
  if (length > rate * 60 * 20)
    throw Error(
      "端末のメモリーを保護するため、音声は20分までです。教材を分けてください。",
    );
  const samples = new Float32Array(length);
  clips.forEach((c, i) =>
    samples.set(c.samples, Math.round(spans[i].start * rate)),
  );
  return { samples, rate, spans };
}
export function sliceAudio(
  samples: Float32Array,
  rate: number,
  a: number,
  b: number,
) {
  if (!validRange(a, b, samples.length / rate))
    throw Error("0 ≦ A < B ≦ 音声の長さにしてください。");
  return samples.slice(Math.round(a * rate), Math.round(b * rate));
}
export function wavBlob(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2),
    v = new DataView(buffer);
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) =>
    v.setInt16(
      44 + i * 2,
      Math.round(Math.max(-1, Math.min(1, s)) * 32767),
      true,
    ),
  );
  return new Blob([buffer], { type: "audio/wav" });
}
export const formatTime = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toFixed(1).padStart(4, "0")}`;
export const clipKey = (text: string, voice: string, speed: number) =>
  JSON.stringify([
    text,
    voice,
    speed,
    voice.startsWith("z") ? "kokoro-v1.1-zh-g2p1-fp32" : "kokoro-v1.0-q8",
  ]);
