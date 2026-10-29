// פורמט ChordPro מצומצם: [Am]שלום [G]עולם, כותרת חלק בשורה "## בית 1", שורה ריקה בין חלקים.
// בתמונה כל אקורד יושב מעל מילה שלמה: אקורד שנפל באמצע מילה נצמד לתחילת המילה, והמילה לא מתפצלת.
//
// שני סימוני פריסה אופציונליים בתוך הסוגריים, אחרי שם האקורד:
//   ^   האקורד יושב בדיוק מעל האות שבה הוא מופיע, ולא מעל תחילת המילה:  של[Am^]ום
//   @n  הזזה של n פיקסלים (בגודל העמוד המלא), חיובי ימינה ושלילי שמאלה:  [Am@-12]שלום   [Am^@16]

export type ChordToken = { name: string; exact: boolean; nudge: number };

/** אקורד אחד כפי שהוא מצויר: id הוא המקום שלו ברצף האקורדים בטקסט המקור */
export type ChordMark = {
  id: number;
  name: string;
  nudge: number;
  /** היסט (UTF-16) של האות בתוך unit.text כשהאקורד צמוד לאות. null: מעל תחילת המילה */
  at: number | null;
};
export type Unit = { chords: ChordMark[]; text: string; /** היסט המילה בטקסט השורה בלי אקורדים */ start: number };
export type Line =
  | { kind: "section"; name: string }
  | { kind: "blank" }
  | { kind: "lyrics"; units: Unit[]; /** מספר השורה בטקסט המקור */ row: number };

const TOKEN_RE = /\[([^\]]*)\]/g;

export function parseToken(raw: string): ChordToken {
  const m = /^([^^@]*?)(\^)?(?:@(-?\d+))?$/.exec(raw.trim());
  if (!m) return { name: raw.trim(), exact: false, nudge: 0 };
  return { name: m[1].trim(), exact: !!m[2], nudge: m[3] ? Number(m[3]) : 0 };
}

export function formatToken(t: ChordToken): string {
  return `${t.name}${t.exact ? "^" : ""}${t.nudge ? `@${t.nudge}` : ""}`;
}

function toUnits(row: string, ids: { n: number }): Unit[] {
  let plain = "";
  const marks: { id: number; tok: ChordToken; at: number }[] = [];
  const re = new RegExp(TOKEN_RE);
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(row))) {
    plain += row.slice(last, m.index);
    const id = ids.n++;
    const tok = parseToken(m[1]);
    if (tok.name) marks.push({ id, tok, at: plain.length });
    last = m.index + m[0].length;
  }
  plain += row.slice(last);

  const mark = (k: (typeof marks)[number], at: number | null): ChordMark => ({
    id: k.id,
    name: k.tok.name,
    nudge: k.tok.nudge,
    at,
  });

  // כל מילה נושאת אחריה את הרווחים שלה, כדי שהמרווח יישמר
  const words: { text: string; start: number; wordEnd: number }[] = [];
  let pos = 0;
  for (const t of plain.match(/\S+\s*|\s+/g) ?? []) {
    if (t.trim()) words.push({ text: t, start: pos, wordEnd: pos + t.trimEnd().length });
    pos += t.length;
  }

  // שורה בלי מילים: רק אקורדים (פתיחה, סיום)
  if (words.length === 0) return marks.map((k) => ({ chords: [mark(k, null)], text: "", start: 0 }));

  const byWord = words.map((): ChordMark[] => []);
  const trailing: ChordMark[] = [];
  for (const k of marks) {
    // המילה הראשונה שנגמרת אחרי האקורד: אקורד בתוך מילה או ברווח שלפניה נצמד לתחילתה
    const i = words.findIndex((w) => k.at < w.wordEnd);
    if (i === -1) trailing.push(mark(k, null));
    else byWord[i].push(mark(k, k.tok.exact && k.at >= words[i].start ? k.at - words[i].start : null));
  }
  const units = words.map((w, i) => ({ chords: byWord[i], text: w.text, start: w.start }));
  if (trailing.length) units.push({ chords: trailing, text: "", start: plain.length });
  return units;
}

export function parseChordPro(src: string): Line[] {
  const lines: Line[] = [];
  const ids = { n: 0 };
  const rows = src.replace(/\r/g, "").split("\n");
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r].trimEnd();
    if (!row.trim()) {
      if (lines.at(-1)?.kind !== "blank") lines.push({ kind: "blank" });
      continue;
    }
    if (row.startsWith("##")) {
      ids.n += (row.match(TOKEN_RE) ?? []).length; // ה-id תואם לסדר הסוגריים בטקסט, גם בכותרות
      lines.push({ kind: "section", name: row.replace(/^#+\s*/, "") });
      continue;
    }
    lines.push({ kind: "lyrics", units: toUnits(row, ids), row: r });
  }
  while (lines.at(-1)?.kind === "blank") lines.pop();
  while (lines[0]?.kind === "blank") lines.shift();
  return lines;
}

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

function noteIndex(n: string): number {
  const i = SHARPS.indexOf(n);
  return i !== -1 ? i : FLATS.indexOf(n);
}

function shiftNote(n: string, by: number, useFlats: boolean): string {
  const i = noteIndex(n);
  if (i === -1) return n;
  const j = (((i + by) % 12) + 12) % 12;
  return (useFlats ? FLATS : SHARPS)[j];
}

export function transposeChord(chord: string, by: number): string {
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(chord);
  if (!m || by === 0) return chord;
  const flats = chord.includes("b") && !chord.startsWith("b");
  const root = shiftNote(m[1], by, flats);
  const bass = m[3] ? `/${shiftNote(m[3], by, flats)}` : "";
  return `${root}${m[2]}${bass}`;
}

export function transposeChordPro(src: string, by: number): string {
  if (by === 0) return src;
  return src.replace(TOKEN_RE, (_, c: string) => {
    const t = parseToken(c);
    return `[${formatToken({ ...t, name: transposeChord(t.name, by) })}]`;
  });
}

function findToken(src: string, id: number): RegExpMatchArray | null {
  let i = 0;
  for (const m of src.matchAll(TOKEN_RE)) if (i++ === id) return m;
  return null;
}

/** משנה אקורד אחד (לפי id) בטקסט המקור: הזזה, הצמדה לאות או שם */
export function updateChord(src: string, id: number, patch: Partial<ChordToken>): string {
  const m = findToken(src, id);
  if (!m || m.index === undefined) return src;
  const tok = { ...parseToken(m[1]), ...patch };
  return `${src.slice(0, m.index)}[${formatToken(tok)}]${src.slice(m.index + m[0].length)}`;
}

// מקום ההכנסה בשורה: ממש לפני האות, אחרי אקורדים שכבר עומדים באותה נקודה
function insertAt(rows: string[], row: number, plainPos: number, token: string): { src: string; id: number } | null {
  const r = rows[row];
  if (r === undefined) return null;
  let plain = 0;
  let i = 0;
  while (i < r.length) {
    if (r[i] === "[") {
      const j = r.indexOf("]", i);
      if (j !== -1) {
        i = j + 1;
        continue;
      }
    }
    if (plain === plainPos) break;
    plain++;
    i++;
  }
  // אחרי ההכנסה האקורד נמצא במקום חדש ברצף, ולכן ה-id שלו משתנה
  const before = [...rows.slice(0, row), r.slice(0, i)].join("\n");
  rows[row] = `${r.slice(0, i)}[${token}]${r.slice(i)}`;
  return { src: rows.join("\n"), id: (before.match(TOKEN_RE) ?? []).length };
}

/** מעביר אקורד לאות מסוימת: row הוא מספר השורה במקור, plainPos ההיסט של האות בשורה בלי אקורדים */
export function placeChord(
  src: string,
  id: number,
  row: number,
  plainPos: number,
): { src: string; id: number } {
  const clean = src.replace(/\r/g, "");
  const m = findToken(clean, id);
  if (!m || m.index === undefined) return { src, id };
  const tok = parseToken(m[1]);
  const rows = (clean.slice(0, m.index) + clean.slice(m.index + m[0].length)).split("\n");
  return insertAt(rows, row, plainPos, formatToken({ ...tok, exact: true })) ?? { src, id };
}

/** מוסיף סימן חדש (אקורד או "/") בשורה ובהיסט נתונים. exact: צמוד לאות, אחרת מעל תחילת המילה */
export function addMark(
  src: string,
  row: number,
  plainPos: number,
  name: string,
  exact: boolean,
): { src: string; id: number } | null {
  return insertAt(src.replace(/\r/g, "").split("\n"), row, plainPos, formatToken({ name, exact, nudge: 0 }));
}

export function removeChord(src: string, id: number): string {
  const clean = src.replace(/\r/g, "");
  const m = findToken(clean, id);
  if (!m || m.index === undefined) return src;
  return clean.slice(0, m.index) + clean.slice(m.index + m[0].length);
}

export function transposeKey(key: string | null | undefined, by: number) {
  if (!key) return key;
  const m = /^([A-G][#b]?)(.*)$/.exec(key.trim());
  return m ? `${transposeChord(m[1], by)}${m[2]}` : key;
}

export function readChord(src: string, id: number | null): ChordToken | null {
  if (id === null) return null;
  const m = findToken(src.replace(/\r/g, ""), id);
  return m ? parseToken(m[1]) : null;
}
