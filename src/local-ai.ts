import type { Lang } from "./core";
// One inference worker at a time; input text/audio is sent only to this local worker.
export class LocalAI {
  private worker?: Worker;
  private reject?: (error: Error) => void;
  private timeout?: ReturnType<typeof setTimeout>;
  private idle?: ReturnType<typeof setTimeout>;
  private profile?: string;
  run(
    kind: "correct" | "transcribe",
    input: { lang: Lang; text?: string; samples?: Float32Array },
    progress: (message: string) => void,
  ): Promise<string> {
    if (this.reject) return Promise.reject(Error("端末内AIが処理中です。"));
    clearTimeout(this.idle);
    const profile = `${kind}:${input.lang}`;
    // Disposing an ONNX session does not shrink an existing WASM heap.
    if (this.worker && this.profile !== profile) this.release();
    this.worker ??= new Worker(
      new URL("./local-ai.worker.ts", import.meta.url),
      { type: "module" },
    );
    this.profile = profile;
    return new Promise((resolve, reject) => {
      this.reject = reject;
      const done = () => {
        clearTimeout(this.timeout);
        this.reject = undefined;
        if (kind === "transcribe") this.release();
        else this.idle = setTimeout(() => this.release(), 15000);
      };
      const renewTimeout = () => {
        clearTimeout(this.timeout);
        this.timeout = setTimeout(
          () =>
            this.release(
              "端末内AIの処理が5分間進みませんでした。短い範囲でお試しください。",
            ),
          300000,
        );
      };
      renewTimeout();
      this.worker!.onerror = (event) => {
        this.release("端末内AIを実行できませんでした。 " + event.message);
      };
      this.worker!.onmessage = ({ data }) => {
        if (data.type === "result") {
          if (typeof data.text !== "string") {
            this.release("端末内AIの結果を確認できませんでした。");
            return;
          }
          done();
          resolve(data.text);
        } else if (data.type === "error") {
          // Stop pending downloads and discard a partially initialized model.
          this.release(data.message);
        } else if (data.type === "status") {
          renewTimeout();
          progress(data.message);
        } else if (data.type === "progress") {
          renewTimeout();
          const p = data.progress;
          progress(
            `AIモデルを準備中… ${p.file || ""} ${p.progress ? Math.round(p.progress) + "%" : p.status || ""}${p.total ? " / " + (p.total / 1048576).toFixed(1) + " MB" : ""}`,
          );
        }
      };
      this.worker!.onmessageerror = () =>
        this.release("端末内AIのデータを受け取れませんでした。");
      try {
        const samples = input.samples;
        // The resampled input belongs to this one ASR request. Transferring it
        // avoids retaining a second full-file PCM copy on memory-limited phones.
        const transfer =
          kind === "transcribe" &&
          samples?.buffer instanceof ArrayBuffer &&
          samples.byteOffset === 0 &&
          samples.byteLength === samples.buffer.byteLength
            ? [samples.buffer]
            : [];
        this.worker!.postMessage({ kind, ...input }, transfer);
      } catch (error) {
        this.release("端末内AIを開始できませんでした。 " + String(error));
      }
    });
  }
  release(message = "端末内AIの処理を中止しました。") {
    clearTimeout(this.timeout);
    clearTimeout(this.idle);
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
    }
    this.worker = undefined;
    this.profile = undefined;
    const reject = this.reject;
    this.reject = undefined;
    reject?.(Error(message));
  }
}
export const localAI = new LocalAI();
