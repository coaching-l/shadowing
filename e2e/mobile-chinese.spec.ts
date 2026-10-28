import { expect, test } from "@playwright/test";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// New, non-speech fixture: no user document or recording is uploaded by the test.
function practiceWav() {
  const rate = 24000;
  const frames = rate * 3;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    buffer.writeInt16LE(
      Math.round(0.1 * 32767 * Math.sin((2 * Math.PI * 440 * i) / rate)),
      44 + i * 2,
    );
  return buffer;
}

test.use({ viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ userAgent }) => {
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        get: () => userAgent,
      });
      const state = ((window as any).mobileTtsCheck = { workers: 0 });
      const NativeWorker = window.Worker;
      window.Worker = new Proxy(NativeWorker, {
        construct(target, args) {
          if (String(args[0]).includes("engine.worker")) {
            state.workers++;
            throw new Error("Mobile Chinese inference must not start");
          }
          return Reflect.construct(target, args);
        },
      });
    },
    { userAgent: IPHONE_SAFARI },
  );
});

test("iPhone扱いでは中国語モデルを読み込まずにPCからの取り込みを案内し、英語の操作は残す", async ({
  page,
}) => {
  let modelDownloads = 0;
  await page.context().route(/\.onnx(?:[?#]|$)/, (route) => {
    modelDownloads++;
    return route.abort();
  });
  await page.goto("/");
  await page.getByLabel("練習する言語").selectOption("zh");
  await page.getByLabel("本文", { exact: true }).fill("请深呼吸。");
  const notice = page.getByRole("status", {
    name: "iPhone・iPadで中国語を練習するには",
    exact: true,
  });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("PCでMP3をダウンロード");
  await expect(
    page.getByRole("button", {
      name: "PCで作成した音声を読み込む",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(page.locator(".voice button")).toHaveCount(3);
  for (const button of await page.locator(".voice button").all()) {
    await expect(button).toHaveText("PCで試聴");
    await expect(button).toBeDisabled();
  }
  await expect(
    page.getByRole("button", { name: "この声と設定で確定", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "全文生成", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => (window as any).mobileTtsCheck.workers),
  ).toBe(0);
  expect(modelDownloads).toBe(0);
  await notice.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/shadowing-mobile-chinese-notice.png" });

  await page.getByLabel("練習する言語").selectOption("en");
  await page.getByLabel("本文", { exact: true }).fill("Take a deep breath.");
  await expect(notice).toHaveCount(0);
  await expect(page.locator(".voice button")).toHaveCount(5);
  for (const button of await page.locator(".voice button").all())
    await expect(button).toBeEnabled();
  await page
    .getByRole("button", { name: "この声と設定で確定", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "全文生成", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => (window as any).mobileTtsCheck.workers),
  ).toBe(0);
  expect(modelDownloads).toBe(0);
});

test("PC音声の取り込みボタンから新規WAVを開き、中国語を保って再生・A–B・速度変更できる", async ({
  page,
}) => {
  let modelDownloads = 0;
  await page.context().route(/\.onnx(?:[?#]|$)/, (route) => {
    modelDownloads++;
    return route.abort();
  });
  await page.goto("/");
  await page.getByLabel("練習する言語").selectOption("zh");
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "PCで作成した音声を読み込む", exact: true })
    .click();
  const fileChooser = await chooser;
  expect(await fileChooser.element().getAttribute("aria-label")).toBe(
    "練習用音声",
  );
  await fileChooser.setFiles({
    name: "fresh-mobile-practice.wav",
    mimeType: "audio/wav",
    buffer: practiceWav(),
  });
  await expect(page.getByText("1文の音声", { exact: true })).toBeVisible();
  await expect(page.getByLabel("練習する言語")).toHaveValue("zh");
  await expect(page.getByLabel("生成時の発話速度")).toBeDisabled();
  await page.getByLabel("練習する言語").selectOption("en");
  await expect(page.getByLabel("生成時の発話速度")).toBeDisabled();
  await page.getByLabel("練習する言語").selectOption("zh");
  const audio = page.locator(".practice > audio");
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "一時停止", exact: true }).click();

  await page.getByText("時刻を数字で調整", { exact: true }).click();
  await page.getByLabel("開始 A（秒）", { exact: true }).fill("0.3");
  await page.getByLabel("終了 B（秒）", { exact: true }).fill("1.3");
  await page.getByLabel("区間の間の無音（秒）").fill("0.1");
  await page.getByLabel("繰り返し回数").selectOption("3");
  await page.getByLabel("区間リピート").check();
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "再生", exact: true }),
  ).toBeVisible({ timeout: 7000 });
  await expect(page.getByText(/区間リピート.*3回目/)).toBeVisible();

  const speed = page.getByRole("slider", { name: "再生速度（高さを維持）" });
  await speed.press("Home");
  await expect(speed).toHaveValue("0.5");
  await speed.press("End");
  await expect(speed).toHaveValue("2");
  await page.getByRole("button", { name: "再生", exact: true }).click();
  expect(
    await audio.evaluate((element: HTMLAudioElement) => element.playbackRate),
  ).toBe(2);
  await page.locator(".practice .play-button").click();
  expect(
    await page.evaluate(() => (window as any).mobileTtsCheck.workers),
  ).toBe(0);
  expect(modelDownloads).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
