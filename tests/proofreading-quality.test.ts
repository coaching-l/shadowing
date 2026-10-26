import { expect, it } from "vitest";
import fixtures from "./fixtures/english-proofreading.json";
import {
  filterEnglishCorrection,
  stableEnglishCorrection,
} from "../src/spelling-en";
import {
  plausibleChineseChange,
  mapHanPositions,
  chineseChangeConfidence,
  protectedChineseRanges,
} from "../src/spelling-zh";
import {
  correctionEdits,
  applyCorrectionEdits,
} from "../src/correction-review";
// These are fixed regression examples, not a representative accuracy benchmark.
it.each(fixtures)(
  "英語の原文と文脈候補を保守的に照合: $source",
  ({ source, model, expected }) => {
    expect(filterEnglishCorrection(source, model)).toBe(expected);
  },
);
it("未知語を誤った辞書第一候補にせず、誤った候補や文意の変更を拒否する", () => {
  expect(
    stableEnglishCorrection(
      "I hav a small problem.",
      "I hag a small problem.",
      "I have a small problem.",
    ),
  ).toBe("I hav a small problem.");
  expect(
    filterEnglishCorrection("I want a small dog.", "I want a large cat."),
  ).toBe("I want a small dog.");
});
it("文脈で選んだ候補を使い、単語の分割や重複の修正を保つ", () => {
  expect(
    filterEnglishCorrection(
      "He has alot of experiance.",
      "He has a lot of experience.",
    ),
  ).toBe("He has a lot of experience.");
  expect(
    filterEnglishCorrection("I have have a problem.", "I have a problem."),
  ).toBe("I have a problem.");
  expect(
    filterEnglishCorrection("She receive messages.", "She receives messages."),
  ).toBe("She receives messages.");
});
it("余分な語の挿入・通常語の削除・否定や数字の変更を採用しない", () => {
  expect(
    filterEnglishCorrection(
      "Please keep this line break.",
      "Please keep this line a break.",
    ),
  ).toBe("Please keep this line break.");
  expect(
    filterEnglishCorrection(
      "I do not agree with this plan.",
      "I agree with this plan.",
    ),
  ).toBe("I do not agree with this plan.");
  expect(
    filterEnglishCorrection("Pay 125.50 dollars.", "Pay 125 dollars."),
  ).toBe("Pay 125.50 dollars.");
});
it("英米の綴り・人名・略語・技術名を保つ", () => {
  const source = "Dr. Nakamura uses TypeScript and prefers the colour grey.";
  expect(
    filterEnglishCorrection(
      source,
      "Dr. Nakamuras uses Typescript and prefers the color gray.",
    ),
  ).toBe(source);
});
it("中国語は音・字形の近い誤字を候補にし、意味の違う置換や簡繁の変更を避ける", () => {
  for (const [a, b] of [
    ["提", "题"],
    ["心", "兴"],
    ["见", "件"],
    ["耍", "要"],
    ["己", "已"],
  ])
    expect(plausibleChineseChange(a, b)).toBe(true);
  expect(plausibleChineseChange("手", "俄")).toBe(false);
  expect(plausibleChineseChange("學", "学")).toBe(false);
});
it("漢字と英数字を含む入力を、英数字を変更せずに位置対応できる", () => {
  const ids = new Map<string, number[]>();
  let next = 1;
  const result = mapHanPositions("我用React，3点见。", (value) => {
    if (!ids.has(value)) ids.set(value, [next++]);
    return ids.get(value)!;
  });
  expect(result.positions.map((p) => p.original)).toEqual([
    "我",
    "用",
    "点",
    "见",
  ]);
  expect(
    result.positions.every(
      (p) => "我用React，3点见。".slice(p.start, p.end) === p.original,
    ),
  ).toBe(true);
});
it("中国語候補の確率と原文字との差を別々に判定する", () => {
  const confident = chineseChangeConfidence(
    new Float32Array([0, 0, 8]),
    0,
    3,
    0,
  );
  expect(confident.best).toBe(2);
  expect(confident.probability).toBeGreaterThan(0.99);
  expect(confident.margin).toBe(8);
  expect(
    chineseChangeConfidence(new Float32Array([1, 1.1, 1]), 0, 3, 0).probability,
  ).toBeLessThan(0.4);
});
it("中国語の明示された姓名は保護する", () => {
  const text = "联系人是张晓雨，邮箱不变。";
  const ranges = protectedChineseRanges(text);
  expect(ranges.map((r) => text.slice(r.start, r.end))).toContain("张晓雨");
});
it.each([
  [
    "en",
    "This sentnce has a speling eror.",
    "This sentence has a spelling error.",
  ],
  ["zh", "这个问提很重耍。", "这个问题很重要。"],
] as const)(
  "修正候補を個別に採用・除外できる: %s",
  (lang, source, proposed) => {
    const edits = correctionEdits(source, proposed, lang);
    expect(
      applyCorrectionEdits(
        source,
        edits,
        edits.map(() => true),
      ),
    ).toBe(proposed);
    expect(
      applyCorrectionEdits(
        source,
        edits,
        edits.map(() => false),
      ),
    ).toBe(source);
    const partial = applyCorrectionEdits(
      source,
      edits,
      edits.map((_, i) => i === 0),
    );
    expect(partial).not.toBe(source);
    expect(partial).not.toBe(proposed);
  },
);

it("よくある短縮形の誤字と動詞の活用を文脈候補から確認できる", () => {
  expect(
    filterEnglishCorrection(
      "She dont like this idea.",
      "She doesn't like this idea.",
    ),
  ).toBe("She doesn't like this idea.");
  expect(
    filterEnglishCorrection(
      "I cant attend the meeting.",
      "I can't attend the meeting.",
    ),
  ).toBe("I can't attend the meeting.");
  expect(
    filterEnglishCorrection(
      "I look forward to meet you.",
      "I look forward to meeting you.",
    ),
  ).toBe("I look forward to meeting you.");
});
it("再確認で不安定な変更だけを除き、安定した候補を残す", () => {
  expect(
    stableEnglishCorrection(
      "I hav a smal problem.",
      "I hag a small problem.",
      "I have a small problem.",
    ),
  ).toBe("I hav a small problem.");
  expect(
    stableEnglishCorrection(
      "I hav a smal problem.",
      "I have a small problem.",
      "I have a small problem.",
    ),
  ).toBe("I have a small problem.");
});
it("再確認の短縮形の表記差や冠詞選択だけで明らかなスペル修正を失わない", () => {
  expect(
    stableEnglishCorrection(
      "I cant attend.",
      "I can't attend.",
      "I cannot attend.",
    ),
  ).toBe("I can't attend.");
  expect(
    stableEnglishCorrection(
      "He received teh message.",
      "He received the message.",
      "He received a message.",
    ),
  ).toBe("He received the message.");
});

it("単語内空白の例：sti fl ed を stifled へ復元する", async () => {
  const { repairEnglishFragments } = await import("../src/spelling-en");
  expect(repairEnglishFragments("sti fl ed")).toBe("stifled");
  expect(repairEnglishFragments("She sti fl ed a yawn.")).toBe(
    "She stifled a yawn.",
  );
  expect(repairEnglishFragments("Her voice was sti fl ed by emotion.")).toBe(
    "Her voice was stifled by emotion.",
  );
});
it("PDFの分断・合字を復元し、正しい単語の間やコードは結合しない", async () => {
  const { repairEnglishFragments } = await import("../src/spelling-en");
  expect(repairEnglishFragments("con fi dence and re fl ect")).toBe(
    "confidence and reflect",
  );
  expect(repairEnglishFragments("sti ﬂ ed and reﬂect")).toBe(
    "stifled and reflect",
  );
  expect(repairEnglishFragments("sti-\nfled")).toBe("stifled");
  expect(repairEnglishFragments("sti\nfled")).toBe("stifled");
  expect(
    repairEnglishFragments(
      "I can not go in to the office.\nKeep this line break.",
    ),
  ).toBe("I can not go in to the office.\nKeep this line break.");
  expect(repairEnglishFragments("`sti fl ed` and COACHING-L")).toBe(
    "`sti fl ed` and COACHING-L",
  );
});
it("分断した1語の復元は1候補として丸ごと採用・除外する", () => {
  const source = "She sti fl ed a yawn.",
    proposed = "She stifled a yawn.";
  const edits = correctionEdits(source, proposed, "en");
  expect(edits).toHaveLength(1);
  expect(applyCorrectionEdits(source, edits, [true])).toBe(proposed);
  expect(applyCorrectionEdits(source, edits, [false])).toBe(source);
});
