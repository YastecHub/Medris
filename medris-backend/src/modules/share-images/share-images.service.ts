import sharp, { type OverlayOptions } from "sharp";
import { getDataContext } from "../../database/index.js";
import { SharingRepository } from "../../database/repositories/sharing.repository.js";
import { readStaticFile, staticFilePath } from "../../config/static-files.js";
import { ogCircle, ogFit, ogFonts, ogGrab, ogHue, ogInitials, ogMoney, ogNaira, ogText, ogWidth, ogWrap } from "./svg-text.js";

/**
 * Server-rendered images:
 *  - share cards (1200x630) for storefront / product / package links. Storefront:
 *    vendor logo (or initials) in the ring, name on the left. Product/package:
 *    item photo in the ring, name + price on the left, vendor along the bottom;
 *  - notification pictures (256x256): the person's / shop's photo or initials,
 *    or an event icon, with the small Levromart mark at the bottom-right.
 */

export type ImageResult = { kind: "image"; png: Buffer; cacheControl: string } | { kind: "redirect"; location: string; cacheControl?: string };

interface CardQuery {
  ogstore?: string;
  ogprod?: string;
  ogpkg?: string;
}


interface Listing {
  name?: string | null;
  sale_price?: number | null;
  discount_price?: number | null;
  rental_rate?: number | null;
  price?: number | null;
  photos?: string[] | null;
  vendor?: { business_name?: string | null; logo_url?: string | null } | null;
}

export async function renderShareCard(query: CardQuery): Promise<ImageResult> {
  try {
    const storeId = String(query.ogstore || "").trim();
    const productId = String(query.ogprod || "").trim();
    const packageId = String(query.ogpkg || "").trim();
    const W = 1200,
      H = 630,
      CX = 880,
      CY = 315,
      D = 392;
    const data = getDataContext();
    const F = ogFonts();
    let kind: "store" | "product" | "package" = "store";
    let name = "";
    let photo: string | null = null;
    let vendorName = "";
    let vendorLogo: string | null = null;
    let priceText = "";

    if (storeId) {
      const v = await data.asService((tx) => new SharingRepository(tx).storefront(storeId));
      name = v?.business_name || "Levromart storefront";
      photo = v?.logo_url || null;
      vendorName = name;
    } else if (productId) {
      kind = "product";
      const p: Listing | null = await data.asService((tx) => new SharingRepository(tx).product(productId));
      name = p?.name || "Levromart listing";
      photo = Array.isArray(p?.photos) && p.photos[0] ? p.photos[0] : null;
      vendorName = p?.vendor?.business_name || "";
      vendorLogo = p?.vendor?.logo_url || null;
      const sale = Number(p?.sale_price);
      const disc = Number(p?.discount_price);
      const price = disc > 0 && sale > 0 && disc < sale ? disc : sale > 0 ? sale : Number(p?.rental_rate) || 0;
      if (price > 0) priceText = ogMoney(price);
    } else if (packageId) {
      kind = "package";
      const p: Listing | null = await data.asService((tx) => new SharingRepository(tx).package(packageId));
      name = p?.name || "Levromart package";
      photo = Array.isArray(p?.photos) && p.photos[0] ? p.photos[0] : null;
      vendorName = p?.vendor?.business_name || "";
      vendorLogo = p?.vendor?.logo_url || null;
      if (Number(p?.price) > 0) priceText = ogMoney(p?.price as number);
    }

    const [photoBuf, logoBuf] = await Promise.all([ogGrab(photo), kind === "store" ? Promise.resolve(null) : ogGrab(vendorLogo)]);
    const layers: OverlayOptions[] = [];

    // Ring content: the photo, or initials on a tinted gradient.
    let centre: Buffer | null = null;
    if (photoBuf) {
      try {
        centre = await ogCircle(photoBuf, D);
      } catch {
        centre = null;
      }
    }
    if (!centre) {
      const who = kind === "store" ? name : vendorName || name;
      const h = ogHue(who);
      const ini = ogInitials(who);
      const size = 190;
      const w = ogWidth(F.bold, ini, size);
      const svg = `<svg width="${D}" height="${D}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,90%)"/><stop offset="1" stop-color="hsl(${h},60%,78%)"/></linearGradient><clipPath id="c"><circle cx="${D / 2}" cy="${D / 2}" r="${D / 2}"/></clipPath></defs><g clip-path="url(#c)"><rect width="${D}" height="${D}" fill="url(#g)"/>${ogText(F.bold, ini, (D - w) / 2, D / 2 + size * 0.36, size, `hsl(${h},55%,28%)`)}</g></svg>`;
      centre = await sharp(Buffer.from(svg)).png().toBuffer();
    }
    layers.push({ input: centre, left: CX - D / 2, top: CY - D / 2 });

    // Levromart badge on the ring.
    const B = 124;
    const iconBase = await sharp(staticFilePath("icon-512.png"))
      .resize(B - 16, B - 16)
      .composite([{ input: Buffer.from(`<svg width="${B - 16}" height="${B - 16}"><rect width="${B - 16}" height="${B - 16}" rx="26" fill="#fff"/></svg>`), blend: "dest-in" }])
      .png()
      .toBuffer();
    const badge = await sharp(Buffer.from(`<svg width="${B}" height="${B}"><rect width="${B}" height="${B}" rx="34" fill="#fff"/></svg>`))
      .composite([{ input: iconBase, left: 8, top: 8 }])
      .png()
      .toBuffer();
    layers.push({ input: badge, left: CX + 118, top: CY + 112 });

    // Left-hand text.
    let svg = "";
    const X = 70;
    if (kind === "store") {
      const size = 66;
      const lines = ogWrap(F.bold, name, size, 540, 2);
      lines.forEach((l, i) => {
        svg += ogText(F.bold, l, X, 250 + i * 78, size, "#ffffff");
      });
      svg += ogText(F.semi, "Verified vendor on LevroMart", X, 250 + lines.length * 78 + 20, 28, "#7dffbe");
    } else {
      let size = 58;
      let lines = ogWrap(F.bold, name, size, 540, 2);
      for (const s of [58, 50, 44]) {
        size = s;
        lines = ogWrap(F.bold, name, s, 540, 2);
        if (lines.join(" ").replace(/\.\.\.$/, "").length >= String(name).trim().length - 1 && !/\.\.\.$/.test(lines[lines.length - 1] ?? "")) break;
      }
      const lh = Math.round(size * 1.17);
      lines.forEach((l, i) => {
        svg += ogText(F.bold, l, X, 230 + i * lh, size, "#ffffff");
      });
      const y = 230 + lines.length * lh + 28;
      if (priceText) {
        const n = ogNaira(F.bold, X, y + 34, 54, "#5df0a5");
        svg += n.svg + ogText(F.bold, priceText, X + n.width + 14, y + 34, 54, "#5df0a5");
      }
      if (vendorName) {
        const R = 40,
          cy = 512;
        svg += ogText(F.med, "Sold by", X + 2 * R + 22, cy - 8, 22, "#a9d9c0");
        svg += ogText(F.semi, ogFit(F.semi, vendorName, 30, 470), X + 2 * R + 22, cy + 28, 30, "#ffffff");
        let face: Buffer | null = null;
        if (logoBuf) {
          try {
            face = await ogCircle(logoBuf, 2 * R - 8);
          } catch {
            face = null;
          }
        }
        const ring = Buffer.from(`<svg width="${2 * R}" height="${2 * R}"><circle cx="${R}" cy="${R}" r="${R}" fill="#fff"/></svg>`);
        layers.push({ input: ring, left: X, top: cy - R });
        if (face) layers.push({ input: face, left: X + 4, top: cy - R + 4 });
        else {
          const h = ogHue(vendorName);
          const ini = ogInitials(vendorName);
          const s2 = 34;
          const w2 = ogWidth(F.bold, ini, s2);
          const t = Buffer.from(
            `<svg width="${2 * R - 8}" height="${2 * R - 8}"><defs><clipPath id="c"><circle cx="${R - 4}" cy="${R - 4}" r="${R - 4}"/></clipPath></defs><g clip-path="url(#c)"><rect width="${2 * R}" height="${2 * R}" fill="hsl(${h},60%,84%)"/>${ogText(F.bold, ini, (2 * R - 8 - w2) / 2, R - 4 + s2 * 0.36, s2, `hsl(${h},55%,28%)`)}</g></svg>`,
          );
          layers.push({ input: await sharp(t).png().toBuffer(), left: X + 4, top: cy - R + 4 });
        }
      }
    }
    if (svg) layers.push({ input: Buffer.from(`<svg width="${W}" height="${H}">${svg}</svg>`), left: 0, top: 0 });

    const png = await sharp(staticFilePath("og-frame.png")).composite(layers).png({ compressionLevel: 8 }).toBuffer();
    return { kind: "image", png, cacheControl: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" };
  } catch (err) {
    console.error("Levromart share card error:", err);
    return { kind: "redirect", location: "/og-levromart.png" };
  }
}

const NICON_KINDS = new Set(["admin", "follow", "heart", "message", "order", "payment", "review"]);

/** Only public https hosts are fetched for notification pictures. */
function isSafeImageHost(u: string): boolean {
  let host = "";
  try {
    const pu = new URL(u);
    if (pu.protocol === "https:") host = pu.hostname;
  } catch {
    /* not a URL */
  }
  return !!host && !/^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(host) && !/\.(local|internal)$/i.test(host);
}

export async function renderNotificationIcon(query: { u?: string; n?: string; k?: string }): Promise<ImageResult> {
  try {
    const S = 256,
      B = 100;
    const u = String(query.u || "");
    const name = String(query.n || "").slice(0, 60);
    const k = String(query.k || "");
    let base: Buffer | null = null;
    const buf = isSafeImageHost(u) ? await ogGrab(u) : null;
    if (buf) {
      try {
        base = await ogCircle(buf, S);
      } catch {
        base = null;
      }
    }
    if (!base && NICON_KINDS.has(k)) base = await ogCircle(readStaticFile(`notif-icons/${k}.png`), S);
    if (!base && name) {
      const F = ogFonts();
      const h = ogHue(name);
      const ini = ogInitials(name);
      const size = 112;
      const w = ogWidth(F.bold, ini, size);
      const svg = `<svg width="${S}" height="${S}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,90%)"/><stop offset="1" stop-color="hsl(${h},60%,78%)"/></linearGradient></defs><circle cx="${S / 2}" cy="${S / 2}" r="${S / 2}" fill="url(#g)"/>${ogText(F.bold, ini, (S - w) / 2, S / 2 + size * 0.36, size, `hsl(${h},55%,28%)`)}</svg>`;
      base = await sharp(Buffer.from(svg)).png().toBuffer();
    }
    let png: Buffer;
    if (!base) {
      png = await sharp(staticFilePath("icon-512.png")).resize(S, S).png().toBuffer();
    } else {
      const ring = B + 12;
      const logo = await ogCircle(readStaticFile("icon-512.png"), B);
      const disc = Buffer.from(`<svg width="${ring}" height="${ring}"><circle cx="${ring / 2}" cy="${ring / 2}" r="${ring / 2}" fill="#fff"/></svg>`);
      png = await sharp(base)
        .composite([
          { input: disc, left: S - ring, top: S - ring },
          { input: logo, left: S - ring + 6, top: S - ring + 6 },
        ])
        .png()
        .toBuffer();
    }
    return { kind: "image", png, cacheControl: "public, max-age=86400, s-maxage=604800, immutable" };
  } catch {
    return { kind: "redirect", location: "/levromart-notification-icon.png", cacheControl: "no-store" };
  }
}
