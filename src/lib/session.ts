import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { cookies } from "next/headers";
import { refreshTokens, type ChatGptTokens } from "./chatgpt/auth";

// הסשן נשמר בעוגייה מוצפנת (AES-256-GCM) ומפוצלת לחתיכות, כי טוקן הגישה לבדו כבד.
// רענון הטוקן מחליף גם את ה-refresh token, ולכן הקריאות מהלקוח חייבות להיות סדרתיות.

const NAME = "cc_session";
const CHUNK = 3000;
const MAX_CHUNKS = 8;
const MAX_AGE = 60 * 60 * 24 * 30;

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET חסר או קצר מדי (לפחות 32 תווים)");
  }
  return createHash("sha256").update(secret).digest();
}

function seal(data: object): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}

function open<T>(value: string): T | null {
  try {
    const buf = Buffer.from(value, "base64url");
    const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    const dec = Buffer.concat([d.update(buf.subarray(28)), d.final()]);
    return JSON.parse(dec.toString("utf8")) as T;
  } catch {
    return null;
  }
}

const cookieOpts = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE,
});

export async function getSession(): Promise<ChatGptTokens | null> {
  const store = await cookies();
  let joined = "";
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const part = store.get(`${NAME}.${i}`)?.value;
    if (!part) break;
    joined += part;
  }
  return joined ? open<ChatGptTokens>(joined) : null;
}

// כותבים רק ב-route handler. ב-Server Component אסור להגדיר עוגיות.
export async function saveSession(tokens: ChatGptTokens): Promise<void> {
  const store = await cookies();
  const sealed = seal(tokens);
  const chunks = sealed.match(new RegExp(`.{1,${CHUNK}}`, "g")) ?? [];
  if (chunks.length > MAX_CHUNKS) throw new Error("הסשן גדול מדי");
  chunks.forEach((c, i) => store.set(`${NAME}.${i}`, c, cookieOpts()));
  for (let i = chunks.length; i < MAX_CHUNKS; i++) store.delete(`${NAME}.${i}`);
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  for (let i = 0; i < MAX_CHUNKS; i++) store.delete(`${NAME}.${i}`);
}

export class NotSignedIn extends Error {
  constructor() {
    super("לא מחובר");
  }
}

// בקשות מקבילות באותו רגע לא מרעננות פעמיים: ה-refresh token מוחלף בכל רענון,
// ורענון שני עם הישן ייכשל. מוגן רק בתוך אותה מופע שרת.
const inflight = new Map<string, Promise<ChatGptTokens>>();

// מחזיר טוקנים בתוקף, ומרענן ושומר מחדש אם נשארה פחות מדקה.
export async function getFreshTokens(): Promise<ChatGptTokens> {
  const s = await getSession();
  if (!s) throw new NotSignedIn();
  if (s.expiresAt - Date.now() > 60_000) return s;
  try {
    let p = inflight.get(s.refreshToken);
    if (!p) {
      p = refreshTokens(s.refreshToken).finally(() => {
        setTimeout(() => inflight.delete(s.refreshToken), 30_000);
      });
      inflight.set(s.refreshToken, p);
    }
    const fresh = await p;
    await saveSession(fresh);
    return fresh;
  } catch {
    await clearSession();
    throw new NotSignedIn();
  }
}
