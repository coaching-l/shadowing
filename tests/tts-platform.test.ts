import { describe, expect, it, vi, afterEach } from "vitest";
import { isAppleMobile, MOBILE_CHINESE_NOTICE } from "../src/tts-platform";
import { BrowserEngine } from "../src/engine";

afterEach(() => vi.unstubAllGlobals());
describe("iPhone・iPadの中国語生成の案内", () => {
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
  it("PCの中国語生成やAndroidを誤って止めない", () => {
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
  it("iOSの中国語は重いWorkerを作る前に停止し、PC音声の取り込みを案内する", async () => {
    const worker = vi.fn();
    vi.stubGlobal("Worker", worker);
    const engine = new BrowserEngine(true);
    await expect(
      engine.generate("请深呼吸。", "zf_001", 1, () => {}),
    ).rejects.toThrow(MOBILE_CHINESE_NOTICE);
    expect(worker).not.toHaveBeenCalled();
  });
});
