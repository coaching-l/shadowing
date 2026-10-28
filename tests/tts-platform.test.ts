import { describe, expect, it, vi, afterEach } from "vitest";
import { isAppleMobile } from "../src/tts-platform";
import { BrowserEngine } from "../src/engine";

afterEach(() => vi.unstubAllGlobals());
describe("Appleモバイル端末の判別", () => {
  it("iPhone SafariとChrome、iPadOSのデスクトップ表示を判別する", () => {
    expect(
      isAppleMobile({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Version/18.7 Mobile Safari/604.1",
      }),
    ).toBe(true);
    expect(
      isAppleMobile({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) CriOS/140 Mobile Safari/604.1",
      }),
    ).toBe(true);
    expect(
      isAppleMobile({
        userAgent: "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X)",
      }),
    ).toBe(true);
    expect(
      isAppleMobile({
        userAgent: "Mozilla/5.0 Macintosh",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      isAppleMobile({
        userAgent: "Mozilla/5.0 Macintosh",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });
  it("PCやAndroidをAppleモバイルと判別しない", () => {
    expect(
      isAppleMobile({
        userAgent: "Mozilla/5.0 Macintosh",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
    expect(isAppleMobile({ userAgent: "Mozilla/5.0 Windows NT 10.0" })).toBe(
      false,
    );
    expect(isAppleMobile({ userAgent: "Mozilla/5.0 Linux; Android 15" })).toBe(
      false,
    );
    expect(isAppleMobile({})).toBe(false);
  });
  it("iPhoneでも中国語生成Workerを開始し、有効な生成結果を返す", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)",
    });
    class WorkerMock {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror = null;
      postMessage = vi.fn(() => {
        queueMicrotask(() =>
          this.onmessage?.({
            data: {
              type: "audio",
              samples: new Float32Array([0.1, -0.1]),
              rate: 24000,
            },
          }),
        );
      });
      terminate = vi.fn();
    }
    const worker = vi.fn(function () {
      return new WorkerMock();
    });
    vi.stubGlobal("Worker", worker);
    const engine = new BrowserEngine();
    const generated = await engine.generate(
      "请深呼吸。",
      "zf_001",
      1,
      () => {},
    );
    expect(worker).toHaveBeenCalledOnce();
    expect(generated).toEqual({
      samples: new Float32Array([0.1, -0.1]),
      rate: 24000,
    });
    engine.cancel();
  });
});
