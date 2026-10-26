import { describe, expect, it } from "vitest";
import { compareTranscript, validateCorrection } from "../src/feedback";
describe("録音の文字起こしと原稿の比較", () => {
  it("英語の大文字・句読点と全角文字を正規化する", () => {
    expect(
      compareTranscript("Hello, WORLD!", "Ｈｅｌｌｏ world.", "en").every(
        (x) => x.kind === "match",
      ),
    ).toBe(true);
  });
  it("アポストロフィを単語の一部として扱う", () => {
    expect(
      compareTranscript("I’m ready.", "I'm ready", "en").every(
        (x) => x.kind === "match",
      ),
    ).toBe(true);
  });
  it("置換、認識なし、原稿にない語を区別する", () => {
    expect(
      compareTranscript(
        "Take a deep breath",
        "Take a slow breath",
        "en",
      ).filter((x) => x.kind !== "match"),
    ).toEqual([{ kind: "replace", expected: "deep", heard: "slow" }]);
    expect(
      compareTranscript("Take a deep breath", "Take a breath", "en").find(
        (x) => x.kind === "missing",
      )?.expected,
    ).toBe("deep");
    expect(
      compareTranscript("Take a breath", "Take a deep breath", "en").find(
        (x) => x.kind === "extra",
      )?.heard,
    ).toBe("deep");
  });
  it("中国語は1字ずつ比較し簡繁の違いを隠さない", () => {
    expect(
      compareTranscript("今天我很高兴。", "今天我很高心", "zh").filter(
        (x) => x.kind !== "match",
      ),
    ).toEqual([{ kind: "replace", expected: "兴", heard: "心" }]);
    expect(
      compareTranscript("学习", "學習", "zh").filter((x) => x.kind !== "match"),
    ).toHaveLength(2);
  });
  it("空の認識結果をミスとして採点しない", () => {
    expect(() => compareTranscript("Hello", "...", "en")).toThrow(
      "認識された文章がありません",
    );
    expect(() => compareTranscript("", "hello", "en")).toThrow("原稿を入力");
  });
  it("長い入力を黙って切り捨てない", () => {
    expect(() => compareTranscript("词".repeat(501), "词", "zh")).toThrow(
      "500",
    );
  });
});
describe("タイポ候補の検査", () => {
  it("小さな英語と中国語の修正候補を受け入れる", () => {
    expect(
      validateCorrection("I hav a smal problm.", "I have a small problem."),
    ).toBe("I have a small problem.");
    expect(validateCorrection("我今天很高心。", "我今天很高兴。")).toBe(
      "我今天很高兴。",
    );
  });
  it("無変更の本文を受け入れる", () => {
    expect(
      validateCorrection("What matters today?", "What matters today?"),
    ).toBe("What matters today?");
  });
  it("原稿への返答や大きな書き換えを拒否する", () => {
    expect(() =>
      validateCorrection(
        "What matters today?",
        "I would like to help you with your work.",
      ),
    ).toThrow();
    expect(() =>
      validateCorrection("我今天很高心。", "你今天心情很好。"),
    ).toThrow();
  });
  it("空・長すぎる・切り詰められた出力を拒否する", () => {
    expect(() => validateCorrection("Hello world", "")).toThrow();
    expect(() => validateCorrection("Hello", "Hello ".repeat(30))).toThrow();
    expect(() =>
      validateCorrection(
        "This is an entire sentence with an important ending.",
        "This is an entire sentence",
      ),
    ).toThrow();
  });
});

it("中国語の繁体字を簡体字へ揃えて照合できる", async () => {
  const { normalizeChineseComparison } = await import("../src/feedback");
  const heard =
    await normalizeChineseComparison("今天我很高興，明天我們一起學習。");
  expect(
    compareTranscript("今天我很高兴。明天我们一起学习。", heard, "zh").every(
      (item) => item.kind === "match",
    ),
  ).toBe(true);
});
it("タイポ候補に選択範囲の前後の空白を保つ", () => {
  expect(validateCorrection("\n I hav a problm. \n", "I have a problem.")).toBe(
    "\n I have a problem. \n",
  );
});

it("英語のスペル確認は本文の質問に答えず、句読点・空白を維持する", async () => {
  const { correctEnglish } = await import("../src/spelling-en");
  expect(correctEnglish("This sentnce has a speling eror.")).toBe(
    "This sentence has a spelling error.",
  );
  expect(correctEnglish("What would you like to focus on today?")).toBe(
    "What would you like to focus on today?",
  );
  expect(correctEnglish("  COACHING-L\nI like learning English.\n")).toBe(
    "  COACHING-L\nI like learning English.\n",
  );
});
