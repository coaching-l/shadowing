import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeInterruptedTtsAttempt,
  finishTtsAttempt,
  readInterruptedTtsAttempt,
  startTtsAttempt,
  TTS_ATTEMPT_KEY,
  TTS_ATTEMPT_MAX_AGE_MS,
  updateTtsAttempt,
} from "../src/tts-attempt";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

let store: MemoryStorage;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T09:00:00Z"));
  store = new MemoryStorage();
  vi.stubGlobal("sessionStorage", store);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("音声生成の中断を知らせるチェックポイント", () => {
  it("本文やファイル情報を含めず、試聴の開始・処理段階だけを保存する", () => {
    const id = startTtsAttempt("zh", "preview");
    expect(id).toBeTruthy();
    const raw = store.getItem(TTS_ATTEMPT_KEY)!;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual([
      "id",
      "lang",
      "source",
      "stage",
      "startedAt",
      "v",
    ]);
    expect(readInterruptedTtsAttempt()).toEqual({
      id,
      lang: "zh",
      source: "preview",
      stage: "loading",
      startedAt: Date.now(),
    });
    updateTtsAttempt(id, "synthesizing");
    expect(readInterruptedTtsAttempt()?.stage).toBe("synthesizing");
  });

  it("読み取りは再実行でき、中断の通知は消費後に再び出さない", () => {
    const id = startTtsAttempt("en", "full");
    const first = readInterruptedTtsAttempt();
    expect(readInterruptedTtsAttempt()).toEqual(first);
    expect(consumeInterruptedTtsAttempt()?.id).toBe(id);
    expect(consumeInterruptedTtsAttempt()).toBeUndefined();
  });

  it("終了処理を呼んだ生成は、中断として報告しない", () => {
    const id = startTtsAttempt("zh");
    finishTtsAttempt(id);
    expect(consumeInterruptedTtsAttempt()).toBeUndefined();
    expect(store.length).toBe(0);
  });

  it("古い非同期処理の終了・段階更新で、新しい生成の記録を消さない", () => {
    const old = startTtsAttempt("en", "preview");
    const current = startTtsAttempt("zh", "full");
    expect(old).not.toBe(current);
    finishTtsAttempt(old);
    updateTtsAttempt(old, "synthesizing");
    finishTtsAttempt(undefined);
    expect(readInterruptedTtsAttempt()).toMatchObject({
      id: current,
      lang: "zh",
      stage: "loading",
    });
  });

  it("期限を超えた古い処理を、現在の中断として扱わない", () => {
    startTtsAttempt("zh");
    vi.advanceTimersByTime(TTS_ATTEMPT_MAX_AGE_MS + 1);
    expect(consumeInterruptedTtsAttempt()).toBeUndefined();
    expect(store.getItem(TTS_ATTEMPT_KEY)).toBeNull();
  });

  it("壊れた記録・未知の形式・未来の時刻は破棄する", () => {
    const valid = {
      v: 1,
      id: "attempt",
      lang: "zh",
      stage: "loading",
      startedAt: Date.now(),
    };
    for (const raw of [
      "",
      "x".repeat(2048),
      "{broken json",
      "null",
      JSON.stringify([]),
      JSON.stringify({ ...valid, v: 2 }),
      JSON.stringify({ ...valid, lang: "unsupported" }),
      JSON.stringify({ ...valid, stage: "unknown" }),
      JSON.stringify({ ...valid, source: "private text" }),
      JSON.stringify({ ...valid, startedAt: Date.now() + 1 }),
      JSON.stringify({ ...valid, id: "" }),
    ]) {
      store.setItem(TTS_ATTEMPT_KEY, raw);
      expect(consumeInterruptedTtsAttempt()).toBeUndefined();
      expect(store.getItem(TTS_ATTEMPT_KEY)).toBeNull();
    }
  });

  it("保存に余分なプロパティがあっても、通知へ返すのは許可したメタデータだけ", () => {
    store.setItem(
      TTS_ATTEMPT_KEY,
      JSON.stringify({
        v: 1,
        id: "attempt",
        lang: "zh",
        stage: "loading",
        startedAt: Date.now(),
        text: "private input",
        title: "private title",
        error: "private error",
      }),
    );
    const result = consumeInterruptedTtsAttempt();
    expect(Object.keys(result!).sort()).toEqual([
      "id",
      "lang",
      "stage",
      "startedAt",
    ]);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("Storageがない・読み書きが拒否された環境でも音声生成を妨げない", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(startTtsAttempt("zh")).toBeUndefined();
    expect(consumeInterruptedTtsAttempt()).toBeUndefined();
    expect(() => {
      finishTtsAttempt("attempt");
      updateTtsAttempt("attempt", "loading");
    }).not.toThrow();
    vi.stubGlobal("sessionStorage", store);
    vi.spyOn(store, "setItem").mockImplementation(() => {
      throw new DOMException("Denied", "QuotaExceededError");
    });
    expect(startTtsAttempt("zh")).toBeUndefined();
    vi.spyOn(store, "getItem").mockImplementation(() => {
      throw new DOMException("Denied", "SecurityError");
    });
    vi.spyOn(store, "removeItem").mockImplementation(() => {
      throw new DOMException("Denied", "SecurityError");
    });
    expect(() => {
      consumeInterruptedTtsAttempt();
      finishTtsAttempt("attempt");
    }).not.toThrow();
  });

  it("Storageプロパティへのアクセス自体が拒否されても通知処理は失敗しない", () => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("Denied", "SecurityError");
      },
    });
    expect(startTtsAttempt("zh")).toBeUndefined();
    expect(readInterruptedTtsAttempt()).toBeUndefined();
    expect(consumeInterruptedTtsAttempt()).toBeUndefined();
    expect(() => {
      finishTtsAttempt("attempt");
      updateTtsAttempt("attempt", "loading");
    }).not.toThrow();
  });
});
