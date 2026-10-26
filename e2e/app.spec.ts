import { test, expect } from "@playwright/test";
import { zipSync, strToU8, unzipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
async function setPlaybackSpeed(
  page: import("@playwright/test").Page,
  value: number,
) {
  const slider = page.getByRole("slider", { name: "再生速度（高さを維持）" });
  await slider.focus();
  await slider.press("Home");
  for (let i = 0; i < Math.round((value - 0.5) / 0.05); i++)
    await slider.press("ArrowRight");
}

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
  await expect(page.locator(".notice[role=status]")).toContainText(
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
  await page.getByText("時刻を数字で調整", { exact: true }).click();
  await page.getByLabel("開始 A（秒）", { exact: true }).fill("0.1");
  await page.getByLabel("終了 B（秒）", { exact: true }).fill("0.5");
  await page.getByLabel("区間の間の無音（秒）").fill("0.1");
  await page.getByLabel("繰り返し回数").selectOption("3");
  await page.getByLabel("区間リピート").check();
  await setPlaybackSpeed(page, 1.5);
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
  await expect(page.locator(".notice[role=status]")).toContainText(
    "保存しました",
  );
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
  await page.getByLabel("資料ファイル").setInputFiles({
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

test("ゲージのA–Bドラッグ・拡大・0.05刻みの速度と区間の保存復元", async ({
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
      "sine=frequency=440:duration=12",
      "-ar",
      "24000",
      "/tmp/shadowing-check/gauge-practice.wav",
    ],
    { stdio: "ignore" },
  );
  await page.goto("/");
  await page.getByText("手元の音声で練習する", { exact: true }).click();
  await page
    .getByLabel("練習用音声")
    .setInputFiles("/tmp/shadowing-check/gauge-practice.wav");
  await expect(page.getByText("1文の音声", { exact: true })).toBeVisible();
  const a = page.getByRole("slider", { name: "ゲージで開始点Aを調整" }),
    b = page.getByRole("slider", { name: "ゲージで終了点Bを調整" });
  async function drag(marker: typeof a, fraction: number) {
    await marker.scrollIntoViewIfNeeded();
    const handle = await marker.boundingBox(),
      rail = await page.locator(".gauge-rail").boundingBox();
    if (!handle || !rail) throw Error("Gauge missing");
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      rail.x + rail.width * fraction,
      handle.y + handle.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
  }
  await drag(a, 0.2);
  await drag(b, 0.75);
  expect(+(await a.getAttribute("aria-valuenow"))!).toBeCloseTo(2.4, 1);
  expect(+(await b.getAttribute("aria-valuenow"))!).toBeCloseTo(9, 1);
  await expect(page.getByLabel("区間リピート")).toBeChecked();
  await expect(page.getByLabel(/文目を区間に含める/)).toHaveCount(0);
  await drag(a, 1);
  expect(+(await a.getAttribute("aria-valuenow"))!).toBeLessThan(
    +(await b.getAttribute("aria-valuenow"))!,
  );
  await drag(a, 0.2);
  await a.focus();
  await a.press("ArrowRight");
  expect(+(await a.getAttribute("aria-valuenow"))!).toBeCloseTo(2.5, 1);
  await page
    .getByRole("button", { name: "区間に合わせる", exact: true })
    .click();
  await expect(page.getByText(/を表示中/)).toBeVisible();
  await page.getByRole("button", { name: "全体を表示", exact: true }).click();
  const beforeA = await a.getAttribute("aria-valuenow"),
    beforeB = await b.getAttribute("aria-valuenow");
  const speed = page.getByLabel("再生速度（高さを維持）");
  await expect(speed).toHaveAttribute("type", "range");
  await expect(speed).toHaveAttribute("min", "0.5");
  await expect(speed).toHaveAttribute("max", "2");
  await expect(speed).toHaveAttribute("step", "0.05");
  for (const rate of [".55", "1.05", "2"]) {
    await setPlaybackSpeed(page, +rate);
    expect(
      await page
        .locator(".practice audio")
        .first()
        .evaluate((a) => ({ rate: a.playbackRate, pitch: a.preservesPitch })),
    ).toEqual({ rate: +rate, pitch: true });
    expect(await a.getAttribute("aria-valuenow")).toBe(beforeA);
    expect(await b.getAttribute("aria-valuenow")).toBe(beforeB);
  }
  await setPlaybackSpeed(page, 1.05);
  await page.getByRole("button", { name: "教材を保存", exact: true }).click();
  await expect(page.locator(".notice[role=status]")).toContainText(
    "教材をこのブラウザーに保存しました",
  );
  await page.reload();
  await page.getByRole("button", { name: /gauge-practice.wav 英語/ }).click();
  await expect(a).toHaveAttribute("aria-valuenow", beforeA!);
  await expect(b).toHaveAttribute("aria-valuenow", beforeB!);
  await expect(speed).toHaveValue("1.05");
  await expect(page.getByLabel("区間リピート")).toBeChecked();
  await a.focus();
  await a.press("Home");
  await b.focus();
  await b.press("Home");
  for (let i = 0; i < 5; i++) await b.press("ArrowRight");
  await page.getByLabel("区間の間の無音（秒）").fill("0.05");
  await page.getByLabel("繰り返し回数").selectOption("3");
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "一時停止", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "再生", exact: true }),
  ).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/区間リピート.*3回目/)).toBeVisible();
  expect(
    await page
      .locator(".practice audio")
      .first()
      .evaluate((a) => a.currentTime),
  ).toBeCloseTo(+(await b.getAttribute("aria-valuenow"))!, 1);

  await page
    .getByRole("button", { name: "リピーティング", exact: true })
    .click();
  await expect(page.getByLabel("区間リピート")).not.toBeChecked();
  await expect(page.getByLabel("区間リピート")).toBeDisabled();
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "一時停止", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test.describe("タッチ操作のゲージ", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("スマートフォン幅でAとBを指で動かせる", async ({ page, context }) => {
    await mkdir("/tmp/shadowing-check", { recursive: true });
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=10",
        "-ar",
        "24000",
        "/tmp/shadowing-check/touch-gauge.wav",
      ],
      { stdio: "ignore" },
    );
    await page.goto("/");
    await page.getByText("手元の音声で練習する", { exact: true }).click();
    await page
      .getByLabel("練習用音声")
      .setInputFiles("/tmp/shadowing-check/touch-gauge.wav");
    await expect(page.getByText("1文の音声", { exact: true })).toBeVisible();
    const cdp = await context.newCDPSession(page);
    for (const [label, fraction] of [
      ["ゲージで開始点Aを調整", 0.2],
      ["ゲージで終了点Bを調整", 0.7],
    ] as const) {
      const marker = page.getByRole("slider", { name: label });
      await marker.scrollIntoViewIfNeeded();
      const box = await marker.boundingBox(),
        rail = await page.locator(".gauge-rail").boundingBox();
      if (!box || !rail) throw Error("Gauge missing");
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: rail.x + rail.width * fraction, y }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    }
    expect(
      +(await page
        .getByRole("slider", { name: "ゲージで開始点Aを調整" })
        .getAttribute("aria-valuenow"))!,
    ).toBeCloseTo(2, 1);
    expect(
      +(await page
        .getByRole("slider", { name: "ゲージで終了点Bを調整" })
        .getAttribute("aria-valuenow"))!,
    ).toBeCloseTo(7, 1);
    await expect(page.getByLabel("区間リピート")).toBeChecked();
    const speed = page.getByRole("slider", { name: "再生速度（高さを維持）" });
    await speed.focus();
    await speed.press("Home");
    await speed.scrollIntoViewIfNeeded();
    const speedBox = await speed.boundingBox();
    if (!speedBox) throw Error("Speed slider missing");
    const y = speedBox.y + speedBox.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: speedBox.x + 8, y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: speedBox.x + speedBox.width / 2, y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(speed).toHaveValue("1.25");
    await page
      .locator(".player")
      .screenshot({ path: "/tmp/shadowing-speed-slider-mobile.png" });
    await page.screenshot({
      path: "/tmp/shadowing-touch-gauge.png",
      fullPage: true,
    });
    await cdp.detach();
  });
});

test("複数ページPDFを並行で読み込んでも本文の順序を保ち、次のPDFを読み込める", async ({
  page,
}) => {
  await page.goto("/");
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 12; i++)
    pdf.addPage().drawText(`Ordered page ${i}. Keep this sentence.`, { font });
  await page.getByLabel("資料ファイル").focus();
  await page.getByLabel("資料ファイル").setInputFiles({
    name: "ordered.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue(
    /Ordered page 12/,
  );
  const text = await page.getByLabel("本文", { exact: true }).inputValue();
  let previous = -1;
  for (let i = 1; i <= 12; i++) {
    const index = text.indexOf(`Ordered page ${i}.`);
    expect(index).toBeGreaterThan(previous);
    previous = index;
  }
  const next = await PDFDocument.create();
  next.addPage().drawText("A second PDF uses the same reader.", {
    font: await next.embedFont(StandardFonts.Helvetica),
  });
  await page.getByLabel("資料ファイル").setInputFiles({
    name: "second.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await next.save()),
  });
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue(
    /A second PDF uses the same reader/,
  );
});

test("試聴キャッシュを再読み込み後に利用し、全文生成へ再利用し、教材を残して削除できる", async ({
  page,
}) => {
  await page.goto("/");
  // Synthetic PCM verifies cache plumbing only; this is not a voice-quality test.
  await page.evaluate(async () => {
    const { putSpeechCache } = await import("/src/speech-cache.ts");
    const { clipKey } = await import("/src/core.ts");
    const samples = Float32Array.from(
      { length: 24000 },
      (_, i) => 0.1 * Math.sin((2 * Math.PI * 440 * i) / 24000),
    );
    await putSpeechCache(clipKey("A short preview.", "af_heart", 1), {
      samples,
      rate: 24000,
    });
  });
  await page.reload();
  let modelRequests = 0;
  await page.route("https://huggingface.co/**", (r) => {
    modelRequests++;
    return r.abort("blockedbyclient");
  });
  await page.getByLabel("本文", { exact: true }).fill("A short preview.");
  await page.locator(".voice").first().getByRole("button").click();
  await expect(page.locator(".progress")).toContainText(
    "保存済みの音声を再利用しました",
  );
  expect(modelRequests).toBe(0);
  await page
    .getByRole("button", { name: "この声と設定で確定", exact: true })
    .click();
  await page.getByRole("button", { name: "全文生成", exact: true }).click();
  await expect(page.getByText("1文の音声", { exact: true })).toBeVisible();
  expect(modelRequests).toBe(0);
  await page.getByRole("button", { name: "教材を保存", exact: true }).click();
  await expect(page.locator(".notice[role=status]")).toContainText(
    "教材をこのブラウザーに保存しました",
  );
  await page
    .getByRole("button", { name: "音声キャッシュを削除", exact: true })
    .click();
  const state = await page.evaluate(async () => {
    const { getSpeechCache } = await import("/src/speech-cache.ts");
    const { clipKey } = await import("/src/core.ts");
    const { listLessons } = await import("/src/storage.ts");
    return {
      cache: await getSpeechCache(clipKey("A short preview.", "af_heart", 1)),
      lessonCount: (await listLessons()).length,
    };
  });
  expect(state.cache).toBeNull();
  expect(state.lessonCount).toBe(1);
  await page.getByRole("button", { name: "1.0×に戻す", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "再生速度（高さを維持）" }),
  ).toHaveValue("1");
  await page.evaluate(async () => {
    const { putSpeechCache } = await import("/src/speech-cache.ts");
    await putSpeechCache("deletion-fixture", {
      samples: new Float32Array([0.1]),
      rate: 24000,
    });
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "新しい教材を削除", exact: true })
    .click();
  await expect(
    page.getByText("練習の積み重ねを、ここに。", { exact: true }),
  ).toBeVisible();
  await page.reload();
  expect(
    await page.evaluate(async () => {
      const { getSpeechCache } = await import("/src/speech-cache.ts");
      return getSpeechCache("deletion-fixture");
    }),
  ).toBeNull();
});

test("音声キャッシュは24件の上限と有効期限を守る", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {
      putSpeechCache,
      clearSpeechCache,
      cleanExpiredSpeechCache,
      getSpeechCache,
    } = await import("/src/speech-cache.ts");
    const request = <T>(r: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const store = await request(indexedDB.open("coaching-l-speech-cache", 1));
    await clearSpeechCache();
    const audio = { samples: new Float32Array([0.1, 0.2]), rate: 24000 };
    for (let i = 0; i < 26; i++) await putSpeechCache("fixture-" + i, audio);
    const before = await request(
      store.transaction("meta").objectStore("meta").count(),
    );
    const rows = await request(
      store.transaction("meta").objectStore("meta").getAll(),
    );
    await request(
      store
        .transaction("meta", "readwrite")
        .objectStore("meta")
        .put({ ...rows[0], used: Date.now() - 8 * 86400000 }),
    );
    await cleanExpiredSpeechCache();
    const after = await request(
      store.transaction("meta").objectStore("meta").count(),
    );
    const record = (
      await request(store.transaction("audio").objectStore("audio").getAll())
    )[0];
    await clearSpeechCache();
    const large = { samples: new Float32Array(1024 * 1024), rate: 24000 };
    for (let i = 0; i < 9; i++)
      await putSpeechCache("large-fixture-" + i, large);
    const bytes = (
      await request(store.transaction("meta").objectStore("meta").getAll())
    ).reduce((sum, row) => sum + row.bytes, 0);
    const pending = putSpeechCache("cleared-during-write", audio);
    await clearSpeechCache();
    await pending;
    const cleared = await getSpeechCache("cleared-during-write");
    return {
      before,
      after,
      keys: Object.keys(record),
      digest: record.key,
      bytes,
      cleared,
    };
  });
  expect(result.before).toBe(24);
  expect(result.after).toBe(23);
  expect(result.keys.sort()).toEqual(["key", "rate", "samples"]);
  expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
  expect(result.bytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  expect(result.cleared).toBeNull();
});

test("試聴中は試聴ボタンだけが処理中になり、全文生成を開始しない", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      speechCalls: { text: string; voice: string }[];
      releaseSpeech?: () => void;
    };
    testWindow.speechCalls = [];
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args) {
        if (!String(args[0]).includes("engine.worker"))
          return Reflect.construct(target, args);
        const worker = {
          onmessage: null as ((event: { data: unknown }) => void) | null,
          onerror: null,
          terminate() {
            testWindow.releaseSpeech = undefined;
          },
          postMessage(data: { text: string; voice: string }) {
            testWindow.speechCalls.push(data);
            testWindow.releaseSpeech = () => {
              testWindow.releaseSpeech = undefined;
              worker.onmessage?.({
                data: {
                  type: "audio",
                  samples: Float32Array.from(
                    { length: 24000 },
                    (_, i) => 0.1 * Math.sin((2 * Math.PI * 440 * i) / 24000),
                  ),
                  rate: 24000,
                },
              });
            };
          },
        };
        return worker;
      },
    });
  });
  await page.goto("/");
  await page
    .getByLabel("本文", { exact: true })
    .fill("First sentence. Second sentence.");
  await page
    .getByRole("button", { name: "この声と設定で確定", exact: true })
    .click();
  const full = page.locator(".generate-row button");
  await page.getByRole("button", { name: "試聴", exact: true }).first().click();
  const preview = page.getByRole("button", {
    name: "試聴を準備中…",
    exact: true,
  });
  await expect(preview).toHaveAttribute("aria-busy", "true");
  await expect(preview.locator(".spin")).toHaveCount(1);
  await expect(full).toHaveText("全文生成");
  await expect(full).toHaveAttribute("aria-busy", "false");
  await expect(full.locator(".spin")).toHaveCount(0);
  await expect(full).toBeDisabled();
  await expect(
    page.getByRole("status", { name: "試聴の状況", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "全文生成の状況", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("1文目の原稿")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).speechCalls.map((c: any) => c.text)),
    )
    .toEqual(["First sentence."]);
  await page.evaluate(() => (window as any).releaseSpeech());
  await expect(full).toBeEnabled();
  await expect(page.getByText("1文の音声", { exact: true })).toHaveCount(0);
  await full.click();
  await expect(full).toHaveText("全文生成中…");
  await expect(full).toHaveAttribute("aria-busy", "true");
  await expect(full.locator(".spin")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "試聴を準備中…", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("status", { name: "全文生成の状況", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).speechCalls.map((c: any) => c.text)),
    )
    .toEqual(["First sentence.", "Second sentence."]);
  await page.evaluate(() => (window as any).releaseSpeech());
  await expect(page.getByText("2文の音声", { exact: true })).toBeVisible();
  await expect(full).toHaveText("全文生成");
  await expect(full).toHaveAttribute("aria-busy", "false");
  // Cancelling a new preview also leaves the full-generation control idle.
  await page.locator(".voice").nth(1).getByRole("button").click();
  await page.getByRole("button", { name: "試聴を中止", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "試聴の状況", exact: true }),
  ).toContainText("試聴を中止しました");
  await expect(full).toBeEnabled();
  await expect(full.locator(".spin")).toHaveCount(0);
});

test("5秒送り戻しは停止状態を保ち、再生中・区間リピート・端の位置を扱う", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "5秒戻る", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "5秒進む", exact: true }),
  ).toBeDisabled();
  // Fresh test-only WAV; no real user's recording or document is used.
  const rate = 24000,
    length = 12 * rate;
  const wav = Buffer.alloc(44 + length * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++)
    wav.writeInt16LE(
      Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / rate)),
      44 + 2 * i,
    );
  await page.getByText("手元の音声で練習する", { exact: true }).click();
  await page
    .getByLabel("練習用音声")
    .setInputFiles({
      name: "skip-test.wav",
      mimeType: "audio/wav",
      buffer: wav,
    });
  const audio = page
    .locator(".player")
    .locator("xpath=preceding-sibling::audio[1]");
  const position = () =>
    audio.evaluate((el: HTMLAudioElement) => el.currentTime);
  const paused = () => audio.evaluate((el: HTMLAudioElement) => el.paused);
  const back = page.getByRole("button", { name: "5秒戻る", exact: true });
  const forward = page.getByRole("button", { name: "5秒進む", exact: true });
  await forward.click();
  expect(await position()).toBeCloseTo(5, 1);
  expect(await paused()).toBe(true);
  await forward.click();
  expect(await position()).toBeCloseTo(10, 1);
  await forward.click();
  expect(await position()).toBeCloseTo(12, 1);
  await back.click();
  expect(await position()).toBeCloseTo(7, 1);
  await back.click();
  await back.click();
  expect(await position()).toBe(0);
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect.poll(position).toBeGreaterThan(0.1);
  const before = await position();
  await forward.click();
  expect(await position()).toBeGreaterThanOrEqual(before + 4.8);
  expect(await paused()).toBe(false);
  await back.click();
  expect(await position()).toBeLessThan(2);
  expect(await paused()).toBe(false);
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  await page.getByText("時刻を数字で調整", { exact: true }).click();
  await page.getByLabel("開始 A（秒）", { exact: true }).fill("2");
  await page.getByLabel("終了 B（秒）", { exact: true }).fill("10");
  await page.getByLabel("繰り返し回数").selectOption("0");
  await page.getByLabel("区間の間の無音（秒）").fill("1");
  await page.getByLabel("区間リピート").check();
  await back.click();
  expect(await position()).toBe(2);
  await forward.click();
  expect(await position()).toBe(7);
  expect(await paused()).toBe(true);
  await page.getByRole("button", { name: "再生", exact: true }).click();
  expect(await position()).toBeGreaterThanOrEqual(7);
  await forward.click();
  await expect(
    page.getByRole("button", { name: "無音中", exact: true }),
  ).toBeVisible();
  await back.click();
  await expect(
    page.getByRole("button", { name: "一時停止", exact: true }),
  ).toBeVisible();
  expect(await position()).toBeGreaterThanOrEqual(5);
  await page.waitForTimeout(1100);
  expect(await position()).toBeGreaterThan(5.5); // The cancelled gap timer must not jump back to A.
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  await page.getByText("自分の声を録音して比較", { exact: true }).click();
  await page
    .getByRole("button", { name: "録音する／録り直す", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "録音を停止", exact: true }),
  ).toBeVisible();
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();
  await page.getByRole("button", { name: "録音を停止", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 800 });
  await forward.scrollIntoViewIfNeeded();
  const row = await page.locator(".transport").boundingBox();
  if (!row) throw Error("transport missing");
  for (const button of [back, page.locator(".play-button"), forward]) {
    const box = await button.boundingBox();
    if (!box) throw Error("transport button missing");
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  await page
    .locator(".player")
    .screenshot({ path: "/tmp/shadowing-skip-mobile.png" });
});
