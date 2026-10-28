export const VOICES = [
  { id: "af_heart", name: "Heart", detail: "米国英語 · 女性" },
  { id: "af_bella", name: "Bella", detail: "米国英語 · 女性" },
  { id: "af_nicole", name: "Nicole", detail: "米国英語 · 女性" },
  { id: "am_michael", name: "Michael", detail: "米国英語 · 男性" },
  { id: "bf_emma", name: "Emma", detail: "英国英語 · 女性" },
];
export const ZH_VOICES = [
  { id: "zf_001", name: "普通話 001", detail: "女性 · 公開モデルの声ID 001" },
  { id: "zf_002", name: "普通話 002", detail: "女性 · 公開モデルの声ID 002" },
  { id: "zm_010", name: "普通話 010", detail: "男性 · 公開モデルの声ID 010" },
];
// No cloud inference, accounts, API keys, browser speechSynthesis or paid fallback.
export class BrowserEngine {
  private worker: Worker | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private reject: ((reason: Error) => void) | undefined;
  async generate(
    text: string,
    voice: string,
    speed: number,
    progress: (message: string) => void,
  ): Promise<{ samples: Float32Array; rate: number }> {
    if (this.reject) throw Error("生成処理が進行中です。");
    if (
      !voice.startsWith("z") &&
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)
    )
      throw Error(
        "英語エンジンでは中国語・日本語を正しく読めません。原稿から読み上げない部分を編集してください。自動削除はしません。",
      );
    if (text.length > 400)
      throw Error(
        "この文は400文字を超えています。原稿の文を意味のまとまりで分割してください。切り捨てて生成しません。",
      );
    this.worker ??= new Worker(new URL("./engine.worker.ts", import.meta.url), {
      type: "module",
    });
    return new Promise((resolve, reject) => {
      this.reject = reject;
      this.timeout = setTimeout(
        () =>
          this.cancel(
            "モデル取得・生成が3分以内に完了しませんでした。接続や端末性能を確認して再試行してください。",
          ),
        180000,
      );
      this.worker!.onerror = (e) => {
        this.cancel(
          "音声モデルの実行中にエラーが発生しました。詳細: " + e.message,
        );
      };
      this.worker!.onmessage = ({ data }) => {
        if (data.type === "progress") {
          const p = data.progress;
          progress(
            `${p.file || "音声モデル"} ${p.progress ? Math.round(p.progress) + "%" : p.status || ""}${p.total ? " / " + (p.total / 1048576).toFixed(1) + " MB" : ""}`,
          );
        } else if (data.type === "audio") {
          if (
            !(data.samples instanceof Float32Array) ||
            !data.samples.length ||
            !data.samples.every(Number.isFinite) ||
            data.rate !== 24000
          ) {
            console.error(
              "TTS output validation",
              data.samples?.constructor?.name,
              data.samples?.length,
              data.rate,
              data.samples?.filter((s: number) => !Number.isFinite(s)).length,
            );
            this.cancel("有効な音声データを生成できませんでした。");
            return;
          }
          this.reject = undefined;
          clearTimeout(this.timeout);
          resolve({ samples: data.samples, rate: data.rate });
        } else if (data.type === "error") {
          this.cancel(
            "音声モデルの読み込み・生成に失敗しました。接続、端末の空きメモリーをご確認ください。詳細: " +
              data.error,
          );
        }
      };
      this.worker!.postMessage({ type: "generate", text, voice, speed });
    });
  }
  cancel(message = "生成を中止しました。成功済みの文は再利用できます。") {
    clearTimeout(this.timeout);
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
    }
    this.worker = undefined;
    this.reject?.(Error(message));
    this.reject = undefined;
  }
}
