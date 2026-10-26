export type PdfTextItem = {
  str: string;
  dir?: string;
  width: number;
  height: number;
  transform: number[];
  hasEOL?: boolean;
};
export function joinPdfText(
  items: readonly (PdfTextItem | { type: string; id?: string })[],
): string {
  let result = "",
    previous: PdfTextItem | undefined;
  for (const item of items) {
    if (!("str" in item)) continue;
    if (
      previous &&
      !previous.hasEOL &&
      previous.str &&
      item.str &&
      !/\s$/.test(result) &&
      !/^\s/.test(item.str) &&
      previous.dir === "ltr" &&
      item.dir === "ltr"
    ) {
      const [a, b, , , x, y] = previous.transform,
        [, , , , nextX, nextY] = item.transform,
        length = Math.hypot(a, b);
      if (
        length > 0 &&
        [x, y, nextX, nextY, previous.width, previous.height].every(
          Number.isFinite,
        )
      ) {
        const dx = nextX - x,
          dy = nextY - y,
          ux = a / length,
          uy = b / length,
          height = Math.max(1, Math.abs(previous.height));
        const baseline = Math.abs(dx * uy - dy * ux),
          gap = dx * ux + dy * uy - previous.width;
        if (baseline > height * 0.5) result += "\n";
        else if (gap > height * 0.18) result += " ";
      }
    }
    result += item.str;
    if (item.hasEOL && !result.endsWith("\n")) result += "\n";
    if (item.str || item.hasEOL) previous = item;
  }
  return result;
}
