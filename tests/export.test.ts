import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { download, encodeMP3 } from "../src/export";

class FakeWorker {
  static instances: FakeWorker[] = [];
  static postError: Error | undefined;
  onmessage:
    | ((event: { data: { blob?: Blob; error?: string } }) => void)
    | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn(() => {
    if (FakeWorker.postError) throw FakeWorker.postError;
  });
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}
beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.postError = undefined;
  vi.stubGlobal("Worker", FakeWorker);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MP3出力の中止と破棄", () => {
  it("中止済みなら音声を渡すWorkerを作らない", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      encodeMP3(new Float32Array([0.1]), 24000, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("変換中の中止でWorkerを即時終了し、遅れた結果を採用しない", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = encodeMP3(
      new Float32Array([0.1]),
      24000,
      controller.signal,
    );
    const worker = FakeWorker.instances[0];
    const late = worker.onmessage!;
    controller.abort();
    late({ data: { blob: new Blob(["late audio"]) } });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("正常なMP3を返して処理終了し、その後の中止では結果を変えない", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const samples = new Float32Array([0.1, 0.2]);
    const pending = encodeMP3(samples, 24000, controller.signal);
    const worker = FakeWorker.instances[0];
    const blob = new Blob(["encoded audio"], { type: "audio/mpeg" });
    expect(worker.postMessage).toHaveBeenCalledWith({ samples, rate: 24000 });
    worker.onmessage!({ data: { blob } });
    expect(await pending).toBe(blob);
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it.each(["worker", "message", "encode", "post"])(
    "%sの失敗でも音声を保持するWorkerを終了する",
    async (kind) => {
      if (kind === "post") FakeWorker.postError = Error("post failed");
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      const pending = encodeMP3(
        new Float32Array([0.1]),
        24000,
        controller.signal,
      );
      const worker = FakeWorker.instances[0];
      if (kind === "worker") worker.onerror!({ message: "worker failed" });
      else if (kind === "message") worker.onmessageerror!();
      else if (kind === "encode")
        worker.onmessage!({ data: { error: "encoder failed" } });
      await expect(pending).rejects.toBeInstanceOf(Error);
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(worker.onmessage).toBeNull();
      expect(worker.onerror).toBeNull();
      expect(worker.onmessageerror).toBeNull();
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    },
  );
});

describe("ダウンロードの一時音声URL", () => {
  function environment() {
    const anchor = { href: "", download: "", click: vi.fn() };
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor) });
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:export-fixture");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    return { anchor, create, revoke };
  }

  it("教材の削除時に呼べる破棄関数を返し、再実行しても一度だけ解除する", async () => {
    const { anchor, create, revoke } = environment();
    const blob = new Blob(["test audio"]);
    const cleanup = download(blob, "lesson.mp3");
    expect(create).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe("blob:export-fixture");
    expect(anchor.download).toBe("lesson.mp3");
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    cleanup();
    cleanup();
    await vi.advanceTimersByTimeAsync(60000);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:export-fixture");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("通常の保存後も60秒で自動解除する", async () => {
    const { revoke } = environment();
    const cleanup = download(new Blob(["test audio"]), "lesson.mp3");
    await vi.advanceTimersByTimeAsync(59999);
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(revoke).toHaveBeenCalledOnce();
    cleanup();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it("保存を開始できなくても作成したURLを残さない", () => {
    const { anchor, revoke } = environment();
    anchor.click.mockImplementation(() => {
      throw Error("download denied");
    });
    expect(() => download(new Blob(["test audio"]), "lesson.mp3")).toThrow(
      "download denied",
    );
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:export-fixture");
    expect(vi.getTimerCount()).toBe(0);
  });
});
