import { describe, it, expect } from "vitest";
import {
  splitSentences,
  gapSeconds,
  timeline,
  mergeAudio,
  sliceAudio,
  validRange,
  wavBlob,
  clipKey,
} from "../src/core";
const clips = [
  {
    text: "One.",
    key: "one",
    samples: new Float32Array([0.1, 0.2, 0.3, 0.4]),
    rate: 4,
  },
  { text: "Two.", key: "two", samples: new Float32Array([0.5, 0.6]), rate: 4 },
];
describe("文分割", () => {
  it("略語・小数・イニシャルを途中で切らない", () =>
    expect(
      splitSentences(
        "Dr. Lee paid 3.14 dollars in the U.S. today. What happened next?",
        "en",
      ),
    ).toEqual([
      "Dr. Lee paid 3.14 dollars in the U.S. today.",
      "What happened next?",
    ]));
  it("中国語と引用の句読点を保持", () =>
    expect(
      splitSentences("今天，你感觉怎么样？「很好。」我们开始吧！", "zh"),
    ).toEqual(["今天，你感觉怎么样？", "「很好。」", "我们开始吧！"]));
  it("日本語の注釈や英語を勝手に除去しない", () =>
    expect(
      splitSentences("Hello!\n日本語の注釈\n你好。", "zh").join(" "),
    ).toContain("日本語の注釈"));
  it("長文を途中で切らず末尾を保持", () => {
    const s = "長".repeat(1000) + "。下一句。";
    expect(splitSentences(s, "zh").join("")).toBe(s);
  });
});
describe("時刻と無音", () => {
  it("無音を文の実時間から上下限つきで計算", () => {
    const gap = { mode: "auto" as const, seconds: 2, min: 1, max: 5 };
    expect(gapSeconds(0.4, gap)).toBe(1);
    expect(gapSeconds(8, gap)).toBe(5);
    expect(gapSeconds(2, gap)).toBe(2);
  });
  it("末尾に無音を足さず文の終わりを保持", () => {
    const gap = { mode: "fixed" as const, seconds: 2, min: 1, max: 8 };
    expect(timeline(clips, gap)).toEqual([
      { text: "One.", start: 0, end: 1 },
      { text: "Two.", start: 3, end: 3.5 },
    ]);
    const merged = mergeAudio(clips, gap);
    expect(merged.samples.length).toBe(14);
    expect(merged.samples[13]).toBeCloseTo(0.6);
    expect([...merged.samples.slice(4, 12)]).toEqual(Array(8).fill(0));
  });
  it("音声の内容を変えず無音を変更できる", () => {
    const original = clips[0].samples.slice();
    mergeAudio(clips, { mode: "auto", seconds: 0, min: 2, max: 5 });
    expect(clips[0].samples).toEqual(original);
  });
  it("A–Bの境界・NaN・範囲外を拒否", () => {
    expect(validRange(0, 1, 1)).toBe(true);
    for (const [a, b] of [
      [-1, 1],
      [1, 1],
      [2, 1],
      [0, 2],
      [0, NaN],
    ])
      expect(validRange(a, b, 1)).toBe(false);
  });
  it("選択区間のサンプル境界と語尾を保持", () => {
    expect([...sliceAudio(clips[0].samples, 4, 0.5, 1)]).toEqual([
      ...clips[0].samples.slice(2),
    ]);
    expect(() => sliceAudio(clips[0].samples, 4, 1, 2)).toThrow();
  });
  it("声・生成速度・本文の変更でキャッシュを区別", () => {
    expect(clipKey("Hi", "a", 1)).not.toBe(clipKey("Hi", "b", 1));
    expect(clipKey("Hi", "a", 1)).not.toBe(clipKey("Hi", "a", 0.9));
  });
  it("WAVヘッダーに正しい長さとサンプルレートを記録", async () => {
    const b = await wavBlob(clips[0].samples, 24000).arrayBuffer();
    const v = new DataView(b);
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint32(40, true)).toBe(8);
    expect(b.byteLength).toBe(52);
  });
});
