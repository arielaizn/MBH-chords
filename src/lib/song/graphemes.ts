// מפצל טקסט לאותיות כפי שהעין רואה אותן: ניקוד ותווים משולבים נשארים צמודים לאות שלהם.
// i הוא ההיסט (UTF-16) של האות בתוך הטקסט, אותו מספר שנשמר באקורד שצמוד לאות.

export type Grapheme = { s: string; i: number };

let segmenter: Intl.Segmenter | null | undefined;

export function graphemes(text: string): Grapheme[] {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  }
  if (segmenter) return Array.from(segmenter.segment(text), (g) => ({ s: g.segment, i: g.index }));
  let i = 0;
  return Array.from(text, (s) => {
    const g = { s, i };
    i += s.length;
    return g;
  });
}
