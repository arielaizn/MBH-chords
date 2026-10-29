"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/config/brand";

type Device = {
  deviceAuthId: string;
  userCode: string;
  intervalSec: number;
  verificationUrl: string;
};

const TIMEOUT_MS = 15 * 60 * 1000;

const FEATURES = [
  {
    title: "חיפוש אקורדים",
    text: "שם של שיר, והמערכת מחפשת אקורדים קיימים באינטרנט.",
    icon: "M21 21l-4.3-4.3M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z",
  },
  {
    title: "כתב יד לתמונה",
    text: "מצלמים דף עם אקורדים, ומקבלים אותו מסודר וממותג.",
    icon: "M4 16l4-4 3 3 4-5 5 6M4 4h16v16H4z",
  },
  {
    title: "הרכבה לפי קצב",
    text: "אין אקורדים? ה-AI מרכיב אותם לפי המילים והגרוב.",
    icon: "M9 18V5l11-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm11-2a3 3 0 11-6 0 3 3 0 016 0z",
  },
];

export function LoginPanel() {
  const router = useRouter();
  const [device, setDevice] = useState<Device | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const stop = useRef(false);

  useEffect(() => {
    stop.current = false;
    return () => {
      stop.current = true;
    };
  }, []);

  async function start() {
    setError(null);
    setStarting(true);
    try {
      const r = await fetch("/api/auth/device/start", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "לא הצלחתי לפתוח התחברות");
      setDevice(j as Device);
      void poll(j as Device);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה לא צפויה");
    } finally {
      setStarting(false);
    }
  }

  async function poll(d: Device) {
    const until = Date.now() + TIMEOUT_MS;
    const wait = Math.max(d.intervalSec, 3) * 1000;
    while (!stop.current && Date.now() < until) {
      await new Promise((res) => setTimeout(res, wait));
      if (stop.current) return;
      try {
        const r = await fetch("/api/auth/device/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceAuthId: d.deviceAuthId, userCode: d.userCode }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "האישור נכשל");
        if (j.status === "ok") {
          router.refresh();
          return;
        }
      } catch (e) {
        setDevice(null);
        setError(e instanceof Error ? e.message : "האישור נכשל");
        return;
      }
    }
    if (!stop.current) {
      setDevice(null);
      setError("הקוד פג תוקף. אפשר להתחיל מחדש.");
    }
  }

  async function copy() {
    if (!device) return;
    try {
      await navigator.clipboard.writeText(device.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ההעתקה אופציונלית */
    }
  }

  return (
    <main className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-5 py-14 text-center">
      <div className="rise relative">
        <div
          aria-hidden
          className="glow pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(212,177,118,0.28), transparent 68%)" }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={BRAND.logoSrc}
          alt={`${BRAND.name} ${BRAND.descriptor}`}
          width={300}
          height={300 / BRAND.logoRatio}
          className="relative h-auto w-64 sm:w-72"
        />
      </div>

      <p className="eyebrow rise mt-10" style={{ animationDelay: "80ms" }}>
        סטודיו אקורדים
      </p>
      <h1
        className="rise mt-3 text-balance text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-6xl"
        style={{ animationDelay: "140ms" }}
      >
        שיר נכנס,
        <br />
        <span className="gold-text">תמונות ממותגות יוצאות</span>
      </h1>
      <p
        className="rise mt-5 max-w-xl text-balance text-lg font-light leading-relaxed text-cream/70"
        style={{ animationDelay: "200ms" }}
      >
        כותבים שם של שיר או מצלמים דף בכתב יד, ומקבלים אקורדים מדויקים מעל המילים, עם הלוגו שלך.
        ההתחברות היא עם מנוי ה-ChatGPT שלך, בלי מפתח API.
      </p>

      <div className="rise mt-9 w-full max-w-md" style={{ animationDelay: "260ms" }}>
        {!device ? (
          <button onClick={start} disabled={starting} className="btn btn-gold w-full py-3.5 text-lg">
            {starting ? "פותח התחברות…" : "התחבר עם ChatGPT"}
          </button>
        ) : (
          <div className="glass p-6 text-start" aria-live="polite">
            <p className="eyebrow">שני צעדים קצרים</p>
            <ol className="mt-3 space-y-2 text-cream/85">
              <li>
                1. פתח את{" "}
                <a
                  href={device.verificationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-gold underline underline-offset-4"
                >
                  דף האישור של OpenAI
                </a>
              </li>
              <li>2. התחבר לחשבון ה-ChatGPT שלך והקלד את הקוד</li>
            </ol>
            <button
              onClick={copy}
              dir="ltr"
              aria-label="העתק את הקוד"
              className="mt-5 flex w-full justify-center gap-1.5 rounded-2xl border border-gold/40 bg-navy-deep/70 px-3 py-4 transition hover:border-gold"
            >
              {device.userCode.split("").map((ch, i) =>
                ch === "-" ? (
                  <span key={i} className="self-center px-1 text-2xl text-gold/50">
                    –
                  </span>
                ) : (
                  <span
                    key={i}
                    className="grid h-11 w-9 place-items-center rounded-lg bg-white/[0.06] font-mono text-2xl font-bold text-gold"
                  >
                    {ch}
                  </span>
                ),
              )}
            </button>
            <p className="mt-2 text-center text-sm text-cream/55">
              {copied ? "הקוד הועתק" : "לחיצה על הקוד מעתיקה אותו"}
            </p>
            <div className="shimmer mt-4 h-1 w-full rounded-full" />
            <p className="mt-2 text-center text-sm text-cream/55">ממתין לאישור שלך…</p>
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            {error}
          </p>
        )}
      </div>

      <ul className="mt-14 grid w-full gap-3 sm:grid-cols-3">
        {FEATURES.map((f, i) => (
          <li
            key={f.title}
            className="glass rise p-5 text-start"
            style={{ animationDelay: `${340 + i * 80}ms` }}
          >
            <span className="mb-3 grid h-10 w-10 place-items-center rounded-xl border border-gold/30 bg-gold/10">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-gold" aria-hidden>
                <path d={f.icon} />
              </svg>
            </span>
            <h2 className="font-bold">{f.title}</h2>
            <p className="mt-1 text-sm font-light leading-relaxed text-cream/65">{f.text}</p>
          </li>
        ))}
      </ul>

      <p className="mt-10 text-xs leading-relaxed text-cream/40">
        ההתחברות נשמרת בעוגייה מוצפנת בדפדפן הזה, ואפשר להתנתק בכל רגע.
      </p>
    </main>
  );
}
