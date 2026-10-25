import { openDB } from "idb";
import type { IDBPDatabase } from "idb";
export type SpeechAudio = { samples: Float32Array; rate: number };
const TTL = 7 * 24 * 60 * 60 * 1000,
  MAX_BYTES = 32 * 1024 * 1024,
  MAX_ITEMS = 24;
let epoch = 0;
const memory = new Map<string, { audio: SpeechAudio; used: number }>();
let database: Promise<IDBPDatabase> | undefined;
const db = () =>
  (database ??= openDB("coaching-l-speech-cache", 1, {
    upgrade(db) {
      db.createObjectStore("audio", { keyPath: "key" });
      db.createObjectStore("meta", { keyPath: "key" });
    },
    blocking() {
      void database?.then((store) => store.close());
      database = undefined;
    },
    terminated() {
      database = undefined;
    },
  }).catch((e) => {
    database = undefined;
    throw e;
  }));
const valid = (a: SpeechAudio) =>
  a?.samples instanceof Float32Array &&
  a.samples.length > 0 &&
  a.rate === 24000 &&
  a.samples.every(Number.isFinite);
async function hash(key: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
function remember(key: string, audio: SpeechAudio) {
  memory.delete(key);
  memory.set(key, { audio, used: Date.now() });
  let bytes = 0;
  for (const x of memory.values()) bytes += x.audio.samples.byteLength;
  while (memory.size > 8 || bytes > 8 * 1024 * 1024) {
    const oldest = memory.keys().next().value!;
    bytes -= memory.get(oldest)!.audio.samples.byteLength;
    memory.delete(oldest);
  }
}
export async function getSpeechCache(key: string): Promise<SpeechAudio | null> {
  const version = epoch;
  const hot = memory.get(key);
  if (hot && Date.now() - hot.used < TTL) {
    remember(key, hot.audio);
    return hot.audio;
  }
  memory.delete(key);
  try {
    const id = await hash(key),
      store = await db();
    const tx = store.transaction(["meta", "audio"], "readwrite");
    const meta = await tx.objectStore("meta").get(id);
    if (!meta || Date.now() - meta.used > TTL) {
      await tx.objectStore("audio").delete(id);
      await tx.objectStore("meta").delete(id);
      await tx.done;
      return null;
    }
    const item = await tx.objectStore("audio").get(id);
    if (!item || !valid(item)) {
      await tx.objectStore("audio").delete(id);
      await tx.objectStore("meta").delete(id);
      await tx.done;
      return null;
    }
    await tx.objectStore("meta").put({ ...meta, used: Date.now() });
    await tx.done;
    const audio = { samples: item.samples, rate: item.rate };
    if (version !== epoch) return null;
    remember(key, audio);
    return audio;
  } catch {
    return null;
  }
}
export async function putSpeechCache(key: string, audio: SpeechAudio) {
  if (!valid(audio)) return;
  const version = epoch;
  remember(key, audio);
  if (audio.samples.byteLength > MAX_BYTES) return;
  try {
    const id = await hash(key),
      store = await db();
    if (version !== epoch) return;
    const tx = store.transaction(["meta", "audio"], "readwrite");
    const meta = tx.objectStore("meta"),
      data = tx.objectStore("audio");
    const all = (await meta.getAll())
      .filter((x) => x.key !== id)
      .sort((a, b) => b.used - a.used);
    let bytes = audio.samples.byteLength,
      count = 1;
    for (const x of all) {
      if (
        Date.now() - x.used > TTL ||
        count >= MAX_ITEMS ||
        bytes + x.bytes > MAX_BYTES
      ) {
        await meta.delete(x.key);
        await data.delete(x.key);
      } else {
        count++;
        bytes += x.bytes;
      }
    }
    await data.put({ key: id, ...audio });
    await meta.put({
      key: id,
      used: Date.now(),
      bytes: audio.samples.byteLength,
    });
    await tx.done;
  } catch {
    /* Cache is optional; storage denial never prevents speech generation. */
  }
}
export async function clearSpeechCache() {
  epoch++;
  memory.clear();
  const store = await db(),
    tx = store.transaction(["audio", "meta"], "readwrite");
  await tx.objectStore("audio").clear();
  await tx.objectStore("meta").clear();
  await tx.done;
}

export async function cleanExpiredSpeechCache() {
  try {
    const store = await db(),
      tx = store.transaction(["meta", "audio"], "readwrite");
    const metadata = await tx.objectStore("meta").getAll();
    for (const row of metadata) {
      if (Date.now() - row.used > TTL) {
        await tx.objectStore("meta").delete(row.key);
        await tx.objectStore("audio").delete(row.key);
      }
    }
    await tx.done;
  } catch {
    /* optional cache */
  }
}
