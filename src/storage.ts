import { openDB } from "idb";
import type { Clip, Gap, Lang } from "./core";
export type Recording = { blob: Blob; a: number; b: number; label: string };
export type Lesson = {
  id: string;
  title: string;
  lang: Lang;
  text: string;
  sentences: string[];
  voice: string;
  speed: number;
  clips: Clip[];
  gap: Gap;
  mode: "shadow" | "repeat";
  a: number;
  b: number;
  repeat: number;
  repeatGap: number;
  rate: number;
  loop: boolean;
  recording?: Recording;
  updated: number;
};
const db = () =>
  openDB("coaching-l-shadowing", 1, {
    upgrade(db) {
      db.createObjectStore("lessons", { keyPath: "id" });
    },
  });
export async function saveLesson(lesson: Lesson) {
  try {
    return await (await db()).put("lessons", lesson);
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError")
      throw Error(
        "ブラウザーの保存容量が不足しています。不要な教材を削除し、音声をダウンロードしてください。",
      );
    throw e;
  }
}
export async function listLessons(): Promise<Lesson[]> {
  return (await (await db()).getAll("lessons")).sort(
    (a, b) => b.updated - a.updated,
  );
}
export async function deleteLesson(id: string) {
  await (await db()).delete("lessons", id);
}
