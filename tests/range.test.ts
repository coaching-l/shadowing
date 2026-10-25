import { describe, it, expect } from "vitest";
import { moveRangePoint } from "../src/range";
import { validRange } from "../src/core";
describe("ゲージの区間境界", () => {
  it("未設定の区間からAを動かすとBを音声の末尾にする", () =>
    expect(moveRangePoint("a", 2, 0, 0, 10)).toEqual({ a: 2, b: 10 }));
  it("Bから動かしても区間を作れる", () =>
    expect(moveRangePoint("b", 7, 0, 0, 10)).toEqual({ a: 0, b: 7 }));
  it("AとBを交差させず音声の長さを超えない", () => {
    expect(moveRangePoint("a", 20, 2, 8, 10)).toEqual({ a: 7.99, b: 8 });
    expect(moveRangePoint("b", -4, 2, 8, 10)).toEqual({ a: 2, b: 2.01 });
    expect(moveRangePoint("b", 30, 2, 8, 10)).toEqual({ a: 2, b: 10 });
    expect(moveRangePoint("a", -30, 2, 8, 10)).toEqual({ a: 0, b: 8 });
  });
  it("短い音声でも有効な区間を保つ", () => {
    for (const duration of [0.001, 0.005, 0.01, 0.1, 10])
      for (const point of ["a", "b"] as const) {
        const range = moveRangePoint(
          point,
          point === "a" ? 100 : -100,
          0,
          0,
          duration,
        )!;
        expect(validRange(range.a, range.b, duration)).toBe(true);
      }
  });
  it("音声がない場合や非数値は変更しない", () => {
    for (const duration of [0, NaN, Infinity, -1])
      expect(moveRangePoint("a", 0, 0, 0, duration)).toBeNull();
    expect(moveRangePoint("b", NaN, 0, 1, 1)).toBeNull();
  });
});
