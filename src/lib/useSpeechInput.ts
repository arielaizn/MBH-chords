"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// תמלול דיבור בדפדפן (Web Speech API). הדפדפן עצמו מתמלל, בלי שרת ובלי מפתח.
// נתמך ב-Chrome, Edge ו-Safari. ב-Firefox אין תמיכה, ואז supported הוא false.

interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  0: SpeechAlternative;
}
interface SpeechEvent {
  results: ArrayLike<SpeechResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "אין הרשאה למיקרופון. אפשר לאשר אותה בהגדרות האתר בדפדפן.",
  "service-not-allowed": "אין הרשאה למיקרופון. אפשר לאשר אותה בהגדרות האתר בדפדפן.",
  "audio-capture": "לא נמצא מיקרופון במכשיר.",
  network: "אין חיבור לשירות התמלול של הדפדפן. בדוק את האינטרנט ונסה שוב.",
  "language-not-supported": "הדפדפן לא תומך בתמלול בשפה הזאת.",
};

type Options = {
  lang: string;
  /** מקבל את כל מה שנאמר בהקלטה הנוכחית: החלק הסופי והחלק הזמני שעדיין מתעדכן */
  onTranscript: (finalText: string, interimText: string) => void;
  onError: (message: string) => void;
};

export function useSpeechInput({ lang, onTranscript, onError }: Options) {
  // false בשרת ובהידרציה, ואז נקבע לפי הדפדפן
  const supported = useSyncExternalStore(
    () => () => {},
    () => getCtor() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  // הקריאות החוזרות תמיד מצביעות על הגרסה האחרונה, בלי להפעיל מחדש את ההקלטה
  const cb = useRef({ onTranscript, onError });
  useEffect(() => {
    cb.current = { onTranscript, onError };
  });

  useEffect(() => () => recRef.current?.abort(), []);

  const stop = useCallback(() => recRef.current?.stop(), []);
  // עוצר מיד וזורק מה שעוד לא תומלל. לשימוש כשהטקסט משתנה מחוץ להקלטה (הקלדה, שליחה)
  const abort = useCallback(() => recRef.current?.abort(), []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      cb.current.onTranscript(finalText, interimText);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      cb.current.onError(ERRORS[e.error] ?? "התמלול נעצר בגלל שגיאה. נסה שוב.");
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setListening(false);
    }
  }, [lang]);

  const toggle = useCallback(() => (recRef.current ? stop() : start()), [start, stop]);

  return { supported, listening, start, stop, abort, toggle };
}
