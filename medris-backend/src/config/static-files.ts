import fs from "node:fs";
import path from "node:path";
import { optionalEnv } from "./env.js";

/**
 * Files the API reads from the web app's static output: the built index.html
 * (link previews), fonts and images (share cards, notification pictures).
 *
 * Production (Vercel): medris-frontend/dist, bundled into the function through
 * vercel.json `includeFiles`. Local: the same dist after `npm run build`, with
 * medris-frontend/public as a fallback for images and fonts. Override with
 * STATIC_ASSETS_DIR.
 */
function candidateDirs(): string[] {
  const cwd = process.cwd();
  return [
    optionalEnv("STATIC_ASSETS_DIR"),
    path.join(cwd, "medris-frontend", "dist"),
    path.join(cwd, "..", "medris-frontend", "dist"),
    path.join(cwd, "medris-frontend", "public"),
    path.join(cwd, "..", "medris-frontend", "public"),
  ].filter(Boolean);
}

/** Absolute path of a static file (e.g. "fonts/Poppins-Medium.ttf"). Throws if it cannot be found. */
export function staticFilePath(relative: string): string {
  for (const dir of candidateDirs()) {
    const file = path.join(dir, relative);
    if (fs.existsSync(file)) return file;
  }
  throw new Error(`Static file not found: ${relative}. Build medris-frontend first or set STATIC_ASSETS_DIR.`);
}

export function readStaticFile(relative: string): Buffer {
  return fs.readFileSync(staticFilePath(relative));
}
