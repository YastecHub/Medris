/**
 * compress-image.ts
 * -----------------------------------------------------------------------
 * TypeScript reference version of the zero-dependency Canvas-based
 * compressor (see compress-image.js for the plain-JS version that
 * actually runs in Levromart today, since this project has no build
 * step yet). Same behavior, fully typed.
 * -----------------------------------------------------------------------
 */

export interface CompressImageOptions {
  /** Max output width in px (aspect ratio preserved). Default 1600. */
  maxWidth?: number;
  /** Max output height in px (aspect ratio preserved). Default 1600. */
  maxHeight?: number;
  /** Initial encode quality, 0..1. Default 0.75. */
  quality?: number;
  /** Floor for the quality step-down loop. Default 0.4. */
  minQuality?: number;
  /** Target format; falls back to JPEG if WebP encoding isn't actually supported. Default 'image/webp'. */
  preferredFormat?: "image/webp" | "image/jpeg";
  /** Return the original file untouched if it's already <= this size. Default 150KB. */
  skipIfUnderBytes?: number;
  /** Desired output ceiling; quality steps down (to minQuality) trying to hit this. Default 300KB. */
  targetMaxBytes?: number;
  /** How much quality drops per retry. Default 0.1. */
  qualityStep?: number;
  /** Max quality step-downs before giving up. Default 4. */
  maxAttempts?: number;
}

const DEFAULT_OPTIONS: Required<CompressImageOptions> = {
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.75,
  minQuality: 0.4,
  preferredFormat: "image/webp",
  skipIfUnderBytes: 150 * 1024,
  targetMaxBytes: 300 * 1024,
  qualityStep: 0.1,
  maxAttempts: 4,
};

interface DecodedImage {
  image: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  cleanup: () => void;
}

let webpEncodeSupport: Promise<boolean> | null = null;

/** Feature-detects real WebP *encoding* support (checks the actual output blob type, not just whether toBlob() throws). */
function supportsWebpEncoding(): Promise<boolean> {
  if (webpEncodeSupport) return webpEncodeSupport;
  webpEncodeSupport = new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    canvas.toBlob((blob) => resolve(!!blob && blob.type === "image/webp"), "image/webp");
  });
  return webpEncodeSupport;
}

/** Decodes a File/Blob respecting EXIF orientation, so a phone photo taken sideways doesn't end up rotated after compression. */
async function decodeImageRespectingOrientation(file: File | Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
    } catch {
      // Fall through to the <img> path for formats/browsers createImageBitmap can't handle.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image."));
      el.src = url;
    });
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, cleanup: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

function renameExtension(filename: string, newExt: string): string {
  const base = (filename || "photo").replace(/\.[^./\\]+$/, "");
  return `${base}.${newExt}`;
}

/**
 * Compresses an image File for upload: resizes to fit within
 * maxWidth/maxHeight, re-encodes as WebP (or JPEG), and steps quality
 * down if still over targetMaxBytes. Returns the original File unchanged
 * for non-images, SVGs, already-small files, or if compression wouldn't
 * actually reduce size.
 */
export async function compressImage(file: File, options: CompressImageOptions = {}): Promise<File> {
  const opts: Required<CompressImageOptions> = { ...DEFAULT_OPTIONS, ...options };

  if (!file?.type?.startsWith("image/")) return file;
  if (file.type === "image/svg+xml") return file;
  if (file.size <= opts.skipIfUnderBytes) return file;

  const decoded = await decodeImageRespectingOrientation(file).catch(() => null);
  if (!decoded) return file;

  try {
    const { image, width, height } = decoded;
    const scale = Math.min(1, opts.maxWidth / width, opts.maxHeight / height);
    const outW = Math.max(1, Math.round(width * scale));
    const outH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, outW, outH);

    const useWebp = opts.preferredFormat === "image/webp" && (await supportsWebpEncoding());
    const mimeType = useWebp ? "image/webp" : "image/jpeg";
    const ext = useWebp ? "webp" : "jpg";

    let quality = opts.quality;
    let blob = await canvasToBlob(canvas, mimeType, quality);

    let attempts = 0;
    while (blob && blob.size > opts.targetMaxBytes && quality > opts.minQuality && attempts < opts.maxAttempts) {
      quality = Math.max(opts.minQuality, quality - opts.qualityStep);
      blob = await canvasToBlob(canvas, mimeType, quality);
      attempts += 1;
    }

    if (!blob || blob.size >= file.size) return file;

    return new File([blob], renameExtension(file.name, ext), { type: mimeType, lastModified: Date.now() });
  } finally {
    decoded.cleanup();
  }
}
