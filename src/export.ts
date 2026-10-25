import { zipSync } from "fflate";
export async function encodeMP3(
  samples: Float32Array,
  rate: number,
): Promise<Blob> {
  const w = new Worker(new URL("./mp3.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise((resolve, reject) => {
    w.onerror = (e) => {
      w.terminate();
      reject(Error(e.message));
    };
    w.onmessage = ({ data }) => {
      w.terminate();
      if (data.error) reject(Error(data.error));
      else resolve(data.blob);
    };
    w.postMessage({ samples, rate });
  });
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function zipMP3(files: { name: string; blob: Blob }[]) {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files)
    entries[f.name] = new Uint8Array(await f.blob.arrayBuffer());
  return new Blob([zipSync(entries, { level: 0 }).buffer as ArrayBuffer], {
    type: "application/zip",
  });
}
