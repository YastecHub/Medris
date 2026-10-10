/**
 * compress-image.js
 * -----------------------------------------------------------------------
 * Zero-dependency, browser-native image compression using the Canvas API.
 * Drop this into a <script> tag (or import as a module) — no bundler,
 * no npm install. This is the version that actually runs in Levromart's
 * current stack (plain HTML + vanilla JS, no build step).
 *
 * Usage:
 *   const compressed = await compressImage(file);
 *   await supabase.storage.from('bucket').upload(path, compressed);
 *
 * See the bottom of this file for a complete <input type="file"> +
 * Supabase upload example.
 * -----------------------------------------------------------------------
 */

/**
 * @typedef {Object} CompressImageOptions
 * @property {number} [maxWidth=1600]        Max output width in px (aspect ratio preserved).
 * @property {number} [maxHeight=1600]       Max output height in px (aspect ratio preserved).
 * @property {number} [quality=0.75]         Initial encode quality, 0..1.
 * @property {number} [minQuality=0.4]       Floor for the quality step-down loop — never goes below this.
 * @property {'image/webp'|'image/jpeg'} [preferredFormat='image/webp']
 *   Target format. Automatically falls back to JPEG if the browser can't
 *   actually encode WebP (some older engines silently no-op to PNG instead
 *   of erroring, so we verify the real output type, not just try/catch).
 * @property {number} [skipIfUnderBytes=150*1024]
 *   If the source file is already this small or smaller, return it untouched.
 * @property {number} [targetMaxBytes=300*1024]
 *   Desired output ceiling. If the first pass comes in over this, quality is
 *   stepped down (down to minQuality) to try to hit it. Not a hard
 *   guarantee — a very busy/large photo may still land a bit over rather
 *   than being crushed to visible mush.
 * @property {number} [qualityStep=0.1]      How much quality drops per retry.
 * @property {number} [maxAttempts=4]        Max quality step-downs before giving up.
 */

/** @type {CompressImageOptions} */
const DEFAULT_OPTIONS = {
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

/**
 * Feature-detects real WebP *encoding* support (not just decoding).
 * Some older browsers accept "image/webp" in toBlob()/toDataURL() without
 * throwing, but silently return a PNG instead — checking the resulting
 * blob's actual .type is the only reliable test.
 * @returns {Promise<boolean>}
 */
let _webpEncodeSupport = null;
function supportsWebpEncoding() {
  if (_webpEncodeSupport !== null) return _webpEncodeSupport;
  _webpEncodeSupport = new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    if (!canvas.toBlob) { resolve(false); return; }
    canvas.toBlob((blob) => resolve(!!blob && blob.type === "image/webp"), "image/webp");
  });
  return _webpEncodeSupport;
}

/**
 * Decodes a File/Blob into a drawable ImageBitmap, respecting EXIF
 * orientation so a photo taken sideways on a phone doesn't end up rotated
 * after compression. Falls back to an <img>/ObjectURL for browsers without
 * createImageBitmap (rare — pre-2018 Safari).
 * @param {File|Blob} file
 * @returns {Promise<{ image: ImageBitmap|HTMLImageElement, width: number, height: number, cleanup: () => void }>}
 */
async function decodeImageRespectingOrientation(file) {
  if (typeof createImageBitmap === "function") {
    try {
      // `imageOrientation: 'from-image'` is the explicit, spec-correct way
      // to apply the file's own EXIF orientation tag during decode, so the
      // pixels we draw to canvas are already right-side-up.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch (_) {
      // Some browsers throw on the options object for non-image blobs or
      // unsupported formats — fall through to the <img> path below.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image."));
      el.src = url;
    });
    return {
      image: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Compresses an image File/Blob for upload: resizes to fit within
 * maxWidth/maxHeight, re-encodes as WebP (or JPEG if WebP isn't supported
 * or explicitly requested), and steps quality down if the result is still
 * over targetMaxBytes.
 *
 * Safe no-ops (returns the original file unchanged) for:
 *   - non-image files
 *   - SVGs (already tiny/vector, re-rasterizing would only make them worse)
 *   - files already at or under skipIfUnderBytes
 *
 * @param {File} file
 * @param {Partial<CompressImageOptions>} [options]
 * @returns {Promise<File>} A new File (same base name, new extension/type)
 *   ready to hand to supabase.storage.upload(), or the original File if
 *   compression was skipped or would not have helped.
 */
async function compressImage(file, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!file || !file.type || !file.type.startsWith("image/")) return file;
  if (file.type === "image/svg+xml") return file;
  if (file.size <= opts.skipIfUnderBytes) return file;

  let decoded;
  try {
    decoded = await decodeImageRespectingOrientation(file);
  } catch (_) {
    // If we can't even decode it, upload the original rather than failing
    // the whole flow over a compression nicety.
    return file;
  }

  try {
    const { image, width, height } = decoded;
    const scale = Math.min(1, opts.maxWidth / width, opts.maxHeight / height);
    let outW = Math.max(1, Math.round(width * scale));
    let outH = Math.max(1, Math.round(height * scale));

    const useWebp = opts.preferredFormat === "image/webp" && (await supportsWebpEncoding());
    const mimeType = useWebp ? "image/webp" : "image/jpeg";
    const ext = useWebp ? "webp" : "jpg";

    const renderAt = (w, h) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, w, h);
      return canvas;
    };

    let quality = opts.quality;
    let canvas = renderAt(outW, outH);
    let blob = await canvasToBlob(canvas, mimeType, quality);

    let attempts = 0;
    while (blob && blob.size > opts.targetMaxBytes && quality > opts.minQuality && attempts < opts.maxAttempts) {
      quality = Math.max(opts.minQuality, quality - opts.qualityStep);
      blob = await canvasToBlob(canvas, mimeType, quality);
      attempts += 1;
    }

    // Busy/detailed photos can still be over target even at the quality
    // floor -- no amount of re-encoding the same pixel count will fix that.
    // Shrinking the actual dimensions further (not just re-encoding) is what
    // gets genuinely large/noisy photos down to size instead of silently
    // shipping an oversized "compressed" file.
    let shrinkAttempts = 0;
    while (blob && blob.size > opts.targetMaxBytes && shrinkAttempts < 3 && Math.min(outW, outH) > 480) {
      outW = Math.max(1, Math.round(outW * 0.8));
      outH = Math.max(1, Math.round(outH * 0.8));
      canvas = renderAt(outW, outH);
      quality = Math.max(opts.minQuality, opts.quality - opts.qualityStep * 2);
      blob = await canvasToBlob(canvas, mimeType, quality);
      shrinkAttempts += 1;
    }

    if (!blob) return file; // Encoding failed outright — fall back to the original.

    // If, after all that, we still didn't beat the original file's size
    // (can happen with already-compressed or very small/simple images),
    // there's no point uploading a "compressed" file that's actually bigger.
    if (blob.size >= file.size) return file;

    const newName = renameExtension(file.name, ext);
    return new File([blob], newName, { type: mimeType, lastModified: Date.now() });
  } finally {
    decoded.cleanup();
  }
}

/** @returns {Promise<Blob|null>} */
function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

/** @returns {string} */
function renameExtension(filename, newExt) {
  const base = String(filename || "photo").replace(/\.[^./\\]+$/, "");
  return `${base}.${newExt}`;
}

// -----------------------------------------------------------------------
// Integration example: <input type="file"> -> compress -> Supabase upload
// -----------------------------------------------------------------------
//
// <input type="file" id="avatarInput" accept="image/*" />
//
// document.getElementById("avatarInput").addEventListener("change", async (evt) => {
//   const file = evt.target.files?.[0];
//   if (!file) return;
//
//   const originalKb = (file.size / 1024).toFixed(0);
//   const compressed = await compressImage(file, {
//     maxWidth: 1200,
//     maxHeight: 1200,
//     quality: 0.75,
//     targetMaxBytes: 250 * 1024,
//   });
//   const compressedKb = (compressed.size / 1024).toFixed(0);
//   console.log(`Image: ${originalKb}KB -> ${compressedKb}KB`);
//
//   const path = `avatars/${crypto.randomUUID()}-${compressed.name}`;
//   const { data, error } = await supabase.storage
//     .from("avatars")
//     .upload(path, compressed, {
//       contentType: compressed.type,
//       upsert: false,
//     });
//   if (error) {
//     console.error("Upload failed:", error.message);
//     return;
//   }
//   const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
//   console.log("Public URL:", pub.publicUrl);
// });

if (typeof module !== "undefined" && module.exports) {
  module.exports = { compressImage, supportsWebpEncoding };
}
