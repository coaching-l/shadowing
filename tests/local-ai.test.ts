import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalAI } from "../src/local-ai";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  reply(data: unknown) {
    this.onmessage?.({ data });
  }
}
beforeEach(() => {
  FakeWorker.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("端末内AIのメモリーと中止", () => {
  it("ASRへPCMを転送し、成功直後にWorker全体を解放する", async () => {
    const ai = new LocalAI();
    const samples = new Float32Array(16000);
    const pending = ai.run("transcribe", { lang: "en", samples }, () => {});
    const worker = FakeWorker.instances[0];
    expect(worker.postMessage).toHaveBeenCalledWith(
      { kind: "transcribe", lang: "en", samples },
      [samples.buffer],
    );
    worker.reply({ type: "result", text: "Hello." });
    expect(await pending).toBe("Hello.");
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
  });

  it("校正の小区間では再利用し、言語・用途を切り替えるとWASMごと解放する", async () => {
    const ai = new LocalAI();
    const first = ai.run("correct", { lang: "en", text: "Hello." }, () => {});
    FakeWorker.instances[0].reply({ type: "result", text: "Hello." });
    await first;
    const second = ai.run("correct", { lang: "en", text: "World." }, () => {});
    expect(FakeWorker.instances).toHaveLength(1);
    FakeWorker.instances[0].reply({ type: "result", text: "World." });
    await second;
    const third = ai.run(
      "transcribe",
      { lang: "en", samples: new Float32Array(16000) },
      () => {},
    );
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[1].reply({ type: "result", text: "Test." });
    await third;
  });

  it("長い音声の区間完了で期限を更新し、停止した処理だけを終了する", async () => {
    const ai = new LocalAI();
    const pending = ai.run(
      "transcribe",
      { lang: "en", samples: new Float32Array(16000) },
      () => {},
    );
    const failure = expect(pending).rejects.toThrow("5分間進みません");
    await vi.advanceTimersByTimeAsync(299000);
    FakeWorker.instances[0].reply({ type: "status", message: "次の区間" });
    await vi.advanceTimersByTimeAsync(299000);
    expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await failure;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it("中止・転送失敗後も新しいWorkerでやり直せる", async () => {
    const ai = new LocalAI();
    const first = ai.run(
      "transcribe",
      { lang: "en", samples: new Float32Array(16000) },
      () => {},
    );
    const cancelled = expect(first).rejects.toThrow("中止");
    ai.release();
    await cancelled;
    const retry = ai.run(
      "transcribe",
      { lang: "en", samples: new Float32Array(16000) },
      () => {},
    );
    FakeWorker.instances[1].onmessageerror?.();
    await expect(retry).rejects.toThrow("データを受け取れません");
    const final = ai.run(
      "transcribe",
      { lang: "en", samples: new Float32Array(16000) },
      () => {},
    );
    FakeWorker.instances[2].reply({ type: "result", text: "Recovered." });
    expect(await final).toBe("Recovered.");
  });
});
