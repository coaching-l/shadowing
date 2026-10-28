import { validRange } from "./core";

/** Make one owned 16 kHz mono input without duplicating the high-rate source. */
export async function prepareTranscriptionAudio(
  source: Float32Array,
  sampleRate: number,
  a: number,
  b: number,
  cancelled: () => boolean = () => false,
): Promise<Float32Array> {
  const duration = source.length / sampleRate;
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 192000 ||
    !validRange(a, b, duration)
  )
    throw Error(
      "音声の範囲を確認できませんでした。音声を読み込み直してください。",
    );
  const seconds = b - a;
  if (seconds < 0.4 || seconds > 1200.01)
    throw Error("文字起こしは0.4秒〜20分の範囲で行ってください。");
  const check = () => {
    if (cancelled())
      throw new DOMException("文字起こしを中止しました。", "AbortError");
  };
  check();
  const target = new Float32Array(Math.floor(seconds * 16000));
  const ratio = sampleRate / 16000;
  const start = a * sampleRate;
  let energy = 0;
  for (let base = 0; base < target.length; base += 64000) {
    check();
    const end = Math.min(base + 64000, target.length);
    for (let i = base; i < end; i++) {
      const left = start + i * ratio;
      let value = 0;
      if (ratio >= 1) {
        // Average each input interval rather than dropping samples on downsampling.
        const right = Math.min(start + (i + 1) * ratio, source.length);
        for (let k = Math.floor(left); k < Math.ceil(right); k++) {
          const weight = Math.min(right, k + 1) - Math.max(left, k);
          value += source[k] * weight;
        }
        value /= right - left;
      } else {
        const k = Math.floor(left);
        const fraction = left - k;
        value =
          source[k] * (1 - fraction) +
          source[Math.min(k + 1, source.length - 1)] * fraction;
      }
      if (!Number.isFinite(value))
        throw Error(
          "音声に読み取れない値が含まれています。別の音声でお試しください。",
        );
      target[i] = value;
      energy += value * value;
    }
    // Let Safari render progress and accept cancellation during long imports.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  check();
  if (Math.sqrt(energy / target.length) < 0.0001)
    throw Error(
      "音声が無音、または小さすぎます。音量と選択範囲を確認してください。",
    );
  return target;
}
