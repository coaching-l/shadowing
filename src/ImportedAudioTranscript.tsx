import { useEffect, useRef, useState } from "react";
import { formatTime, validRange } from "./core";
import type { Lang } from "./core";
import { prepareTranscriptionAudio } from "./asr-audio";
import { localAI } from "./local-ai";

type Props = {
  samples: Float32Array;
  sampleRate: number;
  lang: Lang;
  a: number;
  b: number;
  blocked: boolean;
  onPrepare: () => void;
  onBusyChange: (busy: boolean) => void;
  onApply: (text: string) => void;
};

export default function ImportedAudioTranscript({
  samples,
  sampleRate,
  lang,
  a,
  b,
  blocked,
  onPrepare,
  onBusyChange,
  onApply,
}: Props) {
  const duration = samples.length / sampleRate;
  const hasRange = validRange(a, b, duration);
  const [scope, setScope] = useState<"full" | "range">(
    hasRange ? "range" : "full",
  );
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [recognizedRange, setRecognizedRange] = useState("");
  const operation = useRef(0);
  const active = useRef(false);
  const inference = useRef(false);
  const mounted = useRef(false);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const current = (id: number) => mounted.current && operation.current === id;

  function cancel() {
    operation.current++;
    if (inference.current) localAI.release();
    inference.current = false;
    active.current = false;
    setRunning(false);
    busyCallback.current(false);
    setStatus(
      "文字起こしを中止しました。前回の結果がある場合はそのまま残しています。",
    );
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current++;
      if (active.current) {
        if (inference.current) localAI.release();
        inference.current = false;
        active.current = false;
        busyCallback.current(false);
      }
    };
  }, []);
  useEffect(() => {
    operation.current++;
    if (active.current) {
      if (inference.current) localAI.release();
      inference.current = false;
      active.current = false;
      setRunning(false);
      busyCallback.current(false);
    }
    setText("");
    setRecognizedRange("");
    setError("");
    setStatus("");
  }, [samples, sampleRate, lang]);

  async function transcribe() {
    if (blocked || active.current || (scope === "range" && !hasRange)) return;
    const range =
      scope === "range" && hasRange ? { a, b } : { a: 0, b: duration };
    const label = `${formatTime(range.a)}–${formatTime(range.b)}`;
    const id = ++operation.current;
    active.current = true;
    setRunning(true);
    setError("");
    setStatus("文字起こし用に音声を準備しています…");
    onBusyChange(true);
    try {
      onPrepare();
      const input = await prepareTranscriptionAudio(
        samples,
        sampleRate,
        range.a,
        range.b,
        () => !current(id),
      );
      if (!current(id)) return;
      inference.current = true;
      const transcript = await localAI.run(
        "transcribe",
        { lang, samples: input },
        (message) => {
          if (current(id)) setStatus(message);
        },
      );
      if (!current(id)) return;
      if (!transcript.trim())
        throw Error(
          "文章を認識できませんでした。音声を聴き、短いA–B区間でお試しください。",
        );
      setText(transcript);
      setRecognizedRange(label);
      setStatus(
        "文字起こしが終わりました。聴き直して修正し、「この文字起こしを本文に反映」を押してください。",
      );
    } catch (e) {
      if (current(id)) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("");
      }
    } finally {
      if (current(id)) {
        active.current = false;
        inference.current = false;
        setRunning(false);
        onBusyChange(false);
      }
    }
  }

  return (
    <details>
      <summary>音声を文字起こし</summary>
      <div className="local-ai-panel">
        <p className="small">
          MP3などの持ち込み音声を、この端末で文字にします。
          {lang === "en" ? "英語専用のWhisper tiny.en" : "Whisper tiny"}
          （初回約41
          MB）を使います。無料・ログイン不要で、音声を外部AIへ送りません。
          長い音声は短い区間に分け、順番に処理します。iPhoneでは時間がかかる場合があります。
        </p>
        <label>
          文字起こしする範囲
          <select
            value={scope}
            disabled={blocked || running}
            onChange={(event) =>
              setScope(event.target.value as "full" | "range")
            }
          >
            <option value="full">音声全体（{formatTime(duration)}）</option>
            <option value="range" disabled={!hasRange}>
              選択したA–B区間
              {hasRange
                ? `（${formatTime(a)}–${formatTime(b)}）`
                : "（先にゲージで指定）"}
            </option>
          </select>
        </label>
        <button
          disabled={blocked || running || (scope === "range" && !hasRange)}
          onClick={() => void transcribe()}
        >
          音声を端末内AIで文字起こし
        </button>
        {running && <button onClick={cancel}>文字起こしを中止</button>}
        {status && (
          <p
            className="small"
            role="status"
            aria-label="持ち込み音声の文字起こし状況"
          >
            {status}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {text && (
          <>
            <p className="small">
              文字起こしした範囲：{recognizedRange}
              。誤認識は下の欄で修正できます。本文に反映しても音声の区切り・A–B設定は変えず、文章と音声の自動位置合わせは行いません。
            </p>
            <label>
              持ち込み音声の文字起こし（編集できます）
              <textarea
                rows={6}
                maxLength={50000}
                disabled={blocked || running}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            {text.length > 50000 && (
              <p className="small">
                本文に反映するには50,000文字以内に編集してください。
              </p>
            )}
            <button
              disabled={
                blocked || running || !text.trim() || text.length > 50000
              }
              onClick={() => {
                onApply(text.trim());
                setStatus(
                  "本文に反映しました。元の音声で引き続き練習できます。保存する場合は「教材を保存」を押してください。",
                );
              }}
            >
              この文字起こしを本文に反映
            </button>
          </>
        )}
      </div>
    </details>
  );
}
