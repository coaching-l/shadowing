import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = ((window as any).previewCheck = {
      generated: 0,
      workers: 0,
      terminated: 0,
      failGeneration: false,
      denied: false,
    });
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args) {
        if (!String(args[0]).includes("engine.worker"))
          return Reflect.construct(target, args);
        state.workers++;
        const worker = {
          onmessage: null as ((event: { data: unknown }) => void) | null,
          onerror: null,
          terminate() {
            state.terminated++;
          },
          postMessage() {
            state.generated++;
            setTimeout(() => {
              if (state.failGeneration)
                worker.onmessage?.({
                  data: { type: "error", error: "Test WebAssembly failure" },
                });
              else
                worker.onmessage?.({
                  data: {
                    type: "audio",
                    samples: Float32Array.from(
                      { length: 72000 },
                      (_, i) => 0.1 * Math.sin((2 * Math.PI * 440 * i) / 24000),
                    ),
                    rate: 24000,
                  },
                });
            }, 60);
          },
        };
        return worker;
      },
    });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.getAttribute("aria-label") === "試聴音声" && !state.denied) {
        state.denied = true;
        return Promise.reject(
          new DOMException("User gesture required", "NotAllowedError"),
        );
      }
      return play.call(this);
    };
  });
  await page.goto("/");
  await page.getByLabel("練習する言語").selectOption("zh");
  await page.getByLabel("本文", { exact: true }).fill("请深呼吸。");
});

test("Safariの自動再生制限で生成成功を失敗にせず、タップだけで試聴する", async ({
  page,
}) => {
  await page.getByRole("button", { name: "試聴", exact: true }).first().click();
  await expect(page.getByRole("status", { name: "試聴の状況" })).toContainText(
    "音声の準備ができました",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".generate-row button")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "試聴を再生", exact: true }).click();
  await expect
    .poll(() =>
      page
        .getByLabel("試聴音声", { exact: true })
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.1);
  expect(
    await page.evaluate(() => (window as any).previewCheck.generated),
  ).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("生成の失敗後は新しいWorkerで試聴をやり直せ、再生だけの制限とは区別する", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).previewCheck.failGeneration = true;
  });
  await page.getByRole("button", { name: "試聴", exact: true }).first().click();
  await expect(page.getByRole("alert")).toContainText(
    "音声モデルの読み込み・生成に失敗",
  );
  await expect(
    page.getByRole("button", { name: "試聴を再生", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).previewCheck.failGeneration = false;
  });
  await page.getByRole("button", { name: "試聴", exact: true }).first().click();
  await expect(
    page.getByRole("button", { name: "試聴を再生", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).previewCheck.workers)).toBe(
    2,
  );
  expect(
    await page.evaluate(() => (window as any).previewCheck.terminated),
  ).toBe(1);
});
