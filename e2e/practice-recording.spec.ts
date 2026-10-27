import { test, expect, type Page } from "@playwright/test";

async function trackMicrophone(page: Page) {
  await page.addInitScript(() => {
    const testState = ((window as any).practiceCapture = {
      events: [],
      streams: [],
      recorders: [],
    });
    const log = (type: string) => {
      const model =
        document.querySelector<HTMLAudioElement>(".practice > audio");
      testState.events.push({
        type,
        at: performance.now(),
        time: model?.currentTime,
        paused: model?.paused,
        rate: model?.playbackRate,
        recording: testState.recorders.some(
          (recorder: MediaRecorder) => recorder.state === "recording",
        ),
      });
    };
    const getMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (options) => {
      const stream = await getMedia(options);
      testState.streams.push(stream);
      log("microphone");
      return stream;
    };
    const NativeRecorder = window.MediaRecorder;
    window.MediaRecorder = class extends NativeRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options);
        testState.recorders.push(this);
        this.addEventListener("stop", () => log("record-stop"));
      }
      start(timeslice?: number) {
        log("record-start");
        if (timeslice === undefined) super.start();
        else super.start(timeslice);
      }
    };
    document.addEventListener(
      "play",
      (event) => {
        if (event.target === document.querySelector(".practice > audio"))
          log("model-play");
      },
      true,
    );
    document.addEventListener(
      "pause",
      (event) => {
        if (event.target === document.querySelector(".practice > audio"))
          log("model-pause");
      },
      true,
    );
  });
}

async function openPractice(
  page: Page,
  mode: "repeat" | "shadow" = "shadow",
  rate = 1.5,
) {
  await page.goto("/");
  await page.evaluate(
    async ({ mode, rate }) => {
      const { saveLesson } = await import("/src/storage.ts");
      const { clipKey } = await import("/src/core.ts");
      const sentences = ["Take a deep breath.", "Enjoy your practice."];
      const samples = Float32Array.from(
        { length: 24000 },
        (_, i) => 0.1 * Math.sin((2 * Math.PI * 440 * i) / 24000),
      );
      await saveLesson({
        id: "practice-recording-fixture",
        title: "Practice fixture",
        lang: "en",
        text: sentences.join(" "),
        sentences,
        voice: "af_heart",
        speed: 1,
        clips: sentences.map((text) => ({
          text,
          samples,
          rate: 24000,
          key: clipKey(text, "af_heart", 1),
        })),
        gap: { mode: "none", seconds: 2, min: 1, max: 8 },
        mode,
        rate,
        a: 0.25,
        b: 1.25,
        loop: true,
        repeat: 0,
        repeatGap: 0,
        updated: Date.now(),
      });
    },
    { mode, rate },
  );
  await page.reload();
  await page.getByRole("button", { name: /Practice fixture 英語/ }).click();
  await page.getByText("自分の声を録音して比較", { exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".practice > audio")
        .evaluate((element: HTMLAudioElement) => element.duration),
    )
    .toBe(2);
}

test("無音の秒数は消して打ち直せ、小数・0秒・上限を設定できる", async ({
  page,
}) => {
  await openPractice(page);
  const input = page.getByLabel("区間の間の無音（秒）");
  await expect(input).toHaveValue("0");
  await input.focus();
  await input.press("Backspace");
  await expect(input).toHaveValue("");
  await input.pressSequentially("3");
  await expect(input).toHaveValue("3");
  await input.fill("0.25");
  await input.blur();
  await expect(input).toHaveValue("0.25");
  await input.fill("");
  await input.blur();
  await expect(input).toHaveValue("0.25");
  await input.fill("35");
  await input.blur();
  await expect(input).toHaveValue("30");
  await input.fill("0");
  await page.getByRole("button", { name: "教材を保存", exact: true }).click();
  expect(
    await page.evaluate(
      async () =>
        (await (await import("/src/storage.ts")).listLessons())[0].repeatGap,
    ),
  ).toBe(0);

  await page
    .getByRole("button", { name: "リピーティング", exact: true })
    .click();
  await page.getByLabel("文間の無音").selectOption("fixed");
  const sentenceGap = page.getByLabel("無音（秒）", { exact: true });
  await sentenceGap.fill("");
  await expect(sentenceGap).toHaveValue("");
  await sentenceGap.pressSequentially("2.5");
  await sentenceGap.blur();
  await expect(sentenceGap).toHaveValue("2.5");
});

test("リピーティングはお手本を1回聴いてから録音し、設定速度に合う時間で自動停止", async ({
  page,
}) => {
  await trackMicrophone(page);
  await openPractice(page, "repeat");
  await page
    .getByRole("button", { name: "お手本を聴いてから録音", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "練習録音の状況" }),
  ).toContainText("まだ録音していません");
  await expect(page.getByLabel("本文", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "シャドーイング", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("区間の間の無音（秒）")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "お手本 → 自分の声", exact: true }),
  ).toBeVisible({ timeout: 12000 });
  const state = await page.evaluate(() => {
    const state = (window as any).practiceCapture;
    return {
      events: state.events,
      tracks: state.streams.flatMap((stream: MediaStream) =>
        stream.getTracks().map((track) => track.readyState),
      ),
    };
  });
  const plays = state.events.filter(
    (event: any) => event.type === "model-play",
  );
  const start = state.events.find(
    (event: any) => event.type === "record-start",
  );
  const stop = state.events.find((event: any) => event.type === "record-stop");
  expect(plays).toHaveLength(1); // Ignore the ordinary A–B infinite-loop setting for one practice turn.
  expect(plays[0].recording).toBe(false);
  expect(plays[0].time).toBeCloseTo(0.25, 1);
  expect(plays[0].rate).toBe(1.5);
  expect(start.paused).toBe(true);
  expect(start.at - plays[0].at).toBeGreaterThan(2400);
  expect(stop.at - start.at).toBeGreaterThan(2500);
  expect(stop.at - start.at).toBeLessThan(3400);
  expect(state.tracks).toEqual(["ended"]);
  await expect(page.getByLabel("本文", { exact: true })).toBeEnabled();
});

test("シャドーイングはお手本再生中にマイクを録音し、終了後に余韻を残して停止・保存復元", async ({
  page,
}) => {
  await trackMicrophone(page);
  await openPractice(page);
  await page
    .getByRole("button", { name: "お手本を再生しながら録音", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "練習録音の状況" }),
  ).toContainText("録音開始まで");
  await expect(
    page.getByRole("button", { name: "お手本 → 自分の声", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  const events = await page.evaluate(
    () => (window as any).practiceCapture.events,
  );
  const play = events.find((event: any) => event.type === "model-play");
  const start = events.find((event: any) => event.type === "record-start");
  const pause = events
    .filter((event: any) => event.type === "model-pause")
    .at(-1);
  const stop = events.find((event: any) => event.type === "record-stop");
  expect(play.recording).toBe(true);
  expect(play.time).toBeCloseTo(0.25, 1);
  expect(play.at - start.at).toBeGreaterThanOrEqual(0);
  expect(play.at - start.at).toBeLessThan(300);
  expect(stop.at - pause.at).toBeGreaterThan(1800);
  expect(stop.at - pause.at).toBeLessThan(2600);
  await page.getByLabel("自分の録音も教材と一緒に保存する").check();
  await page.getByRole("button", { name: "教材を保存", exact: true }).click();
  const saved = await page.evaluate(async () => {
    const lesson = (await (await import("/src/storage.ts")).listLessons())[0];
    return {
      a: lesson.recording?.a,
      b: lesson.recording?.b,
      rate: lesson.recording?.rate,
      mode: lesson.recording?.mode,
      size: lesson.recording?.blob.size,
    };
  });
  expect(saved).toMatchObject({ a: 0.25, b: 1.25, rate: 1.5, mode: "shadow" });
  expect(saved.size).toBeGreaterThan(100);
  await page.reload();
  await page.getByRole("button", { name: /Practice fixture 英語/ }).click();
  await page.getByText("自分の声を録音して比較", { exact: true }).click();
  await page
    .getByRole("slider", { name: "再生速度（高さを維持）" })
    .press("Home");
  await page
    .getByRole("button", { name: "お手本 → 自分の声", exact: true })
    .click();
  expect(
    await page
      .locator(".practice > audio")
      .evaluate((audio: HTMLAudioElement) => audio.playbackRate),
  ).toBe(1.5);
  await page.getByRole("button", { name: "比較を停止", exact: true }).click();
  await page.getByRole("button", { name: "再生", exact: true }).click();
  expect(
    await page
      .locator(".practice > audio")
      .evaluate((audio: HTMLAudioElement) => audio.playbackRate),
  ).toBe(0.5);
});

test("録音準備を中止すると遅れて許可されたマイクも閉じ、カウントダウンを残さない", async ({
  page,
}) => {
  await trackMicrophone(page);
  await openPractice(page);
  await page.evaluate(() => {
    const getMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (options) => {
      const stream = await getMedia(options);
      return new Promise((resolve) => {
        (window as any).releaseMic = () => resolve(stream);
      });
    };
  });
  await page
    .getByRole("button", { name: "お手本を再生しながら録音", exact: true })
    .click();
  await page.waitForFunction(() => !!(window as any).releaseMic);
  await page
    .getByRole("button", { name: "録音の準備を中止", exact: true })
    .click();
  await page.evaluate(() => (window as any).releaseMic());
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).practiceCapture.streams[0].getTracks()[0].readyState,
      ),
    )
    .toBe("ended");
  await page.waitForTimeout(2200);
  expect(
    await page.evaluate(() => (window as any).practiceCapture.recorders.length),
  ).toBe(0);
  await expect(
    page.getByRole("button", { name: "お手本を再生しながら録音", exact: true }),
  ).toBeEnabled();
});

test("お手本再生の失敗と録音中の画面離脱で、音声・マイク・操作ロックを解除する", async ({
  page,
}) => {
  await trackMicrophone(page);
  await openPractice(page, "repeat");
  await page.evaluate(() => {
    const audio =
      document.querySelector<HTMLAudioElement>(".practice > audio")!;
    (window as any).restoreModelPlay = audio.play;
    audio.play = () =>
      Promise.reject(
        new DOMException("Test autoplay denial", "NotAllowedError"),
      );
  });
  await page
    .getByRole("button", { name: "お手本を聴いてから録音", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("再生を開始できません");
  await expect(page.getByLabel("本文", { exact: true })).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        (window as any).practiceCapture.streams[0].getTracks()[0].readyState,
    ),
  ).toBe("ended");
  await page.evaluate(() => {
    document.querySelector<HTMLAudioElement>(".practice > audio")!.play = (
      window as any
    ).restoreModelPlay;
  });
  await page
    .getByRole("button", { name: "シャドーイング", exact: true })
    .click();
  await page
    .getByRole("button", { name: "お手本を再生しながら録音", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "録音を停止", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("button", { name: "お手本を再生しながら録音", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      (window as any).practiceCapture.streams.every((stream: MediaStream) =>
        stream.getTracks().every((track) => track.readyState === "ended"),
      ),
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".practice > audio")
      .evaluate((audio: HTMLAudioElement) => audio.paused),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "録音を再生", exact: true }),
  ).toHaveCount(0);
});

test("手動で録音を止めて聴き直せ、録り直しの中止やエラーで前の録音を失わない", async ({
  page,
}) => {
  await trackMicrophone(page);
  await openPractice(page, "shadow", 0.5);
  const start = page.getByRole("button", {
    name: "お手本を再生しながら録音",
    exact: true,
  });
  await start.click();
  await expect(
    page.getByRole("button", { name: "録音を停止", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "録音を停止", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "録音を再生", exact: true }),
  ).toBeVisible();
  const priorSource = await page
    .locator(".practice details audio")
    .getAttribute("src");
  expect(priorSource).toMatch(/^blob:/);
  await page.getByRole("button", { name: "録音を再生", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".practice details audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.05);
  await page.getByRole("button", { name: "比較を停止", exact: true }).click();

  await start.click();
  await expect(
    page.getByRole("status", { name: "練習録音の状況" }),
  ).toContainText("録音開始まで");
  await page
    .getByRole("button", { name: "録音の準備を中止", exact: true })
    .click();
  expect(
    await page.locator(".practice details audio").getAttribute("src"),
  ).toBe(priorSource);
  await start.click();
  await expect(
    page.getByRole("button", { name: "録音を停止", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).practiceCapture.recorders
      .at(-1)
      .dispatchEvent(new Event("error")),
  );
  await expect(page.getByRole("alert")).toContainText("録音中にエラー");
  expect(
    await page.locator(".practice details audio").getAttribute("src"),
  ).toBe(priorSource);
  expect(
    await page.evaluate(() =>
      (window as any).practiceCapture.streams.every((stream: MediaStream) =>
        stream.getTracks().every((track) => track.readyState === "ended"),
      ),
    ),
  ).toBe(true);
  await expect(page.getByLabel("本文", { exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 800 });
  await start.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/shadowing-practice-recording-mobile.png",
  });
});
