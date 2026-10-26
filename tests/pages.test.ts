import { describe, expect, it } from "vitest";
import {
  buildIwa,
  encodeMessageField,
  encodeStringField,
  encodeVarintField,
  snappyDecode,
  snappyEncodeLiterals,
  TYPE,
} from "@mdgate/iwork-common";
import { strToU8, unzipSync, zipSync } from "fflate";
import { extractPages } from "../src/pages";
import { extractDocument, MAX_FILE } from "../src/documents";
import { pagesFixture } from "./fixtures/pages";

describe("Pages本文の取り込み", () => {
  it("本文への参照をたどり、未使用のテンプレート・画像を除外する", () => {
    const source = "She stifled a yawn.\n\nKeep the second paragraph.";
    expect(extractPages(pagesFixture(source))).toBe(source);
  });

  it("Index.zip形式でも中国語・英語・絵文字・改行を保持する", () => {
    const source = "今天一起练习。\nTake a deep breath. 😊\n今天一起练习。";
    expect(extractPages(pagesFixture(source, true))).toBe(source);
  });

  it("現行Pagesの同一IDの拡張メッセージで本文を上書きしない", () => {
    const bytes = buildIwa([
      {
        id: 1,
        type: TYPE.TP_DOCUMENT,
        payload: Uint8Array.from(
          encodeMessageField(4, encodeVarintField(1, 12)),
        ),
      },
      {
        id: 12,
        type: TYPE.TSWP_STORAGE,
        payload: Uint8Array.from(encodeStringField(3, "Keep this body.")),
      },
      {
        id: 12,
        type: 6247,
        payload: Uint8Array.from(encodeStringField(3, "Extension metadata.")),
      },
    ]);
    expect(extractPages(zipSync({ "Index/Document.iwa": bytes }))).toBe(
      "Keep this body.",
    );
  });

  it("本文のprotobufが64 KiBの圧縮ブロック境界をまたいでも文字を保つ", () => {
    const source = "中文".repeat(15000);
    const archive = unzipSync(pagesFixture(source));
    const plain = snappyDecode(archive["Index/Document.iwa"].subarray(4));
    const blocks = [plain.subarray(0, 65536), plain.subarray(65536)].map(
      (part) => {
        const compressed = snappyEncodeLiterals(part);
        const frame = new Uint8Array(4 + compressed.length);
        frame.set([
          0,
          compressed.length & 255,
          (compressed.length >> 8) & 255,
          (compressed.length >> 16) & 255,
        ]);
        frame.set(compressed, 4);
        return frame;
      },
    );
    const iwa = new Uint8Array(blocks[0].length + blocks[1].length);
    iwa.set(blocks[0]);
    iwa.set(blocks[1], blocks[0].length);
    expect(extractPages(zipSync({ "Index/Document.iwa": iwa }))).toBe(source);
  });

  it("Pagesの段落区切り・ページ区切りを改行に変える", () => {
    expect(
      extractPages(pagesFixture("First.\u2029Second.\u2028Third.\x05Last.")),
    ).toBe("First.\nSecond.\nThird.\nLast.");
  });

  it("図の制御文字を読み上げ原稿に混入させない", () => {
    expect(extractPages(pagesFixture("\ufffcTake a breath.\x00"))).toBe(
      "Take a breath.",
    );
  });

  it("50,000文字の本文を切り捨てず取り込む", () => {
    const source = "a".repeat(50000);
    expect(extractPages(pagesFixture(source))).toBe(source);
    expect(() => extractPages(pagesFixture(source + "b"))).toThrow(
      "1教材の上限は50,000文字",
    );
  });

  it("本文がない・壊れたファイルは代替の取り込み方を案内する", () => {
    expect(() => extractPages(pagesFixture(" \n"))).toThrow("PDFまたはWord");
    expect(() => extractPages(strToU8("This is not a Pages archive."))).toThrow(
      "PDFまたはWord",
    );
    expect(() =>
      extractPages(zipSync({ "Index/Document.iwa": new Uint8Array([0, 8]) })),
    ).toThrow("PDFまたはWord");
  });

  it("名前だけ変えたNumbersや本文参照のないファイルを読み込まない", () => {
    const bytes = buildIwa([
      {
        id: 1,
        type: TYPE.TN_DOCUMENT,
        payload: Uint8Array.from(encodeStringField(3, "Not Pages text.")),
      },
    ]);
    expect(() =>
      extractPages(zipSync({ "Index/Document.iwa": bytes })),
    ).toThrow("PDFまたはWord");
  });

  it("巨大なSnappy出力の宣言を確保前に拒否する", () => {
    const hugeBlock = new Uint8Array([
      0, 5, 0, 0, 0xff, 0xff, 0xff, 0xff, 0x07,
    ]);
    expect(() =>
      extractPages(zipSync({ "Index/Document.iwa": hugeBlock })),
    ).toThrow("内容が大きすぎます");
  });

  it("暗号化形式はパスワード解除を案内する", () => {
    expect(() =>
      extractPages(zipSync({ "Index/Document.iwae": strToU8("encrypted") })),
    ).toThrow("パスワード付きのPages");
  });

  it("拡張子の大文字を受け入れ、進捗と元の本文を返す", async () => {
    const progress: string[] = [];
    const source = "Hello from Pages.";
    const file = new File([pagesFixture(source)], "practice.PAGES");
    expect(await extractDocument(file, (value) => progress.push(value))).toBe(
      source,
    );
    expect(progress).toEqual(["Pagesの本文を取り出しています…"]);
  });

  it("20 MBの入力上限を守る", async () => {
    await expect(
      extractDocument({ name: "large.pages", size: MAX_FILE + 1 } as File),
    ).rejects.toThrow("資料の上限は20 MB");
  });
});
