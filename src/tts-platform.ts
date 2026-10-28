type Platform = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
};

export function isAppleMobile(
  platform: Platform | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator,
): boolean {
  return (
    /iPad|iPhone|iPod/i.test(platform?.userAgent ?? "") ||
    /iPad|iPhone|iPod/i.test(platform?.platform ?? "") ||
    (platform?.platform === "MacIntel" && (platform.maxTouchPoints ?? 0) > 1)
  );
}

export const MOBILE_CHINESE_NOTICE =
  "iPhone・iPadでは現在、中国語音声の新規生成を利用できません。モデルの読み込みでページが終了する場合があるためです。PCで生成したMP3をこの端末へ送り、「手元の音声で練習する」から読み込んでください。";
