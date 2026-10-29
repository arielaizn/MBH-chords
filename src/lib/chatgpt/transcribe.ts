import type { ChatGptTokens } from "./auth";

// תמלול אודיו בשרת, במודל חזק בהרבה מתמלול הדפדפן. הספק נבחר לפי המפתחות שמוגדרים, לפי הסדר:
// 1. GROQ_API_KEY: Whisper large-v3 של Groq. יש להם שכבה חינמית (מפתח בחינם, בלי כרטיס אשראי).
// 2. OPENAI_API_KEY: ה-API הרשמי של OpenAI (בתשלום).
// 3. בלי מפתח: המנוי של המשתמש המחובר ל-ChatGPT, באותו מסלול שבו ChatGPT עצמו מתמלל הקלטות.
//    המסלול הזה לא מתועד ועלול להשתנות.

const CHATGPT_URL = process.env.CHATGPT_TRANSCRIBE_URL ?? "https://chatgpt.com/backend-api/transcribe";
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = process.env.GROQ_TRANSCRIBE_MODEL ?? "whisper-large-v3";
const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_MODEL = process.env.TRANSCRIBE_MODEL ?? "gpt-4o-transcribe";

// רמז למתמלל: על מה מדברים ואילו מילים צפויות. בבדיקה הוא תיקן "תהלה חצי טון" ל"תעלה חצי טון".
const HINT_HE =
  "שם של שיר או מילות שיר בעברית, או בקשה לשנות גיליון אקורדים: אקורדים, סולם, קאפו, פזמון, בית, גשר, חצי טון, Am, Dm, Em, G, C, F.";
const HINT_EN = "A song title, song lyrics, or a request to edit a chord sheet: chords, key, capo, chorus, verse, bridge.";

// ברעש Whisper לפעמים מקריא בחזרה את הרמז. טקסט שכולו מילים מהרמז אינו דיבור.
function echoesHint(text: string, hint: string): boolean {
  const norm = (t: string) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const words = norm(text);
  const known = new Set(norm(hint));
  return words.length >= 4 && words.every((w) => known.has(w));
}

// Whisper ממציא טקסט כשיש שקט או רעש. מסננים קטעים שהוא עצמו לא בטוח בהם, וכתוביות מומצאות מוכרות.
const JUNK =
  /תודה( רבה)?( לכם)?( על)?( ה?צפייה| שצפיתם| שהקשבתם)?|כתוביות|תרגום[ :]|הירשמו|לייק|Thanks for watching|Subtitles|Amara\.org/gi;

type Segment = { text?: string; no_speech_prob?: number; avg_logprob?: number; compression_ratio?: number };

function cleanSegments(segments: Segment[], hint: string): string {
  const kept = segments.filter(
    (g) =>
      !((g.no_speech_prob ?? 0) > 0.6 && (g.avg_logprob ?? 0) < -0.8) && // כנראה שקט
      (g.compression_ratio ?? 0) < 2.4, // חזרות אינסופיות
  );
  const text = kept.map((g) => g.text ?? "").join("").trim();
  // אם כל מה שנשאר הוא רק ביטוי מומצא, זה לא דיבור אמיתי
  if (echoesHint(text, hint)) return "";
  return text.replace(JUNK, "").replace(/[\s.,!?-]/g, "") ? text : "";
}

export async function transcribeAudio(o: {
  tokens: ChatGptTokens;
  file: File;
  /** קוד שפה בן שתי אותיות: he או en */
  lang: string;
  signal?: AbortSignal;
}): Promise<string> {
  const form = new FormData();
  form.set("file", o.file, o.file.name || "speech.webm");
  form.set("language", o.lang);

  const hint = o.lang === "he" ? HINT_HE : HINT_EN;
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const apiKey = groqKey || openaiKey;
  let res: Response;
  if (apiKey) {
    form.set("model", groqKey ? GROQ_MODEL : OPENAI_MODEL);
    // ב-Groq מבקשים גם נתוני ביטחון לכל קטע, כדי לסנן שקט ורעש
    form.set("response_format", groqKey ? "verbose_json" : "json");
    form.set("temperature", "0");
    form.set("prompt", hint);
    res = await fetch(groqKey ? GROQ_URL : OPENAI_URL, {
      method: "POST",
      signal: o.signal,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    res = await fetch(CHATGPT_URL, {
      method: "POST",
      signal: o.signal,
      headers: {
        Authorization: `Bearer ${o.tokens.accessToken}`,
        "chatgpt-account-id": o.tokens.accountId,
        originator: "codex_cli_rs",
      },
      body: form,
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429 && groqKey) {
      throw new Error("עברת את מכסת התמלול החינמית לעכשיו. נסה שוב בעוד דקה.");
    }
    throw new Error(`התמלול נכשל (${res.status}): ${body.slice(0, 200)}`);
  }
  const j = (await res.json().catch(() => null)) as { text?: unknown; segments?: Segment[] } | null;
  if (Array.isArray(j?.segments)) return cleanSegments(j.segments, hint);
  return typeof j?.text === "string" ? j.text.trim() : "";
}
