import type { Lang } from "./core";

export const TTS_ATTEMPT_KEY = "coaching-l-tts-attempt-v1";
export const TTS_ATTEMPT_MAX_AGE_MS = 30 * 60 * 1000;
export type TtsAttemptStage = "loading" | "synthesizing";
export type TtsAttemptSource = "preview" | "full";
export type InterruptedTtsAttempt = {
  id: string;
  lang: Lang;
  startedAt: number;
  stage: TtsAttemptStage;
  source?: TtsAttemptSource;
};

// This checkpoint describes an operation, never its text, file, voice or audio.
// sessionStorage keeps it within this browsing session and requires no network.
function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return;
  }
}

function remove(store: Storage) {
  try {
    store.removeItem(TTS_ATTEMPT_KEY);
  } catch {
    // Diagnostics must not prevent playback when browser storage is unavailable.
  }
}

function read(store: Storage): InterruptedTtsAttempt | undefined {
  try {
    const raw = store.getItem(TTS_ATTEMPT_KEY);
    if (raw === null) return;
    if (!raw.length || raw.length > 1024) {
      remove(store);
      return;
    }
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) {
      remove(store);
      return;
    }
    const item = value as Record<string, unknown>;
    const now = Date.now();
    if (
      item.v !== 1 ||
      typeof item.id !== "string" ||
      !item.id.length ||
      item.id.length > 128 ||
      (item.lang !== "en" && item.lang !== "zh") ||
      typeof item.startedAt !== "number" ||
      !Number.isFinite(item.startedAt) ||
      item.startedAt > now ||
      now - item.startedAt > TTS_ATTEMPT_MAX_AGE_MS ||
      (item.stage !== "loading" && item.stage !== "synthesizing") ||
      (item.source !== undefined &&
        item.source !== "preview" &&
        item.source !== "full")
    ) {
      remove(store);
      return;
    }
    // Rebuild the allowlisted result instead of returning arbitrary stored data.
    return {
      id: item.id,
      lang: item.lang,
      startedAt: item.startedAt,
      stage: item.stage,
      ...(item.source === undefined ? {} : { source: item.source }),
    };
  } catch {
    remove(store);
    return;
  }
}

function write(store: Storage, attempt: InterruptedTtsAttempt): boolean {
  try {
    store.setItem(
      TTS_ATTEMPT_KEY,
      JSON.stringify({
        v: 1,
        id: attempt.id,
        lang: attempt.lang,
        startedAt: attempt.startedAt,
        stage: attempt.stage,
        ...(attempt.source === undefined ? {} : { source: attempt.source }),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

let sequence = 0;
export function startTtsAttempt(
  lang: Lang,
  source?: TtsAttemptSource,
): string | undefined {
  if (
    (lang !== "en" && lang !== "zh") ||
    (source !== undefined && source !== "preview" && source !== "full")
  )
    return;
  const store = storage();
  if (!store) return;
  let id: string;
  try {
    id = crypto.randomUUID();
  } catch {
    // It is an ownership token for cleanup, not a secret or an authentication ID.
    id = `${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}`;
  }
  return write(store, {
    id,
    lang,
    source,
    startedAt: Date.now(),
    stage: "loading",
  })
    ? id
    : undefined;
}

export function updateTtsAttempt(
  id: string | undefined,
  stage: TtsAttemptStage,
) {
  if (!id || (stage !== "loading" && stage !== "synthesizing")) return;
  const store = storage();
  if (!store) return;
  const attempt = read(store);
  if (attempt?.id === id) write(store, { ...attempt, stage });
}

export function finishTtsAttempt(id: string | undefined) {
  if (!id) return;
  const store = storage();
  if (!store) return;
  if (read(store)?.id === id) remove(store);
}

// Read first, clear on mount: React StrictMode may invoke initializers twice.
// A marker means the operation did not settle, not that an OOM/crash is proven.
export function readInterruptedTtsAttempt(): InterruptedTtsAttempt | undefined {
  const store = storage();
  return store ? read(store) : undefined;
}

export function consumeInterruptedTtsAttempt():
  | InterruptedTtsAttempt
  | undefined {
  const store = storage();
  if (!store) return;
  const attempt = read(store);
  if (attempt) remove(store);
  return attempt;
}
