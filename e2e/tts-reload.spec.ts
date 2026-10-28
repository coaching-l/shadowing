import { test, expect } from "@playwright/test";
import { TTS_ATTEMPT_KEY } from "../src/tts-attempt";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key }) => {
      const state = ((window as any).reloadCheck = {
        mode: "hang",
        created: 0,
        posted: 0,
        terminated: 0,
        markerAtPlayback: undefined as string | null | undefined,
        worker: null as any,
      });
      const NativeWorker = window.Worker;
      window.Worker = new Proxy(NativeWorker, {
        construct(target, args) {
          if (!String(args[0]).includes("engine.worker"))
            return Reflect.construct(target, args);
          state.created++;
          const worker = {
            onmessage: null as ((event: { data: unknown }) => void) | null,
            onerror: null,
            terminate() {
              state.terminated++;
            },
            postMessage() {
              state.posted++;
              if (state.mode === "hang") return;
              setTimeout(() => {
                if (state.mode === "error") {
                  worker.onmessage?.({
                    data: {
                      type: "error",
                      error: "Test model initialization failure",
                    },
                  });
                } else {
                  worker.onmessage?.({
                    data: {
                      type: "audio",
                      rate: 24000,
                      samples: Float32Array.from(
                        { length: 24000 },
                        (_, i) =>
                          0.1 * Math.sin((2 * Math.PI * 440 * i) / 24000),
                      ),
                    },
                  });
                }
              }, 50);
            },
          };
          state.worker = worker;
          return worker;
        },
      });
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (this.getAttribute("aria-label") === "試聴音声") {
          state.markerAtPlayback = sessionStorage.getItem(key);
          return Promise.reject(
            new DOMException("User gesture required", "NotAllowedError"),
          );
        }
        return play.call(this);
      };
    },
    { key: TTS_ATTEMPT_KEY },
  );
  await page.goto("/");
  await page.getByLabel("練習する言語").selectOption("zh");
  await page
    .getByLabel("教材名", { exact: true })
    .fill("Unsaved recovery example");
  await page.getByLabel("本文", { exact: true }).fill("今天我们一起练习。");
});

test("生成途中の実リロード後は案内を残し、原稿を保存したり生成を自動再開したりしない", async ({
  page,
}) => {
  await page.getByRole("button", { name: "試聴", exact: true }).first().click();
  await expect
    .poll(() =>
      page.evaluate((key) => sessionStorage.getItem(key), TTS_ATTEMPT_KEY),
    )
    .not.toBeNull();
  const raw = await page.evaluate(
    (key) => sessionStorage.getItem(key)!,
    TTS_ATTEMPT_KEY,
  );
  const metadata = JSON.parse(raw);
  expect(Object.keys(metadata).sort()).toEqual([
    "id",
    "lang",
    "source",
    "stage",
    "startedAt",
    "v",
  ]);
  expect(metadata).toMatchObject({
    v: 1,
    lang: "zh",
    source: "preview",
    stage: "loading",
  });
  expect(raw).not.toContain("今天我们一起练习");
  expect(raw).not.toContain("Unsaved recovery example");
  await page.evaluate(() =>
    (window as any).reloadCheck.worker.onmessage({
      data: { type: "stage", stage: "synthesizing" },
    }),
  );
  expect(
    await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)!).stage,
      TTS_ATTEMPT_KEY,
    ),
  ).toBe("synthesizing");

  await page.reload();
  const banner = page.getByRole("status", {
    name: "前回の音声生成について",
    exact: true,
  });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("生成している");
  await expect(banner).toContainText("可能性があります");
  await expect(banner).toContainText("処理は自動で再開していません");
  await expect(banner).toContainText("未保存の原稿は復元できません");
  await expect
    .poll(() =>
      page.evaluate((key) => sessionStorage.getItem(key), TTS_ATTEMPT_KEY),
    )
    .toBeNull();
  expect(
    await page.evaluate(() => ({
      created: (window as any).reloadCheck.created,
      posted: (window as any).reloadCheck.posted,
    })),
  ).toEqual({ created: 0, posted: 0 });
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue("");
  await page
    .getByRole("button", { name: "この案内を閉じる", exact: true })
    .click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(banner).toHaveCount(0);
});

test("モデルの生成成功時に記録を消し、自動再生制限後のリロードを生成中断と誤判定しない", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).reloadCheck.mode = "success";
  });
  await page.getByRole("button", { name: "試聴", exact: true }).first().click();
  await expect(
    page.getByRole("status", { name: "試聴の状況", exact: true }),
  ).toContainText("音声の準備ができました");
  expect(
    await page.evaluate(() => (window as any).reloadCheck.markerAtPlayback),
  ).toBeNull();
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), TTS_ATTEMPT_KEY),
  ).toBeNull();
  await expect(
    page.getByRole("button", { name: "試聴を再生", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("status", { name: "前回の音声生成について", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).reloadCheck.created)).toBe(
    0,
  );
});

test("処理済みのモデルエラーと明示した中止は、次回の中断案内を残さない", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).reloadCheck.mode = "error";
  });
  await page.getByRole("button", { name: "試聴", exact: true }).first().click();
  await expect(page.getByRole("alert")).toContainText(
    "音声モデルの読み込み・生成に失敗",
  );
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), TTS_ATTEMPT_KEY),
  ).toBeNull();
  await page.evaluate(() => {
    (window as any).reloadCheck.mode = "hang";
  });
  await page.getByRole("button", { name: "試聴", exact: true }).first().click();
  await expect
    .poll(() =>
      page.evaluate((key) => sessionStorage.getItem(key), TTS_ATTEMPT_KEY),
    )
    .not.toBeNull();
  await page.getByRole("button", { name: "試聴を中止", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "試聴の状況", exact: true }),
  ).toContainText("試聴を中止しました");
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), TTS_ATTEMPT_KEY),
  ).toBeNull();
  await page.reload();
  await expect(
    page.getByRole("status", { name: "前回の音声生成について", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).reloadCheck.created)).toBe(
    0,
  );
});
