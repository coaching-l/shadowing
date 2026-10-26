import { it, expect } from "vitest";
import { joinPdfText } from "../src/pdf-text";
const item = (
  str: string,
  x: number,
  width: number,
  hasEOL = false,
  y = 700,
) => ({
  str,
  dir: "ltr",
  width,
  height: 12,
  transform: [12, 0, 0, 12, x, y],
  hasEOL,
});
it("字体の異なる連続した文字断片に空白を挿入しない", () => {
  expect(
    joinPdfText([item("sti", 0, 15), item("fl", 15, 8), item("ed", 23, 12)]),
  ).toBe("stifled");
});
it("本当の単語間や明示された空白を保持する", () => {
  expect(joinPdfText([item("Hello", 0, 25), item("world", 30, 25)])).toBe(
    "Hello world",
  );
  expect(
    joinPdfText([
      item("Hello", 0, 25),
      item(" ", 25, 5),
      item("world", 30, 25),
    ]),
  ).toBe("Hello world");
});
it("明示された改行・行の移動と読み順を保つ", () => {
  expect(
    joinPdfText([
      item("First line", 0, 50, true),
      item("Second line", 0, 60, false, 680),
    ]),
  ).toBe("First line\nSecond line");
  expect(
    joinPdfText([
      item("First line", 0, 50),
      item("Second line", 0, 60, false, 680),
    ]),
  ).toBe("First line\nSecond line");
});
it("回転した連続テキストも文字の進む軸で判定する", () => {
  const a = { ...item("sti", 0, 15), transform: [0, 12, -12, 0, 30, 0] };
  const b = { ...item("fled", 0, 20), transform: [0, 12, -12, 0, 30, 15] };
  expect(joinPdfText([a, b])).toBe("stifled");
});
it("マーク用の項目は本文に追加しない", () => {
  expect(
    joinPdfText([
      { type: "beginMarkedContent" },
      item("Text", 0, 20),
      { type: "endMarkedContent" },
    ]),
  ).toBe("Text");
});
