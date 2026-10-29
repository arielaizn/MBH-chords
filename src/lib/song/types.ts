import { z } from "zod";

export const SongSchema = z.object({
  title: z.string().min(1),
  artist: z.string().nullish(),
  key: z.string().nullish(),
  capo: z.number().nullish(),
  bpm: z.number().nullish(),
  timeSignature: z.string().nullish(),
  direction: z.enum(["rtl", "ltr"]).default("rtl"),
  source: z.enum(["web", "ai", "image"]),
  sourceUrl: z.string().nullish(),
  notes: z.string().nullish(),
  chordpro: z.string().min(1),
});

export type Song = z.infer<typeof SongSchema>;

export type FindResult =
  | { found: true; song: Song }
  | { found: false; reason: string };

// שינויים שה-AI מבקש להחיל: רק השדות שהשתנו, בשיר ובעיצוב.
export type ReviseResult = {
  reply: string;
  song: Partial<Song>;
  design: Record<string, unknown>;
};

// lyricsMissing: אין מילים בשיר, זה תרשים אקורדים בלבד (ארבעה אקורדים בשורה)
export type ComposeResult = { song: Song; lyricsMissing: boolean };
