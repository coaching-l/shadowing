import {
  buildIwa,
  encodeMessageField,
  encodeStringField,
  encodeVarintField,
  TYPE,
} from "@mdgate/iwork-common";
import { zipSync } from "fflate";

export function pagesFixture(text: string, nested = false) {
  const bytes = buildIwa([
    // Unused template text must not become the practice script.
    {
      id: 99,
      type: TYPE.TSWP_STORAGE,
      payload: Uint8Array.from(encodeStringField(3, "Unused template text.")),
    },
    {
      id: 1,
      type: TYPE.TP_DOCUMENT,
      payload: Uint8Array.from(encodeMessageField(4, encodeVarintField(1, 12))),
    },
    {
      id: 12,
      type: TYPE.TSWP_STORAGE,
      payload: Uint8Array.from(encodeStringField(3, text)),
    },
  ]);
  return nested
    ? zipSync({ "Index.zip": zipSync({ "Document.iwa": bytes }) })
    : zipSync({ "Index/Document.iwa": bytes });
}
