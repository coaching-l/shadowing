import { describe, expect, it } from "vitest";
import {
  asrProfile,
  asrSegments,
  validateAsrAudio,
  ASR_SAMPLE_RATE,
} from "../src/asr-config";

describe("小型の端末内文字起こし", () => {
  it("英語はtiny.en、中国語は多言語tinyを固定し、baseへ切り替えない", () => {
    expect(asrProfile("en").model).toBe("Xenova/whisper-tiny.en");
    expect(asrProfile("en").generation).toEqual({});
    expect(asrProfile("zh").model).toBe("Xenova/whisper-tiny");
    expect(asrProfile("zh").generation).toEqual({
      language: "chinese",
      task: "transcribe",
    });
  });

  it("20分の音声も短い連続区間に分け、末尾まで欠落・複製しない", () => {
    const audio = new Float32Array(ASR_SAMPLE_RATE * 1200).fill(0.1);
    const segments = [...asrSegments(audio)];
    expect(segments.length).toBeGreaterThan(50);
    let consumed = 0;
    for (const segment of segments) {
      expect(segment.start).toBe(consumed);
      expect(segment.samples.buffer).toBe(audio.buffer);
      expect(segment.samples.length).toBeLessThanOrEqual(ASR_SAMPLE_RATE * 24);
      consumed += segment.samples.length;
      expect(segment.end).toBe(consumed);
    }
    expect(consumed).toBe(audio.length);
  });

  it("近くに無音があれば文の途中を避ける境界に使う", () => {
    const audio = new Float32Array(ASR_SAMPLE_RATE * 50).fill(0.2);
    audio.fill(0, ASR_SAMPLE_RATE * 21, ASR_SAMPLE_RATE * 21.2);
    const [first] = asrSegments(audio);
    expect(first.end / ASR_SAMPLE_RATE).toBeGreaterThanOrEqual(21);
    expect(first.end / ASR_SAMPLE_RATE).toBeLessThan(21.2);
  });

  it("短い音声は途中で分けず、無音・不正値・長さ超過はモデル準備前に拒否する", () => {
    const audio = new Float32Array(ASR_SAMPLE_RATE * 3).fill(0.1);
    expect([...asrSegments(audio)]).toHaveLength(1);
    expect(() => validateAsrAudio(audio)).not.toThrow();
    expect(() => validateAsrAudio(new Float32Array(16000))).toThrow("無音");
    expect(() => validateAsrAudio(new Float32Array(100))).toThrow("0.4秒");
    audio[20] = NaN;
    expect(() => validateAsrAudio(audio)).toThrow("音声データ");
    expect(() =>
      validateAsrAudio(new Float32Array(ASR_SAMPLE_RATE * 1200 + 1)),
    ).toThrow("20分");
  });
});
