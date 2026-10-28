import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    allowLocalModels: true,
    backends: {
      onnx: {
        wasm: {} as {
          numThreads?: number;
          wasmPaths?: { wasm: string };
        },
      },
    },
  },
  pipeline: vi.fn(),
}));

vi.mock("@huggingface/transformers", () => ({
  env: mocks.env,
  pipeline: mocks.pipeline,
  AutoModelForMaskedLM: {},
  AutoTokenizer: {},
}));

type Request = {
  kind: "transcribe";
  lang: string;
  samples: unknown;
};
type Reply = { type: string; text?: string; message?: string };
let host: {
  onmessage: ((event: { data: Request }) => Promise<void>) | null;
  postMessage: ReturnType<typeof vi.fn>;
};
const audio = (seconds = 2) => new Float32Array(seconds * 16000).fill(0.2);
const replies = () =>
  host.postMessage.mock.calls.map(([data]) => data as Reply);
const dispatch = (samples: unknown, lang = "en") =>
  host.onmessage!({ data: { kind: "transcribe", lang, samples } });
function recognizer(text = "A short English sentence.") {
  return Object.assign(
    vi.fn(
      async (_samples: Float32Array, _options: Record<string, unknown>) => ({
        text,
      }),
    ),
    {
      dispose: vi.fn(async () => {}),
    },
  );
}

beforeEach(async () => {
  vi.resetModules();
  mocks.pipeline.mockReset();
  mocks.env.allowLocalModels = true;
  mocks.env.backends.onnx.wasm = {};
  host = { onmessage: null, postMessage: vi.fn() };
  vi.stubGlobal("self", host);
  await import("../src/local-ai.worker");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("音声文字起こしWorker", () => {
  it("単一スレッドとアプリに同梱したWASMを使う", () => {
    expect(mocks.env.allowLocalModels).toBe(false);
    expect(mocks.env.backends.onnx.wasm.numThreads).toBe(1);
    const wasm = mocks.env.backends.onnx.wasm.wasmPaths?.wasm;
    expect(wasm).toMatch(/ort-wasm-simd-threaded\.jsep.*\.wasm/);
    expect(wasm).not.toMatch(/^https?:\/\//);
  });

  it("英語は固定版tiny.en q8を使い、非対応のlanguage/taskを指定しない", async () => {
    const recognize = recognizer();
    mocks.pipeline.mockResolvedValue(recognize);
    await dispatch(audio());
    expect(mocks.pipeline).toHaveBeenCalledWith(
      "automatic-speech-recognition",
      "Xenova/whisper-tiny.en",
      expect.objectContaining({
        revision: "79fb389fc764e7c395bd330e9531d9d32ada7049",
        dtype: "q8",
        device: "wasm",
      }),
    );
    const options = recognize.mock.calls[0][1] as Record<string, unknown>;
    expect(options).not.toHaveProperty("language");
    expect(options).not.toHaveProperty("task");
    expect(options).toMatchObject({ num_beams: 1, return_timestamps: false });
    expect(replies().at(-1)).toEqual({
      type: "result",
      text: "A short English sentence.",
    });
  });

  it("中国語は従来の多言語tinyと中国語の文字起こし指定を保つ", async () => {
    const recognize = recognizer("这是中文。");
    mocks.pipeline.mockResolvedValue(recognize);
    await dispatch(audio(), "zh");
    expect(mocks.pipeline).toHaveBeenCalledWith(
      "automatic-speech-recognition",
      "Xenova/whisper-tiny",
      expect.objectContaining({
        revision: "5332fcc35e32a33b86612b9a57a89be7906102b1",
        dtype: "q8",
        device: "wasm",
      }),
    );
    expect(recognize.mock.calls[0][1]).toMatchObject({
      language: "chinese",
      task: "transcribe",
    });
    expect(replies().at(-1)).toEqual({ type: "result", text: "这是中文。" });
  });

  it("65秒の音声を24秒以下の区間で逐次認識し、全区間の結果を残す", async () => {
    let active = 0;
    let maximumActive = 0;
    let completed = 0;
    const recognize = Object.assign(
      vi.fn(async (_samples: Float32Array, _options: unknown) => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active--;
        return { text: `  Part ${++completed}.  ` };
      }),
      { dispose: vi.fn(async () => {}) },
    );
    mocks.pipeline.mockResolvedValue(recognize);
    const samples = audio(65);
    await dispatch(samples);
    expect(mocks.pipeline).toHaveBeenCalledOnce();
    expect(recognize.mock.calls.length).toBeGreaterThan(1);
    const segments = recognize.mock.calls.map(([segment]) => segment);
    expect(segments.every((segment) => segment.length <= 24 * 16000)).toBe(
      true,
    );
    expect(
      segments.reduce((length, segment) => length + segment.length, 0),
    ).toBe(samples.length);
    expect(maximumActive).toBe(1);
    expect(replies().at(-1)).toEqual({
      type: "result",
      text: Array.from({ length: completed }, (_, i) => `Part ${i + 1}.`).join(
        " ",
      ),
    });
    expect(replies().filter((reply) => reply.type === "status")).toHaveLength(
      completed,
    );
  });

  it.each([
    ["通常の配列", [0.2, 0.1]],
    ["短すぎる音声", audio(0.1)],
    ["NaNを含む音声", Object.assign(audio(), { 2: NaN })],
    ["Infinityを含む音声", Object.assign(audio(), { 2: Infinity })],
    ["無音", new Float32Array(16000)],
  ])("%sはモデル取得前に拒否する", async (_name, samples) => {
    await dispatch(samples);
    expect(mocks.pipeline).not.toHaveBeenCalled();
    expect(replies()).toHaveLength(1);
    expect(replies()[0]).toMatchObject({
      type: "error",
      message: expect.any(String),
    });
  });

  it("言語の切り替えで前の認識モデルを解放する", async () => {
    const english = recognizer();
    const chinese = recognizer("你好。");
    mocks.pipeline
      .mockResolvedValueOnce(english)
      .mockResolvedValueOnce(chinese);
    await dispatch(audio(), "en");
    await dispatch(audio(), "zh");
    expect(english.dispose).toHaveBeenCalledOnce();
    expect(chinese.dispose).not.toHaveBeenCalled();
    expect(mocks.pipeline).toHaveBeenCalledTimes(2);
    expect(replies().at(-1)).toEqual({ type: "result", text: "你好。" });
  });

  it("処理中の追加メッセージで同時推論を始めない", async () => {
    let finish!: (output: { text: string }) => void;
    const pending = new Promise<{ text: string }>((resolve) => {
      finish = resolve;
    });
    const recognize = Object.assign(
      vi.fn(() => pending),
      {
        dispose: vi.fn(async () => {}),
      },
    );
    mocks.pipeline.mockResolvedValue(recognize);
    const first = dispatch(audio());
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledOnce());
    await dispatch(audio());
    expect(mocks.pipeline).toHaveBeenCalledOnce();
    expect(recognize).toHaveBeenCalledOnce();
    finish({ text: "One request." });
    await first;
    expect(replies().filter((reply) => reply.type === "result")).toEqual([
      { type: "result", text: "One request." },
    ]);
  });
});
