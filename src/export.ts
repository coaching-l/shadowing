import { zipSync } from "fflate";
export async function encodeMP3(
  samples: Float32Array,
  rate: number,
  signal?: AbortSignal,
): Promise<Blob> {
  const aborted = () =>
    new DOMException("MP3の変換を中止しました。", "AbortError");
  if (signal?.aborted) throw aborted();
  const w = new Worker(new URL("./mp3.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      w.onmessage = null;
      w.onerror = null;
      w.onmessageerror = null;
      signal?.removeEventListener("abort", onAbort);
      w.terminate();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(aborted());
    w.onerror = (e) => {
      fail(Error(e.message));
    };
    w.onmessageerror = () =>
      fail(Error("MP3の変換結果を受け取れませんでした。"));
    w.onmessage = ({ data }) => {
      if (settled) return;
      if (!data || typeof data !== "object")
        fail(Error("MP3の変換結果を確認できませんでした。"));
      else if (data.error) fail(Error(data.error));
      else if (!(data.blob instanceof Blob))
        fail(Error("MP3の変換結果を確認できませんでした。"));
      else {
        settled = true;
        cleanup();
        resolve(data.blob);
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    try {
      w.postMessage({ samples, rate });
    } catch (error) {
      fail(error);
    }
  });
}
export function download(blob: Blob, name: string): () => void {
  const url = URL.createObjectURL(blob);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let released = false;
  const cleanup = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    URL.revokeObjectURL(url);
  };
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    timer = setTimeout(cleanup, 60000);
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
export async function zipMP3(files: { name: string; blob: Blob }[]) {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files)
    entries[f.name] = new Uint8Array(await f.blob.arrayBuffer());
  return new Blob([zipSync(entries, { level: 0 }).buffer as ArrayBuffer], {
    type: "application/zip",
  });
}
