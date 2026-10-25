import { validRange } from "./core";
export function moveRangePoint(
  point: "a" | "b",
  time: number,
  a: number,
  b: number,
  duration: number,
) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(time))
    return null;
  const current = validRange(a, b, duration) ? { a, b } : { a: 0, b: duration };
  const gap = Math.min(0.01, duration / 2);
  if (point === "a")
    return { a: Math.max(0, Math.min(current.b - gap, time)), b: current.b };
  return {
    a: current.a,
    b: Math.min(duration, Math.max(current.a + gap, time)),
  };
}
