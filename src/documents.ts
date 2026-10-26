import type { PDFWorker } from "pdfjs-dist";
import { joinPdfText } from "./pdf-text";
export const MAX_FILE = 20 * 1024 * 1024;
let pdfModule: Promise<typeof import("pdfjs-dist")> | undefined;
let pdfWorker: PDFWorker | undefined;
async function getPdfReader() {
  pdfModule ??= import("pdfjs-dist").catch((e) => {
    pdfModule = undefined;
    throw e;
  });
  const pdfjs = await pdfModule;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  if (!pdfWorker || pdfWorker.destroyed) pdfWorker = new pdfjs.PDFWorker();
  const worker = pdfWorker;
  try {
    await worker.promise;
  } catch (e) {
    if (pdfWorker === worker) pdfWorker = undefined;
    throw e;
  }
  return { pdfjs, worker };
}
// Fetch the public reader code while the native file picker is open. No document is sent.
export function primeDocumentReaders() {
  void getPdfReader().catch(() => {});
  void import("mammoth").catch(() => {});
}
export async function extractDocument(
  file: File,
  onProgress: (text: string) => void = () => {},
): Promise<string> {
  if (file.size > MAX_FILE)
    throw Error("資料の上限は20 MBです。ファイルを分けてください。");
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "txt") return file.text();
  if (ext === "pages") {
    onProgress("Pagesの本文を取り出しています…");
    const [{ extractPages }, arrayBuffer] = await Promise.all([
      import("./pages"),
      file.arrayBuffer(),
    ]);
    return extractPages(new Uint8Array(arrayBuffer));
  }
  if (ext === "docx") {
    onProgress("Wordの本文を取り出しています…");
    const [mammoth, arrayBuffer] = await Promise.all([
      import("mammoth"),
      file.arrayBuffer(),
    ]);
    const result = await mammoth.extractRawText({ arrayBuffer });
    if (!result.value.trim())
      throw Error(
        "Wordから本文を抽出できませんでした。テキストを貼り付けてください。",
      );
    return result.value;
  }
  if (ext === "pdf") {
    onProgress("PDFの読み込みを準備しています…");
    const [{ pdfjs, worker }, data] = await Promise.all([
      getPdfReader(),
      file.arrayBuffer(),
    ]);
    const pdf = await pdfjs.getDocument({ data, worker }).promise;
    try {
      if (pdf.numPages > 200) throw Error("PDFは200ページまでです。");
      const parts = new Array<string>(pdf.numPages);
      let next = 1,
        completed = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, pdf.numPages) }, async () => {
          while (next <= pdf.numPages) {
            const number = next++;
            const page = await pdf.getPage(number);
            const content = await page.getTextContent();
            parts[number - 1] = joinPdfText(content.items);
            page.cleanup();
            completed++;
            onProgress(
              `PDFの本文を取り出しています… ${completed} / ${pdf.numPages}ページ`,
            );
          }
        }),
      );
      const text = parts.join("\n\n");
      if (!text.trim())
        throw Error(
          "画像PDFには対応していません。OCRで抽出した文章、または本文を貼り付けてください。",
        );
      return text;
    } finally {
      await pdf.destroy();
    }
  }
  throw Error("対応形式は .pages・.docx・文字情報のある .pdf・.txt です。");
}
