import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { formatTime, validRange } from "./core";
import { moveRangePoint } from "./range";
type Props = {
  samples: Float32Array | null;
  sampleRate: number;
  duration: number;
  time: number;
  a: number;
  b: number;
  disabled: boolean;
  onSeek: (time: number) => void;
  onAdjustStart: () => void;
  onRangeChange: (range: { a: number; b: number }) => void;
};
export default function Timeline({
  samples,
  sampleRate,
  duration,
  time,
  a,
  b,
  disabled,
  onSeek,
  onAdjustStart,
  onRangeChange,
}: Props) {
  const help = useId();
  const rail = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; point: "a" | "b"; offset: number } | null>(
    null,
  );
  const [view, setView] = useState({ start: 0, end: duration });
  useEffect(() => {
    drag.current = null;
    setView({ start: 0, end: duration });
  }, [samples, duration]);
  const selected = validRange(a, b, duration),
    start = selected ? a : 0,
    end = selected ? b : duration;
  const span = view.end - view.start;
  const zoomed = span < duration - 0.001;
  const percent = (value: number) =>
    span > 0 ? ((value - view.start) / span) * 100 : 0;
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const peaks = useMemo(() => {
    if (!samples?.length || span <= 0) return [];
    const count = 240;
    const from = Math.floor(view.start * sampleRate),
      to = Math.min(samples.length, Math.ceil(view.end * sampleRate));
    return Array.from({ length: count }, (_, i) => {
      const begin = Math.floor(from + ((to - from) * i) / count),
        end = Math.floor(from + ((to - from) * (i + 1)) / count);
      let peak = 0;
      for (let j = begin; j < end; j++)
        peak = Math.max(peak, Math.abs(samples[j]));
      return Math.max(0.02, peak);
    });
  }, [samples, sampleRate, view.start, view.end]);
  const waveformBars = useMemo(
    () =>
      peaks.map((peak, i) => (
        <rect key={i} x={i} y={24 - peak * 23} width=".7" height={peak * 46} />
      )),
    [peaks],
  );
  function pointTime(time: number) {
    const hundredths = Math.round(time * 100);
    return `${Math.floor(hundredths / 6000)
      .toString()
      .padStart(
        2,
        "0",
      )}:${((hundredths % 6000) / 100).toFixed(2).padStart(5, "0")}`;
  }
  function setWindow(center: number, newSpan: number) {
    const size = Math.min(duration, Math.max(Math.min(0.5, duration), newSpan));
    const start = Math.max(0, Math.min(duration - size, center - size / 2));
    setView({ start, end: start + size });
  }
  function move(point: "a" | "b", value: number) {
    const next = moveRangePoint(
      point,
      Math.round(value * 1000) / 1000,
      start,
      end,
      duration,
    );
    if (next) onRangeChange(next);
  }
  function begin(event: PointerEvent<HTMLButtonElement>, point: "a" | "b") {
    if (disabled || !event.isPrimary || event.button !== 0 || !rail.current)
      return;
    event.preventDefault();
    event.currentTarget.focus();
    onAdjustStart();
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = {
      id: event.pointerId,
      point,
      offset: event.clientX - (rect.left + rect.width / 2),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.id !== event.pointerId || !rail.current || disabled)
      return;
    const rect = rail.current.getBoundingClientRect();
    const fraction = Math.max(
      0,
      Math.min(1, (event.clientX - active.offset - rect.left) / rect.width),
    );
    move(active.point, view.start + fraction * span);
  }
  function finish(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function key(event: KeyboardEvent<HTMLButtonElement>, point: "a" | "b") {
    if (disabled) return;
    const value = point === "a" ? start : end;
    const step =
      (zoomed ? Math.max(0.01, Math.min(0.1, span / 100)) : 0.1) *
      (event.shiftKey ? 10 : 1);
    const values: Record<string, number> = {
      ArrowLeft: value - step,
      ArrowDown: value - step,
      ArrowRight: value + step,
      ArrowUp: value + step,
      Home: 0,
      End: duration,
    };
    if (!(event.key in values)) return;
    event.preventDefault();
    onAdjustStart();
    move(point, values[event.key]);
  }
  return (
    <div className="timeline-control">
      <div className={`interval-gauge ${disabled ? "gauge-disabled" : ""}`}>
        <div ref={rail} className="gauge-rail">
          <svg
            className="gauge-waveform"
            viewBox="0 0 240 48"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {waveformBars}
          </svg>
          {selected && (
            <div
              className="gauge-selection"
              aria-hidden="true"
              style={{
                left: `${clamp(percent(a))}%`,
                right: `${100 - clamp(percent(b))}%`,
              }}
            />
          )}
          {percent(time) >= 0 && percent(time) <= 100 && (
            <div
              className="gauge-playhead"
              aria-hidden="true"
              style={{ left: `${percent(time)}%` }}
            />
          )}
          {(["a", "b"] as const).map((point) => {
            const value = point === "a" ? start : end;
            const position = percent(value);
            const gap = Math.min(0.01, duration / 2);
            return (
              <button
                key={point}
                type="button"
                role="slider"
                className={`gauge-marker gauge-marker-${point}`}
                aria-label={
                  point === "a"
                    ? "ゲージで開始点Aを調整"
                    : "ゲージで終了点Bを調整"
                }
                aria-valuemin={point === "a" ? 0 : start + gap}
                aria-valuemax={
                  point === "a" ? Math.max(0, end - gap) : duration
                }
                aria-valuenow={value}
                aria-valuetext={pointTime(value)}
                aria-describedby={help}
                aria-orientation="horizontal"
                disabled={disabled}
                style={{
                  left: `${position}%`,
                  visibility:
                    position < -0.01 || position > 100.01
                      ? "hidden"
                      : undefined,
                }}
                onPointerDown={(e) => begin(e, point)}
                onPointerMove={pointerMove}
                onPointerUp={finish}
                onPointerCancel={finish}
                onLostPointerCapture={() => {
                  drag.current = null;
                }}
                onKeyDown={(e) => key(e, point)}
              >
                {point.toUpperCase()}
              </button>
            );
          })}
        </div>
        <input
          className="gauge-seek"
          aria-label="再生位置"
          type="range"
          min={view.start}
          max={view.end || 1}
          step={zoomed ? 0.001 : 0.01}
          value={Math.max(view.start, Math.min(time, view.end))}
          disabled={disabled}
          onChange={(e) => onSeek(+e.target.value)}
        />
      </div>
      <div className="gauge-legend">
        <span>A {selected ? pointTime(a) : "—"}</span>
        <span>B {selected ? pointTime(b) : "—"}</span>
      </div>
      <div className="gauge-actions">
        <button
          disabled={disabled}
          onClick={() => {
            onAdjustStart();
            move("a", time);
          }}
        >
          現在位置をAに
        </button>
        <button
          disabled={disabled}
          onClick={() => {
            onAdjustStart();
            move("b", time);
          }}
        >
          現在位置をBに
        </button>
      </div>
      <div className="gauge-tools">
        <span className="small">
          {zoomed
            ? `${formatTime(view.start)}–${formatTime(view.end)}を表示中`
            : "全体を表示中"}
        </span>
        <div className="gauge-zoom">
          <button
            className="text-button"
            aria-label="ゲージを縮小"
            disabled={disabled || !zoomed}
            onClick={() => setWindow((view.start + view.end) / 2, span * 2)}
          >
            縮小
          </button>
          <button
            className="text-button"
            aria-label="ゲージを拡大"
            disabled={disabled || span <= Math.min(0.5, duration) + 0.001}
            onClick={() => setWindow(selected ? (a + b) / 2 : time, span / 2)}
          >
            拡大
          </button>
          <button
            className="text-button"
            disabled={disabled || !selected}
            onClick={() => {
              const pad = Math.max(0.2, (b - a) * 0.25);
              setWindow((a + b) / 2, b - a + pad * 2);
            }}
          >
            区間に合わせる
          </button>
          {zoomed && (
            <button
              className="text-button"
              onClick={() => setView({ start: 0, end: duration })}
            >
              全体を表示
            </button>
          )}
        </div>
      </div>
      <p id={help} className="small gauge-help">
        AとBを左右にドラッグして、くり返す範囲を指定します。上の丸いつまみは再生位置です。「拡大」で短い区間を細かく調整できます。区間を調整すると再生は一時停止します。
      </p>
    </div>
  );
}
