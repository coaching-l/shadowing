import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Upload,
  Check,
  Headphones,
  Plus,
  Trash2,
  Save,
  ArrowRight,
  FileText,
  LoaderCircle,
} from "lucide-react";
import { clipKey, NO_GAP, splitSentences, wavBlob } from "./core";
import type { Clip, Lang } from "./core";
import { extractDocument, primeDocumentReaders } from "./documents";
import {
  getSpeechCache,
  putSpeechCache,
  clearSpeechCache,
  cleanExpiredSpeechCache,
} from "./speech-cache";
import { BrowserEngine, VOICES, ZH_VOICES } from "./engine";
import { saveLesson, listLessons, deleteLesson } from "./storage";
import type { Lesson, Recording } from "./storage";
import Practice from "./Practice";
import Proofreader from "./Proofreader";
import { localAI } from "./local-ai";
import { readInterruptedTtsAttempt, finishTtsAttempt } from "./tts-attempt";
type SpeechTask = { kind: "preview"; voice: string } | { kind: "full" };
const fresh = (): Lesson => ({
  id: crypto.randomUUID(),
  title: "新しい教材",
  lang: "en",
  text: "",
  sentences: [],
  voice: "af_heart",
  speed: 1,
  clips: [],
  gap: { ...NO_GAP },
  mode: "shadow",
  a: 0,
  b: 0,
  repeat: 3,
  repeatGap: 1,
  rate: 1,
  loop: false,
  updated: Date.now(),
});
export default function App() {
  const [lesson, setLesson] = useState<Lesson>(() => {
      const previous = readInterruptedTtsAttempt();
      const initial = fresh();
      return previous?.lang === "zh"
        ? { ...initial, lang: "zh", voice: "zf_001" }
        : initial;
    }),
    [library, setLibrary] = useState<Lesson[]>([]),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [task, setTask] = useState<SpeechTask | null>(null),
    [localBusy, setLocalBusy] = useState(false),
    [recordingBusy, setRecordingBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [progressKind, setProgressKind] = useState<SpeechTask["kind"]>("preview"),
    [failed, setFailed] = useState<number | null>(null),
    [confirmed, setConfirmed] = useState(""),
    [previewText, setPreviewText] = useState(""),
    [previewVoice, setPreviewVoice] = useState(""),
    [recording, setRecording] = useState<Recording | undefined>(),
    [persistRecording, setPersistRecording] = useState(false),
    [importing, setImporting] = useState(false),
    [importProgress, setImportProgress] = useState(""),
    [saving, setSaving] = useState(false),
    [deleting, setDeleting] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(readInterruptedTtsAttempt);
  const busy =
    task !== null || localBusy || recordingBusy || saving || deleting !== null;
  const deletingRef = useRef(false);
  const rawInput = useRef<HTMLTextAreaElement>(null),
    engine = useRef(new BrowserEngine()),
    preview = useRef<HTMLAudioElement>(null),
    previewUrl = useRef(""),
    cancelled = useRef(false);
  const update = (patch: Partial<Lesson>) => {
    setNotice("");
    setLesson((l) => ({ ...l, ...patch }));
  };
  const report = (message: string) => setError(message);
  const availableVoices = lesson.lang === "zh" ? ZH_VOICES : VOICES;
  const config = JSON.stringify([lesson.lang, lesson.voice, lesson.speed]);
  const generationHint = importing
    ? "資料を読み込んでいます。"
    : !lesson.text.trim()
      ? "資料を取り込むか、本文を入力してください。"
      : confirmed !== config
        ? "「この声と設定で確定」を押すと、全文生成に進めます。"
        : !lesson.sentences.length
          ? "全文生成を押すと本文を自動で文に分割します。事前に確認したい場合は「文に分割する」を使えます。"
          : "";
  const clips = useMemo(() => {
    const map = new Map(lesson.clips.map((c) => [c.key, c]));
    const current = lesson.sentences.map((text) =>
      map.get(clipKey(text, lesson.voice, lesson.speed)),
    );
    return current.every(Boolean) ? (current as Clip[]) : [];
  }, [lesson.clips, lesson.sentences, lesson.voice, lesson.speed]);
  const readyCount = lesson.sentences.filter((text) =>
    lesson.clips.some(
      (c) => c.key === clipKey(text, lesson.voice, lesson.speed),
    ),
  ).length;
  useEffect(() => {
    if (interrupted) finishTtsAttempt(interrupted.id);
  }, []);
  useEffect(() => {
    const exclusive = (e: Event) =>
      document.querySelectorAll("audio").forEach((el) => {
        if (el !== e.target) el.pause();
      });
    document.addEventListener("play", exclusive, true);
    return () => document.removeEventListener("play", exclusive, true);
  }, []);
  useEffect(() => {
    void cleanExpiredSpeechCache();
    void listLessons()
      .then(setLibrary)
      .catch((e) => report("教材一覧を読み込めません。 " + String(e)));
    return () => {
      engine.current.cancel();
      localAI.release();
      preview.current?.pause();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);
  function stopPreview() {
    preview.current?.pause();
    setPreviewVoice("");
  }
  function clearPreview() {
    stopPreview();
    if (preview.current) {
      preview.current.removeAttribute("src");
      preview.current.load();
    }
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = "";
  }
  function cancel() {
    cancelled.current = true;
    engine.current.cancel();
    setProgress(
      task?.kind === "preview"
        ? "試聴を中止しました。"
        : "全文生成を中止しました。成功した文の音声は再利用できます。",
    );
  }
  function reset() {
    cancelled.current = true;
    engine.current.cancel();
    localAI.release();
    clearPreview();
    const attempt = readInterruptedTtsAttempt();
    if (attempt) finishTtsAttempt(attempt.id);
    setInterrupted(undefined);
    setLesson(fresh());
    setConfirmed("");
    setPreviewText("");
    setRecording(undefined);
    setPersistRecording(false);
    setError("");
    setNotice("");
    setFailed(null);
    setProgress("");
    setImportProgress("");
  }
  async function remove(item: Lesson) {
    if (busy || importing || deletingRef.current) return;
    if (
      !confirm(
        `「${item.title}」の本文・音声・保存した録音をすべて削除しますか？ 音声の一時キャッシュもまとめて削除します。削除後は元に戻せません。`,
      )
    )
      return;
    deletingRef.current = true;
    setDeleting(item.id);
    setError("");
    setNotice("");
    try {
      await deleteLesson(item.id);
      // Release model-local text/tensors even if the deleted lesson is not open.
      engine.current.cancel();
      localAI.release();
      if (item.id === lesson.id) reset();
      setLibrary((items) => items.filter((entry) => entry.id !== item.id));
      setNotice(
        "教材の本文・音声・保存した録音と、音声の一時キャッシュを削除しました。",
      );
    } catch (e) {
      report(
        "削除を完了できませんでした。教材は一覧に残しています。もう一度削除してください。 " +
          String(e),
      );
    } finally {
      deletingRef.current = false;
      setDeleting(null);
    }
  }
  async function loadFile(file: File) {
    setImportProgress("ファイルを読み込んでいます…");
    setImporting(true);
    setError("");
    try {
      const text = await extractDocument(file, setImportProgress);
      update({ text, sentences: [], title: file.name.replace(/\.[^.]+$/, "") });
      setConfirmed("");
      setNotice(
        (file.name.toLowerCase().endsWith(".pages")
          ? "Pagesの本文を取り込みました。図・表・テキストボックス内の文字は含まれないため、本文をご確認ください。"
          : "本文を取り込みました。") +
          "読み上げ範囲を確認して、声を確定してください。文の区切りは全文生成の開始時に自動で作成します。",
      );
    } catch (e) {
      report(String(e));
    } finally {
      setImporting(false);
    }
  }
  function replaceText(text: string) {
    update({ text, sentences: [] });
    setConfirmed("");
    setFailed(null);
  }
  function split() {
    const text = lesson.text.trim();
    if (!text) {
      report("本文を入力してください。");
      return;
    }
    if (text.length > 50000) {
      report("1教材の上限は50,000文字です。教材を分けてください。");
      return;
    }
    update({ sentences: splitSentences(text, lesson.lang) });
    setPreviewText("");
    setFailed(null);
    setNotice("文の区切りを確認してください。必要なら結合・再分割できます。");
  }
  function changeSentences(sentences: string[]) {
    update({ sentences, text: sentences.join("\n") });
    setFailed(null);
  }
  async function listen(voice: string) {
    if (busy) return;
    localAI.release();
    stopPreview();
    setTask({ kind: "preview", voice });
    setProgressKind("preview");
    setError("");
    setProgress("試聴を準備中…");
    cancelled.current = false;
    try {
      const sentences = lesson.sentences.length
        ? lesson.sentences
        : splitSentences(lesson.text.trim(), lesson.lang);
      const text = previewText.trim() || sentences[0] || "";
      if (!text) throw Error("本文または試聴原稿を入力してください。");
      if (text.length > 400)
        throw Error(
          "試聴原稿は400文字までです。自然な文の区切りで短くしてください。",
        );
      const key = clipKey(text, voice, lesson.speed);
      const cached =
        lesson.clips.find((clip) => clip.key === key) ??
        (await getSpeechCache(key));
      let clip = cached;
      if (cancelled.current) return;
      if (!clip) {
        const result = await engine.current.generate(
          text,
          voice,
          lesson.speed,
          setProgress,
          "preview",
        );
        clip = result;
        void putSpeechCache(key, result);
      }
      if (cancelled.current) return;
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = URL.createObjectURL(
        wavBlob(clip.samples, clip.rate),
      );
      preview.current!.src = previewUrl.current;
      setPreviewVoice(voice);
      try {
        await preview.current!.play();
        setProgress(
          cached
            ? "保存済みの音声を再利用しました。"
            : "試聴音声を生成しました。",
        );
      } catch (e) {
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          setProgress(
            "音声の準備ができました。下の「試聴を再生」を押してください。Safariでは再生ボタンのタップが必要な場合があります。",
          );
        } else throw e;
      }
    } catch (e) {
      if (!cancelled.current) {
        setProgress("試聴を完了できませんでした。");
        report(String(e));
      }
    } finally {
      setTask(null);
    }
  }
  async function generate() {
    if (busy) return;
    localAI.release();
    if (confirmed !== config) {
      report("声と発話速度を確定してください。");
      return;
    }
    stopPreview();
    setTask({ kind: "full" });
    setProgressKind("full");
    setProgress("全文生成を準備中…");
    setError("");
    setFailed(null);
    cancelled.current = false;
    let snapshot = lesson;
    const cache = new Map(lesson.clips.map((c) => [c.key, c]));
    try {
      if (!snapshot.text.trim()) throw Error("本文を入力してください。");
      if (snapshot.text.trim().length > 50000)
        throw Error("1教材の上限は50,000文字です。教材を分けてください。");
      if (!snapshot.sentences.length) {
        const sentences = splitSentences(snapshot.text, snapshot.lang);
        if (!sentences.length)
          throw Error("読み上げる本文を入力してください。");
        snapshot = { ...snapshot, sentences };
        setLesson((l) => ({ ...l, sentences }));
      }
      if (snapshot.sentences.some((s) => !s.trim()))
        throw Error("空の文を削除してください。");
      for (let i = 0; i < snapshot.sentences.length; i++) {
        if (cancelled.current) break;
        const text = snapshot.sentences[i];
        const key = clipKey(text, snapshot.voice, snapshot.speed);
        setProgress(`${i + 1} / ${snapshot.sentences.length} 文を生成中`);
        if (cache.has(key)) continue;
        try {
          const cached = await getSpeechCache(key);
          if (cancelled.current) break;
          const result =
            cached ??
            (await engine.current.generate(
              text,
              snapshot.voice,
              snapshot.speed,
              (msg) =>
                setProgress(
                  `${i + 1} / ${snapshot.sentences.length} 文 · ${msg}`,
                ),
              "full",
            ));
          if (cancelled.current) break;
          if (
            [
              ...snapshot.sentences
                .slice(0, i)
                .map((t) =>
                  cache.get(clipKey(t, snapshot.voice, snapshot.speed)),
                ),
            ].reduce((n, c) => n + (c ? c.samples.length / c.rate : 0), 0) +
              result.samples.length / result.rate >
            1200
          )
            throw Error("音声が20分を超えます。教材を分けてください。");
          if (!cached) void putSpeechCache(key, result);
          cache.set(key, { ...result, text, key });
          setLesson((l) => ({ ...l, clips: [...cache.values()] }));
        } catch (e) {
          setFailed(i);
          throw e;
        }
      }
      if (!cancelled.current)
        setProgress("全文の音声を生成しました。練習画面で再生できます。");
    } catch (e) {
      if (!cancelled.current) setProgress("全文生成を完了できませんでした。");
      report(String(e));
    } finally {
      setTask(null);
    }
  }
  async function save() {
    if (busy || importing) return;
    setSaving(true);
    try {
      await saveLesson({
        ...lesson,
        recording: persistRecording ? recording : undefined,
        updated: Date.now(),
      });
      setLibrary(await listLessons());
      setNotice("教材をこのブラウザーに保存しました。");
      void navigator.storage?.persist?.();
    } catch (e) {
      report(String(e));
    } finally {
      setSaving(false);
    }
  }
  function open(item: Lesson) {
    clearPreview();
    setLesson(item);
    setConfirmed("");
    setRecording(item.recording);
    setPersistRecording(!!item.recording);
    setFailed(null);
    setPreviewText("");
    setError("");
    setNotice("保存した教材を開きました。");
  }
  async function importAudio(file: File) {
    if (file.size > 50 * 1024 * 1024) {
      report("持ち込み音声は50 MBまでです。");
      return;
    }
    if (
      lesson.text &&
      !confirm(
        "持ち込み音声を新しい教材として開きます。未保存の編集内容は失われます。続けますか？",
      )
    )
      return;
    setImporting(true);
    // Decode MP3s without retaining an idle inference model's WASM heap.
    engine.current.cancel();
    localAI.release();
    clearPreview();
    let ctx: AudioContext | undefined;
    try {
      ctx = new AudioContext();
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      if (buffer.duration > 1200) throw Error("持ち込み音声は20分までです。");
      const mono = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const channel = buffer.getChannelData(c);
        for (let i = 0; i < mono.length; i++)
          mono[i] += channel[i] / buffer.numberOfChannels;
      }
      const text = "持ち込み音声（文の自動位置合わせなし）";
      const item = fresh();
      item.lang = lesson.lang;
      item.title = file.name;
      item.text = text;
      item.sentences = [text];
      item.voice = "imported";
      item.clips = [
        {
          text,
          key: clipKey(text, "imported", 1),
          samples: mono,
          rate: buffer.sampleRate,
        },
      ];
      stopPreview();
      setLesson(item);
      setRecording(undefined);
      setConfirmed("");
      setNotice(
        "持ち込み音声を開きました。A–B区間で練習できます。本文の文単位対応はありません。",
      );
    } catch (e) {
      report("音声を読み込めませんでした。 " + String(e));
    } finally {
      await ctx?.close();
      setImporting(false);
    }
  }
  function speechProgress(kind: SpeechTask["kind"]) {
    if (progressKind !== kind || (!task && !progress)) return null;
    return (
      <div
        className="progress"
        role="status"
        aria-label={kind === "preview" ? "試聴の状況" : "全文生成の状況"}
      >
        <span>{progress}</span>
        {task?.kind === kind && (
          <button className="small-button" onClick={cancel}>
            {kind === "preview" ? "試聴を中止" : "全文生成を中止"}
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      <header className="page-header">
        <a className="brand" href="./">
          <img
            src={new URL("../public/cl-logo.png", import.meta.url).href}
            width="52"
            height="52"
            alt="COACHING-L公式CLロゴ"
          />
          <div>
            <p className="brand-name">COACHING-L</p>
            <h1>シャドーイング・スタジオ</h1>
          </div>
        </a>
        <span className="header-note">自分のペースで、言葉を育てる。</span>
      </header>
      <main>
        <div className="intro">
          <span className="eyebrow">YOUR WORDS, YOUR PRACTICE</span>
          <h2>
            聴く。重ねる。
            <br />
            自分の言葉にする。
          </h2>
          <p>いつもの資料から、あなただけの語学練習を。</p>
        </div>
        <div className="status-banner">
          <BookOpen size={20} />
          <div>
            <strong>開発プレビュー · まず短い原稿で声を試してください</strong>
            <p>
              英語・中国語の音声は、無料・登録不要の公開モデルを端末内で実行します。中国語の読み変換は試験対応です。多音字や声調、自然さは試聴で確認してください。スマートフォンでの生成は未検証です。
            </p>
          </div>
        </div>
        <nav className="steps" aria-label="使い方">
          <span>
            <b>1</b>資料と原稿
          </span>
          <ArrowRight size={16} />
          <span>
            <b>2</b>声を選ぶ
          </span>
          <ArrowRight size={16} />
          <span>
            <b>3</b>生成して練習
          </span>
        </nav>
        {error && (
          <div className="alert" role="alert">
            <span>{error}</span>
            <button className="text-button" onClick={() => setError("")}>
              閉じる
            </button>
          </div>
        )}
        {interrupted && (
          <div
            className="status-banner"
            role="status"
            aria-label="前回の音声生成について"
          >
            <div>
              <strong>前回の音声生成が途中で終了したようです</strong>
              <p>
                {interrupted.lang === "zh" ? "中国語" : "英語"}の音声を
                {interrupted.stage === "loading"
                  ? "読み込んでいる"
                  : "生成している"}
                間に、ページが閉じられたか読み直された可能性があります。端末のメモリー不足などでも起こります。処理は自動で再開していません。
              </p>
              <p>
                再びページが読み直される場合は、PCで生成したMP3を「手元の音声で練習する」から読み込んでください。未保存の原稿は復元できません。生成前に「教材を保存」を使うと、このブラウザーの教材ライブラリから開き直せます。
              </p>
              <button
                className="text-button"
                onClick={() => setInterrupted(undefined)}
              >
                この案内を閉じる
              </button>
            </div>
          </div>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <div className="workspace">
          <aside>
            <section className="card library">
              <div className="section-heading">
                <h2>
                  <BookOpen size={19} />
                  教材ライブラリ
                </h2>
                <span className="tag">{library.length}件</span>
              </div>
              <button
                className="new-button"
                disabled={busy || importing}
                onClick={reset}
              >
                <Plus size={18} />
                新しい教材
              </button>
              {!library.length && (
                <div className="empty">
                  <BookOpen size={28} />
                  <p>練習の積み重ねを、ここに。</p>
                  <span>教材を保存すると一覧に表示されます。</span>
                </div>
              )}
              {library.map((item) => (
                <div
                  className={`library-item ${item.id === lesson.id ? "selected" : ""}`}
                  key={item.id}
                >
                  <button
                    disabled={busy || importing}
                    onClick={() => open(item)}
                  >
                    <strong>{item.title}</strong>
                    <span>
                      {item.lang === "en" ? "英語" : "中国語"} ·{" "}
                      {item.sentences.length}文 ·{" "}
                      {new Date(item.updated).toLocaleDateString("ja-JP")}
                    </span>
                  </button>
                  <button
                    aria-label={`${item.title}を削除`}
                    disabled={busy || importing}
                    className="icon-button"
                    onClick={() => void remove(item)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <p className="small">
                保存先はこの端末のブラウザー内（IndexedDB）です。履歴・サイトデータの削除や容量不足で失われる場合があります。大切な音声はダウンロードしてください。
              </p>
              <p className="small">
                教材を削除すると、その本文・音声・保存した録音と音声の一時キャッシュを消去します。端末へ別途ダウンロードしたファイルは残ります。
              </p>
            </section>
            <section className="card privacy">
              <span className="eyebrow">PRIVATE BY DESIGN</span>
              <h3>
                資料も、録音も。
                <br />
                あなたの端末の中に。
              </h3>
              <p className="small">
                本文や音声をサーバーへ送りません。AIモデルなどの取得時は、配布サイトへ通信します。
              </p>
              <p className="small">
                <strong>使用上の注意</strong>
                <br />
                教材・録音の保存先は、この端末のブラウザー内です。万が一の情報漏えいに備え、氏名・住所・電話番号などの個人情報や機密情報を含む文章・資料・音声は使用しないでください。
              </p>
              <details>
                <summary>使い方と制約</summary>
                <p className="small">
                  初回のモデル取得は英語約92 MB・中国語約339
                  MBに、実行ファイル等が加わります。合計は100
                  MB以上、実行には数百MB以上のメモリーが必要です（メモリー使用量の正確な実測は未完了）。進捗は生成時に表示します。モデルはブラウザーのCache
                  Storageに保存されますが、削除される場合があります。低メモリー端末・スマートフォンでの生成は未確認です。対応の検証対象は最新Chrome/Edge。Safari/Firefoxの生成は未検証です。WebAssembly対応が必要です。
                </p>
                <p className="small">
                  サービス課金・アカウント・APIキー不要。アプリ側の上限は資料20
                  MB・PDF200ページ・本文50,000文字・生成1文400文字・音声20分です。超過時は停止し、有料サービスへ切り替えません。話し方の感情指定には対応していません。
                </p>
              </details>
            </section>
          </aside>
          <div className="main-column" key={lesson.id}>
            <section className="card">
              <div className="section-heading">
                <h2>01 資料を取り込む</h2>
                <span className="tag">端末内で抽出</span>
              </div>
              <div className="row">
                <label className="grow">
                  教材名
                  <input
                    value={lesson.title}
                    disabled={busy}
                    maxLength={120}
                    onChange={(e) => update({ title: e.target.value })}
                  />
                </label>
                <label>
                  練習する言語
                  <select
                    value={lesson.lang}
                    disabled={busy}
                    onChange={(e) => {
                      update({
                        lang: e.target.value as Lang,
                        ...(lesson.voice === "imported"
                          ? {}
                          : {
                              sentences: [],
                              voice:
                                e.target.value === "en" ? "af_heart" : "zf_001",
                            }),
                      });
                      setConfirmed("");
                      setPreviewText("");
                    }}
                  >
                    <option value="en">英語 / English</option>
                    <option value="zh">中国語 / 中文</option>
                  </select>
                </label>
              </div>
              <label
                className={`drop-zone ${busy || importing ? "disabled" : ""}`}
              >
                <Upload size={25} />
                <strong>
                  {importing
                    ? importProgress || "読み込み中…"
                    : "資料を選んで取り込む"}
                </strong>
                <span>
                  Pages（.pages）・Word（.docx）・PDF・テキスト（.txt）／最大20
                  MB
                </span>
                <input
                  onPointerDown={primeDocumentReaders}
                  onFocus={primeDocumentReaders}
                  aria-label="資料ファイル"
                  type="file"
                  accept=".pages,.docx,.pdf,.txt"
                  disabled={busy || importing}
                  onChange={(e) => {
                    if (e.target.files?.[0]) void loadFile(e.target.files[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              <p id="direct-text-help" className="small">
                <strong>
                  本文欄にテキストを直接貼り付ければ、ファイルをアップロードせずに音声を作れます。
                </strong>
                <br />
                下の「02
                読み上げ原稿を整える」にある「本文」欄へ、読み上げたいテキストを貼り付けてください。
              </p>
              <p className="small">
                スキャンした資料や写真だけのPDFは、そのままでは文字を読み取れません（OCR未対応）。別のアプリなどで文字に変換してから、「02」の「本文」欄に貼り付けてください。
              </p>
            </section>
            <section className="card">
              <div className="section-heading">
                <h2>02 読み上げ原稿を整える</h2>
                <span className="tag">
                  {lesson.text.length.toLocaleString()}文字
                </span>
              </div>
              <p className="muted">
                読み上げたい部分だけ残し、見出しや注釈を編集してください。翻訳や要約、文字種による自動削除は行いません。
              </p>
              <label>
                本文
                <textarea
                  aria-label="本文"
                  aria-describedby="direct-text-help"
                  ref={rawInput}
                  value={lesson.text}
                  disabled={busy}
                  rows={10}
                  placeholder={
                    lesson.lang === "en"
                      ? "What would you like to focus on today?\nTake a moment to reflect on your progress."
                      : "今天，你想把注意力放在哪件事上？\n请给自己一点时间，想一想最近的进步。"
                  }
                  onChange={(e) => replaceText(e.target.value)}
                />
              </label>
              <div className="toolbar">
                <button disabled={busy || !lesson.text} onClick={split}>
                  <FileText size={17} />
                  文に分割する
                </button>
                <button
                  className="small-button"
                  disabled={busy || !lesson.text}
                  onClick={() => {
                    replaceText(
                      lesson.text.replace(
                        /([^\n])\n(?!\n)/g,
                        lesson.lang === "en" ? "$1 " : "$1",
                      ),
                    );
                    setNotice(
                      "単独の改行を整理しました。単語のつながりを確認してください。",
                    );
                  }}
                >
                  改行を整理
                </button>
                <button
                  className="small-button"
                  disabled={busy || !lesson.text}
                  onClick={() => {
                    const el = rawInput.current!;
                    if (el.selectionStart === el.selectionEnd) {
                      report("本文で読み上げたい範囲を選択してください。");
                      return;
                    }
                    replaceText(
                      lesson.text.slice(el.selectionStart, el.selectionEnd),
                    );
                  }}
                >
                  選択範囲だけ残す
                </button>
              </div>
              <Proofreader
                text={lesson.text}
                lang={lesson.lang}
                blocked={busy || importing}
                selection={() => ({
                  start: rawInput.current?.selectionStart ?? 0,
                  end: rawInput.current?.selectionEnd ?? 0,
                })}
                onBusyChange={setLocalBusy}
                onPrepare={() => {
                  stopPreview();
                  engine.current.cancel();
                }}
                onApply={(range, original, replacement) => {
                  if (lesson.text.slice(range.start, range.end) !== original) {
                    report(
                      "本文が変わりました。タイポ確認をやり直してください。",
                    );
                    return;
                  }
                  replaceText(
                    lesson.text.slice(0, range.start) +
                      replacement +
                      lesson.text.slice(range.end),
                  );
                  setNotice(
                    "確認した修正候補を本文に反映しました。声の設定を再度確定してください。",
                  );
                }}
              />
              {lesson.sentences.length > 0 && (
                <details open>
                  <summary>
                    文の区切りを確認（{lesson.sentences.length}文）
                  </summary>
                  <p className="small">
                    各欄を直接編集できます。途中で分けるときは改行して「改行で再分割」。400文字を超える文は生成前に分割してください。
                  </p>
                  <div className="editing-list">
                    {lesson.sentences.map((s, i) => (
                      <div
                        className={`editing-sentence ${failed === i ? "failed" : ""}`}
                        key={i}
                      >
                        <span className="sentence-number">
                          {String(i + 1).padStart(2, "0")}
                          {lesson.clips.some(
                            (c) =>
                              c.key === clipKey(s, lesson.voice, lesson.speed),
                          ) && <Check size={13} />}
                        </span>
                        <textarea
                          aria-label={`${i + 1}文目の原稿`}
                          disabled={busy}
                          rows={2}
                          value={s}
                          onChange={(e) =>
                            changeSentences(
                              lesson.sentences.map((x, j) =>
                                i === j ? e.target.value : x,
                              ),
                            )
                          }
                        />
                        <div className="toolbar">
                          <button
                            className="small-button"
                            disabled={busy || i === lesson.sentences.length - 1}
                            onClick={() =>
                              changeSentences(
                                lesson.sentences.flatMap((x, j) =>
                                  j === i
                                    ? [
                                        x +
                                          (lesson.lang === "en" ? " " : "") +
                                          lesson.sentences[j + 1],
                                      ]
                                    : j === i + 1
                                      ? []
                                      : [x],
                                ),
                              )
                            }
                          >
                            次と結合
                          </button>
                          <button
                            className="small-button"
                            disabled={busy || !s.includes("\n")}
                            onClick={() =>
                              changeSentences(
                                lesson.sentences.flatMap((x, j) =>
                                  j === i
                                    ? x
                                        .split("\n")
                                        .map((t) => t.trim())
                                        .filter(Boolean)
                                    : [x],
                                ),
                              )
                            }
                          >
                            改行で再分割
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`${i + 1}文目を削除`}
                            disabled={busy}
                            onClick={() =>
                              changeSentences(
                                lesson.sentences.filter((_, j) => j !== i),
                              )
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </section>
            <section className="card">
              <div className="section-heading">
                <h2>03 声を聴き比べる</h2>
                <span className="tag">
                  {lesson.lang === "en"
                    ? "Kokoro 英語"
                    : "Kokoro 中国語 · 試験対応"}
                </span>
              </div>
              {lesson.voice === "imported" && (
                <p className="small">
                  取り込んだ音声は「04
                  練習する」で再生してください。再生速度も04のスライダーで変更できます。
                </p>
              )}
              <>
                <p className="muted">
                  同じ原稿で、英語は5声、中国語は3声を聴き比べられます。試聴して、発音や区切り、好みに合う声か確認してください。
                </p>
                <label>
                  試聴原稿（400文字以内・空欄なら先頭1文）
                  <textarea
                    rows={3}
                    value={previewText}
                    disabled={busy}
                    onChange={(e) => setPreviewText(e.target.value)}
                    placeholder={
                      lesson.sentences[0] ||
                      "本文を入力すると先頭の文で試聴できます。短い試聴原稿を直接入力することもできます。"
                    }
                  />
                </label>
                <label className="inline">
                  生成時の発話速度
                  <select
                    value={lesson.speed}
                    disabled={busy || lesson.voice === "imported"}
                    onChange={(e) => {
                      update({ speed: +e.target.value });
                      setConfirmed("");
                    }}
                  >
                    {[0.8, 0.9, 1, 1.1, 1.2].map((n) => (
                      <option key={n} value={n}>
                        {n}×
                      </option>
                    ))}
                  </select>
                </label>
                <div className="voice-grid">
                  {availableVoices.map((voice, i) => (
                    <div
                      className={`voice ${lesson.voice === voice.id ? "chosen" : ""}`}
                      key={voice.id}
                    >
                      <label>
                        <input
                          type="radio"
                          name="voice"
                          checked={lesson.voice === voice.id}
                          disabled={busy || lesson.voice === "imported"}
                          onChange={() => {
                            update({ voice: voice.id });
                            setConfirmed("");
                          }}
                        />
                        <span className="voice-avatar">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>
                          <strong>{voice.name}</strong>
                          <small>{voice.detail}</small>
                        </span>
                      </label>
                      <button
                        className="small-button"
                        disabled={
                          busy || importing || lesson.voice === "imported"
                        }
                        aria-busy={
                          task?.kind === "preview" && task.voice === voice.id
                        }
                        onClick={() => void listen(voice.id)}
                      >
                        {task?.kind === "preview" && task.voice === voice.id ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : (
                          <Headphones size={15} />
                        )}
                        {task?.kind === "preview" && task.voice === voice.id
                          ? "試聴を準備中…"
                          : previewVoice === voice.id
                            ? "もう一度聴く"
                            : "試聴"}
                      </button>
                    </div>
                  ))}
                </div>
                <audio
                  ref={preview}
                  aria-label="試聴音声"
                  controls={!!previewVoice}
                  onEnded={() => setPreviewVoice("")}
                />
                {!!previewVoice && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setProgressKind("preview");
                      const audio = preview.current!;
                      if (audio.ended) audio.currentTime = 0;
                      void audio
                        .play()
                        .then(() => {
                          setProgress("試聴音声を再生しています。");
                        })
                        .catch((e) => {
                          setProgress(
                            "音声は準備済みです。もう一度「試聴を再生」を押してください。",
                          );
                          report(
                            "試聴の再生を開始できませんでした。 " + String(e),
                          );
                        });
                    }}
                  >
                    <Headphones size={18} /> 試聴を再生
                  </button>
                )}
                {speechProgress("preview")}
                <p className="small">
                  初回は音声モデルなどをダウンロードするため時間がかかります。本文は外部送信せず、端末内で生成します。iPhone・Safariで音声が自動再生されない場合は、準備完了後に「試聴を再生」を押してください。
                </p>
                <p className="small">
                  待ち時間を短くするため、空欄なら先頭の1文だけで試聴します。試聴・生成音声の一部をこの端末に最大32
                  MB・24件キャッシュし、7日を過ぎた音声は次回利用時に削除します。
                </p>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    void clearSpeechCache()
                      .then(() =>
                        setNotice(
                          "音声の一時キャッシュを削除しました。保存した教材は引き続き使えます。",
                        ),
                      )
                      .catch((e) => report(String(e)));
                  }}
                >
                  音声キャッシュを削除
                </button>
                <button
                  disabled={
                    busy ||
                    importing ||
                    !availableVoices.some((v) => v.id === lesson.voice)
                  }
                  onClick={() => {
                    stopPreview();
                    setConfirmed(config);
                    setNotice(
                      "声と発話速度を確定しました。全文生成は次のボタンで開始します。",
                    );
                  }}
                >
                  <Check size={18} />
                  {confirmed === config
                    ? "この声と設定で確定済み"
                    : "この声と設定で確定"}
                </button>
                <div className="generate-row">
                  <div>
                    <strong>全文を音声にする</strong>
                    <p className="small">
                      {lesson.sentences.length
                        ? `${readyCount} / ${lesson.sentences.length}文の音声を保持 · 成功した文は再利用`
                        : "本文の文分割は生成開始時に自動で行います。"}
                    </p>
                    <p id="generation-help" className="small">
                      {generationHint}
                    </p>
                  </div>
                  <button
                    className="primary"
                    aria-describedby="generation-help"
                    aria-busy={task?.kind === "full"}
                    disabled={
                      busy ||
                      importing ||
                      confirmed !== config ||
                      !lesson.text.trim()
                    }
                    onClick={() => void generate()}
                  >
                    {task?.kind === "full" ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <ArrowRight size={18} />
                    )}{" "}
                    {task?.kind === "full"
                      ? "全文生成中…"
                      : failed !== null
                        ? "失敗した文から再試行"
                        : "全文生成"}
                  </button>
                </div>
                {failed !== null && (
                  <p className="small">
                    {failed + 1}
                    文目で停止しました。原因を解消して再試行すると、成功済み音声を再利用します。
                  </p>
                )}
              </>
              {speechProgress("full")}
            </section>
            <section className="card compact">
              <details>
                <summary>手元の音声で練習する</summary>
                <p className="small">
                  生成できない場合の代替として、自分が利用できるMP3・WAVなどを読み込めます。音声と本文の自動位置合わせはありません。1つの音声としてA–B練習とMP3出力ができます。最大50
                  MB・20分です。
                </p>
                <input
                  aria-label="練習用音声"
                  type="file"
                  accept="audio/*"
                  disabled={busy || importing}
                  onChange={(e) => {
                    if (e.target.files?.[0])
                      void importAudio(e.target.files[0]);
                    e.target.value = "";
                  }}
                />
              </details>
            </section>
            <Practice
              key={lesson.id}
              lesson={lesson}
              clips={clips}
              update={update}
              error={report}
              recording={recording}
              setRecording={setRecording}
              aiBlocked={task !== null || localBusy || importing}
              onCaptureChange={setRecordingBusy}
              onAIBusyChange={setLocalBusy}
              onPrepareAI={() => {
                stopPreview();
                engine.current.cancel();
              }}
            />
            <section className="card save-card">
              <div>
                <h2>教材を保存する</h2>
                <p className="small">
                  原稿・区切り・生成音声・声・練習設定を、このブラウザーに保存します。
                </p>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={persistRecording}
                    onChange={(e) => setPersistRecording(e.target.checked)}
                  />
                  自分の録音も教材と一緒に保存する
                </label>
              </div>
              <button
                className="primary"
                disabled={busy || saving || importing}
                onClick={() => void save()}
              >
                <Save size={18} />
                {saving ? "保存中…" : "教材を保存"}
              </button>
            </section>
          </div>
        </div>
      </main>
      <footer>
        COACHING-L<span>自分のペースで、自分の言葉に。</span>
        <a href="./licenses/" target="_blank" rel="noreferrer">
          ライセンスとソース
        </a>
      </footer>
    </>
  );
}
