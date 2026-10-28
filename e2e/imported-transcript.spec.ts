import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () =>
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const state = ((window as any).importedAsrCheck = {
      mode: "success",
      calls: [] as unknown[],
      terminated: 0,
    });
    const Native = window.Worker;
    window.Worker = new Proxy(Native, {
      construct(target, args) {
        if (!String(args[0]).includes("local-ai.worker"))
          return Reflect.construct(target, args);
        let ended = false;
        const worker = {
          onmessage: null as ((event: { data: unknown }) => void) | null,
          onerror: null,
          terminate() {
            ended = true;
            state.terminated++;
          },
          postMessage(data: any) {
            state.calls.push({
              kind: data.kind,
              lang: data.lang,
              length: data.samples.length,
            });
            const mode = state.mode;
            if (mode === "hang") return;
            setTimeout(() => {
              if (ended) return;
              worker.onmessage?.({
                data:
                  mode === "fail"
                    ? { type: "error", message: "テスト用の取得エラー" }
                    : {
                        type: "result",
                        text: "Take a deep breath. Let us practice together.",
                      },
              });
            }, 80);
          },
        };
        return worker;
      },
    });
  });
  await mkdir("/tmp/shadowing-imported-transcript", { recursive: true });
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
      "/tmp/shadowing-imported-transcript/input.mp3",
    ],
    { stdio: "ignore" },
  );
  await page.goto("/");
  await page.getByText("手元の音声で練習する", { exact: true }).click();
  await page
    .getByLabel("練習用音声", { exact: true })
    .setInputFiles("/tmp/shadowing-imported-transcript/input.mp3");
  await expect(page.getByText("1文の音声", { exact: true })).toBeVisible();
});

test("iPhone扱いで実MP3の区間を文字起こしし、音声・A–Bを保って本文へ反映できる", async ({
  page,
}) => {
  await page.getByText("時刻を数字で調整", { exact: true }).click();
  await page.getByLabel("開始 A（秒）", { exact: true }).fill("0.5");
  await page.getByLabel("終了 B（秒）", { exact: true }).fill("2.5");
  await page.getByLabel("区間リピート").check();
  await page.getByText("音声を文字起こし", { exact: true }).click();
  await expect(page.getByText(/英語専用のWhisper tiny.en/)).toBeVisible();
  await page.getByLabel("文字起こしする範囲").selectOption("range");
  await page
    .getByRole("button", { name: "音声を端末内AIで文字起こし", exact: true })
    .click();
  const transcript = page.getByLabel(
    "持ち込み音声の文字起こし（編集できます）",
  );
  await expect(transcript).toHaveValue(
    "Take a deep breath. Let us practice together.",
  );
  expect(
    await page.evaluate(() => (window as any).importedAsrCheck.calls[0]),
  ).toMatchObject({ kind: "transcribe", lang: "en", length: 32000 });
  await transcript.fill("Take a deep breath. We practice together.");
  await page
    .getByRole("button", { name: "この文字起こしを本文に反映", exact: true })
    .click();
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue(
    "Take a deep breath. We practice together.",
  );
  await expect(page.getByLabel("開始 A（秒）", { exact: true })).toHaveValue(
    "0.5",
  );
  await expect(page.getByLabel("終了 B（秒）", { exact: true })).toHaveValue(
    "2.5",
  );
  await expect(page.getByLabel("区間リピート")).toBeChecked();
  await expect(page.getByText("1文の音声", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".practice > audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.6);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("文字起こしの失敗・中止で前回の結果と持ち込み音声を失わない", async ({
  page,
}) => {
  await page.getByText("音声を文字起こし", { exact: true }).click();
  const start = page.getByRole("button", {
    name: "音声を端末内AIで文字起こし",
    exact: true,
  });
  const transcript = page.getByLabel(
    "持ち込み音声の文字起こし（編集できます）",
  );
  await start.click();
  await expect(transcript).toHaveValue(
    "Take a deep breath. Let us practice together.",
  );
  await transcript.fill("My reviewed transcript.");
  await page.evaluate(() => {
    (window as any).importedAsrCheck.mode = "fail";
  });
  await start.click();
  await expect(page.getByRole("alert")).toContainText("テスト用の取得エラー");
  await expect(transcript).toHaveValue("My reviewed transcript.");
  await page.evaluate(() => {
    (window as any).importedAsrCheck.mode = "hang";
  });
  await start.click();
  await expect(
    page.getByRole("button", { name: "文字起こしを中止", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "文字起こしを中止", exact: true })
    .click();
  await expect(start).toBeEnabled();
  await expect(transcript).toHaveValue("My reviewed transcript.");
  expect(
    await page.evaluate(() => (window as any).importedAsrCheck.terminated),
  ).toBeGreaterThan(0);
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue(
    "持ち込み音声（文の自動位置合わせなし）",
  );
  await expect(
    page.getByRole("button", { name: "再生", exact: true }),
  ).toBeEnabled();
});
