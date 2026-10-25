import { describe, it, expect } from "vitest";
import { mandarinPhonemes, syllable } from "../src/mandarin";
describe("普通話のKokoro v1.1読み変換", () => {
  it("舌尖母音とüの特殊表記", () => {
    expect(syllable("zhi4", 4)).toBe("ㄓ十4");
    expect(syllable("zi3", 3)).toBe("ㄗㄭ3");
    expect(syllable("jue2", 2)).toBe("ㄐ月2");
    expect(syllable("yun2", 2)).toBe("云2");
  });
  it("第三声の変調と句読点を保持", () => {
    const p = mandarinPhonemes("你好，今天你想做什么？");
    expect(p).toContain("ㄋㄧ2ㄏㄠ3");
    expect(p).toContain(",");
    expect(p.endsWith("?")).toBe(true);
    expect(p).not.toContain("❓");
  });
  it("語の境界は保持し、一字ずつ区切らない", () =>
    expect(mandarinPhonemes("今天的进步。")).toContain("ㄐ阴1ㄊ言1"));
  it("未対応文字を黙って削除しない", () => {
    expect(() => mandarinPhonemes("今天练习AI。")).toThrow();
    expect(() => mandarinPhonemes("2026年")).toThrow();
    expect(() => mandarinPhonemes("你好😊")).toThrow();
  });
});
