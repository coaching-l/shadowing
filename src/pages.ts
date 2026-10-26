import { gunzipSync, unzipSync } from "fflate";
import {
  fieldAllBytes,
  fieldBytes,
  parseIwa,
  readReference,
  TYPE,
  type IwaObject,
} from "@mdgate/iwork-common";

const MAX_EXPANDED = 64 * 1024 * 1024;
const MAX_TEXT = 50000;
const FALLBACK =
  "Pagesから本文を取り出せませんでした。PagesでPDFまたはWordに書き出して取り込むか、本文を貼り付けてください。";
const TOO_LARGE =
  "Pagesの内容が大きすぎます。本文を分けるか、PDFまたはWordに書き出して取り込んでください。";
const PASSWORD =
  "パスワード付きのPagesには対応していません。Pagesでパスワードを解除したコピーを保存して取り込んでください。";

function cleanText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029\f\x05]/g, "\n")
    .replace(/[\x00-\x08\x0b\x0e-\x1f\ufffc]/g, "")
    .trim();
}

// Check Snappy's declared output lengths before the parser allocates buffers.
function checkIwaSize(bytes: Uint8Array, budget: { remaining: number }) {
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) throw Error(FALLBACK);
    const type = bytes[offset];
    const size =
      bytes[offset + 1] | (bytes[offset + 2] << 8) | (bytes[offset + 3] << 16);
    offset += 4;
    const end = offset + size;
    if (end > bytes.length || type !== 0) throw Error(FALLBACK);
    if (size) {
      let length = 0,
        shift = 0,
        cursor = offset;
      for (;;) {
        if (cursor >= end || shift > 28) throw Error(FALLBACK);
        const value = bytes[cursor++];
        length += (value & 127) * 2 ** shift;
        if (!(value & 128)) break;
        shift += 7;
      }
      budget.remaining -= length;
      if (budget.remaining < 0) throw Error(TOO_LARGE);
    }
    offset = end;
  }
}

function readModern(parts: Record<string, Uint8Array>): string | undefined {
  const objects = new Map<number, IwaObject>();
  const budget = { remaining: MAX_EXPANDED };
  for (const [name, bytes] of Object.entries(parts)) {
    if (!name.toLowerCase().endsWith(".iwa")) continue;
    checkIwaSize(bytes, budget);
    for (const object of parseIwa(bytes)) {
      // Current Pages files attach extension messages to the same object ID.
      // Keep the primary message, as the iWork archive reader does.
      if (!objects.has(object.id)) objects.set(object.id, object);
      if (objects.size > 100000) throw Error(TOO_LARGE);
    }
  }
  if (!objects.size) return;
  const document = [...objects.values()].find(
    (object) => object.type === TYPE.TP_DOCUMENT,
  );
  if (!document) throw Error(FALLBACK);
  const body = objects.get(readReference(fieldBytes(document.fields, 4)) ?? -1);
  if (!body || body.type !== TYPE.TSWP_STORAGE) throw Error(FALLBACK);
  // Follow the document's body reference. Other text stores can contain unused
  // templates, headers or comments and must not be read as the user's script.
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return fieldAllBytes(body.fields, 3)
    .map((part) => decoder.decode(part))
    .join("");
}

function readLegacy(bytes: Uint8Array): string {
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length)
    throw Error(FALLBACK);
  const root = document.documentElement;
  if (root.localName !== "document") throw Error(FALLBACK);
  const body = [...root.children].find(
    (element) =>
      element.localName === "text-storage" &&
      [...element.attributes].some(
        (attribute) =>
          attribute.localName === "kind" && attribute.value === "body",
      ),
  );
  if (!body) throw Error(FALLBACK);
  function text(node: Node): string {
    if (
      node.nodeType === Node.TEXT_NODE ||
      node.nodeType === Node.CDATA_SECTION_NODE
    )
      return node.nodeValue ?? "";
    if (!(node instanceof Element)) return "";
    if (node.localName === "br" || node.localName === "lnbr") return "\n";
    if (node.localName === "tab") return "\t";
    // Layout attachments and annotations are separate from the body text.
    if (["attachment", "annotation", "comment"].includes(node.localName))
      return "";
    const result = [...node.childNodes].map(text).join("");
    return node.localName === "p" ? result.replace(/\n$/, "") + "\n" : result;
  }
  return [...body.getElementsByTagNameNS("*", "text-body")]
    .map((element) => text(element))
    .join("\n");
}

export function extractPages(bytes: Uint8Array): string {
  try {
    let expanded = 0,
      count = 0;
    function unpack(data: Uint8Array) {
      return unzipSync(data, {
        filter: (entry) => {
          const name = entry.name.toLowerCase();
          if (name.startsWith("__macosx/")) return false;
          if (
            [99, 0x636b, 0x636c].includes(entry.compression) ||
            name.endsWith(".iwae") ||
            name.includes("encrypted")
          )
            throw Error(PASSWORD);
          const wanted =
            /(^|\/)index\.(zip|xml|xml\.gz)$/.test(name) ||
            /(^|\/)index\/.*\.iwa$/.test(name) ||
            /^[^/]+\.iwa$/.test(name);
          if (!wanted) return false;
          expanded += entry.originalSize;
          count++;
          if (expanded > MAX_EXPANDED || count > 2000) throw Error(TOO_LARGE);
          return true;
        },
      });
    }
    const parts = unpack(bytes);
    for (const [name, data] of Object.entries(parts)) {
      if (/(^|\/)index\.zip$/i.test(name)) {
        // Some Pages releases put the IWA components inside Index.zip.
        const nested = unpack(data);
        for (const [path, value] of Object.entries(nested)) {
          if (parts[path]) throw Error(FALLBACK);
          parts[path] = value;
        }
      }
    }
    let result = readModern(parts);
    if (result === undefined) {
      const legacy = Object.entries(parts).find(([name]) =>
        /(^|\/)index\.xml(\.gz)?$/i.test(name),
      );
      if (!legacy) throw Error(FALLBACK);
      let [name, data] = legacy;
      if (name.toLowerCase().endsWith(".gz")) {
        if (data.length < 18) throw Error(FALLBACK);
        const size = new DataView(
          data.buffer,
          data.byteOffset,
          data.byteLength,
        ).getUint32(data.length - 4, true);
        if (size > MAX_EXPANDED - expanded) throw Error(TOO_LARGE);
        data = gunzipSync(data, { out: new Uint8Array(size) });
      }
      result = readLegacy(data);
    }
    const text = cleanText(result);
    if (!text) throw Error(FALLBACK);
    if (text.length > MAX_TEXT)
      throw Error(
        "1教材の上限は50,000文字です。Pagesの本文を分けて取り込んでください。",
      );
    return text;
  } catch (error) {
    if (
      error instanceof Error &&
      [FALLBACK, TOO_LARGE, PASSWORD].some(
        (message) => error.message === message,
      )
    )
      throw error;
    if (error instanceof Error && error.message.startsWith("1教材の上限"))
      throw error;
    throw Error(FALLBACK);
  }
}
