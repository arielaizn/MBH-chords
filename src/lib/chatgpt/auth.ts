// התחברות עם מנוי ChatGPT דרך זרימת device-code של Codex.
// הכתובות והשדות נבדקו מול openai/codex (codex-rs/login). זה מסלול לא מתועד ולא נתמך רשמית,
// ו-OpenAI יכולה לשנות אותו בכל רגע.

const ISSUER = process.env.CHATGPT_ISSUER ?? "https://auth.openai.com";
export const CLIENT_ID =
  process.env.CHATGPT_CLIENT_ID ?? "app_EMoamEEZ73f0CkXaXp7hrann";

export type ChatGptTokens = {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  email: string | null;
  expiresAt: number;
};

export type DeviceStart = {
  deviceAuthId: string;
  userCode: string;
  intervalSec: number;
  verificationUrl: string;
};

type JwtPayload = Record<string, unknown> & {
  exp?: number;
  email?: string;
  "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
  "https://api.openai.com/profile"?: { email?: string };
};

function decodeJwt(token: string): JwtPayload {
  const part = token.split(".")[1];
  if (!part) throw new Error("טוקן לא תקין");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function tokensFrom(res: {
  id_token?: string;
  access_token: string;
  refresh_token: string;
}): ChatGptTokens {
  const access = decodeJwt(res.access_token);
  const id = res.id_token ? decodeJwt(res.id_token) : {};
  const accountId =
    id["https://api.openai.com/auth"]?.chatgpt_account_id ??
    access["https://api.openai.com/auth"]?.chatgpt_account_id;
  if (!accountId) throw new Error("לא נמצא מזהה חשבון ChatGPT בטוקן");
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    accountId,
    email:
      (id.email as string | undefined) ??
      access["https://api.openai.com/profile"]?.email ??
      null,
    expiresAt: (access.exp ?? Math.floor(Date.now() / 1000) + 3000) * 1000,
  };
}

export async function startDeviceLogin(): Promise<DeviceStart> {
  const r = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (r.status === 404) {
    throw new Error("התחברות בקוד מכשיר לא זמינה כרגע אצל OpenAI");
  }
  if (!r.ok) throw new Error(`פתיחת התחברות נכשלה (${r.status})`);
  const j = (await r.json()) as {
    device_auth_id: string;
    user_code?: string;
    usercode?: string;
    interval?: string | number;
  };
  return {
    deviceAuthId: j.device_auth_id,
    userCode: (j.user_code ?? j.usercode) as string,
    intervalSec: Number(j.interval) || 5,
    verificationUrl: `${ISSUER}/codex/device`,
  };
}

export type PollResult =
  | { status: "pending" }
  | { status: "ok"; tokens: ChatGptTokens };

export async function pollDeviceLogin(
  deviceAuthId: string,
  userCode: string,
): Promise<PollResult> {
  const r = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
  });
  if (r.status === 403 || r.status === 404) return { status: "pending" };
  if (!r.ok) throw new Error(`בדיקת האישור נכשלה (${r.status})`);
  const grant = (await r.json()) as {
    authorization_code: string;
    code_verifier: string;
  };

  const ex = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: grant.authorization_code,
      redirect_uri: `${ISSUER}/deviceauth/callback`,
      client_id: CLIENT_ID,
      code_verifier: grant.code_verifier,
    }),
  });
  if (!ex.ok) throw new Error(`החלפת הקוד בטוקן נכשלה (${ex.status})`);
  return { status: "ok", tokens: tokensFrom(await ex.json()) };
}

export async function refreshTokens(
  refreshToken: string,
): Promise<ChatGptTokens> {
  const r = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "openid profile email",
    }),
  });
  if (!r.ok) throw new Error(`רענון ההתחברות נכשל (${r.status})`);
  const j = (await r.json()) as {
    id_token?: string;
    access_token: string;
    refresh_token?: string;
  };
  return tokensFrom({ ...j, refresh_token: j.refresh_token ?? refreshToken });
}
