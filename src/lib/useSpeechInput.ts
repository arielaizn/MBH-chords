"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// מקליט מהמיקרופון ושולח את ההקלטה לתמלול בשרת (/api/transcribe), שמדויק בהרבה מתמלול הדפדפן.
// הטקסט מגיע בסוף ההקלטה, לא תוך כדי דיבור.

const MAX_SECONDS = 240;
const MIN_BYTES = 1500; // הקלטה קטנה מזה היא שקט או לחיצה בטעות
const MIN_PEAK = 0.04; // עוצמה מקסימלית (0 עד 1) מתחת לזה: המיקרופון לא קלט דיבור
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

const canRecord = () =>
  typeof window !== "undefined" &&
  typeof MediaRecorder !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

type Options = {
  /** "he-IL" או "en-US" */
  lang: string;
  onText: (text: string) => void;
  onError: (message: string) => void;
};

export function useSpeechInput({ lang, onText, onError }: Options) {
  // false בשרת ובהידרציה, ואז נקבע לפי הדפדפן
  const supported = useSyncExternalStore(
    () => () => {},
    canRecord,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0); // עוצמת הקול הנוכחית, 0 עד 1
  const peakRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortedRef = useRef(false);
  const fetchRef = useRef<AbortController | null>(null);
  // הקריאות החוזרות תמיד מצביעות על הגרסה האחרונה
  const cb = useRef({ onText, onError });
  useEffect(() => {
    cb.current = { onText, onError };
  });

  const release = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
    recRef.current = null;
    setListening(false);
  }, []);

  const send = useCallback(
    async (blob: Blob) => {
      const ac = new AbortController();
      fetchRef.current = ac;
      setTranscribing(true);
      try {
        const form = new FormData();
        form.set("file", new File([blob], `speech.${blob.type.includes("mp4") ? "m4a" : "webm"}`, { type: blob.type }));
        form.set("lang", lang.startsWith("en") ? "en" : "he");
        const res = await fetch("/api/transcribe", { method: "POST", body: form, signal: ac.signal });
        const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (res.status === 401) {
          cb.current.onError("צריך להתחבר מחדש כדי לתמלל");
          return;
        }
        if (!res.ok) throw new Error(j.error ?? "התמלול נכשל, נסה שוב");
        if (j.text) cb.current.onText(j.text);
        else cb.current.onError("לא שמעתי דיבור בהקלטה. נסה שוב, קרוב יותר למיקרופון.");
      } catch (e) {
        if (!ac.signal.aborted) cb.current.onError(e instanceof Error ? e.message : "התמלול נכשל, נסה שוב");
      } finally {
        if (fetchRef.current === ac) fetchRef.current = null;
        setTranscribing(false);
      }
    },
    [lang],
  );

  const start = useCallback(async () => {
    if (!canRecord() || recRef.current) return;
    abortedRef.current = false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // סינון הרעשים של הדפדפן פוגע בדיבור ומבלבל את המתמלל. מגבר אוטומטי נשאר, בשביל מיקרופון רחוק.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      cb.current.onError(
        name === "NotFoundError"
          ? "לא נמצא מיקרופון במכשיר."
          : "אין הרשאה למיקרופון. אפשר לאשר אותה בהגדרות האתר בדפדפן.",
      );
      return;
    }
    streamRef.current = stream;
    const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = () => {
      const type = rec.mimeType || mimeType || "audio/webm";
      release();
      if (abortedRef.current) return;
      const blob = new Blob(chunks, { type });
      if (peakRef.current < MIN_PEAK) {
        cb.current.onError("לא נקלט קול. בדוק שבחרת את המיקרופון הנכון, שהוא לא מושתק, ודבר קרוב אליו.");
        return;
      }
      if (blob.size < MIN_BYTES) {
        cb.current.onError("ההקלטה הייתה קצרה מדי. לחץ על המיקרופון, דבר, ולחץ שוב.");
        return;
      }
      void send(blob);
    };
    recRef.current = rec;
    // מד עוצמה חי: מראה למשתמש שהקול נקלט, ומאפשר לא לשלוח הקלטה של שקט
    peakRef.current = 0;
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const meter = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        peakRef.current = Math.max(peakRef.current, peak);
        setLevel(Math.min(1, peak * 2.5));
      }, 100);
      rec.addEventListener("stop", () => clearInterval(meter));
    } catch {
      peakRef.current = 1; // אין מדידה: לא חוסמים את ההקלטה
    }
    rec.start(1000);
    setSeconds(0);
    setListening(true);
    const t0 = Date.now();
    timerRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS && rec.state === "recording") rec.stop();
    }, 250);
  }, [release, send]);

  /** מסיים את ההקלטה ושולח לתמלול */
  const stop = useCallback(() => {
    if (recRef.current?.state === "recording") recRef.current.stop();
  }, []);

  /** זורק את ההקלטה (ואת התמלול שבדרך) בלי להכניס טקסט */
  const abort = useCallback(() => {
    abortedRef.current = true;
    fetchRef.current?.abort();
    if (recRef.current?.state === "recording") recRef.current.stop();
    else release();
  }, [release]);

  const toggle = useCallback(() => (recRef.current ? stop() : void start()), [start, stop]);

  useEffect(
    () => () => {
      abortedRef.current = true;
      fetchRef.current?.abort();
      if (recRef.current?.state === "recording") recRef.current.stop();
      else release();
    },
    [release],
  );

  return { supported, listening, transcribing, seconds, level, start, stop, abort, toggle };
}
