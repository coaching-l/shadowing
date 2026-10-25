export const MAX_FILE = 20 * 1024 * 1024;
export async function extractDocument(file: File): Promise<string> {
  if (file.size > MAX_FILE)
    throw Error("資料の上限は20 MBです。ファイルを分けてください。");
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "txt") return file.text();
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer(),
    });
    if (!result.value.trim())
      throw Error(
        "Wordから本文を抽出できませんでした。テキストを貼り付けてください。",
      );
    return result.value;
  }
  if (ext === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).href;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() })
      .promise;
    try {
      if (pdf.numPages > 200) throw Error("PDFは200ページまでです。");
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text +=
          content.items
            .map((item) =>
              "str" in item
                ? item.str + ("hasEOL" in item && item.hasEOL ? "\n" : " ")
                : "",
            )
            .join("") + "\n\n";
      }
      if (!text.trim())
        throw Error(
          "画像PDFには対応していません。OCRで抽出した文章、または本文を貼り付けてください。",
        );
      return text;
    } finally {
      await pdf.destroy();
    }
  }
  throw Error("対応形式は .docx・文字情報のある .pdf・.txt です。");
}
