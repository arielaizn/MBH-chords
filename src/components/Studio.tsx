"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/config/brand";
import {
  addNodesToZip,
  downloadPage,
  downloadZip,
  JSZip,
  saveBlob,
} from "@/lib/exportImages";
import {
  addMark,
  placeChord,
  readChord,
  removeChord,
  transposeChordPro,
  transposeKey,
  updateChord,
} from "@/lib/song/chordpro";
import { DEFAULT_DESIGN, mergeDesign, type Design } from "@/lib/song/design";
import type { ComposeResult, FindResult, ReviseResult, Song } from "@/lib/song/types";
import { useSpeechInput } from "@/lib/useSpeechInput";
import { SheetPages, type ChordEdit } from "./SheetPages";

type Msg = { id: number; role: "user" | "bot"; text: string; warn?: boolean };
type Item = {
  id: number;
  label: string;
  status: "queued" | "working" | "done" | "error";
  song?: Song;
  error?: string;
};
type Undo = { itemId: number; song: Song; design: Design };
// ממתינים למילים: אם יש chart, זה תרשים בלי מילים שכבר מוצג, והמילים ישולבו מתחת לאותם אקורדים
type Waiting = { query: string; artist?: string | null; chart?: string; itemId?: number };
type Pane = "chat" | "edit" | "result";

const GREETING =
  "כתוב שם של שיר ואחפש אקורדים קיימים באינטרנט. אם אין, אחשוב ואצור אותם בעצמי לפי המילים והקצב. אפשר גם להעלות תמונה של שיר בכתב יד, או הרבה תמונות בבת אחת.";
const MAX_IMAGES = 80;
const MAX_PAGES_PER_SONG = 4;
const NUDGE_STEP = 8; // פיקסלים בגודל העמוד המלא (1080) בכל לחיצה
const NUDGE_MAX = 240;
const QUICK_EDITS = ["הגדל את האקורדים", "עיצוב בהיר", "פשט את האקורדים", "פורמט סטורי"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const joinSpeech = (base: string, spoken: string) => {
  const t = spoken.trimStart();
  return base && t && !/\s$/.test(base) ? `${base} ${t}` : base + t;
};
const sentence = (s: string) => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

async function handle<T>(res: Response): Promise<T> {
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) {
    location.reload();
    throw new Error("צריך להתחבר מחדש");
  }
  if (!res.ok) throw new Error((j as { error?: string }).error ?? "משהו השתבש, נסה שוב");
  return j as T;
}

const postJson = <T,>(url: string, body: unknown, signal?: AbortSignal) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }).then((r) => handle<T>(r));

// מקטינים תמונה גדולה לפני ההעלאה: נקראת מהר יותר ונשארת מתחת למגבלת הגוף.
async function shrink(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob ? new File([blob], "sheet.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

async function waitForPages(id: number): Promise<HTMLElement[]> {
  let prev = -1;
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    const nodes = document
      .querySelector(`[data-export-id="${id}"]`)
      ?.querySelectorAll<HTMLElement>("[data-sheet-page]");
    const n = nodes?.length ?? 0;
    if (n > 0 && n === prev) return Array.from(nodes!);
    prev = n;
  }
  throw new Error("העמודים לא נטענו בזמן");
}

const SOURCE_NOTE: Record<Song["source"], { text: string; ok: boolean }> = {
  web: { text: "נמצא באינטרנט", ok: true },
  ai: { text: "אקורדים שהורכבו על ידי AI. כדאי לנגן ולבדוק לפני פרסום", ok: false },
  image: { text: "נקרא מתמונה. בדוק שכל אקורד ומילה נקראו נכון", ok: false },
};

const STATUS_LABEL: Record<Item["status"], string> = {
  queued: "בתור",
  working: "קורא…",
  done: "",
  error: "נכשל",
};

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const ICONS = {
  image: "M4 16l4-4 3 3 4-5 5 6M4 4h16v16H4zM9 9.5h.01",
  send: "M4 12l16-8-6 16-3-7-7-1z",
  download: "M12 4v11m0 0l-4-4m4 4l4-4M5 20h14",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3",
  logout: "M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 16l4-4-4-4M14 12H4",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  chat: "M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
  mic: "M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zM6 11a6 6 0 0012 0M12 17v4M9 21h6",
};

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="glass rise p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-full border border-gold/40 bg-gold/10 text-xs font-bold text-gold">
          {n}
        </span>
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        <span className="rule flex-1" />
      </div>
      {children}
    </section>
  );
}

export function Studio({ email }: { email: string | null }) {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, role: "bot", text: GREETING }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [composeOnly, setComposeOnly] = useState(false);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [forceNew, setForceNew] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [design, setDesign] = useState<Design>(DEFAULT_DESIGN);
  const [pending, setPending] = useState<File[] | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportSong, setExportSong] = useState<{ id: number; song: Song } | null>(null);
  const [undoCount, setUndoCount] = useState(0);
  const [previewW, setPreviewW] = useState(420);
  const [pageCount, setPageCount] = useState(0);
  const [pane, setPane] = useState<Pane>("chat");
  // האקורד שנבחר בתצוגה. itemId מונע ממנו לדלוג לשיר אחר כשעוברים בין שירים
  const [selChord, setSelChord] = useState<{ itemId: number; chordId: number } | null>(null);
  // move: בוחרים אות לאקורד שנבחר. slash: בוחרים אות או מילה להוספת סימן "/"
  const [picking, setPicking] = useState<false | "move" | "slash">(false);
  const [slashOnWord, setSlashOnWord] = useState(false);
  const [speechLang, setSpeechLang] = useState<"he-IL" | "en-US">("he-IL");
  const speechBase = useRef("");
  const nextMsg = useRef(1);
  const nextItem = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const undoStack = useRef<Undo[]>([]);

  const active = items.find((i) => i.id === activeId) ?? null;
  const song = active?.song ?? null;
  // הצ'אט נעול בזמן עבודה כדי שהרענון של ההתחברות לא יתנגש. הורדות לא נעולות בגלל העלאה המונית.
  const chatLocked = !!busy || !!bulk || !!exporting;
  const editing = !!song && !forceNew && !waiting;
  const doneItems = items.filter((i) => i.status === "done" && i.song);
  const selId = selChord && selChord.itemId === activeId ? selChord.chordId : null;
  const selToken = song && selId !== null ? readChord(song.chordpro, selId) : null;

  const say = (role: Msg["role"], text: string, warn = false) =>
    setMsgs((m) => [...m, { id: nextMsg.current++, role, text, warn }]);
  const patchItem = (id: number, patch: Partial<Item>) =>
    setItems((all) => all.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const addItem = (label: string, status: Item["status"] = "working") => {
    const id = nextItem.current++;
    setItems((all) => [...all, { id, label, status }]);
    return id;
  };
  const removeItem = (id: number) => {
    setItems((all) => all.filter((i) => i.id !== id));
    setActiveId((a) => (a === id ? null : a));
  };

  const speech = useSpeechInput({
    lang: speechLang,
    onTranscript: (done, interim) => setInput(joinSpeech(speechBase.current, done + interim)),
    onError: (m) => say("bot", m, true),
  });

  useEffect(() => {
    if (chatLocked) speech.stop();
  }, [chatLocked, speech.stop]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy, pending, bulk, pane]);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPreviewW(Math.max(220, Math.min(440, el.clientWidth - 24))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [song]);

  function finishSong(id: number, s: Song, text: string) {
    patchItem(id, { status: "done", song: s });
    setActiveId(id);
    setWaiting(null);
    setForceNew(false);
    setPane("result");
    say("bot", text);
  }

  async function runQuery(
    query: string,
    opts: { lyrics?: string; chart?: string; replaceId?: number; composeOnly?: boolean; hint?: string },
  ) {
    const id = opts.replaceId ?? addItem(query);
    const composing = "מרכיב אקורדים לפי המילים והקצב…";
    setBusy(opts.composeOnly || opts.lyrics ? composing : "מחפש אקורדים קיימים באינטרנט…");
    try {
      if (!opts.composeOnly && !opts.lyrics) {
        const r = await postJson<FindResult>("/api/song/find", { query });
        if (r.found) {
          finishSong(id, r.song, `מצאתי אקורדים ל"${r.song.title}". אפשר לתקן בעורך, או לכתוב לי כאן מה לשנות.`);
          return;
        }
        say("bot", `${sentence(r.reason)} עובר להרכיב אותם בעצמי.`);
        setBusy(composing);
      }
      const c = await postJson<ComposeResult>("/api/song/compose", {
        query,
        lyrics: opts.lyrics,
        chart: opts.chart,
        hint: opts.hint,
      });
      if (c.lyricsMissing) {
        finishSong(
          id,
          c.song,
          `הרכבתי תרשים אקורדים ל"${c.song.title}" בלי מילים, כי אין לי את המילים המלאות. הדבק את המילים ואשלב אותן מתחת לאותם אקורדים, או העלה תמונה של השיר בכתב יד.`,
        );
        // finishSong מאפס את ההמתנה, ולכן קובעים אותה מחדש אחריו
        setWaiting({ query, artist: c.song.artist, chart: c.song.chordpro, itemId: id });
        setPane("chat");
        return;
      }
      finishSong(id, c.song, "הרכבתי אקורדים לפי המילים והקצב. זו הצעה של AI, כדאי לנגן ולבדוק לפני שמפרסמים.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "שגיאה לא צפויה";
      if (opts.replaceId === undefined) patchItem(id, { status: "error", error: msg });
      say("bot", msg, true);
    } finally {
      setBusy(null);
    }
  }

  async function revise(instruction: string) {
    if (!active?.song) return;
    say("user", instruction);
    setBusy("משנה לפי הבקשה…");
    try {
      const r = await postJson<ReviseResult>("/api/song/revise", {
        song: active.song,
        design,
        instruction,
      });
      undoStack.current.push({ itemId: active.id, song: active.song, design });
      setUndoCount(undoStack.current.length);
      if (Object.keys(r.song).length) patchItem(active.id, { song: { ...active.song, ...r.song } });
      setDesign(mergeDesign(design, r.design));
      setSelChord(null);
      say("bot", r.reply);
    } catch (e) {
      say("bot", e instanceof Error ? e.message : "שגיאה לא צפויה", true);
    } finally {
      setBusy(null);
    }
  }

  function undo() {
    const u = undoStack.current.pop();
    setUndoCount(undoStack.current.length);
    if (!u) return;
    patchItem(u.itemId, { song: u.song });
    setDesign(u.design);
    setSelChord(null);
    setPicking(false);
    say("bot", "ביטלתי את השינוי האחרון.");
  }

  function submit(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || chatLocked) return;
    speech.abort();
    setInput("");
    if (waiting) {
      say("user", text.length > 140 ? `${text.slice(0, 140)}…` : text);
      void runQuery(waiting.query, {
        lyrics: text,
        chart: waiting.chart,
        replaceId: waiting.itemId,
        hint: waiting.artist ? `האמן: ${waiting.artist}` : undefined,
      });
    } else if (editing) {
      void revise(text);
    } else {
      say("user", text);
      void runQuery(text, { composeOnly });
    }
  }

  async function processImages(files: File[], onePage: boolean) {
    const groups = onePage ? [files] : files.map((f) => [f]);
    const hint = groups.length === 1 ? input.trim() : "";
    setInput("");
    const ids = groups.map((g) =>
      addItem(g.length > 1 ? `${g[0].name} (+${g.length - 1})` : g[0].name, "queued"),
    );
    say("user", groups.length === 1 ? `תמונה: ${groups[0][0].name}` : `${files.length} תמונות`);
    cancelRef.current = false;
    setBulk({ done: 0, total: groups.length });
    let ok = 0;
    let fail = 0;
    let lastError = "הקריאה נכשלה";
    for (let i = 0; i < groups.length; i++) {
      if (cancelRef.current) {
        for (const id of ids.slice(i)) patchItem(id, { status: "error", error: "בוטל" });
        break;
      }
      const id = ids[i];
      patchItem(id, { status: "working" });
      try {
        const form = new FormData();
        for (const f of groups[i]) form.append("file", await shrink(f));
        if (hint) form.set("hint", hint);
        const ac = new AbortController();
        abortRef.current = ac;
        const r = await fetch("/api/song/image", { method: "POST", body: form, signal: ac.signal }).then(
          (x) => handle<{ song: Song }>(x),
        );
        patchItem(id, { status: "done", song: r.song });
        // השיר הראשון שמוכן נפתח מיד, וההורדה שלו זמינה בלי לחכות לשאר
        setActiveId((a) => (groups.length === 1 || a === null ? id : a));
        if (groups.length === 1) setPane("result");
        ok++;
      } catch (e) {
        fail++;
        lastError = cancelRef.current ? "בוטל" : e instanceof Error ? e.message : "שגיאה לא צפויה";
        patchItem(id, { status: "error", error: lastError });
      }
      setBulk({ done: i + 1, total: groups.length });
    }
    setBulk(null);
    abortRef.current = null;
    setForceNew(false);
    setWaiting(null);
    if (groups.length === 1) {
      if (ok) say("bot", "קראתי את השיר מהתמונה. עבור על האקורדים בעורך לפני שמורידים.");
      else say("bot", lastError, true);
    } else {
      say(
        "bot",
        `סיימתי: ${ok} שירים נקראו${fail ? `, ${fail} נכשלו` : ""}. עבור על כל שיר ברשימה לפני ההורדה.`,
        fail > 0,
      );
    }
  }

  function onFiles(list: FileList | File[] | null | undefined) {
    if (chatLocked || !list) return;
    let files = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    if (files.length > MAX_IMAGES) {
      say("bot", `אפשר עד ${MAX_IMAGES} תמונות בבת אחת. לקחתי את הראשונות.`, true);
      files = files.slice(0, MAX_IMAGES);
    }
    if (files.length === 1) void processImages(files, false);
    else setPending(files);
    if (fileRef.current) fileRef.current.value = "";
  }

  function stopBulk() {
    cancelRef.current = true;
    abortRef.current?.abort();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  }

  function edit(patch: Partial<Song>) {
    if (active) patchItem(active.id, { song: { ...active.song!, ...patch } });
  }

  function transpose(by: number) {
    if (!active?.song) return;
    const s = active.song;
    patchItem(active.id, {
      song: { ...s, chordpro: transposeChordPro(s.chordpro, by), key: transposeKey(s.key, by) },
    });
  }

  function pushUndo() {
    if (!active?.song) return;
    undoStack.current.push({ itemId: active.id, song: active.song, design });
    setUndoCount(undoStack.current.length);
  }

  function nudgeChord(delta: number) {
    if (!active?.song || selId === null || !selToken) return;
    const nudge = Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, selToken.nudge + delta));
    edit({ chordpro: updateChord(active.song.chordpro, selId, { nudge }) });
  }

  function resetNudge() {
    if (!active?.song || selId === null) return;
    edit({ chordpro: updateChord(active.song.chordpro, selId, { nudge: 0 }) });
  }

  // לחיצה על אות במצב בחירה: האקורד עובר אליה, או שנוסף לה סימן "/"
  function onPickLetter(row: number, plainPos: number, wordStart: number) {
    if (!active?.song) return;
    if (picking === "slash") {
      // אות מסוימת, או מעל תחילת המילה כולה. אפשר להוסיף כמה סימנים ברצף
      const r = addMark(active.song.chordpro, row, slashOnWord ? wordStart : plainPos, "/", !slashOnWord);
      if (!r) return;
      pushUndo();
      edit({ chordpro: r.src });
      setSelChord({ itemId: active.id, chordId: r.id });
      return;
    }
    if (selId === null) return;
    pushUndo();
    const r = placeChord(active.song.chordpro, selId, row, plainPos);
    edit({ chordpro: r.src });
    setSelChord({ itemId: active.id, chordId: r.id });
    setPicking(false);
  }

  function deleteChord() {
    if (!active?.song || selId === null) return;
    pushUndo();
    edit({ chordpro: removeChord(active.song.chordpro, selId) });
    setSelChord(null);
  }

  function unpinChord() {
    if (!active?.song || selId === null) return;
    pushUndo();
    edit({ chordpro: updateChord(active.song.chordpro, selId, { exact: false }) });
  }

  const chordEdit: ChordEdit = {
    selectedId: selId,
    picking: picking === "slash" || (picking === "move" && selId !== null),
    onSelect: (id) => {
      setPicking(false);
      setSelChord(id === null || !active ? null : { itemId: active.id, chordId: id });
    },
    onPick: onPickLetter,
  };

  // חצים זזים את האקורד שנבחר, Esc משחרר אותו
  useEffect(() => {
    if (selId === null) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable)) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        nudgeChord(e.key === "ArrowRight" ? NUDGE_STEP : -NUDGE_STEP);
      } else if (e.key === "Escape") {
        setPicking(false);
        setSelChord(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function toggleMic() {
    if (!speech.supported) {
      say("bot", "הדפדפן הזה לא תומך בתמלול דיבור. נסה ב-Chrome, Edge או Safari.", true);
      return;
    }
    if (speech.listening) speech.stop();
    else {
      speechBase.current = input;
      speech.start();
    }
  }

  function setD(patch: Partial<Design>) {
    setDesign((d) => ({ ...d, ...patch }));
  }

  // ───────── הורדות ─────────
  const failExport = (e: unknown) =>
    say("bot", e instanceof Error ? `הייצוא נכשל: ${e.message}` : "הייצוא נכשל", true);

  // השיר הפתוח: העמודים כבר מצוירים בתצוגה, אז ההורדה מיידית
  async function exportCurrent() {
    if (!song || exporting) return;
    setExporting("מכין את התמונות…");
    try {
      // מסמן הבחירה לא נכנס לתמונה: משחררים אותו וממתינים לציור מחדש
      if (selId !== null || picking) {
        setSelChord(null);
        setPicking(false);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      const nodes = Array.from(previewRef.current?.querySelectorAll<HTMLElement>("[data-sheet-page]") ?? []);
      if (nodes.length === 0) return;
      if (nodes.length === 1) await downloadPage(nodes[0], song.title, 1);
      else await downloadZip(nodes, song.title);
    } catch (e) {
      failExport(e);
    } finally {
      setExporting(null);
    }
  }

  // שיר כלשהו מהרשימה, בלי לפתוח אותו: מציירים אותו מחוץ למסך ומורידים
  async function downloadItem(it: Item) {
    if (!it.song || exporting) return;
    setExporting(`מכין את "${it.song.title}"…`);
    try {
      setExportSong({ id: it.id, song: it.song });
      const nodes = await waitForPages(it.id);
      if (nodes.length === 1) await downloadPage(nodes[0], it.song.title, 1);
      else await downloadZip(nodes, it.song.title);
    } catch (e) {
      failExport(e);
    } finally {
      setExportSong(null);
      setExporting(null);
    }
  }

  // כל מה שמוכן עד עכשיו, ב-ZIP אחד, גם כשההעלאה ההמונית עוד רצה
  async function exportAll() {
    const list = doneItems;
    if (list.length === 0 || exporting) return;
    try {
      const zip = new JSZip();
      for (let k = 0; k < list.length; k++) {
        const it = list[k];
        setExporting(`מייצא ${k + 1} מתוך ${list.length}…`);
        setExportSong({ id: it.id, song: it.song! });
        const nodes = await waitForPages(it.id);
        await addNodesToZip(zip, `${String(k + 1).padStart(2, "0")} ${it.song!.title}`, nodes);
      }
      saveBlob(await zip.generateAsync({ type: "blob" }), "mbh-chords.zip");
    } catch (e) {
      failExport(e);
    } finally {
      setExportSong(null);
      setExporting(null);
    }
  }

  const placeholder = waiting
    ? "הדבק כאן את מילות השיר"
    : editing
      ? "מה לשנות? למשל: תעלה חצי טון, רקע שחור, תפשט אקורדים"
      : "שם השיר, למשל: אני ואתה";

  const zipLabel = bulk ? `הורד את מה שהושלם (${doneItems.length})` : `הורד את כולם ב-ZIP (${doneItems.length})`;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-40 border-b border-line bg-navy-deep/75 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-3 sm:gap-4 sm:px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logoSrc} alt={BRAND.name} className="h-10 w-auto sm:h-11" />
          <span className="h-6 w-px bg-line" aria-hidden />
          <span className="gold-text text-sm font-bold tracking-wide">סטודיו אקורדים</span>
          <div className="ms-auto flex items-center gap-3 text-sm">
            {email && (
              <span dir="ltr" className="hidden rounded-full border border-line bg-white/5 px-3 py-1 text-xs text-cream/70 md:inline">
                {email}
              </span>
            )}
            <button onClick={logout} className="btn btn-ghost flex items-center gap-2 !px-3 !py-1.5 text-sm" aria-label="התנתק">
              <Icon d={ICONS.logout} size={16} />
              <span className="hidden sm:inline">התנתק</span>
            </button>
          </div>
        </div>
      </header>

      <div className="has-nav mx-auto grid w-full max-w-7xl flex-1 gap-5 px-3 pt-3 sm:px-4 lg:grid-cols-[400px_minmax(0,1fr)] lg:pb-4 lg:pt-4">
        <section
          aria-label="צ'אט"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFiles(e.dataTransfer.files);
          }}
          className={`glass pane-h flex-col overflow-hidden lg:sticky lg:top-[4.75rem] lg:h-[calc(100dvh-6.5rem)] ${
            pane === "chat" ? "flex" : "hidden"
          } lg:flex`}
        >
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gold/15 text-gold">
              <Icon d={ICONS.sparkle} size={16} />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-bold">עוזר האקורדים</p>
              <p className="text-xs text-cream/50">{busy ? "עובד על זה…" : "מוכן"}</p>
            </div>
            <span
              className={`ms-auto h-2 w-2 rounded-full ${busy ? "glow bg-gold" : "bg-emerald-400/80"}`}
              aria-hidden
            />
          </div>

          <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-4" aria-live="polite">
            {msgs.map((m) => (
              <div
                key={m.id}
                className={`rise max-w-[92%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
                  m.role === "user"
                    ? "me-auto rounded-es-md bg-gradient-to-br from-gold/25 to-gold/10 text-cream ring-1 ring-gold/25"
                    : m.warn
                      ? "rounded-ss-md border border-amber-400/35 bg-amber-400/10 text-amber-100"
                      : "rounded-ss-md bg-white/[0.07] text-cream/90 ring-1 ring-white/5"
                }`}
              >
                {m.text}
              </div>
            ))}
            {pending && (
              <div className="rise rounded-2xl border border-line bg-white/[0.06] p-3.5 text-sm">
                <p className="font-semibold">בחרת {pending.length} תמונות. מה הן?</p>
                <div className="mt-3 flex gap-2">
                  <button
                    className="btn btn-gold flex-1 !py-2"
                    onClick={() => {
                      const f = pending;
                      setPending(null);
                      void processImages(f, false);
                    }}
                  >
                    כל תמונה היא שיר
                  </button>
                  <button
                    className="btn btn-ghost flex-1 !py-2"
                    disabled={pending.length > MAX_PAGES_PER_SONG}
                    title={pending.length > MAX_PAGES_PER_SONG ? `עד ${MAX_PAGES_PER_SONG} עמודים לשיר` : undefined}
                    onClick={() => {
                      const f = pending;
                      setPending(null);
                      void processImages(f, true);
                    }}
                  >
                    עמודים של שיר אחד
                  </button>
                </div>
              </div>
            )}
            {bulk && (
              <div className="rise rounded-2xl border border-line bg-white/[0.06] p-3.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gold">
                    קורא תמונות: {bulk.done} מתוך {bulk.total}
                  </span>
                  <button onClick={stopBulk} className="px-1 py-1 text-cream/70 underline underline-offset-4 hover:text-cream">
                    עצור
                  </button>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${(bulk.done / bulk.total) * 100}%`, background: "var(--gold-grad)" }}
                  />
                </div>
                {doneItems.length > 0 && (
                  <p className="mt-2.5 text-xs text-cream/55">
                    מה שכבר מוכן אפשר להוריד עכשיו, בלי לחכות לשאר.
                  </p>
                )}
              </div>
            )}
            {busy && (
              <div className="rise flex items-center gap-3 rounded-2xl rounded-ss-md bg-white/[0.05] px-4 py-3 text-sm text-gold">
                <span className="flex gap-1" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="glow h-1.5 w-1.5 rounded-full bg-gold"
                      style={{ animationDelay: `${i * 220}ms` }}
                    />
                  ))}
                </span>
                {busy}
              </div>
            )}
          </div>

          <div className="space-y-2.5 border-t border-line bg-black/10 p-3">
            {waiting ? (
              <div className="flex items-center justify-between text-sm text-gold">
                <span>ממתין למילים של &quot;{waiting.query}&quot;</span>
                <button onClick={() => setWaiting(null)} className="px-1 py-1 underline underline-offset-4">
                  ביטול
                </button>
              </div>
            ) : (
              song && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <button
                    onClick={() => setForceNew(false)}
                    aria-pressed={editing}
                    className={`btn !py-1 !text-sm ${editing ? "btn-gold" : "btn-ghost"}`}
                  >
                    ערוך את השיר הנוכחי
                  </button>
                  <button
                    onClick={() => setForceNew(true)}
                    aria-pressed={!editing}
                    className={`btn !py-1 !text-sm ${!editing ? "btn-gold" : "btn-ghost"}`}
                  >
                    שיר חדש
                  </button>
                  {undoCount > 0 && (
                    <button onClick={undo} disabled={chatLocked} className="btn btn-ghost ms-auto flex items-center gap-1.5 !py-1 !text-sm">
                      <Icon d={ICONS.undo} size={14} />
                      בטל שינוי
                    </button>
                  )}
                </div>
              )
            )}
            {editing && (
              <div className="flex flex-wrap gap-1.5">
                {QUICK_EDITS.map((q) => (
                  <button key={q} onClick={() => submit(q)} disabled={chatLocked} className="chip">
                    {q}
                  </button>
                ))}
              </div>
            )}
            <label className="sr-only" htmlFor="chat-input">
              {waiting ? "מילות השיר" : editing ? "מה לשנות" : "שם השיר"}
            </label>
            <textarea
              id="chat-input"
              rows={waiting ? 5 : 2}
              value={input}
              disabled={chatLocked}
              onChange={(e) => {
                if (speech.listening) speech.abort();
                setInput(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !waiting) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={placeholder}
              className="field resize-none"
            />
            {speech.listening && (
              <p className="flex items-center gap-2 text-sm text-gold" role="status">
                <span className="glow h-2 w-2 rounded-full bg-red-400" aria-hidden />
                מקשיב… דבר, ולחץ שוב על המיקרופון כדי לסיים
              </p>
            )}
            {!waiting && !editing && (
              <label className="flex items-center gap-2 text-sm text-cream/65">
                <input
                  type="checkbox"
                  checked={composeOnly}
                  onChange={(e) => setComposeOnly(e.target.checked)}
                  className="accent-[#d4b176]"
                />
                בלי חיפוש, תרכיב אקורדים בעצמך
              </label>
            )}
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={chatLocked}
                className="btn btn-ghost flex flex-1 items-center justify-center gap-2"
              >
                <Icon d={ICONS.image} />
                העלה תמונות
              </button>
              <div className="flex shrink-0 items-stretch">
                <button
                  onClick={toggleMic}
                  disabled={chatLocked}
                  aria-pressed={speech.listening}
                  aria-label={speech.listening ? "הפסק הקלטה" : "הקלט בקול ותמלל לטקסט"}
                  title={speech.listening ? "הפסק הקלטה" : "הקלט בקול ותמלל לטקסט"}
                  className={`btn flex items-center justify-center !px-3.5 ${
                    speech.listening ? "btn-gold ring-2 ring-red-400/70" : "btn-ghost"
                  } ${speech.supported ? "rounded-e-none" : ""}`}
                >
                  <Icon d={ICONS.mic} />
                </button>
                {speech.supported && (
                  <button
                    onClick={() => setSpeechLang((l) => (l === "he-IL" ? "en-US" : "he-IL"))}
                    disabled={chatLocked || speech.listening}
                    aria-label="שפת התמלול"
                    title={speechLang === "he-IL" ? "מתמלל בעברית. לחץ למעבר לאנגלית" : "מתמלל באנגלית. לחץ למעבר לעברית"}
                    className="btn btn-ghost !rounded-s-none !px-2.5 !text-xs"
                  >
                    {speechLang === "he-IL" ? "עב" : "EN"}
                  </button>
                )}
              </div>
              <button
                onClick={() => submit()}
                disabled={chatLocked || !input.trim()}
                className="btn btn-gold flex flex-1 items-center justify-center gap-2"
              >
                <Icon d={ICONS.send} />
                {waiting ? "הרכב אקורדים" : editing ? "שנה" : "שלח"}
              </button>
            </div>
            <p className="hidden text-center text-xs text-cream/35 lg:block">אפשר גם לגרור תמונות לכאן</p>
          </div>
        </section>

        <div className={`min-w-0 space-y-5 lg:block ${pane === "chat" ? "hidden" : "block"}`}>
          {items.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3 text-sm text-cream/60">
                <span className="eyebrow">
                  השירים שלי · {doneItems.length}
                  {items.length > doneItems.length ? ` מתוך ${items.length}` : ""}
                </span>
              </div>
              <div role="tablist" aria-label="שירים" className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1.5 sm:mx-0 sm:px-0">
                {items.map((it) => (
                  <div
                    key={it.id}
                    className={`rise flex shrink-0 items-center rounded-2xl border pe-1 ps-3.5 text-sm transition ${
                      it.id === activeId
                        ? "border-gold/70 bg-gold/15 shadow-[0_8px_24px_-12px_rgba(212,177,118,0.6)]"
                        : "border-line bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    <button
                      role="tab"
                      aria-selected={it.id === activeId}
                      disabled={it.status !== "done"}
                      onClick={() => setActiveId(it.id)}
                      title={it.error}
                      className="max-w-[10rem] truncate py-2.5 disabled:cursor-default sm:max-w-[12rem]"
                    >
                      {it.song?.title ?? it.label}
                      {STATUS_LABEL[it.status] && (
                        <span className={`ms-2 text-xs ${it.status === "error" ? "text-red-300" : "text-gold"}`}>
                          {STATUS_LABEL[it.status]}
                        </span>
                      )}
                    </button>
                    {it.status === "done" && (
                      <button
                        onClick={() => downloadItem(it)}
                        disabled={!!exporting}
                        aria-label={`הורד את ${it.song?.title ?? it.label}`}
                        title="הורד עכשיו"
                        className="grid h-9 w-9 place-items-center rounded-xl text-gold hover:bg-gold/15 disabled:opacity-40"
                      >
                        <Icon d={ICONS.download} size={16} />
                      </button>
                    )}
                    <button
                      onClick={() => removeItem(it.id)}
                      disabled={it.status === "working"}
                      aria-label={`הסר את ${it.song?.title ?? it.label}`}
                      className="grid h-9 w-9 place-items-center rounded-xl text-cream/45 hover:text-cream disabled:opacity-30"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {doneItems.length > 1 && (
                <button
                  onClick={exportAll}
                  disabled={!!exporting}
                  className="btn btn-ghost flex w-full items-center justify-center gap-2 text-sm sm:w-auto"
                >
                  <Icon d={ICONS.download} size={16} />
                  {exporting && exportSong ? exporting : zipLabel}
                </button>
              )}
            </div>
          )}

          {!song ? (
            <div className="glass rise grid min-h-[50dvh] place-items-center p-6 text-center sm:p-8">
              <div className="max-w-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={BRAND.logoSrc} alt="" className="mx-auto h-24 w-auto opacity-40" />
                <h2 className="mt-6 text-2xl font-extrabold tracking-tight">
                  מתחילים משיר <span className="gold-text">אחד</span>
                </h2>
                <p className="mt-2 font-light leading-relaxed text-cream/60">
                  כתוב שם של שיר בצ&apos;אט, או העלה תמונות של דפי אקורדים. כאן יופיעו העורך, העיצוב והתמונות המוכנות להורדה.
                </p>
                <button onClick={() => setPane("chat")} className="btn btn-gold mt-6 lg:hidden">
                  עבור לצ&apos;אט
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className={`space-y-5 ${pane === "result" ? "hidden lg:block lg:space-y-5" : "block"}`}>
                <Section n="1" title="פרטי השיר">
                  <div
                    className={`mb-4 flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm ${
                      SOURCE_NOTE[song.source].ok
                        ? "bg-emerald-400/10 text-emerald-100 ring-1 ring-emerald-300/20"
                        : "bg-amber-400/10 text-amber-100 ring-1 ring-amber-300/20"
                    }`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${SOURCE_NOTE[song.source].ok ? "bg-emerald-300" : "bg-amber-300"}`} aria-hidden />
                    <span>
                      {SOURCE_NOTE[song.source].text}
                      {song.source === "web" && song.sourceUrl && (
                        <>
                          {" · "}
                          <a href={song.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                            מקור
                          </a>
                        </>
                      )}
                    </span>
                  </div>
                  {song.notes && (
                    <p className="mb-4 whitespace-pre-wrap rounded-xl bg-white/5 px-3.5 py-2.5 text-sm font-light leading-relaxed text-cream/80">
                      {song.notes}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                    <label className="col-span-2 text-sm text-cream/65 sm:col-span-3">
                      שם השיר
                      <input className="field mt-1.5" value={song.title} onChange={(e) => edit({ title: e.target.value })} />
                    </label>
                    <label className="col-span-2 text-sm text-cream/65 sm:col-span-3">
                      אמן
                      <input className="field mt-1.5" value={song.artist ?? ""} onChange={(e) => edit({ artist: e.target.value })} />
                    </label>
                    <label className="text-sm text-cream/65">
                      סולם
                      <input dir="ltr" className="field mt-1.5" value={song.key ?? ""} onChange={(e) => edit({ key: e.target.value })} />
                    </label>
                    <label className="text-sm text-cream/65">
                      קאפו
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={12}
                        dir="ltr"
                        className="field mt-1.5"
                        value={song.capo ?? ""}
                        onChange={(e) => edit({ capo: e.target.value ? Number(e.target.value) : null })}
                      />
                    </label>
                    <label className="col-span-2 text-sm text-cream/65 sm:col-span-1">
                      BPM
                      <input
                        type="number"
                        inputMode="numeric"
                        min={30}
                        max={300}
                        dir="ltr"
                        className="field mt-1.5"
                        value={song.bpm ?? ""}
                        onChange={(e) => edit({ bpm: e.target.value ? Number(e.target.value) : null })}
                      />
                    </label>
                    <div className="col-span-2 flex items-end gap-2 text-sm text-cream/65 sm:col-span-3">
                      <span className="pb-3">הזז סולם</span>
                      <button onClick={() => transpose(-1)} className="btn btn-ghost !px-5" aria-label="חצי טון למטה">
                        −
                      </button>
                      <button onClick={() => transpose(1)} className="btn btn-ghost !px-5" aria-label="חצי טון למעלה">
                        +
                      </button>
                    </div>
                  </div>
                </Section>

                <Section n="2" title="אקורדים ומילים">
                  <label className="block text-sm text-cream/65">
                    <span className="text-cream/45">
                      אקורד בסוגריים מרובעים לפני המילה: [Am]שלום. כותרת חלק: ## פזמון
                      <br />
                      את מיקום האקורד אפשר לכוון גם בלחיצה עליו בתמונה למטה: להזיז ימינה ושמאלה, או לשייך לאות מסוימת.
                    </span>
                    <textarea
                      dir={song.direction}
                      rows={14}
                      spellCheck={false}
                      value={song.chordpro}
                      onChange={(e) => {
                        setSelChord(null);
                        edit({ chordpro: e.target.value });
                      }}
                      className="field mt-2 whitespace-pre font-sans text-[15px] leading-7"
                    />
                  </label>
                  <fieldset className="mt-4 flex items-center gap-2 text-sm">
                    <legend className="sr-only">כיוון</legend>
                    <span className="text-cream/65">כיוון</span>
                    {(["rtl", "ltr"] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => edit({ direction: d })}
                        aria-pressed={song.direction === d}
                        className={`btn !py-1.5 ${song.direction === d ? "btn-gold" : "btn-ghost"}`}
                      >
                        {d === "rtl" ? "עברית" : "אנגלית"}
                      </button>
                    ))}
                  </fieldset>
                </Section>

                <Section n="3" title="עיצוב">
                  <div className="flex flex-wrap items-center gap-x-7 gap-y-4 text-sm">
                    <fieldset className="flex flex-wrap items-center gap-2">
                      <legend className="sr-only">ערכת צבעים</legend>
                      <span className="text-cream/65">ערכה</span>
                      {([["navy", "כחול וזהב"], ["cream", "בהיר"]] as const).map(([k, label]) => (
                        <button
                          key={k}
                          onClick={() => setD({ theme: k, bgColor: null, textColor: null, accentColor: null, chordColor: null })}
                          aria-pressed={design.theme === k}
                          className={`btn !py-1.5 ${design.theme === k ? "btn-gold" : "btn-ghost"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </fieldset>
                    <fieldset className="flex flex-wrap items-center gap-2">
                      <legend className="sr-only">גודל תמונה</legend>
                      <span className="text-cream/65">גודל</span>
                      {([["feed", "פוסט 4:5"], ["story", "סטורי 9:16"]] as const).map(([k, label]) => (
                        <button
                          key={k}
                          onClick={() => setD({ format: k })}
                          aria-pressed={design.format === k}
                          className={`btn !py-1.5 ${design.format === k ? "btn-gold" : "btn-ghost"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </fieldset>
                    <label className="flex items-center gap-3 text-cream/65">
                      טקסט
                      <input
                        type="range"
                        min={0.7}
                        max={1.4}
                        step={0.05}
                        value={design.fontScale}
                        onChange={(e) => setD({ fontScale: Number(e.target.value) })}
                      />
                    </label>
                    <label className="flex items-center gap-3 text-cream/65">
                      אקורדים
                      <input
                        type="range"
                        min={0.7}
                        max={1.5}
                        step={0.05}
                        value={design.chordScale}
                        onChange={(e) => setD({ chordScale: Number(e.target.value) })}
                      />
                    </label>
                    <fieldset className="flex flex-wrap items-center gap-2">
                      <legend className="sr-only">עמודות</legend>
                      <span className="text-cream/65">עמודות</span>
                      {([[1, "אחת"], [2, "שתיים עם הפרדה"]] as const).map(([k, label]) => (
                        <button
                          key={k}
                          onClick={() => setD({ columns: k })}
                          aria-pressed={design.columns === k}
                          className={`btn !py-1.5 ${design.columns === k ? "btn-gold" : "btn-ghost"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </fieldset>
                    <label className="flex items-center gap-3 text-cream/65">
                      ריווח
                      <select
                        value={design.lineGap}
                        onChange={(e) => setD({ lineGap: e.target.value as Design["lineGap"] })}
                        className="field !w-auto !py-1.5"
                      >
                        <option value="tight">צפוף</option>
                        <option value="normal">רגיל</option>
                        <option value="airy">מרווח</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-cream/65">
                      <input
                        type="checkbox"
                        checked={design.showMeta}
                        onChange={(e) => setD({ showMeta: e.target.checked })}
                        className="accent-[#d4b176]"
                      />
                      סולם, קאפו ו-BPM
                    </label>
                    <fieldset className="flex flex-wrap items-center gap-4 text-cream/65">
                      <legend className="sr-only">צבעים</legend>
                      {([
                        ["bgColor", "רקע", design.theme === "navy" ? "#161830" : "#faf7f0"],
                        ["textColor", "טקסט", design.theme === "navy" ? "#faf7f0" : "#161830"],
                        ["accentColor", "הדגשה", design.theme === "navy" ? "#d4b176" : "#8a6a33"],
                      ] as const).map(([k, label, fallback]) => (
                        <label key={k} className="flex items-center gap-2">
                          {label}
                          <input
                            type="color"
                            value={design[k] ?? fallback}
                            onChange={(e) => setD({ [k]: e.target.value } as Partial<Design>)}
                            className="h-9 w-11 cursor-pointer border border-line bg-transparent"
                          />
                        </label>
                      ))}
                      <button
                        onClick={() => setD({ bgColor: null, textColor: null, accentColor: null, chordColor: null })}
                        className="px-1 py-2 underline underline-offset-4 hover:text-cream"
                      >
                        אפס צבעים
                      </button>
                    </fieldset>
                  </div>
                </Section>
              </div>

              <section className={`glass rise p-4 sm:p-6 ${pane === "edit" ? "hidden lg:block" : "block"}`}>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <span className="grid h-7 w-7 place-items-center rounded-full border border-gold/40 bg-gold/10 text-xs font-bold text-gold">
                    4
                  </span>
                  <h2 className="text-lg font-bold tracking-tight">התוצאה</h2>
                  <span className="rule hidden min-w-8 flex-1 sm:block" />
                  <div className="flex w-full flex-wrap gap-2 sm:ms-auto sm:w-auto">
                    <button
                      onClick={exportCurrent}
                      disabled={!!exporting}
                      className="btn btn-gold flex flex-1 items-center justify-center gap-2 sm:flex-none"
                    >
                      <Icon d={ICONS.download} />
                      {exporting && !exportSong ? exporting : "הורד את השיר"}
                    </button>
                    {doneItems.length > 1 && (
                      <button
                        onClick={exportAll}
                        disabled={!!exporting}
                        className="btn btn-ghost flex flex-1 items-center justify-center gap-2 sm:flex-none"
                      >
                        <Icon d={ICONS.download} />
                        {exporting && exportSong ? exporting : zipLabel}
                      </button>
                    )}
                  </div>
                </div>
                <div className="mb-3 space-y-2.5 rounded-xl bg-white/5 px-3.5 py-2.5 text-sm ring-1 ring-white/5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <button
                      onClick={() => {
                        // בכניסה למצב מבטלים בחירה קודמת. ביציאה נשאר מסומן הסימן האחרון, למקרה שצריך לכוון אותו
                        if (picking !== "slash") setSelChord(null);
                        setPicking((v) => (v === "slash" ? false : "slash"));
                      }}
                      aria-pressed={picking === "slash"}
                      className={`btn !px-3 !py-1 ${picking === "slash" ? "btn-gold" : "btn-ghost"}`}
                    >
                      {picking === "slash" ? "סיום הוספת /" : "הוסף / על אות או מילה"}
                    </button>
                    {picking === "slash" && (
                      <>
                        <label className="flex items-center gap-2 text-cream/65">
                          <input
                            type="checkbox"
                            checked={slashOnWord}
                            onChange={(e) => setSlashOnWord(e.target.checked)}
                            className="accent-[#d4b176]"
                          />
                          מעל תחילת המילה
                        </label>
                        <span className="text-gold">
                          {slashOnWord ? "לחץ על מילה" : "לחץ על האות"} כדי להוסיף /. אפשר להוסיף כמה שרוצים.
                        </span>
                      </>
                    )}
                  </div>
                  {selToken ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-cream/65">
                        {selToken.name === "/" ? "סימן נבחר:" : "אקורד נבחר:"}{" "}
                        <b dir="ltr" className="text-gold">
                          {selToken.name}
                        </b>
                      </span>
                      <span className="rule hidden min-w-4 flex-1 sm:block" />
                      <button onClick={() => nudgeChord(NUDGE_STEP)} className="btn btn-ghost !px-3 !py-1" aria-label="הזז ימינה">
                        הזז ימינה →
                      </button>
                      <button onClick={() => nudgeChord(-NUDGE_STEP)} className="btn btn-ghost !px-3 !py-1" aria-label="הזז שמאלה">
                        ← הזז שמאלה
                      </button>
                      {selToken.nudge !== 0 && (
                        <button onClick={resetNudge} className="px-1 py-1 text-cream/65 underline underline-offset-4 hover:text-cream">
                          איפוס ({selToken.nudge > 0 ? "+" : ""}
                          {selToken.nudge})
                        </button>
                      )}
                      <button
                        onClick={() => setPicking((v) => (v === "move" ? false : "move"))}
                        aria-pressed={picking === "move"}
                        className={`btn !px-3 !py-1 ${picking === "move" ? "btn-gold" : "btn-ghost"}`}
                      >
                        {picking === "move" ? "בטל בחירת אות" : "שייך לאות"}
                      </button>
                      {selToken.exact && (
                        <button onClick={unpinChord} className="px-1 py-1 text-cream/65 underline underline-offset-4 hover:text-cream">
                          החזר לתחילת המילה
                        </button>
                      )}
                      <button onClick={deleteChord} className="px-1 py-1 text-red-300/80 underline underline-offset-4 hover:text-red-200">
                        {selToken.name === "/" ? "מחק סימן" : "מחק אקורד"}
                      </button>
                      <button
                        onClick={() => {
                          setPicking(false);
                          setSelChord(null);
                        }}
                        className="px-1 py-1 text-cream/45 hover:text-cream"
                        aria-label="סיים בחירה"
                      >
                        ×
                      </button>
                      {picking === "move" && (
                        <p className="basis-full text-gold">לחץ על האות שמעליה האקורד יופיע.</p>
                      )}
                    </div>
                  ) : (
                    picking !== "slash" && (
                      <p className="text-cream/55">
                        לחץ על אקורד או על / בתמונה כדי להזיז אותו ימינה ושמאלה (גם במקשי החצים), לשייך אותו לאות מסוימת או למחוק אותו.
                      </p>
                    )
                  )}
                </div>
                {pageCount >= 6 && design.format === "feed" && (
                  <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-gold/10 px-3.5 py-2.5 text-sm text-gold ring-1 ring-gold/25">
                    <span>השיר ארוך ({pageCount} תמונות). בפורמט סטורי הוא ייכנס בפחות עמודים.</span>
                    <button className="btn btn-ghost !py-1 !text-sm" onClick={() => setD({ format: "story" })}>
                      עבור לסטורי
                    </button>
                  </div>
                )}
                <div ref={previewRef} className="stage relative flex flex-wrap justify-center gap-6">
                  <SheetPages song={song} design={design} cardWidth={previewW} edit={chordEdit} onPageCount={setPageCount} />
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {/* רינדור מחוץ למסך לצורך הורדת שירים שלא פתוחים בתצוגה, שיר אחר שיר */}
      {exportSong && (
        <div
          key={exportSong.id}
          data-export-id={exportSong.id}
          aria-hidden
          style={{ position: "fixed", left: -99999, top: 0 }}
        >
          <SheetPages song={exportSong.song} design={design} cardWidth={1080} />
        </div>
      )}

      <nav
        aria-label="ניווט ראשי"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-navy-deep/85 px-3 pt-1.5 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
      >
        <div className="mx-auto flex max-w-md gap-1">
          {(
            [
              ["chat", "צ'אט", ICONS.chat],
              ["edit", "עריכה", ICONS.edit],
              ["result", "תוצאה", ICONS.image],
            ] as const
          ).map(([k, label, icon]) => (
            <button
              key={k}
              onClick={() => setPane(k)}
              aria-current={pane === k ? "page" : undefined}
              className="nav-btn relative"
            >
              <Icon d={icon} size={22} />
              {label}
              {k === "result" && doneItems.length > 0 && (
                <span className="absolute end-[28%] top-1 grid h-4 min-w-4 place-items-center rounded-full bg-gold px-1 text-[10px] font-bold text-navy-deep">
                  {doneItems.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
