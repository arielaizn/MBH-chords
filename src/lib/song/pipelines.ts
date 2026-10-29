import type { ChatGptTokens } from "../chatgpt/auth";
import { codexText } from "../chatgpt/responses";
import { parseChordPro } from "./chordpro";
import { DESIGN_FIELDS_HELP, type Design } from "./design";
import { importFromTab4u } from "./importers/tab4u";
import {
  SongSchema,
  type ComposeResult,
  type FindResult,
  type ReviseResult,
  type Song,
} from "./types";

const BAD_FORMAT = "התשובה מה-AI לא הייתה בפורמט תקין, נסה שוב";

const CHORDPRO_RULES = `ChordPro rules (strict):
- One line of the song per line. Put each chord in square brackets immediately before the FIRST LETTER of the whole word where it changes: "[Am]שלום [G]עולם". Never put a chord inside a word and never split a word; if a change falls mid-word, put the chord before that word.
- Section headers sit on their own line and start with "## " (for example "## בית 1", "## פזמון", "## Intro").
- Instrumental or chord-only lines: chords separated by spaces, no lyrics: "[Am] [F] [C] [G]".
- One blank line between sections.
- No markdown fences, no tab diagrams, no commentary inside the chordpro text.
- Use standard chord names only (Am, F, C, G7, Dm7, Fmaj7, Esus4, D/F#).`;

const FIND = `You research chord charts for a singer-guitarist. The user names a song (Hebrew or any language).
1. Use web search to find an existing chord chart with lyrics for exactly this song. Hebrew sources include tab4u.com and nagnu.co.il; others include Ultimate Guitar and Chordie. Open the best result.
2. If you find a reliable chart, copy the ENTIRE chart faithfully into ChordPro: every section and every line, from the first line to the last, including intro and outro lines. Never abbreviate, summarize, sample or stop after a few lines; a partial chart is a failure. If the page is long, read all of it. Never invent or "fix" chords.
3. If you cannot find a chart, or the match is doubtful (different song, different artist), return found=false. Never fabricate a chart to fill the gap.

${CHORDPRO_RULES}

Reply with ONE JSON object and nothing else:
{"found":true,"title":"","artist":"","key":"","capo":null,"bpm":null,"timeSignature":"","direction":"rtl","sourceUrl":"","chordpro":"","reason":""}
direction is "rtl" for Hebrew or Arabic lyrics, otherwise "ltr". When found=false, chordpro may be empty and reason explains in Hebrew in one short sentence.
Only "sourceUrl" may contain a URL. Never put links or citations in any other field.`;

const COMPOSE = `You are a working guitarist-arranger with an excellent harmonic and rhythmic sense. No reliable chord chart exists for this song, so you create one.
Inputs: the song name; optionally lyrics the user pasted; optionally "Chart to keep" (an earlier version of this song without lyrics); optionally style hints.

1. Identify the song and its facts (artist, original key, tempo, genre, time signature). Use web search when no lyrics were given.
2. Lyrics: use only the lyrics the user pasted. If none were pasted, never invent lyrics and never reproduce lyrics you cannot provide reliably. Return a CHORD CHART WITHOUT LYRICS instead (format below).
3. Decide the key (comfortable for a singer, easy on guitar), BPM, time signature and groove. Prefer open shapes and suggest a capo when it helps. Write the chords as the SHAPES played with the capo, and put the sounding key in "key".
4. Harmony: if you know the song, follow its real melody contour and mood. Stay mostly diatonic. Use relative-minor/major swaps, secondary dominants, borrowed iv or sus chords only where the mood calls for it. Verse, chorus and bridge each get their own progression, related to each other. A repeated section repeats the same chords exactly.
5. With lyrics: put chord changes at phrase starts and on strong beats. Slow songs: one chord per line or per half line. Faster songs: up to two per line. Never change chord on every word. End sections on the tonic, and use a dominant or turnaround leading into the chorus.
6. Chord chart without lyrics: use the real structure of the song as you know it, at most 8 sections, no invented filler sections. Each section gets a "## " header and its progression as chord-only lines of exactly 4 chords, one chord per bar, for example "[Am] [Dm] [Am] [Am]". Write a repeated section once and add "(x2)" to its header.
7. If a "Chart to keep" is given, keep its key, capo, BPM and progressions exactly, and place the pasted lyrics under those chords following rule 5.
8. In "notes" write 2 to 4 short lines in Hebrew: feel and BPM, a suggested strumming pattern, and the capo suggestion.

${CHORDPRO_RULES}

Reply with ONE JSON object and nothing else:
{"title":"","artist":"","key":"","capo":null,"bpm":0,"timeSignature":"4/4","direction":"rtl","notes":"","chordpro":""}
Never put URLs or markdown links in any field.`;

const IMAGE = `You read photographed handwritten song sheets with chords (Hebrew or English).
Transcribe exactly what is written. Each chord is written above a word (often in red, often with a small slanted line from the chord down to the word): attach it to the word directly below it, or to the nearest word below where it starts. Hebrew reads right to left, so the first chord of a line is the rightmost one. Do not correct, complete or improve the song. If several images are given, they are consecutive pages of the same song, in the order given.
If a chord is illegible write [?] in its place; if a word is illegible write … instead.
Detect the sections. If the sheet has none, add "## " headers only where there are clear gaps, named by order (בית 1, פזמון).

${CHORDPRO_RULES}

Reply with ONE JSON object and nothing else:
{"title":"","artist":"","key":"","capo":null,"bpm":null,"timeSignature":"","direction":"rtl","notes":"anything unclear, in Hebrew","chordpro":""}
Take the title from the sheet; if there is none, use the first line of the lyrics.`;

const REVISE = `You edit a chord sheet for a singer-guitarist. You get the current sheet (ChordPro plus metadata), the current design settings, and the user's request (usually Hebrew).
Decide what the request touches:
- Music or content (chords, lyrics, key, capo, BPM, sections, transposing, simplifying chords, adding an intro, fixing one chord): return the FULL updated "chordpro" and any changed metadata.
- Design (colors, light or dark theme, text or chord size, spacing, story or post format, showing or hiding the key/capo/BPM chips): return only the design fields that change.
Rules:
- Change only what was asked. Never touch the lyrics unless asked.
- When transposing, move the key and every chord together and say the new key.
- When simplifying, say which chords you replaced.
- Chord names in the sheet may carry layout suffixes: "^" (pins the chord to the letter it sits on) and "@n" (moves it n pixels, e.g. [Am^@-12]). Keep them exactly as they are, on the same chord and the same spot.
- If the request is unclear or impossible, change nothing and ask one short question in "reply".

${CHORDPRO_RULES}

${DESIGN_FIELDS_HELP}

Reply with ONE JSON object and nothing else:
{"reply":"one or two short Hebrew sentences saying what you changed","song":{"title":"","artist":"","key":"","capo":null,"bpm":null,"timeSignature":"","direction":"rtl","notes":"","chordpro":""},"design":{}}
Inside "song" and "design" include only the fields that changed. Use empty objects when nothing changed.`;

function extractJson(text: string): Record<string, unknown> {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a === -1 || b <= a) throw new Error(BAD_FORMAT);
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    throw new Error(BAD_FORMAT);
  }
}

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;

// טקסט חופשי מה-AI מגיע לפעמים עם ציטוטים וקישורים ("([youtube.com](...utm_source=openai))"). מנקים לפני שמציגים.
function cleanText(v: unknown, max = 220): string | null {
  if (typeof v !== "string") return null;
  const t = v
    .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

function cleanUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return null;
  }
}

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
};

function cleanChordPro(v: unknown): string {
  return String(v ?? "")
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/, "")
    .trim();
}

function toSong(
  j: Record<string, unknown>,
  source: Song["source"],
  fallbackTitle: string,
): Song | null {
  const chordpro = cleanChordPro(j.chordpro);
  if (!chordpro.includes("[")) return null;
  const parsed = SongSchema.safeParse({
    title: str(j.title) ?? fallbackTitle,
    artist: str(j.artist),
    key: str(j.key),
    capo: num(j.capo),
    bpm: num(j.bpm),
    timeSignature: str(j.timeSignature),
    direction: j.direction === "ltr" ? "ltr" : "rtl",
    source,
    sourceUrl: cleanUrl(j.sourceUrl),
    notes: cleanText(j.notes, 600),
    chordpro,
  });
  return parsed.success ? parsed.data : null;
}

// האם יש בשיר מילים בכלל, או שזה תרשים אקורדים בלבד
const hasLyrics = (chordpro: string) =>
  parseChordPro(chordpro).some((l) => l.kind === "lyrics" && l.units.some((u) => u.text.trim()));

// פחות מזה נחשב קטע בודד ולא שיר: מעדיפים להודות שלא מצאנו מאשר להציג חצי שיר
const MIN_LINES = 8;
const countLines = (chordpro: string) =>
  parseChordPro(chordpro).filter((l) => l.kind === "lyrics").length;

export async function findSong(
  tokens: ChatGptTokens,
  query: string,
  signal?: AbortSignal,
): Promise<FindResult> {
  // שלב 1: ייבוא מלא ודטרמיניסטי מאתר אקורדים. לא תלוי בהחלטה של המודל כמה לקחת, ולכן מביא את כל השיר.
  const imported = await importFromTab4u(query).catch(() => null);
  if (imported) {
    const parsed = SongSchema.safeParse({
      title: imported.title,
      artist: imported.artist,
      key: imported.key,
      capo: null,
      bpm: null,
      timeSignature: null,
      direction: imported.direction,
      source: "web",
      sourceUrl: imported.sourceUrl,
      notes: null,
      chordpro: imported.chordpro,
    });
    if (parsed.success) return { found: true, song: parsed.data };
  }

  // שלב 2 (גיבוי כשהאתר חסום או לא מצא): המודל מחפש וקורא בעצמו, עם בדיקת שלמות
  const text = await codexText({
    tokens,
    signal,
    instructions: FIND,
    parts: [{ type: "input_text", text: `Song: ${query}` }],
    webSearch: true,
  });
  const j = extractJson(text);
  const found = j.found === false ? null : toSong(j, "web", query);
  if (found && countLines(found.chordpro) < MIN_LINES) {
    return { found: false, reason: "מצאתי רק קטע קצר מהשיר, לא גרסה מלאה." };
  }
  const song = found;
  if (!song) {
    return {
      found: false,
      reason: cleanText(j.reason) ?? "לא נמצאו אקורדים אמינים לשיר הזה.",
    };
  }
  return { found: true, song };
}

export async function composeSong(
  tokens: ChatGptTokens,
  input: { query: string; lyrics?: string; chart?: string; hint?: string },
  signal?: AbortSignal,
): Promise<ComposeResult> {
  const lines = [`Song: ${input.query}`];
  if (input.lyrics?.trim()) lines.push(`Lyrics from the user:\n${input.lyrics.trim()}`);
  if (input.chart?.trim()) lines.push(`Chart to keep:\n${input.chart.trim()}`);
  if (input.hint?.trim()) lines.push(`Style hints: ${input.hint.trim()}`);
  const text = await codexText({
    tokens,
    signal,
    instructions: COMPOSE,
    parts: [{ type: "input_text", text: lines.join("\n\n") }],
    webSearch: !input.lyrics?.trim(),
    effort: "high",
  });
  const song = toSong(extractJson(text), "ai", input.query);
  if (!song) throw new Error(BAD_FORMAT);
  return { song, lyricsMissing: !hasLyrics(song.chordpro) };
}

export async function imageToSong(
  tokens: ChatGptTokens,
  dataUrls: string[],
  hint: string | undefined,
  signal?: AbortSignal,
): Promise<Song> {
  const text = await codexText({
    tokens,
    signal,
    instructions: IMAGE,
    parts: [
      {
        type: "input_text",
        text: hint?.trim()
          ? `Transcribe this sheet. The user says it is: ${hint.trim()}`
          : "Transcribe this sheet.",
      },
      ...dataUrls.map((u) => ({ type: "input_image" as const, image_url: u })),
    ],
    effort: "medium",
  });
  const song = toSong(extractJson(text), "image", hint?.trim() || "שיר ללא שם");
  if (!song) throw new Error(BAD_FORMAT);
  return song;
}

function songPatch(v: unknown): Partial<Song> {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const p: Partial<Song> = {};
  const title = str(o.title);
  if (title) p.title = title;
  for (const k of ["artist", "key", "timeSignature", "notes"] as const) {
    if (k in o) p[k] = str(o[k]);
  }
  for (const k of ["capo", "bpm"] as const) {
    if (k in o) p[k] = num(o[k]);
  }
  if (o.direction === "rtl" || o.direction === "ltr") p.direction = o.direction;
  if ("chordpro" in o) {
    const c = cleanChordPro(o.chordpro);
    if (c.includes("[")) p.chordpro = c;
  }
  return p;
}

export async function reviseSong(
  tokens: ChatGptTokens,
  input: { song: Song; design: Design; instruction: string },
  signal?: AbortSignal,
): Promise<ReviseResult> {
  const { chordpro, ...meta } = input.song;
  const text = await codexText({
    tokens,
    signal,
    instructions: REVISE,
    parts: [
      {
        type: "input_text",
        text: `Current metadata: ${JSON.stringify(meta)}\nCurrent design: ${JSON.stringify(
          input.design,
        )}\nCurrent chordpro:\n${chordpro}\n\nUser request: ${input.instruction}`,
      },
    ],
    effort: "medium",
  });
  const j = extractJson(text);
  return {
    reply: cleanText(j.reply, 400) ?? "עדכנתי.",
    song: songPatch(j.song),
    design:
      j.design && typeof j.design === "object" ? (j.design as Record<string, unknown>) : {},
  };
}
