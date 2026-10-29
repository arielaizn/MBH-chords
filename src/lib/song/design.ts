import { z } from "zod";

// הגדרות העיצוב של התמונות. אותו מבנה משמש את הממשק ואת ה-AI שמשנה עיצוב לפי בקשה בצ'אט.

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const DesignSchema = z.object({
  theme: z.enum(["navy", "cream"]),
  format: z.enum(["feed", "story"]),
  fontScale: z.number().min(0.7).max(1.4),
  chordScale: z.number().min(0.7).max(1.5),
  lineGap: z.enum(["tight", "normal", "airy"]),
  // עמודה אחת, או שתיים באותו עמוד עם קו הפרדה ביניהן
  columns: z.union([z.literal(1), z.literal(2)]),
  showMeta: z.boolean(),
  accentColor: hex.nullable(),
  chordColor: hex.nullable(),
  bgColor: hex.nullable(),
  textColor: hex.nullable(),
});

export type Design = z.infer<typeof DesignSchema>;

export const DEFAULT_DESIGN: Design = {
  theme: "navy",
  format: "feed",
  fontScale: 1,
  chordScale: 1,
  lineGap: "normal",
  columns: 1,
  showMeta: true,
  accentColor: null,
  chordColor: null,
  bgColor: null,
  textColor: null,
};

// ממזג תיקון חלקי שה-AI החזיר: שדה לא תקין נזרק, והשאר נכנסים.
export function mergeDesign(base: Design, patch: unknown): Design {
  if (!patch || typeof patch !== "object") return base;
  const shape = DesignSchema.shape as Record<string, z.ZodType>;
  const next: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const r = shape[k]?.safeParse(v);
    if (r?.success) next[k] = r.data;
  }
  return next as Design;
}

export const DESIGN_FIELDS_HELP = `Design fields (all optional, return only the ones that change):
- theme: "navy" (dark blue with gold, default) or "cream" (light)
- format: "feed" (post 4:5) or "story" (9:16)
- fontScale: lyrics size, 0.7 to 1.4 (default 1)
- chordScale: chord size, 0.7 to 1.5 (default 1)
- lineGap: "tight", "normal" or "airy"
- columns: 1 or 2 (two text columns on the same page, with a divider line between them)
- showMeta: true or false (the key / capo / BPM chips under the title)
- accentColor, chordColor, bgColor, textColor: "#RRGGBB" or null to reset to the theme
Keep text readable: strong contrast between textColor/chordColor and bgColor.`;

function channel(v: number) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(color: string): number {
  const n = parseInt(color.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
