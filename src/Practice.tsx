import { useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Mic,
  Square,
  Download,
  Repeat2,
} from "lucide-react";
import { formatTime, mergeAudio, NO_GAP, validRange, wavBlob } from "./core";
import type { Clip } from "./core";
import type { Lesson, Recording } from "./storage";
import { download, encodeMP3, zipMP3 } from "./export";
import Timeline from "./Timeline";
type Props = {
  lesson: Lesson;
  clips: Clip[];
  update: (patch: Partial<Lesson>) => void;
  error: (message: string) => void;
  recording: Recording | undefined;
  setRecording: (r: Recording | undefined) => void;
};
export default function Practice({
  lesson,
  clips,
  update,
  error,
  recording,
  setRecording,
}: Props) {
  const { gap, mode, a, b, repeat, repeatGap } = lesson;
  const rate = lesson.rate ?? 1,
    loop = lesson.loop ?? false;
  const setRate = (rate: number) => update({ rate }),
    setLoop = (loop: boolean) => update({ loop });
  const merged = useMemo(() => {
    try {
      return clips.length
        ? mergeAudio(clips, mode === "repeat" ? gap : NO_GAP)
        : null;
    } catch (e) {
      return { error: String(e) };
    }
  }, [clips, gap, mode]);
  const data = merged && "samples" in merged ? merged : null;
  const audio = useRef<HTMLAudioElement>(null),
    recordAudio = useRef<HTMLAudioElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    frame = useRef(0),
    counter = useRef(1),
    boundary = useRef<{
      a: number;
      b: number;
      loop: boolean;
      after?: () => void;
    } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    capturePending = useRef(false),
    alive = useRef(true);
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [iteration, setIteration] = useState(1),
    [waiting, setWaiting] = useState(false),
    [capturing, setCapturing] = useState(false),
    [micPending, setMicPending] = useState(false),
    [exporting, setExporting] = useState(false),
    [exports, setExports] = useState<{ name: string; blob: Blob }[]>([]),
    [group, setGroup] = useState(10),
    [modelVolume, setModelVolume] = useState(1),
    [ownVolume, setOwnVolume] = useState(1);
  const priorData = useRef(data),
    gapWaiting = useRef(false);
  const duration = data ? data.samples.length / data.rate : 0;
  const settings = useRef({ repeat, repeatGap });
  settings.current = { repeat, repeatGap };
  function stop(except?: HTMLAudioElement) {
    gapWaiting.current = false;
    clearTimeout(timer.current);
    cancelAnimationFrame(frame.current);
    if (audio.current !== except) audio.current?.pause();
    if (recordAudio.current !== except) recordAudio.current?.pause();
    boundary.current = null;
    setPlaying(false);
    setWaiting(false);
  }
  async function safePlay() {
    try {
      await audio.current!.play();
      setPlaying(true);
    } catch (e) {
      stop();
      error(
        "再生を開始できませんでした。再生ボタンを押してください。 " + String(e),
      );
    }
  }
  function startRange(
    start: number,
    end: number,
    looping: boolean,
    after?: () => void,
  ) {
    stop();
    if (!validRange(start, end, duration)) {
      error("0 ≦ A < B ≦ 音声の長さにしてください。");
      return;
    }
    counter.current = 1;
    setIteration(1);
    boundary.current = { a: start, b: end, loop: looping, after };
    audio.current!.currentTime = start;
    void safePlay();
  }
  useEffect(() => {
    if (!data) return;
    const el = audio.current!;
    const url = URL.createObjectURL(wavBlob(data.samples, data.rate));
    el.src = url;
    return () => {
      stop();
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
    };
  }, [data]);
  useEffect(() => {
    if (priorData.current === data) return;
    priorData.current = data;
    stop();
    setExports([]);
    setTime(0);
    if (a !== 0 || b !== 0 || loop) update({ a: 0, b: 0, loop: false });
    setRecording(undefined);
  }, [data]);
  useEffect(() => {
    audio.current!.playbackRate = rate;
    audio.current!.preservesPitch = true;
  }, [rate, data]);
  useEffect(() => {
    audio.current!.volume = modelVolume;
  }, [modelVolume]);
  useEffect(() => {
    if (recordAudio.current) recordAudio.current.volume = ownVolume;
  }, [ownVolume, recording]);
  useEffect(() => {
    if (!recording) return;
    const el = recordAudio.current!;
    const url = URL.createObjectURL(recording.blob);
    el.src = url;
    return () => {
      el.pause();
      el.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [recording]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop();
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);
  useEffect(() => {
    stop();
  }, [a, b, loop, repeat, repeatGap]);
  useEffect(() => {
    const onOtherPlay = (e: Event) => {
      if (e.target !== audio.current && e.target instanceof HTMLAudioElement)
        stop(e.target);
    };
    document.addEventListener("play", onOtherPlay, true);
    return () => document.removeEventListener("play", onOtherPlay, true);
  }, []);
  function tick() {
    cancelAnimationFrame(frame.current);
    if (gapWaiting.current) return;
    const el = audio.current;
    if (!el) return;
    setTime(el.currentTime);
    const target = boundary.current;
    if (target && (el.currentTime >= target.b - 0.015 || el.ended)) {
      el.pause();
      el.currentTime = target.b;
      setTime(target.b);
      cancelAnimationFrame(frame.current);
      if (
        target.loop &&
        (settings.current.repeat === 0 ||
          counter.current < settings.current.repeat)
      ) {
        gapWaiting.current = true;
        setWaiting(true);
        timer.current = setTimeout(() => {
          gapWaiting.current = false;
          counter.current++;
          setIteration(counter.current);
          setWaiting(false);
          el.currentTime = target.a;
          void safePlay();
        }, settings.current.repeatGap * 1000);
      } else {
        const after = target.after;
        boundary.current = null;
        setPlaying(false);
        setWaiting(false);
        after?.();
      }
      return;
    }
    if (!el.paused) frame.current = requestAnimationFrame(tick);
  }
  function toggle() {
    if (playing || waiting) {
      stop();
      return;
    }
    if (loop) {
      startRange(a, b, true);
      return;
    }
    const start =
      audio.current!.currentTime >= duration - 0.02
        ? 0
        : audio.current!.currentTime;
    startRange(start, duration, false);
  }
  async function record() {
    if (capturing) {
      recorder.current?.stop();
      return;
    }
    if (capturePending.current) return;
    stop();
    document.querySelectorAll("audio").forEach((el) => el.pause());
    capturePending.current = true;
    setMicPending(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw Error(
          "このブラウザーでは録音できません。HTTPSまたはlocalhostで、対応ブラウザーをお使いください。",
        );
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      const rec = new MediaRecorder(s);
      recorder.current = rec;
      const chunks: Blob[] = [];
      const range = validRange(a, b, duration)
        ? { a, b }
        : { a: 0, b: duration };
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => {
        s.getTracks().forEach((t) => t.stop());
        if (!alive.current) return;
        setCapturing(false);
        const blob = new Blob(chunks, { type: rec.mimeType });
        if (blob.size)
          setRecording({
            ...range,
            blob,
            label: `${formatTime(range.a)}–${formatTime(range.b)}`,
          });
      };
      rec.onerror = () => {
        s.getTracks().forEach((t) => t.stop());
        setCapturing(false);
        error("録音中にエラーが発生しました。");
      };
      rec.start();
      setCapturing(true);
    } catch (e) {
      error(
        "録音を開始できませんでした。マイク権限を確認してください。通常の練習は続けられます。 " +
          String(e),
      );
    } finally {
      capturePending.current = false;
      setMicPending(false);
    }
  }
  async function output(kind: "plain" | "gaps" | "ab" | "parts") {
    if (!data || exporting) return;
    setExporting(true);
    stop();
    setExports([]);
    try {
      const safeTitle = (lesson.title || "lesson").replace(
        /[\\/:*?"<>|]/g,
        "_",
      );
      const groups =
        kind === "parts"
          ? Array.from({ length: Math.ceil(clips.length / group) }, (_, i) =>
              clips.slice(i * group, (i + 1) * group),
            )
          : [clips];
      const files = [];
      for (let i = 0; i < groups.length; i++) {
        const merged = mergeAudio(groups[i], kind === "gaps" ? gap : NO_GAP);
        const samples =
          kind === "ab"
            ? data.samples.slice(
                Math.round(a * data.rate),
                Math.round(b * data.rate),
              )
            : merged.samples;
        if (kind === "ab" && !validRange(a, b, duration))
          throw Error("A–B区間を設定してください。");
        const blob = await encodeMP3(samples, merged.rate);
        files.push({
          name: `${safeTitle}-${kind}-${String(i + 1).padStart(2, "0")}.mp3`,
          blob,
        });
      }
      setExports(files);
    } catch (e) {
      error(String(e));
    } finally {
      setExporting(false);
    }
  }
  const active =
    data?.spans.findIndex((s) => time >= s.start && time < s.end) ?? -1;
  return (
    <section className="card practice">
      <div className="section-heading">
        <h2>04 練習する</h2>
        <span className="tag">{clips.length}文の音声</span>
      </div>
      <p className="muted">
        生成音声、または持ち込み音声で練習できます。再生速度と練習の無音は、音声の再生成なしで変更できます。
      </p>
      {merged && "error" in merged && <p role="alert">{merged.error}</p>}
      <div className="segmented">
        <button
          aria-pressed={mode === "shadow"}
          onClick={() => update({ mode: "shadow" })}
        >
          シャドーイング
        </button>
        <button
          aria-pressed={mode === "repeat"}
          onClick={() => update({ mode: "repeat" })}
        >
          リピーティング
        </button>
      </div>
      {mode === "repeat" && (
        <div className="inset">
          <label>
            文間の無音
            <select
              value={gap.mode}
              onChange={(e) =>
                update({
                  gap: { ...gap, mode: e.target.value as typeof gap.mode },
                })
              }
            >
              <option value="none">なし</option>
              <option value="fixed">固定秒数</option>
              <option value="auto">文の長さに応じて自動</option>
            </select>
          </label>
          {gap.mode === "fixed" && (
            <label>
              無音（秒）
              <input
                type="number"
                min="0"
                max="30"
                value={gap.seconds}
                onChange={(e) =>
                  update({
                    gap: {
                      ...gap,
                      seconds: Math.max(0, Math.min(30, +e.target.value)),
                    },
                  })
                }
              />
            </label>
          )}
          {gap.mode === "auto" && (
            <>
              <p className="small">
                無音 = 実際の文の発話時間 × 1。下限と上限で調整します。
              </p>
              <div className="row">
                <label>
                  下限（秒）
                  <input
                    type="number"
                    min="0"
                    max={gap.max}
                    value={gap.min}
                    onChange={(e) =>
                      update({
                        gap: {
                          ...gap,
                          min: Math.max(0, Math.min(gap.max, +e.target.value)),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  上限（秒）
                  <input
                    type="number"
                    min={gap.min}
                    max="30"
                    value={gap.max}
                    onChange={(e) =>
                      update({
                        gap: {
                          ...gap,
                          max: Math.max(gap.min, Math.min(30, +e.target.value)),
                        },
                      })
                    }
                  />
                </label>
              </div>
            </>
          )}
          <p className="small">
            無音設定・モードを変えると時刻を再計算し、A–B区間と一時録音を解除します。
          </p>
        </div>
      )}
      <audio
        ref={audio}
        onPlay={() => {
          cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(tick);
        }}
        onTimeUpdate={() => {
          if (
            audio.current &&
            !audio.current.paused &&
            boundary.current &&
            audio.current.currentTime >= boundary.current.b - 0.015
          )
            tick();
        }}
        onEnded={() => {
          if (boundary.current) tick();
          else setPlaying(false);
        }}
      />
      <div className="player">
        <div className="time">
          <span>{formatTime(time)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <Timeline
          samples={data?.samples ?? null}
          sampleRate={data?.rate ?? 24000}
          duration={duration}
          time={time}
          a={a}
          b={b}
          disabled={!data || capturing}
          onAdjustStart={() => stop()}
          onRangeChange={(range) => {
            stop();
            update({ ...range, loop: true });
          }}
          onSeek={(next) => {
            stop();
            audio.current!.currentTime = next;
            setTime(next);
          }}
        />
        <div className="transport">
          <button
            aria-label="前の文"
            disabled={!data || capturing}
            onClick={() => {
              const idx = Math.max(0, active - 1);
              startRange(data!.spans[idx].start, duration, false);
            }}
          >
            <SkipBack size={22} />
          </button>
          <button
            className="play-button"
            disabled={!data || capturing}
            onClick={toggle}
          >
            {playing || waiting ? <Pause /> : <Play />}
            {waiting ? "無音中" : playing ? "一時停止" : "再生"}
          </button>
          <button
            aria-label="次の文"
            disabled={!data || capturing}
            onClick={() => {
              const idx = Math.min(data!.spans.length - 1, active + 1);
              startRange(data!.spans[idx].start, duration, false);
            }}
          >
            <SkipForward size={22} />
          </button>
        </div>
        <div className="speed-section">
          <div className="speed-label">
            <label htmlFor="playback-speed">再生速度（高さを維持）</label>
            <output htmlFor="playback-speed">{rate.toFixed(2)}×</output>
          </div>
          <input
            id="playback-speed"
            type="range"
            min="0.5"
            max="2"
            step="0.05"
            value={rate}
            onChange={(e) => setRate(+e.target.value)}
          />
          <div className="speed-scale">
            <span>0.5×（ゆっくり）</span>
            <button className="text-button" onClick={() => setRate(1)}>
              1.0×に戻す
            </button>
            <span>2.0×（速い）</span>
          </div>
        </div>
      </div>
      <div className="inset">
        <h3>
          <Repeat2 size={18} /> A–B 区間リピート
        </h3>
        <details className="range-numbers">
          <summary>時刻を数字で調整</summary>
          <div className="row">
            <label>
              開始 A（秒）
              <input
                aria-label="開始 A（秒）"
                type="number"
                min="0"
                max={duration}
                step="0.01"
                value={a}
                onChange={(e) => update({ a: +e.target.value })}
              />
            </label>
            <label>
              終了 B（秒）
              <input
                aria-label="終了 B（秒）"
                type="number"
                min="0"
                max={duration}
                step="0.01"
                value={b}
                onChange={(e) => update({ b: +e.target.value })}
              />
            </label>
          </div>
        </details>
        <p className="small">
          {validRange(a, b, duration)
            ? `A ${formatTime(a)} → B ${formatTime(b)}`
            : a !== 0 || b !== 0
              ? "0 ≦ A < B ≦ 音声の長さにしてください。"
              : "ゲージのA・Bを動かして、繰り返したい範囲を指定してください。"}
        </p>
        <div className="row">
          <label>
            繰り返し回数
            <select
              value={repeat}
              onChange={(e) => update({ repeat: +e.target.value })}
            >
              {[1, 3, 5, 0].map((n) => (
                <option key={n} value={n}>
                  {n || "無限"}
                  {n ? "回" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            区間の間の無音（秒）
            <input
              type="number"
              min="0"
              max="30"
              step="0.5"
              value={repeatGap}
              onChange={(e) =>
                update({
                  repeatGap: Math.max(0, Math.min(30, +e.target.value)),
                })
              }
            />
          </label>
        </div>
        <div className="row">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={loop}
              disabled={!validRange(a, b, duration)}
              onChange={(e) => setLoop(e.target.checked)}
            />
            区間リピート {loop && `· ${iteration}回目`}
          </label>
          <button
            className="text-button"
            onClick={() => {
              setLoop(false);
              update({ a: 0, b: 0 });
            }}
          >
            区間を解除
          </button>
        </div>
        <p className="small">
          ゲージのA・Bを動かすと、区間リピートがオンになります。背景に移ると、区間ずれを防ぐため再生を停止します。
        </p>
      </div>
      {data && (
        <details className="transcript">
          <summary>本文を見る（文を押すとその位置から再生）</summary>
          <div className="sentence-list">
            {data.spans.map((s, i) => (
              <div
                key={i}
                className={`sentence ${active === i ? "active" : ""}`}
              >
                <button
                  disabled={capturing}
                  onClick={() => startRange(s.start, duration, false)}
                >
                  <span className="sentence-number">
                    {String(i + 1).padStart(2, "0")} · {formatTime(s.start)}
                  </span>
                  {s.text}
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
      <details>
        <summary>自分の声を録音して比較</summary>
        <p className="small">
          録音は端末内だけで扱います。A–B区間（未設定なら全文）に対応づけます。マイクはHTTPSまたはlocalhostが必要です。
        </p>
        <button disabled={!data || micPending} onClick={() => void record()}>
          {capturing ? <Square size={18} /> : <Mic size={18} />}{" "}
          {micPending
            ? "マイクを準備中"
            : capturing
              ? "録音を停止"
              : "録音する／録り直す"}
        </button>
        {capturing && <span role="status"> 録音中…</span>}
        <audio ref={recordAudio} />
        {recording && (
          <>
            <p className="small">録音の対応区間：{recording.label}</p>
            <div className="row">
              <button
                disabled={capturing}
                onClick={() => {
                  stop();
                  recordAudio.current!.currentTime = 0;
                  void recordAudio
                    .current!.play()
                    .catch((e) => error(String(e)));
                }}
              >
                録音を再生
              </button>
              <button
                disabled={capturing}
                onClick={() =>
                  startRange(recording.a, recording.b, false, () => {
                    recordAudio.current!.currentTime = 0;
                    void recordAudio
                      .current!.play()
                      .catch((e) => error(String(e)));
                  })
                }
              >
                お手本 → 自分の声
              </button>
              <button onClick={() => stop()}>比較を停止</button>
            </div>
          </>
        )}
        <div className="row">
          <label>
            お手本の音量
            <input
              aria-label="お手本の音量"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={modelVolume}
              onChange={(e) => setModelVolume(+e.target.value)}
            />
          </label>
          <label>
            録音の音量
            <input
              aria-label="録音の音量"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={ownVolume}
              onChange={(e) => setOwnVolume(+e.target.value)}
            />
          </label>
        </div>
      </details>
      <details>
        <summary>MP3をダウンロード</summary>
        <p className="small">
          端末内でMP3に変換します。再生速度は反映せず、生成時の等速で保存します。語尾を保つため、文の途中では分割しません。
        </p>
        <div className="button-grid">
          <button
            disabled={!data || exporting}
            onClick={() => void output("plain")}
          >
            <Download size={17} />
            全文・無音なし
          </button>
          <button
            disabled={!data || exporting}
            onClick={() => void output("gaps")}
          >
            全文・設定した無音あり
          </button>
          <button
            disabled={!data || exporting || !validRange(a, b, duration)}
            onClick={() => void output("ab")}
          >
            選択したA–B区間
          </button>
        </div>
        <div className="row">
          <label>
            1ファイルあたりの文数
            <input
              type="number"
              min="1"
              max="100"
              value={group}
              onChange={(e) =>
                setGroup(Math.max(1, Math.min(100, +e.target.value)))
              }
            />
          </label>
          <button
            disabled={!data || exporting}
            onClick={() => void output("parts")}
          >
            文数で分割する
          </button>
        </div>
        {exporting && <p role="status">MP3に変換中…</p>}
        {exports.map((f) => (
          <button
            className="download-link"
            key={f.name}
            onClick={() => download(f.blob, f.name)}
          >
            <Download size={16} />
            {f.name}（{Math.ceil(f.blob.size / 1024)} KB）
          </button>
        ))}
        {exports.length > 1 && (
          <button
            onClick={() => {
              void zipMP3(exports)
                .then((blob) => download(blob, "coaching-l-audio.zip"))
                .catch((e) => error(String(e)));
            }}
          >
            まとめてZIP保存
          </button>
        )}
      </details>
    </section>
  );
}
