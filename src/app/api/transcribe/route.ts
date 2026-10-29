import { guard } from "@/lib/api";
import { transcribeAudio } from "@/lib/chatgpt/transcribe";
import { getFreshTokens } from "@/lib/session";

export const maxDuration = 60;

const MAX_BYTES = 4.4 * 1024 * 1024; // מתחת לתקרת גוף הבקשה בפונקציות של Vercel

// תמלול הקלטה קצרה מהמיקרופון לטקסט.
export async function POST(req: Request) {
  return guard(async () => {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return Response.json({ error: "לא התקבלה הקלטה" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: "ההקלטה ארוכה מדי, נסה להקליט קצר יותר" }, { status: 413 });
    }
    const lang = form?.get("lang") === "en" ? "en" : "he";
    const tokens = await getFreshTokens();
    const text = await transcribeAudio({ tokens, file, lang, signal: req.signal });
    return Response.json({ text });
  });
}
