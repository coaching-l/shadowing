import type { Lang } from "./core";
// One inference worker at a time; input text/audio is sent only to this local worker.
export class LocalAI {
  private worker?: Worker;
  private reject?: (error: Error) => void;
  private timeout?: ReturnType<typeof setTimeout>;
  private idle?: ReturnType<typeof setTimeout>;
  run(
    kind: "correct" | "transcribe",
    input: { lang: Lang; text?: string; samples?: Float32Array },
    progress: (message: string) => void,
  ): Promise<string> {
    if (this.reject) return Promise.reject(Error("端末内AIが処理中です。"));
    clearTimeout(this.idle);
    this.worker ??= new Worker(
      new URL("./local-ai.worker.ts", import.meta.url),
      { type: "module" },
    );
    return new Promise((resolve, reject) => {
      this.reject = reject;
      const done = () => {
        clearTimeout(this.timeout);
        this.reject = undefined;
        this.idle = setTimeout(() => this.release(), 15000);
      };
      this.timeout = setTimeout(
        () =>
          this.release(
            "端末内AIの処理が5分以内に完了しませんでした。短い範囲でお試しください。",
          ),
        300000,
      );
      this.worker!.onerror = (event) => {
        this.release("端末内AIを実行できませんでした。 " + event.message);
      };
      this.worker!.onmessage = ({ data }) => {
        if (data.type === "result") {
          done();
          resolve(data.text);
        } else if (data.type === "error") {
          // Stop pending downloads and discard a partially initialized model.
          this.release(data.message);
        } else if (data.type === "status") progress(data.message);
        else if (data.type === "progress") {
          const p = data.progress;
          progress(
            `AIモデルを準備中… ${p.file || ""} ${p.progress ? Math.round(p.progress) + "%" : p.status || ""}${p.total ? " / " + (p.total / 1048576).toFixed(1) + " MB" : ""}`,
          );
        }
      };
      this.worker!.postMessage({ kind, ...input });
    });
  }
  release(message = "端末内AIの処理を中止しました。") {
    clearTimeout(this.timeout);
    clearTimeout(this.idle);
    this.worker?.terminate();
    this.worker = undefined;
    this.reject?.(Error(message));
    this.reject = undefined;
  }
}
export const localAI = new LocalAI();
