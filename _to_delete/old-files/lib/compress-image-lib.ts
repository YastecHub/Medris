/**
 * compress-image-lib.ts
 * -----------------------------------------------------------------------
 * Same compressImage(file, options) contract as compress-image.ts, but
 * implemented on top of the `browser-image-compression` npm package
 * instead of hand-rolled Canvas code.
 *
 *   npm install browser-image-compression
 *
 * Trade-off vs. the zero-dependency version:
 *   + Runs the resize/encode in a Web Worker by default (off the main
 *     thread — matters for large photos on low-end phones).
 *   + Has its own EXIF-aware orientation handling and iterative
 *     size-targeting already built in, so this wrapper is thin.
 *   - One more dependency to install/update/audit.
 *   - Pulls in its own WASM/worker bundle (small, but not zero).
 *
 * Use this one if you're already on a bundler (Vite/webpack/Next) and
 * don't mind the extra package. Use compress-image.ts/.js if you want
 * zero dependencies (e.g. Levromart's current no-build-step setup).
 * -----------------------------------------------------------------------
 */
import imageCompression from "browser-image-compression";
import type { Options as LibOptions } from "browser-image-compression";

export interface CompressImageOptions {
  /** Max width OR height, whichever is larger (the library uses a single square bound). Default 1600. */
  maxWidthOrHeight?: number;
  /** Initial encode quality, 0..1. Default 0.75. */
  quality?: number;
  /** Target format. Default 'image/webp'. */
  fileType?: "image/webp" | "image/jpeg";
  /** Return the original file untouched if it's already <= this size. Default 150KB. */
  skipIfUnderBytes?: number;
  /** Desired output ceiling in MB (the library's native unit). Default ~0.3MB (300KB). */
  maxSizeMB?: number;
  /** Run the heavy work in a Web Worker instead of the main thread. Default true. */
  useWebWorker?: boolean;
}

const DEFAULTS: Required<CompressImageOptions> = {
  maxWidthOrHeight: 1600,
  quality: 0.75,
  fileType: "image/webp",
  skipIfUnderBytes: 150 * 1024,
  maxSizeMB: 300 / 1024, // 300KB expressed in MB, the library's unit
  useWebWorker: true,
};

/**
 * Compresses an image File via browser-image-compression. Same skip
 * rules as the zero-dependency version: non-images, SVGs, and files
 * already under skipIfUnderBytes pass through untouched.
 */
export async function compressImage(file: File, options: CompressImageOptions = {}): Promise<File> {
  const opts: Required<CompressImageOptions> = { ...DEFAULTS, ...options };

  if (!file?.type?.startsWith("image/")) return file;
  if (file.type === "image/svg+xml") return file;
  if (file.size <= opts.skipIfUnderBytes) return file;

  const libOptions: LibOptions = {
    maxWidthOrHeight: opts.maxWidthOrHeight,
    maxSizeMB: opts.maxSizeMB,
    initialQuality: opts.quality,
    fileType: opts.fileType,
    useWebWorker: opts.useWebWorker,
    // The library already preserves EXIF orientation by re-drawing through
    // a canvas internally, same principle as the hand-rolled version.
  };

  try {
    const compressed = await imageCompression(file, libOptions);
    // Guard against the rare case where compression didn't actually help
    // (e.g. a small, already-optimized image) — never ship a "compressed"
    // file that's bigger than the original.
    return compressed.size < file.size ? compressed : file;
  } catch (err) {
    console.warn("[compressImage] browser-image-compression failed, uploading original:", err);
    return file;
  }
}
