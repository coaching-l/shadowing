import { useEffect, useRef, useState } from "react";
import type { Lang } from "./core";
import { localAI } from "./local-ai";
import { validateCorrection } from "./feedback";
import { MAX_PROOFREADING_CHARS, proofreadingChunks } from "./proofreading";
type Selection = { start: number; end: number };
type Props = {
  text: string;
  lang: Lang;
  blocked: boolean;
  selection: () => Selection;
  onApply: (
    selection: Selection,
    original: string,
    replacement: string,
  ) => void;
  onPrepare: () => void;
  onBusyChange: (busy: boolean) => void;
};
export default function Proofreader({
  text,
  lang,
  blocked,
  selection,
  onApply,
  onPrepare,
  onBusyChange,
}: Props) {
  const [running, setRunning] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const [candidate, setCandidate] = useState<{
    selection: Selection;
    original: string;
    text: string;
  } | null>(null);
  const alive = useRef(true),
    active = useRef(false),
    cancelled = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (active.current) {
        cancelled.current = true;
        localAI.release();
        onBusyChange(false);
      }
    };
  }, [onBusyChange]);
  useEffect(() => {
    setCandidate(null);
    setStatus("");
    setError("");
  }, [text, lang]);
  async function check() {
    if (blocked || active.current) return;
    const range = selection();
    const chosen =
      range.end > range.start ? range : { start: 0, end: text.length };
    const original = text.slice(chosen.start, chosen.end);
    setCandidate(null);
    setError("");
    if (!original.trim() || original.length > MAX_PROOFREADING_CHARS) {
      setError(
        "本文を入力するか、5,000文字以内の範囲を選択してください。5,000文字以内の本文は全体を確認できます。",
      );
      return;
    }
    onPrepare();
    active.current = true;
    cancelled.current = false;
    setRunning(true);
    onBusyChange(true);
    setStatus("タイポ確認を準備しています…");
    try {
      const chunks = proofreadingChunks(original, lang);
      const total = chunks.filter((chunk) => chunk.trim()).length;
      const corrected: string[] = [];
      let completed = 0;
      for (const chunk of chunks) {
        if (cancelled.current || !alive.current) return;
        if (!chunk.trim()) {
          corrected.push(chunk);
          continue;
        }
        const prefix = `タイポを確認中… ${completed + 1} / ${total}区間`;
        setStatus(prefix);
        try {
          const result = await localAI.run(
            "correct",
            { lang, text: chunk },
            (message) => setStatus(`${prefix} · ${message}`),
          );
          if (cancelled.current || !alive.current) return;
          corrected.push(validateCorrection(chunk, result));
          completed++;
        } catch (e) {
          if (cancelled.current) throw e;
          throw Error(
            `${completed + 1} / ${total}区間で停止しました。本文は変更していません。 ${String(e)}`,
          );
        }
      }
      const result = corrected.join("");
      if (alive.current && !cancelled.current) {
        setCandidate({ selection: chosen, original, text: result });
        setStatus(
          result === original
            ? "修正候補はありませんでした。誤りがないことを保証するものではありません。"
            : "修正前後を確認し、反映するか選んでください。",
        );
      }
    } catch (e) {
      if (alive.current) {
        setStatus(
          cancelled.current
            ? "タイポ確認を中止しました。本文は変更していません。"
            : "",
        );
        if (!cancelled.current) setError(String(e));
      }
    } finally {
      active.current = false;
      if (alive.current) {
        setRunning(false);
        onBusyChange(false);
      }
    }
  }
  return (
    <details className="local-ai-panel">
      <summary>端末内でタイポを確認（試験機能）</summary>
      <p className="small">
        英語・中国語の本文全体または選択範囲を最大5,000文字まで確認します。短い範囲に分けて順番に処理し、最後に候補をまとめて表示します。原文は自動で書き換えません。英語は米国英語の辞書でスペルを確認し、中国語は簡体字向けのAIモデル（初回約104
        MB）を使います。無料・ログイン不要で、本文を外部AIへ送りません。人名・専門用語や文意が変わっていないか確認してください。
      </p>
      <button disabled={blocked || !text.trim()} onClick={() => void check()}>
        タイポの修正候補を作る
      </button>
      {running && (
        <button
          onClick={() => {
            cancelled.current = true;
            setStatus("タイポ確認を中止しました。本文は変更していません。");
            localAI.release();
          }}
        >
          タイポ確認を中止
        </button>
      )}
      {status && (
        <p role="status" aria-label="タイポ確認の状況" className="small">
          {status}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {candidate && candidate.text !== candidate.original && (
        <div className="correction-review">
          <label>
            修正前
            <textarea readOnly value={candidate.original} rows={3} />
          </label>
          <label>
            修正候補（編集できます）
            <textarea
              value={candidate.text}
              maxLength={MAX_PROOFREADING_CHARS * 2}
              disabled={blocked}
              rows={3}
              onChange={(e) =>
                setCandidate({ ...candidate, text: e.target.value })
              }
            />
          </label>
          <div className="toolbar">
            <button
              disabled={blocked || !candidate.text.trim()}
              onClick={() =>
                onApply(candidate.selection, candidate.original, candidate.text)
              }
            >
              この候補を本文に反映
            </button>
            <button disabled={blocked} onClick={() => setCandidate(null)}>
              候補を破棄
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
