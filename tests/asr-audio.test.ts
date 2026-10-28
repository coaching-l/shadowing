import { describe, expect, it } from "vitest";
import { prepareTranscriptionAudio } from "../src/asr-audio";

describe("持ち込み音声の文字起こし用変換", () => {
  it("指定区間だけを16kHzへ変換し、元のPCMを変更しない", async () => {
    const source = new Float32Array(48000 * 2);
    source.fill(0.1, 0, 48000);
    source.fill(0.3, 48000);
    const output = await prepareTranscriptionAudio(source, 48000, 1, 2);
    expect(output.length).toBe(16000);
    expect(output[0]).toBeCloseTo(0.3);
    expect(output.at(-1)).toBeCloseTo(0.3);
    expect(source[0]).toBeCloseTo(0.1);
    expect(source.length).toBe(96000);
  });
  it("非整数比のダウンサンプリングでも長さと一定音量を保つ", async () => {
    const source = new Float32Array(44100).fill(0.25);
    const output = await prepareTranscriptionAudio(source, 44100, 0, 1);
    expect(output.length).toBe(16000);
    expect(output.every((value) => Math.abs(value - 0.25) < 1e-6)).toBe(true);
  });
  it("無音・非有限値・範囲外・短すぎる区間を推論に送らない", async () => {
    const source = new Float32Array(16000);
    await expect(
      prepareTranscriptionAudio(source, 16000, 0, 1),
    ).rejects.toThrow("無音");
    source.fill(0.2);
    source[4000] = NaN;
    await expect(
      prepareTranscriptionAudio(source, 16000, 0, 1),
    ).rejects.toThrow("読み取れない値");
    await expect(
      prepareTranscriptionAudio(source, 16000, 0, 2),
    ).rejects.toThrow("範囲");
    await expect(
      prepareTranscriptionAudio(source, 16000, 0, 0.1),
    ).rejects.toThrow("0.4秒");
  });
  it("変換途中の中止に応答し、部分音声を返さない", async () => {
    const source = new Float32Array(16000 * 10).fill(0.2);
    let stopped = false;
    const operation = prepareTranscriptionAudio(
      source,
      16000,
      0,
      10,
      () => stopped,
    );
    stopped = true;
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
  });
});
