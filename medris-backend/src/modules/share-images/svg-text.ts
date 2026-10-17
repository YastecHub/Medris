import opentype, { type Font, type Path } from "opentype.js";
import sharp from "sharp";
import { readStaticFile } from "../../config/static-files.js";

/**
 * Drawing helpers for the server-rendered images (share cards and
 * notification pictures). Text becomes vector paths through opentype.js, so
 * nothing depends on fonts installed on the server.
 */

export interface Fonts {
  bold: Font;
  semi: Font;
  med: Font;
}

let fonts: Fonts | null = null;

export function ogFonts(): Fonts {
  if (fonts) return fonts;
  const load = (file: string) => {
    const b = readStaticFile(`fonts/${file}`);
    return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  };
  fonts = { bold: load("Poppins-ExtraBold.ttf"), semi: load("Poppins-SemiBold.ttf"), med: load("Poppins-Medium.ttf") };
  return fonts;
}

export function ogWidth(font: Font, text: string, size: number): number {
  return font.getAdvanceWidth(text, size);
}

/** toPathData() can print exponents like 1e-7, which some SVG renderers reject mid-path; format every number plainly. */
export function ogPathData(p: Path): string {
  const n = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
  return p.commands
    .map((c) =>
      c.type === "Z"
        ? "Z"
        : c.type === "M" || c.type === "L"
          ? `${c.type}${n(c.x)} ${n(c.y)}`
          : c.type === "Q"
            ? `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`
            : `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`,
    )
    .join("");
}

export function ogText(font: Font, text: string, x: number, y: number, size: number, fill: string): string {
  return `<path d="${ogPathData(font.getPath(text, x, y, size))}" fill="${fill}"/>`;
}

/** Truncates with "..." so the text fits maxW. */
export function ogFit(font: Font, text: string, size: number, maxW: number): string {
  let t = String(text || "").trim();
  if (ogWidth(font, t, size) <= maxW) return t;
  while (t.length > 1 && ogWidth(font, t + "...", size) > maxW) t = t.slice(0, -1);
  return t.trim() + "...";
}

/** Word-wraps into at most maxLines lines; the last line is truncated if needed. */
export function ogWrap(font: Font, text: string, size: number, maxW: number, maxLines: number): string[] {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    const tryLine = cur ? cur + " " + w : w;
    if (ogWidth(font, tryLine, size) <= maxW) {
      cur = tryLine;
      continue;
    }
    if (cur) {
      lines.push(cur);
      cur = w;
    } else {
      lines.push(ogFit(font, w, size, maxW));
      cur = "";
    }
    if (lines.length === maxLines) {
      cur = "";
      const rest = words.slice(i).join(" ");
      lines[maxLines - 1] = ogFit(font, lines[maxLines - 1] + " " + rest, size, maxW);
      return lines;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    keep[maxLines - 1] = ogFit(font, lines.slice(maxLines - 1).join(" "), size, maxW);
    return keep;
  }
  return lines;
}

export function ogInitials(name: string): string {
  const w = String(name || "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!w.length) return "L";
  const first = w[0] as string;
  return ((first[0] || "") + (w.length > 1 ? (w[1] as string)[0] || "" : first[1] || "")).toUpperCase();
}

/** Stable hue (0-359) derived from a name, for initials avatars. */
export function ogHue(name: string): number {
  let h = 0;
  const n = String(name || "Levromart");
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
  return h;
}

/** The naira sign drawn as an N with two bars (the fonts have no ₦ glyph). */
export function ogNaira(f: Font, x: number, y: number, size: number, fill: string): { svg: string; width: number } {
  const N = ogPathData(f.getPath("N", x, y, size));
  const w = ogWidth(f, "N", size);
  const bar = (dy: number) => `<rect x="${x - size * 0.07}" y="${y - dy}" width="${w + size * 0.14}" height="${size * 0.085}" fill="${fill}"/>`;
  return { svg: `<path d="${N}" fill="${fill}"/>${bar(size * 0.43)}${bar(size * 0.27)}`, width: w };
}

/** Downloads an image (6 s timeout); null on any failure. */
export async function ogGrab(u: string | null | undefined): Promise<Buffer | null> {
  if (!u) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(u, { signal: ctl.signal });
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Crops an image into a D x D circle (PNG). */
export async function ogCircle(buf: Buffer, D: number, bg?: string): Promise<Buffer> {
  const mask = Buffer.from(`<svg width="${D}" height="${D}"><circle cx="${D / 2}" cy="${D / 2}" r="${D / 2}" fill="#fff"/></svg>`);
  return sharp(buf, { failOn: "none" })
    .rotate()
    .flatten({ background: bg || "#ffffff" })
    .resize(D, D, { fit: "cover" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

export function ogMoney(n: number | string): string {
  return Number(n).toLocaleString("en-NG", { maximumFractionDigits: 0 });
}
