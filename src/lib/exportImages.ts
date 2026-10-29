import { toPng } from "html-to-image";
import JSZip from "jszip";

// מייצא כל עמוד (צומת עם data-sheet-page) ל-PNG בגודל המלא שלו, בלי קשר לקנה המידה של התצוגה.

export async function nodeToBlob(node: HTMLElement): Promise<Blob> {
  const opts = {
    width: node.offsetWidth,
    height: node.offsetHeight,
    pixelRatio: 1,
    cacheBust: true,
    style: { transform: "none" },
  };
  await document.fonts.ready;
  await toPng(node, opts).catch(() => null); // חימום: הקריאה הראשונה לפעמים מפספסת פונטים ותמונות
  const dataUrl = await toPng(node, opts);
  return (await fetch(dataUrl)).blob();
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const safeName = (s: string) =>
  s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "song";

export async function downloadPage(node: HTMLElement, title: string, n: number) {
  saveBlob(await nodeToBlob(node), `${safeName(title)}-${n}.png`);
}

export async function addNodesToZip(zip: JSZip, folder: string, nodes: HTMLElement[]) {
  const dir = folder ? zip.folder(safeName(folder))! : zip;
  for (let i = 0; i < nodes.length; i++) {
    dir.file(`${safeName(folder || "song")}-${i + 1}.png`, await nodeToBlob(nodes[i]));
  }
}

export async function downloadZip(nodes: HTMLElement[], title: string) {
  const zip = new JSZip();
  await addNodesToZip(zip, "", nodes.map((n) => n));
  saveBlob(await zip.generateAsync({ type: "blob" }), `${safeName(title)}.zip`);
}

export { JSZip };
