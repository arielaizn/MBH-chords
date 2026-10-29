// ייבוא דטרמיניסטי מ-tab4u: כל השיר, בלי שמודל מחליט כמה לקחת.
// הדף בנוי מטבלאות: שורות td.chords (אקורדים, מיושרים ברווחים) ושורות td.song (מילים).
// כל אקורד נצמד למילה שנמצאת באותה עמודה, וכותרות חלקים ("בית:", "פזמון:") נשמרות.

const BASE = "https://www.tab4u.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export type ImportedChart = {
  title: string;
  artist: string | null;
  key: string | null;
  direction: "rtl" | "ltr";
  sourceUrl: string;
  chordpro: string;
};

async function fetchText(url: string, ms = 10_000): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": UA, "Accept-Language": "he,en;q=0.8", Accept: "text/html" },
    });
    if (!r.ok) return null;
    const t = await r.text();
    return t.length > 4_000_000 ? null : t;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&lt;": "<", "&gt;": ">", "&#039;": "'", "&#39;": "'" };
const decode = (s: string) =>
  s
    .replace(/&(?:amp|quot|lt|gt|#0?39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));

// המרווחים האמיתיים בדף הם &nbsp;. שורות חדשות וטאבים הם הזחה של קוד המקור ולכן נמחקים.
// nbsp הופך לרווח רגיל לפני הסרת התגיות, כדי ששמירת העמודות תישאר מדויקת.
const cellText = (html: string) =>
  decode(html.replace(/[\r\n\t]+/g, "").replace(/&nbsp;/g, " ").replace(/<[^>]*>/g, "")).replace(
    /[ ‎‏]/g,
    " ",
  );

const CHORD = /^[A-G][#b]?[A-Za-z0-9#b+\-()]*(?:\/[A-G][#b]?)?$/;
const isChord = (t: string) => CHORD.test(t);

type Hit = { url: string; artist: string; title: string };

async function search(query: string): Promise<Hit[]> {
  const html = await fetchText(`${BASE}/resultsSimple?tab=songs&q=${encodeURIComponent(query)}`);
  if (!html) return [];
  const seen = new Set<string>();
  const hits: Hit[] = [];
  for (const m of html.matchAll(/href="(tabs\/songs\/\d+_[^"]+?\.html)"/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    let name: string;
    try {
      name = decodeURIComponent(m[1]).replace(/^tabs\/songs\/\d+_/, "").replace(/\.html$/, "");
    } catch {
      continue;
    }
    const [artist, ...rest] = name.split("_-_");
    hits.push({
      url: `${BASE}/${m[1]}`,
      artist: artist.replace(/_/g, " ").trim(),
      title: (rest.join(" - ") || artist).replace(/_/g, " ").trim(),
    });
  }
  return hits;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

// בוחר את התוצאות שמכילות את מילות החיפוש (בשם השיר או בשם האמן), לפי הסדר שהאתר החזיר
function rank(query: string, hits: Hit[]): Hit[] {
  const q = words(query);
  if (!q.length) return [];
  const need = Math.max(1, Math.ceil(q.length * 0.6));
  return hits
    .map((h, i) => {
      const hay = `${h.artist} ${h.title}`.toLowerCase();
      return { h, i, score: q.filter((w) => hay.includes(w)).length };
    })
    .filter((x) => x.score >= need)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.h);
}

function lineWithChords(lyricRaw: string, chordRow: string | null): string {
  const marks = chordRow
    ? [...chordRow.matchAll(/\S+/g)].filter((m) => isChord(m[0])).map((m) => ({ chord: m[0], at: m.index ?? 0 }))
    : [];
  const lyric = lyricRaw.replace(/\s+$/, "");
  if (!marks.length) return lyric.trim().replace(/\s{2,}/g, " ");

  const inserts = new Map<number, string[]>();
  const trailing: string[] = [];
  for (const { chord, at } of marks) {
    if (at >= lyric.length) {
      trailing.push(chord);
      continue;
    }
    let j = at;
    if (lyric[j] === " ") while (j < lyric.length && lyric[j] === " ") j++; // ברווח: למילה הבאה
    else while (j > 0 && lyric[j - 1] !== " ") j--; // באמצע מילה: לתחילתה
    if (j >= lyric.length) trailing.push(chord);
    else inserts.set(j, [...(inserts.get(j) ?? []), chord]);
  }
  let out = "";
  for (let i = 0; i < lyric.length; i++) {
    for (const c of inserts.get(i) ?? []) out += `[${c}]`;
    out += lyric[i];
  }
  for (const c of trailing) out += `[${c}]`;
  return out.replace(/\s{2,}/g, " ").trim();
}

const chordOnlyLine = (row: string) => {
  const chords = [...row.matchAll(/\S+/g)].map((m) => m[0]).filter(isChord);
  return chords.length ? chords.map((c) => `[${c}]`).join(" ") : null;
};

function parseSong(html: string): { chordpro: string; chords: string[] } | null {
  const start = html.indexOf('id="songContentTPL"');
  if (start < 0) return null;
  const ends = ['id="downInSongTable"', 'id="footerTable"']
    .map((k) => html.indexOf(k, start))
    .filter((i) => i > 0);
  const seg = html.slice(start, ends.length ? Math.min(...ends) : undefined);

  const out: string[] = [];
  const allChords: string[] = [];
  let pendingChords: string | null = null;
  let pendingBlank = false;

  const push = (line: string) => {
    // שורה ריקה בין קטעים, אבל לא מיד אחרי כותרת
    if (pendingBlank && out.length && out[out.length - 1] !== "" && !out[out.length - 1].startsWith("##")) {
      out.push("");
    }
    pendingBlank = false;
    out.push(line);
  };
  const flushChords = () => {
    if (pendingChords !== null) {
      const l = chordOnlyLine(pendingChords);
      if (l) {
        push(l);
        allChords.push(...[...l.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]));
      }
      pendingChords = null;
    }
  };

  const re = /<td class="(chords|song|tabs)"[^>]*>([\s\S]*?)<\/td>|<br\s*\/?>/gi;
  for (const m of seg.matchAll(re)) {
    if (!m[1]) {
      flushChords();
      pendingBlank = true;
      continue;
    }
    const kind = m[1];
    const text = cellText(m[2]);
    if (kind === "tabs") {
      flushChords();
    } else if (kind === "chords") {
      flushChords();
      pendingChords = text.trim() ? text : null;
    } else {
      const t = text.trim();
      if (!t) {
        flushChords();
      } else if (pendingChords === null && t.endsWith(":") && t.length <= 40) {
        pendingBlank = out.length > 0;
        push(`## ${t.replace(/[:\s]+$/, "")}`);
      } else {
        const line = lineWithChords(text, pendingChords);
        if (pendingChords) allChords.push(...[...line.matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]));
        pendingChords = null;
        push(line);
      }
    }
  }
  flushChords();
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.length ? { chordpro: out.join("\n"), chords: allChords } : null;
}

// סולם רק כשיש ודאות: האקורד האחרון בשיר הוא גם הנפוץ ביותר (בצורת משולש)
function guessKey(chords: string[]): string | null {
  const base = (c: string) => {
    const m = /^([A-G][#b]?)(m(?!aj))?/.exec(c.split("/")[0]);
    return m ? `${m[1]}${m[2] ?? ""}` : null;
  };
  const bases = chords.map(base).filter(Boolean) as string[];
  if (bases.length < 6) return null;
  const count = new Map<string, number>();
  for (const b of bases) count.set(b, (count.get(b) ?? 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return bases[bases.length - 1] === top ? top : null;
}

export async function importFromTab4u(query: string): Promise<ImportedChart | null> {
  const hits = rank(query, await search(query)).slice(0, 3);
  for (const hit of hits) {
    const html = await fetchText(hit.url);
    const parsed = html ? parseSong(html) : null;
    if (!parsed) continue;
    const lines = parsed.chordpro.split("\n").filter((l) => l && !l.startsWith("##"));
    // רף מינימלי: שיר אמיתי, לא קטע בודד
    if (lines.length < 6 || parsed.chords.length < 4) continue;
    const he = (parsed.chordpro.match(/[֐-׿]/g) ?? []).length;
    const en = (parsed.chordpro.replace(/\[[^\]]*\]/g, "").match(/[A-Za-z]/g) ?? []).length;
    return {
      title: hit.title,
      artist: hit.artist || null,
      key: guessKey(parsed.chords),
      direction: he >= en ? "rtl" : "ltr",
      sourceUrl: hit.url,
      chordpro: parsed.chordpro,
    };
  }
  return null;
}
