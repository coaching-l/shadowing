import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserEngine } from "../src/engine";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  reply(data: unknown) {
    this.onmessage?.({ data });
  }
}
const audio = () => ({
  type: "audio",
  samples: new Float32Array([0.1, 0.2]),
  rate: 24000,
});
beforeEach(() => {
  FakeWorker.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("音声生成の失敗からの復帰", () => {
  it("言語を切り替えたらWorkerごと解放し、古いWASMメモリーを残さない", async () => {
    const engine = new BrowserEngine();
    const first = engine.generate("Hello.", "af_heart", 1, () => {});
    FakeWorker.instances[0].reply(audio());
    await first;
    const second = engine.generate("你好。", "zf_001", 1, () => {});
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[1].reply(audio());
    await second;
    engine.cancel();
  });
  it("モデル読み込みの失敗後はWorkerを破棄し、新しいWorkerで再試行する", async () => {
    const engine = new BrowserEngine();
    const pending = engine.generate("你好。", "zf_001", 1, () => {});
    const failure = expect(pending).rejects.toThrow("音声モデルの読み込み");
    const first = FakeWorker.instances[0];
    first.reply({ type: "error", error: "Test allocation failure" });
    await failure;
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(first.onmessage).toBeNull();
    const retry = engine.generate("你好。", "zf_001", 1, () => {});
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[1].reply(audio());
    expect((await retry).samples).toHaveLength(2);
    const next = engine.generate("再见。", "zf_002", 1, () => {});
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[1].reply(audio());
    await next;
    engine.cancel();
  });

  it("Worker自体のエラーでも停止し、処理中のまま残さない", async () => {
    const engine = new BrowserEngine();
    const pending = engine.generate("你好。", "zf_001", 1, () => {});
    const failure = expect(pending).rejects.toThrow("実行中にエラー");
    FakeWorker.instances[0].onerror?.({ message: "WebAssembly failure" });
    await failure;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const retry = engine.generate("你好。", "zf_001", 1, () => {});
    FakeWorker.instances[1].reply(audio());
    await retry;
    engine.cancel();
  });

  it("NaN音声は成功として保存せず、失敗した推論環境を破棄する", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const engine = new BrowserEngine();
    const pending = engine.generate("你好。", "zf_001", 1, () => {});
    const failure = expect(pending).rejects.toThrow("有効な音声データ");
    FakeWorker.instances[0].reply({
      ...audio(),
      samples: new Float32Array([NaN]),
    });
    await failure;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it("中止・タイムアウトでWorkerを残さず、同時の生成を始めない", async () => {
    const engine = new BrowserEngine();
    const pending = engine.generate("你好。", "zf_001", 1, () => {});
    const failure = expect(pending).rejects.toThrow("中止");
    await expect(
      engine.generate("再见。", "zf_002", 1, () => {}),
    ).rejects.toThrow("進行中");
    engine.cancel();
    await failure;
    const retry = engine.generate("你好。", "zf_001", 1, () => {});
    const timeout = expect(retry).rejects.toThrow("3分以内");
    await vi.advanceTimersByTimeAsync(180000);
    await timeout;
    expect(
      FakeWorker.instances.every(
        (worker) => worker.terminate.mock.calls.length === 1,
      ),
    ).toBe(true);
  });
});
