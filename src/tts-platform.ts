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
