"use client";

import { Fragment, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { BRAND } from "@/config/brand";
import { contrast, luminance, type Design } from "@/lib/song/design";
import { parseChordPro, type ChordMark, type Line, type Unit } from "@/lib/song/chordpro";
import { graphemes } from "@/lib/song/graphemes";
import type { Song } from "@/lib/song/types";

export const SHEET_W = 1080;
const SHEET_H = { feed: 1350, story: 1920 } as const;
const PAD = 76;
const HEADER_NEXT = 128;
const FOOTER = 92;
const CONTENT_W = SHEET_W - PAD * 2;
const COL_GAP = 64; // המרווח בין שתי עמודות, וקו ההפרדה במרכזו
const DIVIDER_W = 2;
const GAPS = { tight: 6, normal: 12, airy: 22 } as const;

// גרגר עדין שנותן לרקע תחושת נייר או בד. לבן על כהה, כהה על בהיר.
const grain = (rgb: 0 | 1) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${rgb} 0 0 0 0 ${rgb} 0 0 0 0 ${rgb} 0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
  )}")`;

type Colors = {
  bg: string;
  text: string;
  chord: string;
  accent: string;
  muted: string;
  dark: boolean;
  glow: boolean;
};

const THEMES = {
  navy: {
    bg: `radial-gradient(ellipse at 50% -8%, #2c3060 0%, ${BRAND.navy} 46%, ${BRAND.navyDeep} 100%)`,
    base: BRAND.navy,
    text: BRAND.cream,
    chord: BRAND.gold,
    accent: BRAND.gold,
  },
  cream: {
    bg: `linear-gradient(180deg, #fffdf8 0%, #f6f0e2 100%)`,
    base: BRAND.cream,
    text: BRAND.navy,
    chord: "#8a6a33",
    accent: "#8a6a33",
  },
} as const;

// צבעים אחרי דריסות של המשתמש או ה-AI. אם הניגודיות נמוכה מדי, הצבע מוחלף בכהה או בבהיר.
function resolveColors(d: Design): Colors {
  const t = THEMES[d.theme];
  const bgHex = d.bgColor ?? t.base;
  const dark = luminance(bgHex) < 0.4;
  const safeFallback = dark ? BRAND.cream : BRAND.navy;
  const pick = (preferred: string | null, fallback: string, min: number) => {
    const c = preferred ?? fallback;
    return contrast(c, bgHex) >= min ? c : safeFallback;
  };
  const text = pick(d.textColor, t.text, 4.5);
  return {
    bg: d.bgColor ?? t.bg,
    text,
    accent: pick(d.accentColor, t.accent, 3),
    chord: pick(d.chordColor ?? d.accentColor, t.chord, 3),
    muted: `color-mix(in srgb, ${text} 64%, transparent)`,
    dark,
    glow: dark && d.bgColor === null,
  };
}

const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** מצב עריכה בתצוגה המקדימה: בחירת אקורד והצמדתו לאות. בלי זה העמודים רק מצוירים (למשל בייצוא) */
export type ChordEdit = {
  selectedId: number | null;
  picking: boolean;
  onSelect: (id: number | null) => void;
  /** wordStart: ההיסט של תחילת המילה, למקרה שהסימן צריך לשבת מעל המילה ולא מעל האות */
  onPick: (row: number, plainPos: number, wordStart: number) => void;
};

type Props = {
  song: Song;
  design: Design;
  cardWidth: number;
  edit?: ChordEdit;
  /** מדווח כמה עמודים יצאו, כדי שהממשק יוכל להציע פורמט מתאים לשיר ארוך */
  onPageCount?: (n: number) => void;
};

function Diamond({ size, color }: { size: number; color: string }) {
  return (
    <span
      style={{
        display: "block",
        width: size,
        height: size,
        background: color,
        transform: "rotate(45deg)",
        flex: "none",
      }}
    />
  );
}

function ChordText({
  ch,
  c,
  edit,
}: {
  ch: ChordMark;
  c: Colors;
  edit?: ChordEdit;
}) {
  const selected = !!edit && edit.selectedId === ch.id;
  return (
    <span
      data-chord-id={ch.id}
      onClick={
        edit
          ? (e) => {
              e.stopPropagation();
              edit.onSelect(selected ? null : ch.id);
            }
          : undefined
      }
      style={{
        direction: "ltr",
        unicodeBidi: "isolate",
        display: "inline-block",
        // חיובי זז ימינה על המסך, שלילי שמאלה, בלי קשר לכיוון השיר
        transform: ch.nudge ? `translateX(${ch.nudge}px)` : undefined,
        cursor: edit ? "pointer" : undefined,
        borderRadius: 8,
        outline: selected ? `2.5px solid ${c.chord}` : undefined,
        outlineOffset: 4,
        background: selected ? mix(c.chord, 18) : undefined,
      }}
    >
      {ch.name}
    </span>
  );
}

// טקסט המילה. אקורד שצמוד לאות יושב מעליה, ובמצב הצמדה כל אות לחיצה.
function WordText({
  u,
  row,
  c,
  design,
  edit,
}: {
  u: Unit;
  row: number;
  c: Colors;
  design: Design;
  edit?: ChordEdit;
}) {
  const scale = design.fontScale;
  const text = u.text || " ";
  const pinned = u.chords.filter((k) => k.at !== null);
  const picking = !!edit?.picking && !!u.text.trim();
  if (pinned.length === 0 && !picking) return <>{text}</>;

  const chordSize = 29 * design.chordScale * scale;
  return (
    <>
      {graphemes(text).map((g) => {
        // האקורד שייך לאות שמכילה את ההיסט שלו
        const here = pinned.filter((k) => k.at! >= g.i && k.at! < g.i + g.s.length);
        const letter =
          picking && g.s.trim() ? (
            <span
              className="pick-letter"
              onClick={(e) => {
                e.stopPropagation();
                edit!.onPick(row, u.start + g.i, u.start);
              }}
            >
              {g.s}
            </span>
          ) : (
            g.s
          );
        if (here.length === 0) return <Fragment key={g.i}>{letter}</Fragment>;
        return (
          <span key={g.i} style={{ position: "relative" }}>
            {letter}
            <span
              style={{
                position: "absolute",
                left: "50%",
                bottom: `calc(100% + ${7 * scale}px)`,
                transform: "translateX(-50%)",
                display: "flex",
                gap: 8 * scale,
                whiteSpace: "nowrap",
                lineHeight: 1.1,
                fontSize: chordSize,
                fontWeight: 800,
                color: c.chord,
                textShadow: c.dark ? `0 0 22px ${mix(c.chord, 35)}` : undefined,
              }}
            >
              {here.map((k) => (
                <ChordText key={k.id} ch={k} c={c} edit={edit} />
              ))}
            </span>
          </span>
        );
      })}
    </>
  );
}

function LineView({
  line,
  dir,
  design,
  c,
  edit,
}: {
  line: Line;
  dir: "rtl" | "ltr";
  design: Design;
  c: Colors;
  edit?: ChordEdit;
}) {
  const scale = design.fontScale;
  const gap = GAPS[design.lineGap] * scale;
  if (line.kind === "blank") return <div style={{ height: 22 * scale }} />;
  if (line.kind === "section") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          paddingBottom: gap + 4,
          paddingTop: 6 * scale,
          color: c.accent,
          fontWeight: 700,
          fontSize: 28 * scale,
          letterSpacing: dir === "ltr" ? 2 : 0.5,
        }}
      >
        <Diamond size={9 * scale} color={c.accent} />
        <span>{line.name}</span>
        <span
          style={{
            flex: 1,
            height: 1.5,
            background: `linear-gradient(to ${dir === "rtl" ? "left" : "right"}, ${mix(c.accent, 55)}, transparent)`,
          }}
        />
      </div>
    );
  }
  if (line.units.every((u) => !u.text.trim())) {
    // שורת אקורדים בלי מילים (פתיחה, תרשים): תאים עם קו תיבה, צפופה ולא שורה שלמה לכל אקורד
    const bar = `2px solid ${mix(c.accent, 50)}`;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", paddingBottom: gap + 6 * scale, direction: dir }}>
        {line.units.map((u, i) => (
          <span
            key={i}
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 10 * scale,
              minWidth: 128 * scale,
              padding: `${6 * scale}px ${20 * scale}px`,
              fontSize: 33 * design.chordScale * scale,
              fontWeight: 800,
              color: c.chord,
              textShadow: c.dark ? `0 0 22px ${mix(c.chord, 35)}` : undefined,
              borderInlineStart: bar,
              borderInlineEnd: i === line.units.length - 1 ? bar : undefined,
            }}
          >
            {u.chords.map((ch) => (
              <ChordText key={ch.id} ch={ch} c={c} edit={edit} />
            ))}
          </span>
        ))}
      </div>
    );
  }
  const hasChord = line.units.some((u) => u.chords.length > 0);
  const chordSize = 29 * design.chordScale * scale;
  const tickH = 16 * scale;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        paddingBottom: gap,
        lineHeight: 1.3,
      }}
    >
      {line.units.map((u, i) => {
        // אקורד שצמוד לאות מצויר בתוך המילה. כאן רק אלה שמעל תחילת המילה
        const atStart = u.chords.filter((k) => k.at === null);
        return (
        <span
          key={i}
          style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start" }}
        >
          {hasChord && (
            <>
              <span
                style={{
                  display: "flex",
                  gap: 14 * scale,
                  direction: dir,
                  minHeight: "1.1em",
                  fontSize: chordSize,
                  fontWeight: 800,
                  color: c.chord,
                  textShadow: c.dark ? `0 0 22px ${mix(c.chord, 35)}` : undefined,
                  paddingInlineEnd: atStart.length ? 10 * scale : 0,
                }}
              >
                {atStart.length === 0
                  ? " "
                  : atStart.map((ch) => <ChordText key={ch.id} ch={ch} c={c} edit={edit} />)}
              </span>
              {/* קו קטן באלכסון מהאקורד אל המילה, כמו בכתב יד */}
              <span style={{ display: "block", height: tickH, marginTop: -4 * scale }}>
                {atStart.length > 0 && u.text.trim() && (
                  <svg
                    width={tickH * 0.8}
                    height={tickH}
                    viewBox="0 0 16 20"
                    aria-hidden
                    style={{
                      display: "block",
                      overflow: "visible",
                      transform: dir === "rtl" ? "scaleX(-1)" : undefined,
                    }}
                  >
                    <line
                      x1="13"
                      y1="1"
                      x2="3"
                      y2="19"
                      stroke={c.chord}
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      opacity="0.9"
                    />
                  </svg>
                )}
              </span>
            </>
          )}
          <span style={{ whiteSpace: "pre", fontSize: 36 * scale, color: c.text, fontWeight: 500 }}>
            <WordText u={u} row={line.row} c={c} design={design} edit={edit} />
          </span>
        </span>
        );
      })}
    </div>
  );
}

function metaOf(song: Song): string[] {
  return [
    song.key ? `סולם ${song.key}` : null,
    song.capo ? `קאפו ${song.capo}` : null,
    song.bpm ? `${song.bpm} BPM` : null,
    song.timeSignature || null,
  ].filter(Boolean) as string[];
}

function headerFirstHeight(song: Song, d: Design) {
  return d.showMeta && metaOf(song).length ? 352 : 296;
}

function Ornament({ c }: { c: Colors }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, width: 360, marginTop: 4 }}>
      <span style={{ flex: 1, height: 1.5, background: `linear-gradient(to right, transparent, ${mix(c.accent, 70)})` }} />
      <Diamond size={10} color={c.accent} />
      <span style={{ flex: 1, height: 1.5, background: `linear-gradient(to left, transparent, ${mix(c.accent, 70)})` }} />
    </div>
  );
}

function Header({ song, first, c, design }: { song: Song; first: boolean; c: Colors; design: Design }) {
  const logoH = first ? 108 : 58;
  const meta = design.showMeta ? metaOf(song) : [];
  const logo = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={BRAND.logoSrc}
      alt=""
      style={{
        height: logoH,
        width: logoH * BRAND.logoRatio,
        objectFit: "contain",
        filter: c.glow ? "drop-shadow(0 8px 26px rgba(212,177,118,0.3))" : undefined,
      }}
    />
  );
  if (!first) {
    return (
      <div
        style={{
          height: HEADER_NEXT,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          direction: "rtl",
          borderBottom: `1.5px solid ${mix(c.accent, 30)}`,
          boxSizing: "border-box",
          paddingBottom: 18,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 38, color: c.text, paddingTop: 8, letterSpacing: -0.5 }}>
          {song.title}
        </div>
        {logo}
      </div>
    );
  }
  return (
    <div
      style={{
        height: headerFirstHeight(song, design),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        direction: "rtl",
      }}
    >
      {logo}
      <Ornament c={c} />
      <div
        style={{
          fontWeight: 800,
          fontSize: song.title.length > 22 ? 50 : 64,
          letterSpacing: -1,
          color: c.text,
          lineHeight: 1.1,
          maxWidth: CONTENT_W,
          textAlign: "center",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          paddingTop: 4,
          textShadow: c.dark ? "0 4px 28px rgba(0,0,0,0.4)" : undefined,
        }}
      >
        {song.title}
      </div>
      {song.artist && (
        <div style={{ fontSize: 32, color: c.muted, fontWeight: 300, letterSpacing: 2 }}>{song.artist}</div>
      )}
      {meta.length > 0 && (
        <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
          {meta.map((m) => (
            <span
              key={m}
              dir="auto"
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: 0.5,
                color: c.accent,
                background: mix(c.accent, 10),
                border: `1px solid ${mix(c.accent, 55)}`,
                borderRadius: 999,
                padding: "5px 20px",
              }}
            >
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Frame({ c }: { c: Colors }) {
  const corner = (pos: React.CSSProperties) => (
    <span style={{ position: "absolute", width: 14, height: 14, background: c.accent, transform: "rotate(45deg)", ...pos }} />
  );
  return (
    <>
      <div style={{ position: "absolute", inset: 30, border: `1.5px solid ${mix(c.accent, 62)}`, borderRadius: 4, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 40, border: `1px solid ${mix(c.accent, 24)}`, borderRadius: 2, pointerEvents: "none" }} />
      {corner({ top: 23, left: 23 })}
      {corner({ top: 23, right: 23 })}
      {corner({ bottom: 23, left: 23 })}
      {corner({ bottom: 23, right: 23 })}
    </>
  );
}

export function SheetPages({ song, design, cardWidth, edit, onPageCount }: Props) {
  const c = resolveColors(design);
  const H = SHEET_H[design.format];
  const lines = useMemo(() => parseChordPro(song.chordpro), [song.chordpro]);
  const dir = song.direction;
  const measureRef = useRef<HTMLDivElement>(null);
  // עמוד הוא רשימת עמודות, ועמודה היא רשימת מספרי שורות
  const [pages, setPages] = useState<number[][][]>([]);
  const [fontsReady, setFontsReady] = useState(false);
  // false בשרת ובהידרציה, true בדפדפן: ה-portal של המדידה נוצר רק אחרי שיש document
  const inBrowser = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const headerFirst = headerFirstHeight(song, design);
  const { fontScale, chordScale, lineGap, columns } = design;
  const colW = columns === 2 ? (CONTENT_W - COL_GAP) / 2 : CONTENT_W;

  useLayoutEffect(() => {
    let alive = true;
    document.fonts.ready.then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root || !fontsReady || !inBrowser) return;
    const heights = Array.from(root.querySelectorAll<HTMLElement>("[data-i]")).map(
      (el) => el.offsetHeight,
    );
    const capFirst = H - PAD * 2 - headerFirst - FOOTER;
    const capNext = H - PAD * 2 - HEADER_NEXT - FOOTER;
    // כל עמודה (או עמוד, כשיש עמודה אחת) נמלאת עד הסוף לפני שעוברים לבאה
    const out: number[][] = [[]];
    let used = 0;
    const isSoft = (i: number) => lines[i].kind === "section" || lines[i].kind === "blank";
    lines.forEach((l, i) => {
      const cur = out[out.length - 1];
      if (l.kind === "blank" && cur.length === 0) return;
      const cap = Math.floor((out.length - 1) / columns) === 0 ? capFirst : capNext;
      if (used + heights[i] > cap && cur.length > 0) {
        // כותרת חלק לא נשארת לבד בתחתית עמוד: היא עוברת יחד עם השורה הבאה
        const carry: number[] = [];
        while (cur.length && isSoft(cur[cur.length - 1])) carry.unshift(cur.pop()!);
        const next = carry.filter((k) => lines[k].kind !== "blank");
        out.push(next);
        used = next.reduce((sum, k) => sum + heights[k], 0);
        if (l.kind === "blank") return;
      }
      out[out.length - 1].push(i);
      used += heights[i];
    });
    for (const p of out) while (p.length && lines[p[p.length - 1]].kind === "blank") p.pop();
    const filled = out.filter((p) => p.length > 0);
    const grouped: number[][][] = [];
    for (let k = 0; k < filled.length; k += columns) grouped.push(filled.slice(k, k + columns));
    setPages(grouped);
  }, [lines, fontScale, chordScale, lineGap, columns, design.format, fontsReady, inBrowser, H, headerFirst]);

  const s = cardWidth / SHEET_W;
  const total = pages.length;
  useLayoutEffect(() => {
    onPageCount?.(total);
  }, [total, onPageCount]);
  const footerLabel = BRAND.handle || BRAND.descriptor.toUpperCase();

  return (
    <>
      {/* מדידה בלבד: אותו רוחב ואותם סגנונות כמו בעמוד. position: fixed בתוך body, כדי שלא ייצור גלילה
          אופקית באתר RTL, ושלא תיפגע המדידה כשהאזור של התצוגה מוסתר (למשל בלשונית אחרת בנייד) */}
      {inBrowser &&
        createPortal(
          <div
            ref={measureRef}
            aria-hidden
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              width: colW,
              direction: dir,
              visibility: "hidden",
              pointerEvents: "none",
              fontFamily: "var(--font-heebo), system-ui, sans-serif",
            }}
          >
            {lines.map((l, i) => (
              <div key={i} data-i={i}>
                <LineView line={l} dir={dir} design={design} c={c} />
              </div>
            ))}
          </div>,
          document.body,
        )}

      {pages.map((cols, p) => (
        <div
          key={p}
          className="rise"
          style={{
            width: cardWidth,
            height: H * s,
            overflow: "hidden",
            borderRadius: 10,
            boxShadow: "0 30px 60px -24px rgba(0,0,0,.75), 0 0 0 1px rgba(212,177,118,.14)",
            flex: "none",
            // בלי direction: ltr העמוד המוקטן נדחף שמאלה אל מחוץ לכרטיס כשהאתר RTL
            direction: "ltr",
            animationDelay: `${p * 70}ms`,
          }}
        >
          <div
            data-sheet-page={p + 1}
            onClick={edit ? () => edit.onSelect(null) : undefined}
            style={{
              width: SHEET_W,
              height: H,
              transform: `scale(${s})`,
              transformOrigin: "top left",
              position: "relative",
              overflow: "hidden",
              background: c.bg,
              padding: PAD,
              boxSizing: "border-box",
              direction: dir,
              fontFamily: "var(--font-heebo), system-ui, sans-serif",
            }}
          >
            {c.glow && (
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: -180,
                  width: 900,
                  height: 560,
                  transform: "translateX(-50%)",
                  background: "radial-gradient(ellipse at center, rgba(212,177,118,0.2), transparent 68%)",
                  pointerEvents: "none",
                }}
              />
            )}
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: grain(c.dark ? 1 : 0),
                opacity: c.dark ? 0.06 : 0.07,
                pointerEvents: "none",
              }}
            />
            <Frame c={c} />

            <Header song={song} first={p === 0} c={c} design={design} />
            <div
              style={{ width: CONTENT_W, position: "relative", display: columns === 2 ? "flex" : "block" }}
            >
              {Array.from({ length: columns }, (_, k) => (
                <Fragment key={k}>
                  {k > 0 && (
                    <span
                      style={{
                        flex: "none",
                        alignSelf: "stretch",
                        width: DIVIDER_W,
                        margin: `0 ${(COL_GAP - DIVIDER_W) / 2}px`,
                        // בלי עמודה שנייה אין מה להפריד
                        background: cols[k]
                          ? `linear-gradient(to bottom, transparent, ${mix(c.accent, 55)} 8%, ${mix(c.accent, 55)} 92%, transparent)`
                          : "transparent",
                      }}
                    />
                  )}
                  <div style={{ width: colW, flex: "none" }}>
                    {(cols[k] ?? []).map((i) => (
                      <LineView key={i} line={lines[i]} dir={dir} design={design} c={c} edit={edit} />
                    ))}
                  </div>
                </Fragment>
              ))}
            </div>

            <div
              style={{
                position: "absolute",
                left: PAD,
                right: PAD,
                bottom: 58,
                paddingTop: 16,
                borderTop: `1.5px solid transparent`,
                borderImage: `linear-gradient(to right, transparent, ${mix(c.accent, 60)}, transparent) 1`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                direction: "rtl",
                color: c.muted,
                fontSize: 19,
                fontWeight: 500,
                letterSpacing: 4,
              }}
            >
              <span dir="auto">{footerLabel}</span>
              {total > 1 ? (
                <span style={{ direction: "ltr", fontVariantNumeric: "tabular-nums", letterSpacing: 2 }}>
                  {p + 1} / {total}
                </span>
              ) : (
                <Diamond size={8} color={c.accent} />
              )}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
