import type { Lang } from "./core";

export const ASR_SAMPLE_RATE = 16000;
export const ASR_MAX_SECONDS = 1200;

export function asrProfile(lang: Lang) {
  return lang === "en"
    ? {
        model: "Xenova/whisper-tiny.en",
        revision: "79fb389fc764e7c395bd330e9531d9d32ada7049",
        // English-only Whisper rejects both `language` and `task`.
        generation: {},
      }
    : {
        model: "Xenova/whisper-tiny",
        revision: "5332fcc35e32a33b86612b9a57a89be7906102b1",
        generation: { language: "chinese", task: "transcribe" },
      };
}

export function validateAsrAudio(samples: Float32Array) {
  if (
    !(samples instanceof Float32Array) ||
    samples.length < ASR_SAMPLE_RATE * 0.4 ||
    samples.length > ASR_SAMPLE_RATE * ASR_MAX_SECONDS
  )
    throw Error("文字起こしの音声は0.4秒〜20分にしてください。");
  let energy = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample))
      throw Error("音声データを確認できませんでした。");
    energy += sample * sample;
  }
  if (Math.sqrt(energy / samples.length) < 0.0001)
    throw Error("音声が無音、または小さすぎます。音声を確認してください。");
}

// Keep only one segment's features in memory. Transformers' built-in chunking
// prepares all segments first. Prefer a quiet boundary near 20 seconds without
// dropping or duplicating any samples; word alignment is deliberately not implied.
export function* asrSegments(samples: Float32Array) {
  let start = 0;
  const target = 20 * ASR_SAMPLE_RATE;
  const search = 2 * ASR_SAMPLE_RATE;
  const window = Math.round(0.04 * ASR_SAMPLE_RATE);
  while (start < samples.length) {
    let end = Math.min(start + target, samples.length);
    if (samples.length - start > 24 * ASR_SAMPLE_RATE) {
      let quietest = Infinity;
      let boundary = end;
      for (
        let position = end - search;
        position <= end + search;
        position += window
      ) {
        let energy = 0;
        for (let i = position; i < position + window; i++)
          energy += samples[i] ** 2;
        // Prefer the planned boundary when equally quiet (e.g. a long pause).
        const score = energy + Math.abs(position - end) * 1e-12;
        if (score < quietest) {
          quietest = score;
          boundary = position + Math.floor(window / 2);
        }
      }
      end = boundary;
    } else end = samples.length;
    yield { samples: samples.subarray(start, end), start, end };
    start = end;
  }
}
