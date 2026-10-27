import { useCallback, useEffect, useRef, useState } from "react";
import { formatTime } from "./core";
import type { Recording } from "./storage";

type Phase =
  | "idle"
  | "preparing"
  | "listening"
  | "countdown"
  | "recording"
  | "tail"
  | "finishing";
type Target = { a: number; b: number; rate: number; mode: "shadow" | "repeat" };
type Options = {
  playModel: (
    target: Target,
    ended: () => void,
    failed: (message: string) => void,
  ) => void;
  stopModel: () => void;
  onRecording: (recording: Recording) => void;
  onError: (message: string) => void;
};
type Session = {
  target: Target;
  phase: Phase;
  stream?: MediaStream;
  recorder?: MediaRecorder;
  chunks: Blob[];
  timers: Set<ReturnType<typeof setTimeout>>;
  started: number;
};

const TAIL_SECONDS = 2;
export function usePracticeRecording(options: Options) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const active = useRef<Session | null>(null);
  const alive = useRef(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [countdown, setCountdown] = useState(2);
  const [elapsed, setElapsed] = useState(0);

  function transition(session: Session, next: Phase) {
    session.phase = next;
    if (alive.current && active.current === session) setPhase(next);
  }
  function later(session: Session, action: () => void, delay: number) {
    const timer = setTimeout(() => {
      session.timers.delete(timer);
      if (alive.current && active.current === session) action();
    }, delay);
    session.timers.add(timer);
  }
  function clearTimers(session: Session) {
    session.timers.forEach(clearTimeout);
    session.timers.clear();
  }
  const cancel = useCallback(() => {
    const session = active.current;
    if (!session) return;
    active.current = null;
    clearTimers(session);
    callbacks.current.stopModel();
    try {
      if (session.recorder?.state === "recording") session.recorder.stop();
    } catch {
      // Always release the microphone, even if the browser has already stopped.
    } finally {
      session.stream?.getTracks().forEach((track) => track.stop());
    }
    if (alive.current) setPhase("idle");
  }, []);

  function fail(session: Session, message: string) {
    if (active.current !== session) return;
    cancel();
    if (alive.current) callbacks.current.onError(message);
  }
  function finish(session: Session) {
    if (
      active.current !== session ||
      !session.recorder ||
      session.phase === "finishing"
    )
      return;
    clearTimers(session);
    callbacks.current.stopModel();
    transition(session, "finishing");
    try {
      if (session.recorder.state === "recording") session.recorder.stop();
    } catch (error) {
      fail(session, "録音を停止できませんでした。 " + String(error));
    } finally {
      session.stream?.getTracks().forEach((track) => track.stop());
    }
  }
  function beginRecording(session: Session) {
    if (active.current !== session) return;
    try {
      const recorder = new MediaRecorder(session.stream!);
      session.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (active.current === session && event.data.size)
          session.chunks.push(event.data);
      };
      recorder.onstop = () => {
        session.stream?.getTracks().forEach((track) => track.stop());
        if (active.current !== session || !alive.current) return;
        callbacks.current.stopModel();
        active.current = null;
        clearTimers(session);
        setPhase("idle");
        const blob = new Blob(session.chunks, { type: recorder.mimeType });
        if (!blob.size) {
          callbacks.current.onError(
            "録音データが空でした。マイクの設定を確認して録り直してください。",
          );
          return;
        }
        callbacks.current.onRecording({
          a: session.target.a,
          b: session.target.b,
          rate: session.target.rate,
          mode: session.target.mode,
          blob,
          label: `${formatTime(session.target.a)}–${formatTime(session.target.b)}`,
        });
      };
      recorder.onerror = () =>
        fail(
          session,
          "録音中にエラーが発生しました。マイクの設定を確認して録り直してください。",
        );
      recorder.start();
      session.started = performance.now();
      setElapsed(0);
      transition(session, "recording");
      const clock = () => {
        setElapsed((performance.now() - session.started) / 1000);
        later(session, clock, 200);
      };
      later(session, clock, 200);
      if (session.target.mode === "shadow") {
        // Record only the microphone; the model is played separately for following.
        callbacks.current.playModel(
          session.target,
          () => {
            if (active.current !== session) return;
            transition(session, "tail");
            later(session, () => finish(session), TAIL_SECONDS * 1000);
          },
          (message) => fail(session, message),
        );
      } else {
        const seconds =
          (session.target.b - session.target.a) / session.target.rate +
          TAIL_SECONDS;
        later(session, () => finish(session), seconds * 1000);
      }
    } catch (error) {
      fail(session, "録音を開始できませんでした。 " + String(error));
    }
  }
  function countIn(session: Session) {
    if (active.current !== session) return;
    transition(session, "countdown");
    setCountdown(2);
    later(session, () => setCountdown(1), 1000);
    later(session, () => beginRecording(session), 2000);
  }
  async function start(target: Target) {
    if (
      active.current ||
      !Number.isFinite(target.rate) ||
      target.rate <= 0 ||
      target.b <= target.a
    )
      return;
    const session: Session = {
      target,
      phase: "preparing",
      chunks: [],
      timers: new Set(),
      started: 0,
    };
    active.current = session;
    setPhase("preparing");
    callbacks.current.stopModel();
    document.querySelectorAll("audio").forEach((audio) => audio.pause());
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw Error(
          "HTTPSまたはlocalhostで、録音対応ブラウザーをお使いください。",
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!alive.current || active.current !== session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      session.stream = stream;
      if (target.mode === "repeat") {
        transition(session, "listening");
        callbacks.current.playModel(
          target,
          () => countIn(session),
          (message) => fail(session, message),
        );
      } else countIn(session);
    } catch (error) {
      fail(
        session,
        "録音を開始できませんでした。マイク権限を確認してください。通常の練習は続けられます。 " +
          String(error),
      );
    }
  }
  function stop() {
    const session = active.current;
    if (!session) return;
    if (session.phase === "recording" || session.phase === "tail")
      finish(session);
    else if (session.phase !== "finishing") cancel();
  }
  useEffect(() => {
    alive.current = true;
    const hide = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      alive.current = false;
      cancel();
      document.removeEventListener("visibilitychange", hide);
    };
  }, [cancel]);
  return {
    phase,
    countdown,
    elapsed,
    busy: phase !== "idle",
    capturing: phase === "recording" || phase === "tail",
    start,
    stop,
    cancel,
  };
}
