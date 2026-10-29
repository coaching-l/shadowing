import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const deletedText = "Take a deep breath.";
const otherText = "Keep this other lesson.";
const previewText = "Temporary preview fixture.";

async function seedLessons(page: Page) {
  await page.goto("/");
  await page.evaluate(
    async ({ deletedText, otherText, previewText }) => {
      const { saveLesson } = await import("/src/storage.ts");
      const { putSpeechCache } = await import("/src/speech-cache.ts");
      const { clipKey, wavBlob } = await import("/src/core.ts");
      const samples = Float32Array.from(
        { length: 48000 },
        (_, i) => 0.1 * Math.sin((2 * Math.PI * 440 * i) / 24000),
      );
      for (const [id, title, text] of [
        ["delete-fixture", "Delete fixture", deletedText],
        ["keep-fixture", "Keep fixture", otherText],
      ]) {
        await saveLesson({
          id,
          title,
          lang: "en",
          text,
          sentences: [text],
          voice: "af_heart",
          speed: 1,
          clips: [
            { text, key: clipKey(text, "af_heart", 1), samples, rate: 24000 },
          ],
          gap: { mode: "none", seconds: 2, min: 1, max: 8 },
          mode: "shadow",
          a: 0,
          b: 2,
          repeat: 3,
          repeatGap: 1,
          rate: 1,
          loop: false,
          updated: Date.now(),
          recording: {
            blob: wavBlob(samples, 24000),
            a: 0,
            b: 2,
            label: "00:00–00:02",
          },
        });
      }
      await putSpeechCache(clipKey(previewText, "af_heart", 1), {
        samples,
        rate: 24000,
      });
      await putSpeechCache(clipKey(deletedText, "af_heart", 1), {
        samples,
        rate: 24000,
      });
    },
    { deletedText, otherText, previewText },
  );
  await page.reload();
}

async function storedState(page: Page) {
  return page.evaluate(
    async ({ deletedText, previewText }) => {
      const { listLessons } = await import("/src/storage.ts");
      const { getSpeechCache } = await import("/src/speech-cache.ts");
      const { clipKey } = await import("/src/core.ts");
      const request = <T>(value: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          value.onsuccess = () => resolve(value.result);
          value.onerror = () => reject(value.error);
        });
      const cache = await request(indexedDB.open("coaching-l-speech-cache", 1));
      const tx = cache.transaction(["audio", "meta"]);
      const audioCount = await request(tx.objectStore("audio").count());
      const metaCount = await request(tx.objectStore("meta").count());
      cache.close();
      return {
        lessons: (await listLessons()).map((lesson) => ({
          id: lesson.id,
          text: lesson.text,
          clips: lesson.clips.length,
          recording: !!lesson.recording,
        })),
        audioCount,
        metaCount,
        lessonCache: await getSpeechCache(clipKey(deletedText, "af_heart", 1)),
        previewCache: await getSpeechCache(clipKey(previewText, "af_heart", 1)),
      };
    },
    { deletedText, previewText },
  );
}

test("開いている教材の削除で本文・音声・録音・認識結果・試聴URLを消し、別教材を保つ", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    window.Worker = new Proxy(Native, {
      construct(target, args) {
        if (!String(args[0]).includes("local-ai.worker"))
          return Reflect.construct(target, args);
        const worker = {
          onmessage: null as ((event: { data: unknown }) => void) | null,
          onerror: null,
          terminate() {},
          postMessage() {
            setTimeout(
              () =>
                worker.onmessage?.({
                  data: { type: "result", text: "Take a slow breath." },
                }),
              20,
            );
          },
        };
        return worker;
      },
    });
  });
  await seedLessons(page);
  await page.getByRole("button", { name: /Delete fixture 英語/ }).click();
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue(
    deletedText,
  );
  await page.getByText("自分の声を録音して比較", { exact: true }).click();
  await page
    .getByRole("button", { name: "録音を端末内AIで文字起こし", exact: true })
    .click();
  await expect(
    page.getByLabel("AIの文字起こし（聴き直して修正できます）"),
  ).toHaveValue("Take a slow breath.");
  await page
    .getByLabel("試聴原稿（400文字以内・空欄なら先頭1文）")
    .fill(previewText);
  await page.locator(".voice").first().getByRole("button").click();
  await expect(
    page.getByRole("status", { name: "試聴の状況", exact: true }),
  ).toContainText("保存済みの音声を再利用しました");
  const urls = await page
    .locator("audio")
    .evaluateAll((elements) =>
      elements
        .map((el) => el.getAttribute("src"))
        .filter((src): src is string => !!src?.startsWith("blob:")),
    );
  expect(urls.length).toBeGreaterThanOrEqual(3);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete fixtureを削除", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Delete fixtureを削除", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue("");
  await expect(
    page.getByLabel("試聴原稿（400文字以内・空欄なら先頭1文）"),
  ).toHaveValue("");
  await expect(page.getByLabel("比較する原稿（録音した範囲）")).toHaveCount(0);
  await expect(
    page.getByLabel("AIの文字起こし（聴き直して修正できます）"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "録音を再生", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("0文の音声", { exact: true })).toBeVisible();
  expect(
    await page
      .locator("audio")
      .evaluateAll((elements) =>
        elements.every((el) => !el.getAttribute("src")),
      ),
  ).toBe(true);
  expect(
    await page.evaluate(
      async (urls) =>
        Promise.all(
          urls.map(async (url) => {
            try {
              await fetch(url);
              return false;
            } catch {
              return true;
            }
          }),
        ),
      urls,
    ),
  ).toEqual(urls.map(() => true));
  const state = await storedState(page);
  expect(state).toEqual({
    lessons: [
      { id: "keep-fixture", text: otherText, clips: 1, recording: true },
    ],
    audioCount: 0,
    metaCount: 0,
    lessonCache: null,
    previewCache: null,
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Delete fixtureを削除", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue("");
  expect(await storedState(page)).toEqual(state);
  await page.getByRole("button", { name: /Keep fixture 英語/ }).click();
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue(otherText);
  await expect(page.getByText("1文の音声", { exact: true })).toBeVisible();
});

test("削除の確認を取り消すと本文・保存音声・録音・キャッシュを保つ", async ({
  page,
}) => {
  await seedLessons(page);
  await page.getByRole("button", { name: /Delete fixture 英語/ }).click();
  const before = await storedState(page);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Delete fixtureを削除", exact: true })
    .click();
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue(
    deletedText,
  );
  await expect(page.getByText("1文の音声", { exact: true })).toBeVisible();
  expect(await storedState(page)).toEqual(before);
});

test("開いていない教材を削除しても、別の教材の本文・音声・録音を消さない", async ({
  page,
}) => {
  await seedLessons(page);
  await page.getByRole("button", { name: /Keep fixture 英語/ }).click();
  const audio = await page.locator(".practice > audio").getAttribute("src");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete fixtureを削除", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Delete fixtureを削除", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue(otherText);
  await expect(page.getByText("1文の音声", { exact: true })).toBeVisible();
  await expect(page.locator(".practice > audio")).toHaveAttribute(
    "src",
    audio!,
  );
  await page.getByText("自分の声を録音して比較", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "録音を再生", exact: true }),
  ).toBeVisible();
  expect((await storedState(page)).lessons).toEqual([
    { id: "keep-fixture", text: otherText, clips: 1, recording: true },
  ]);
});

test("キャッシュを消せない場合は教材を削除済みとせず、再試行できる", async ({
  page,
}) => {
  await seedLessons(page);
  await page.getByRole("button", { name: /Delete fixture 英語/ }).click();
  await page.evaluate(() => {
    const clear = IDBObjectStore.prototype.clear;
    (window as any).restoreCacheClear = () => {
      IDBObjectStore.prototype.clear = clear;
    };
    IDBObjectStore.prototype.clear = function () {
      if (this.transaction.db.name === "coaching-l-speech-cache")
        throw new Error("テスト用のキャッシュ削除エラー");
      return clear.call(this);
    };
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete fixtureを削除", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete fixtureを削除", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue(
    deletedText,
  );
  expect(
    (await storedState(page)).lessons.map((lesson) => lesson.id),
  ).toContain("delete-fixture");
  await page.evaluate(() => (window as any).restoreCacheClear());
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete fixtureを削除", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Delete fixtureを削除", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue("");
  expect(
    (await storedState(page)).lessons.map((lesson) => lesson.id),
  ).not.toContain("delete-fixture");
});

test("MP3変換中の教材を削除するとWorkerを終了し、遅い変換結果を復活させない", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    const state = ((window as any).deletionEncoding = {
      posted: 0,
      terminated: 0,
      late: null as ((event: { data: unknown }) => void) | null,
    });
    window.Worker = new Proxy(Native, {
      construct(target, args) {
        if (!String(args[0]).includes("mp3.worker"))
          return Reflect.construct(target, args);
        const worker = {
          onmessage: null as ((event: { data: unknown }) => void) | null,
          onerror: null,
          onmessageerror: null,
          terminate() {
            state.terminated++;
          },
          postMessage() {
            state.posted++;
            // Simulate a result queued before deletion independently of
            // clearing worker.onmessage during termination.
            state.late = worker.onmessage;
          },
        };
        return worker;
      },
    });
  });
  const downloads: string[] = [];
  page.on("download", (value) => downloads.push(value.suggestedFilename()));
  await seedLessons(page);
  await page.getByRole("button", { name: /Delete fixture 英語/ }).click();
  await page.getByText("MP3をダウンロード", { exact: true }).click();
  await page
    .getByRole("button", { name: "全文・無音なし", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "MP3に変換中…" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).deletionEncoding.posted),
  ).toBe(1);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete fixtureを削除", exact: true })
    .click();
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue("");
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).deletionEncoding.terminated),
    )
    .toBe(1);
  await page.evaluate(() => {
    (window as any).deletionEncoding.late?.({
      data: {
        blob: new Blob(["Late synthetic MP3 result."], { type: "audio/mpeg" }),
      },
    });
  });
  await expect(page.locator(".download-link")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "MP3に変換中…" }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue("");
  expect(downloads).toEqual([]);
  expect((await storedState(page)).lessons.map((value) => value.id)).toEqual([
    "keep-fixture",
  ]);
});
