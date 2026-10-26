import { expect, it } from "vitest";
import { proofreadingChunks } from "../src/proofreading";
it("英語5,000文字を単語・空白・改行を保って小分けにする", () => {
  const unit = "This sentence contains several words and punctuation.\n";
  const text = unit.repeat(100).slice(0, 4990) + " Last end.";
  expect(text).toHaveLength(5000);
  const chunks = proofreadingChunks(text, "en");
  expect(chunks.join("")).toBe(text);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((c) => c.length > 0 && c.length <= 300)).toBe(true);
  const words = (s: string) => s.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? [];
  expect(chunks.flatMap(words)).toEqual(words(text));
});
it("長い1文も英単語や短縮形の途中で分けない", () => {
  const text = "Don't forget this important detail ".repeat(60);
  const chunks = proofreadingChunks(text, "en");
  expect(chunks.join("")).toBe(text);
  expect(chunks.every((c) => c.length <= 300)).toBe(true);
  expect(
    chunks.flatMap((c) => c.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? []),
  ).toEqual(text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g));
});
it("中国語5,000文字と空白・改行を保つ", () => {
  const text = "今天我们一起学习。\n".repeat(500);
  expect(text).toHaveLength(5000);
  const chunks = proofreadingChunks(text, "zh");
  expect(chunks.join("")).toBe(text);
  expect(chunks.every((c) => c.length <= 300)).toBe(true);
});
it("文区切りのない中国語やサロゲートペアも欠落させない", () => {
  const text = "𠀀".repeat(2500);
  const chunks = proofreadingChunks(text, "zh");
  expect(chunks.join("")).toBe(text);
  expect(
    chunks.every(
      (c) => c.length <= 300 && !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(c),
    ),
  ).toBe(true);
});
it("空白だけの範囲も再結合できる", () => {
  const text = " \n".repeat(2500);
  expect(proofreadingChunks(text, "en").join("")).toBe(text);
});
it("上限超過や異常に長い英単語は切り捨てず案内する", () => {
  expect(() => proofreadingChunks("中".repeat(5001), "zh")).toThrow("5,000");
  expect(() => proofreadingChunks("a".repeat(301), "en")).toThrow("長い単語");
});
