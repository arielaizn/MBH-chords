import type { ChatGptTokens } from "./auth";

// קריאה ל-backend של Codex (Responses API) עם המנוי של המשתמש.
// מסלול לא מתועד: הכותרות והגוף נלקחו מהתנהגות Codex CLI והם עלולים להשתנות.

const BASE =
  process.env.CODEX_BASE_URL ?? "https://chatgpt.com/backend-api/codex";
export const MODEL = process.env.CODEX_MODEL ?? "gpt-6.1-sol";
const WEB_SEARCH_TOOL = process.env.CODEX_WEB_SEARCH_TOOL ?? "web_search";

export type InputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

type Opts = {
  tokens: ChatGptTokens;
  instructions: string;
  parts: InputPart[];
  webSearch?: boolean;
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
};

export async function codexText(o: Opts): Promise<string> {
  const res = await fetch(`${BASE}/responses`, {
    method: "POST",
    signal: o.signal,
    headers: {
      Authorization: `Bearer ${o.tokens.accessToken}`,
      "chatgpt-account-id": o.tokens.accountId,
      originator: "codex_cli_rs",
      "OpenAI-Beta": "responses=experimental",
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: MODEL,
      instructions: o.instructions,
      input: [{ type: "message", role: "user", content: o.parts }],
      tools: o.webSearch ? [{ type: WEB_SEARCH_TOOL }] : [],
      tool_choice: "auto",
      parallel_tool_calls: false,
      reasoning: { effort: o.effort ?? "medium" },
      store: false,
      stream: true,
      include: [],
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`ChatGPT החזיר ${res.status}: ${body.slice(0, 400)}`);
  }

  const messages: string[] = [];
  let deltas = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";

  const handle = (raw: string) => {
    const data = raw
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    if (!data || data === "[DONE]") return;
    let ev: {
      type?: string;
      delta?: string;
      item?: { type?: string; content?: { type?: string; text?: string }[] };
      response?: { error?: { message?: string } };
      message?: string;
    };
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    if (ev.type === "response.output_text.delta" && ev.delta) {
      deltas += ev.delta;
    } else if (
      ev.type === "response.output_item.done" &&
      ev.item?.type === "message"
    ) {
      const text = (ev.item.content ?? [])
        .filter((c) => c.type === "output_text")
        .map((c) => c.text ?? "")
        .join("");
      if (text) messages.push(text);
    } else if (ev.type === "response.failed") {
      throw new Error(ev.response?.error?.message ?? "ChatGPT החזיר כשל");
    } else if (ev.type === "error") {
      throw new Error(ev.message ?? "ChatGPT החזיר שגיאה");
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      handle(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
    }
  }
  if (buf.trim()) handle(buf);

  // עם חיפוש ברשת המודל כותב גם הודעות ביניים, והתשובה הסופית היא ההודעה האחרונה.
  return messages.at(-1) ?? deltas;
}
