import { test, expect } from "@playwright/test";
import { zipSync, strToU8, unzipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
test("実ファイルの資料抽出・編集・保存復元・言語切替・レスポンシブ", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "シャドーイング・スタジオ" }),
  ).toBeVisible();
  await page.getByLabel("資料ファイル").setInputFiles({
    name: "sample.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Dr. Lee paid 3.14 dollars. What matters today?"),
  });
  await page.getByRole("button", { name: "文に分割する", exact: true }).click();
  await expect(page.getByLabel("1文目の原稿")).toHaveValue(
    "Dr. Lee paid 3.14 dollars.",
  );
  await expect(page.getByLabel("2文目の原稿")).toHaveValue(
    "What matters today?",
  );
  await page.getByRole("button", { name: "次と結合" }).first().click();
  await expect(page.getByLabel("1文目の原稿")).toHaveValue(
    "Dr. Lee paid 3.14 dollars. What matters today?",
  );
  await page
    .getByLabel("1文目の原稿")
    .fill("Dr. Lee paid 3.14 dollars.\nWhat matters today?");
  await page.getByRole("button", { name: "改行で再分割" }).first().click();
  await expect(page.getByLabel("2文目の原稿")).toBeVisible();
  await page.getByRole("button", { name: "教材を保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "教材をこのブラウザーに保存しました",
  );
  await page.reload();
  await page.getByRole("button", { name: /sample 英語/ }).click();
  await expect(page.getByLabel("2文目の原稿")).toHaveValue(
    "What matters today?",
  );
  const docx = zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "word/document.xml": strToU8(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello from Word.</w:t></w:r></w:p></w:body></w:document>',
    ),
  });
  await page.getByLabel("資料ファイル").setInputFiles({
    name: "real.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(docx),
  });
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue(
    /Hello from Word/,
  );
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("PDF document. Keep every word.", { font });
  await page.getByLabel("資料ファイル").setInputFiles({
    name: "text.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue(
    /PDF document. Keep every word/,
  );
  const image = await PDFDocument.create();
  image.addPage();
  await page.getByLabel("資料ファイル").setInputFiles({
    name: "empty.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await image.save()),
  });
  await expect(page.getByRole("alert")).toContainText(
    "画像PDFには対応していません",
  );
  await page.getByLabel("練習する言語").selectOption("zh");
  await page
    .getByLabel("本文", { exact: true })
    .fill("今天，你想练习什么？请慢慢说。");
  await page.getByRole("button", { name: "文に分割する", exact: true }).click();
  await expect(page.getByLabel("2文目の原稿")).toHaveValue("请慢慢说。");
  await expect(
    page.getByText(
      "同じ原稿で、英語は5声、中国語は3声を聴き比べられます。試聴して、発音や区切り、好みに合う声か確認してください。",
    ),
  ).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(3);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
test("実MP3の持ち込み・再生・A–B・録音・MP3/ZIP出力・復元", async ({
  page,
}) => {
  await mkdir("/tmp/shadowing-check", { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=3",
      "-ar",
      "24000",
      "/tmp/shadowing-check/input.mp3",
    ],
    { stdio: "ignore" },
  );
  await page.goto("/");
  await page.getByText("手元の音声で練習する", { exact: true }).click();
  await page
    .getByLabel("練習用音声")
    .setInputFiles("/tmp/shadowing-check/input.mp3");
  await expect(page.getByText("1文の音声", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.waitForTimeout(350);
  expect(
    await page
      .locator("audio")
      .evaluateAll((els) =>
        (els as HTMLAudioElement[]).some((a) => a.currentTime > 0.1),
      ),
  ).toBe(true);
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  await page.getByLabel("開始 A（秒）", { exact: true }).fill("0.1");
  await page.getByLabel("終了 B（秒）", { exact: true }).fill("0.5");
  await page.getByLabel("区間の間の無音（秒）").fill("0.1");
  await page.getByLabel("繰り返し回数").selectOption("3");
  await page.getByLabel("区間リピート").check();
  await page.getByLabel("再生速度（高さを維持）").selectOption("1.5");
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.waitForTimeout(1600);
  await expect(
    page.getByRole("button", { name: "再生", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/区間リピート.*3回目/)).toBeVisible();
  await page.getByText("自分の声を録音して比較", { exact: true }).click();
  await page
    .getByRole("button", { name: "録音する／録り直す", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "録音を停止", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "録音を停止", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "お手本 → 自分の声" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "お手本 → 自分の声" }).click();
  await page.waitForTimeout(600);
  expect(
    await page
      .locator("audio")
      .evaluateAll(
        (els) => (els as HTMLAudioElement[]).filter((a) => !a.paused).length,
      ),
  ).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "比較を停止" }).click();
  await page.getByText("MP3をダウンロード", { exact: true }).click();
  await page
    .getByRole("button", { name: "全文・無音なし", exact: true })
    .click();
  const link = page.getByRole("button", { name: /input.mp3-plain-01.mp3/ });
  await expect(link).toBeVisible();
  const d = page.waitForEvent("download");
  await link.click();
  await (await d).saveAs("/tmp/shadowing-check/output.mp3");
  const probe = JSON.parse(
    execFileSync("ffprobe", [
      "-v",
      "quiet",
      "-show_streams",
      "-of",
      "json",
      "/tmp/shadowing-check/output.mp3",
    ]).toString(),
  );
  expect(probe.streams[0].codec_name).toBe("mp3");
  expect(+probe.streams[0].duration).toBeGreaterThan(3);
  await page.getByLabel("自分の録音も教材と一緒に保存する").check();
  await page.getByRole("button", { name: "教材を保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("保存しました");
  await page.reload();
  await page.getByRole("button", { name: /input.mp3 英語/ }).click();
  await expect(page.getByLabel("開始 A（秒）", { exact: true })).toHaveValue(
    "0.1",
  );
  await expect(page.getByLabel("終了 B（秒）", { exact: true })).toHaveValue(
    "0.5",
  );
  await page.getByText("自分の声を録音して比較", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "お手本 → 自分の声" }),
  ).toBeVisible();
  // Functional fixture tests output, not synthesis quality. Create two sentence clips through the persisted lesson schema.
  await page.evaluate(async () => {
    const { listLessons, saveLesson } = await import("/src/storage.ts");
    const lesson = (await listLessons())[0];
    const c = lesson.clips[0];
    lesson.sentences = ["First.", "Second."];
    lesson.text = "First. Second.";
    lesson.clips = lesson.sentences.map((text: string, i: number) => ({
      ...c,
      samples:
        i === 0
          ? c.samples
          : Float32Array.from(
              c.samples,
              (_, j) => 0.4 * Math.sin((2 * Math.PI * 880 * j) / c.rate),
            ),
      text,
      key: JSON.stringify([text, lesson.voice, lesson.speed, "kokoro-v1.0-q8"]),
    }));
    await saveLesson(lesson);
  });
  await page.reload();
  await page.getByRole("button", { name: /input.mp3 英語/ }).click();
  await page.getByText("MP3をダウンロード", { exact: true }).click();
  await page.getByLabel("1ファイルあたりの文数").fill("1");
  await page.getByRole("button", { name: "文数で分割する" }).click();
  await expect(
    page.getByRole("button", { name: /input.mp3-parts-02.mp3/ }),
  ).toBeVisible();
  const zipD = page.waitForEvent("download");
  await page.getByRole("button", { name: "まとめてZIP保存" }).click();
  await (await zipD).saveAs("/tmp/shadowing-check/output.zip");
  const entries = unzipSync(await readFile("/tmp/shadowing-check/output.zip"));
  expect(Object.keys(entries)).toHaveLength(2);
  for (const [name, bytes] of Object.entries(entries)) {
    await writeFile("/tmp/shadowing-check/" + name, bytes);
    const p = JSON.parse(
      execFileSync("ffprobe", [
        "-v",
        "quiet",
        "-show_streams",
        "-of",
        "json",
        "/tmp/shadowing-check/" + name,
      ]).toString(),
    );
    expect(p.streams[0].codec_name).toBe("mp3");
    expect(+p.streams[0].duration).toBeGreaterThan(3);
    const pcm = execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      "/tmp/shadowing-check/" + name,
      "-f",
      "s16le",
      "-ac",
      "1",
      "-ar",
      "24000",
      "pipe:1",
    ]);
    let crossings = 0;
    for (let i = 2402; i < 26400; i += 2)
      if (pcm.readInt16LE(i - 2) <= 0 && pcm.readInt16LE(i) > 0) crossings++;
    expect(crossings).toBeGreaterThan(name.includes("02") ? 400 : 200);
    expect(crossings).toBeLessThan(name.includes("02") ? 460 : 240);
  }
});

test("マイク拒否・容量不足・生成失敗から通常操作へ戻れる", async ({ page }) => {
  await mkdir("/tmp/shadowing-check", { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=3",
      "-ar",
      "24000",
      "/tmp/shadowing-check/input.mp3",
    ],
    { stdio: "ignore" },
  );
  await page.goto("/");
  await page.getByLabel("本文", { exact: true }).fill("Hello.");
  await page.getByRole("button", { name: "文に分割する", exact: true }).click();
  await page.route("https://huggingface.co/**", (route) =>
    route.abort("blockedbyclient"),
  );
  await page.getByRole("button", { name: "試聴", exact: true }).first().click();
  await expect(page.getByRole("alert")).toContainText("音声モデル", {
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "試聴", exact: true }).first(),
  ).toBeEnabled();
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Test quota exhausted", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "教材を保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存容量が不足");
  await page.reload();
  await page.getByText("手元の音声で練習する", { exact: true }).click();
  await page
    .getByLabel("練習用音声")
    .setInputFiles("/tmp/shadowing-check/input.mp3");
  await expect(page.getByText("1文の音声", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Test permission denied", "NotAllowedError");
    };
  });
  await page.getByText("自分の声を録音して比較", { exact: true }).click();
  await page
    .getByRole("button", { name: "録音する／録り直す", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "通常の練習は続けられます",
  );
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "一時停止", exact: true }),
  ).toBeVisible();
});

test("PDFを取り込み声を確定すれば手動の文分割なしで全文生成を開始できる", async ({
  page,
}) => {
  await page.goto("/");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage()
    .drawText("Take a deep breath. What matters to you today?", { font });
  await page
    .getByLabel("資料ファイル")
    .setInputFiles({
      name: "english-practice.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await pdf.save()),
    });
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue(
    /Take a deep breath/,
  );
  await page
    .getByRole("button", { name: "この声と設定で確定", exact: true })
    .click();
  const full = page.getByRole("button", { name: "全文生成", exact: true });
  await expect(full).toBeEnabled();
  await page.route("https://huggingface.co/**", (r) =>
    r.abort("blockedbyclient"),
  );
  await full.click();
  await expect(page.getByLabel("1文目の原稿")).toHaveValue(
    "Take a deep breath.",
  );
  await expect(page.getByLabel("2文目の原稿")).toHaveValue(
    "What matters to you today?",
  );
  await expect(page.getByRole("alert")).toContainText("音声モデル", {
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "失敗した文から再試行", exact: true }),
  ).toBeEnabled();
});
