import { useEffect, useRef, useState } from "react";
import type { Lang } from "./core";
import type { Recording } from "./storage";
import {
  compareTranscript,
  decodeRecording,
  normalizeChineseComparison,
} from "./feedback";
import type { Difference } from "./feedback";
import { localAI } from "./local-ai";
type Props = {
  recording: Recording;
  lang: Lang;
  reference: string;
  partial: boolean;
  blocked: boolean;
  onPrepare: () => void;
  onBusyChange: (busy: boolean) => void;
};
export default function RecordingFeedback({
  recording,
  lang,
  reference,
  partial,
  blocked,
  onPrepare,
  onBusyChange,
}: Props) {
  const [expected, setExpected] = useState(reference),
    [heard, setHeard] = useState(""),
    [running, setRunning] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const [result, setResult] = useState<Difference[] | null>(null),
    [seconds, setSeconds] = useState(0),
    [soundNote, setSoundNote] = useState("");
  const comparison = useRef(0);
  const active = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    comparison.current++;
    alive.current = true;
    return () => {
      alive.current = false;
      if (active.current) {
        localAI.release();
        onBusyChange(false);
      }
    };
  }, [onBusyChange]);
  useEffect(() => {
    comparison.current++;
    setExpected(reference);
    setHeard("");
    setResult(null);
    setStatus("");
    setError("");
    setSeconds(0);
    setSoundNote("");
  }, [recording, reference, lang]);
  async function transcribe() {
    if (blocked || active.current) return;
    comparison.current++;
    onPrepare();
    active.current = true;
    setRunning(true);
    onBusyChange(true);
    setError("");
    setResult(null);
    setHeard("");
    setStatus("録音を準備しています…");
    try {
      const samples = await decodeRecording(recording.blob);
      if (!alive.current || !active.current) return;
      setSeconds(samples.length / 16000);
      const rms = Math.sqrt(
        samples.reduce((sum, x) => sum + x * x, 0) / samples.length,
      );
      const clipped =
        samples.filter((x) => Math.abs(x) >= 0.99).length / samples.length;
      setSoundNote(
        clipped > 0.01
          ? "音割れの可能性があります。マイクから少し離して録り直してください。"
          : rms < 0.01
            ? "録音の音量が小さめです。マイクとの距離を確認してください。"
            : "",
      );
      const text = await localAI.run(
        "transcribe",
        { lang, samples },
        setStatus,
      );
      if (alive.current) {
        if (!text.trim())
          throw Error(
            "文章を認識できませんでした。録音を聴き、短い文で録り直してください。",
          );
        setHeard(text);
        setStatus("文字起こしを確認・修正してから、原稿と照合してください。");
      }
    } catch (e) {
      if (alive.current) {
        setStatus("");
        setError(String(e));
      }
    } finally {
      active.current = false;
      if (alive.current) {
        setRunning(false);
        onBusyChange(false);
      }
    }
  }
  const differences = result?.filter((item) => item.kind !== "match") ?? [];
  async function compare() {
    const request = ++comparison.current;
    try {
      const [source, transcript] =
        lang === "zh"
          ? await Promise.all([
              normalizeChineseComparison(expected),
              normalizeChineseComparison(heard),
            ])
          : [expected, heard];
      if (alive.current && request === comparison.current) {
        setResult(compareTranscript(source, transcript, lang));
        setError("");
      }
    } catch (e) {
      if (alive.current && request === comparison.current) setError(String(e));
    }
  }
  return (
    <div className="local-ai-panel">
      <h3>録音のAIフィードバック（試験機能）</h3>
      <p className="small">
        0.4〜30秒の録音を端末内で文字起こしします。英語はWhisper
        tiny.en、中国語はWhisper tinyを使い、初回は言語ごとに約41
        MBのモデルを取得します。録音は外部AIへ送りません。認識結果との違いは発音ミスとは限りません。発音・アクセント・中国語の声調の採点には対応していません。
      </p>
      {(partial || !reference) && (
        <p className="small">
          区間の途中から録音した場合や持ち込み音声では、下の原稿を実際に読んだ範囲に合わせてください。
        </p>
      )}
      <label>
        比較する原稿（録音した範囲）
        <textarea
          rows={3}
          maxLength={1500}
          disabled={blocked}
          value={expected}
          onChange={(e) => {
            comparison.current++;
            setExpected(e.target.value);
            setResult(null);
          }}
        />
      </label>
      <button disabled={blocked} onClick={() => void transcribe()}>
        録音を端末内AIで文字起こし
      </button>
      {running && (
        <button
          onClick={() => {
            active.current = false;
            localAI.release();
          }}
        >
          録音の解析を中止
        </button>
      )}
      {status && (
        <p
          className="small"
          role="status"
          aria-label="録音フィードバックの状況"
        >
          {status}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {seconds > 0 && (
        <p className="small">
          録音 {seconds.toFixed(1)}秒 ／ 対応するお手本区間{" "}
          {(recording.b - recording.a).toFixed(1)}
          秒。文間の無音や話し始めるまでの時間も含みます。
        </p>
      )}
      {soundNote && <p className="small">{soundNote}</p>}
      {heard && (
        <>
          <label>
            AIの文字起こし（聴き直して修正できます）
            <textarea
              rows={3}
              maxLength={1500}
              disabled={blocked}
              value={heard}
              onChange={(e) => {
                comparison.current++;
                setHeard(e.target.value);
                setResult(null);
              }}
            />
          </label>
          <button
            disabled={blocked || !expected.trim() || !heard.trim()}
            onClick={() => void compare()}
          >
            この文字起こしで原稿と照合
          </button>
        </>
      )}
      {result && (
        <div className="feedback-result" aria-label="原稿との照合結果">
          <p>
            {differences.length
              ? `原稿と認識結果が異なる箇所が${differences.length}件あります。`
              : "文字起こし上は原稿と一致しました。"}
          </p>
          {differences.length > 0 && (
            <div className="feedback-table">
              <table>
                <thead>
                  <tr>
                    <th>原稿</th>
                    <th>認識結果</th>
                    <th>確認点</th>
                  </tr>
                </thead>
                <tbody>
                  {differences.map((item, i) => (
                    <tr key={i}>
                      <td>{item.expected || "—"}</td>
                      <td>{item.heard || "認識なし"}</td>
                      <td>
                        {item.kind === "missing"
                          ? "認識されなかった語句"
                          : item.kind === "extra"
                            ? "原稿にない語句"
                            : "異なる語句"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="small">
            {differences.length
              ? "練習のポイント：まず録音を聴き直して誤認識を直し、残った違いを含む1文を短いA–B区間にして、お手本と交互に練習しましょう。"
              : "練習のポイント：次はお手本と交互に聴き、語の強弱や区切りを確認しましょう。一致は発音の正確さを保証するものではありません。"}
          </p>
          {lang === "zh" && (
            <p className="small">
              中国語は簡体字に揃えて照合しています。原稿と文字起こし本体の表記は変更しません。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
