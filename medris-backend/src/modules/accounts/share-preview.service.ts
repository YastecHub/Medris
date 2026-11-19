import fs from "node:fs";
import { getDataContext } from "../../database/index.js";
import { SharingRepository } from "../../database/repositories/sharing.repository.js";
import { staticFilePath } from "../../config/static-files.js";
import { escapeAttr } from "../../lib/format.js";

/**
 * Link previews for shared storefront / product / package links.
 *
 * WhatsApp/Facebook/X crawlers read the raw HTML <meta> tags of a shared URL
 * and never run the app's JavaScript. For `/?storefront=<id>`,
 * `/?product=<id>`, `/?package=<id>` and the short forms `/s/<id>`,
 * `/p/<id>`, `/k/<id>` this serves the built app's index.html with the default
 * meta tags swapped for that item's name, description and share card image.
 * Real browsers get the same app; on short links a <base> tag and a
 * history.replaceState keep the app on "/?<kind>=<id>".
 */

export function readAppHtml(): string {
  return fs.readFileSync(staticFilePath("index.html"), "utf8");
}

export interface PreviewMeta {
  title: string;
  description: string;
  image: string | null;
  pageUrl: string;
}

export function applyPreviewMeta(html: string, meta: PreviewMeta): string {
  const t = escapeAttr(meta.title);
  const d = escapeAttr(meta.description || "");
  const u = escapeAttr(meta.pageUrl);
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`);
  out = out.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${d}">`);
  out = out.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${t}">`);
  out = out.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${d}">`);
  out = out.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${u}">`);
  out = out.replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${t}">`);
  out = out.replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${d}">`);
  if (meta.image) {
    const img = escapeAttr(meta.image);
    out = out.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${img}">`);
    out = out.replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${img}">`);
  }
  return out;
}

export interface PreviewQuery {
  storefront?: string;
  product?: string;
  package?: string;
  /** A Levi chat (or one reply) shared from the app: /l/<token>. */
  levi?: string;
}

/**
 * The title, description and picture of a shared storefront, product, package or Levi chat, for a site hosted apart
 * from this server (Cloudflare Pages): its share-link function asks here and writes them into the app's page.
 * `appOrigin` is the site the link was opened on (page addresses); picture cards are drawn by this server.
 * `query` is what the opened page should switch its address to (e.g. "storefront=<id>"), so the app opens that screen.
 */
export async function sharePreviewMeta(query: PreviewQuery, appOrigin: string, apiOrigin: string): Promise<(PreviewMeta & { query: string }) | null> {
  const vendorId = String(query.storefront || "").trim();
  const productId = String(query.product || "").trim();
  const packageId = String(query.package || "").trim();
  const leviToken = String(query.levi || "").trim();
  const data = getDataContext();
  if (leviToken) {
    if (!/^[0-9a-f-]{36}$/i.test(leviToken)) return null;
    let chatTitle = "A chat with Levi";
    try {
      const title = await data.asService((tx) => new SharingRepository(tx).sharedLeviTitle(leviToken));
      if (title) chatTitle = String(title).slice(0, 80);
    } catch {
      /* the generic title */
    }
    return {
      title: `${chatTitle} | Levi on Levromart`,
      description: "A conversation with Levi, Levromart's assistant. Tap to read it.",
      image: `${appOrigin}/og-levi.jpg`,
      pageUrl: `${appOrigin}/l/${encodeURIComponent(leviToken)}`,
      query: `share=${encodeURIComponent(leviToken)}`,
    };
  }
  if (vendorId) {
    const v = await data.asService((tx) => new SharingRepository(tx).storefront(vendorId));
    return v
      ? {
          title: `${v.business_name || "Levromart storefront"} | Levromart`,
          description: v.bio || `Check out ${v.business_name || "this store"} on Levromart.`,
          image: `${apiOrigin}/api/delete-account?ogstore=${encodeURIComponent(v.id)}`,
          pageUrl: `${appOrigin}/?storefront=${encodeURIComponent(v.id)}`,
          query: `storefront=${encodeURIComponent(v.id)}`,
        }
      : null;
  }
  if (packageId) {
    const k = await data.asService((tx) => new SharingRepository(tx).package(packageId));
    return k
      ? {
          title: `${k.name || "Levromart package"} | Levromart`,
          description: String(k.description || `${k.name || "This package"} on Levromart${k.vendor?.business_name ? ` from ${k.vendor.business_name}` : ""}.`).slice(0, 200),
          image: `${apiOrigin}/api/delete-account?ogpkg=${encodeURIComponent(k.id)}`,
          pageUrl: `${appOrigin}/?package=${encodeURIComponent(k.id)}`,
          query: `package=${encodeURIComponent(k.id)}`,
        }
      : null;
  }
  if (productId) {
    const p = await data.asService((tx) => new SharingRepository(tx).product(productId));
    return p
      ? {
          title: `${p.name || "Levromart listing"} | Levromart`,
          description: String(p.description || `${p.name || "This listing"} on Levromart${p.vendor?.business_name ? ` from ${p.vendor.business_name}` : ""}.`).slice(0, 200),
          image: `${apiOrigin}/api/delete-account?ogprod=${encodeURIComponent(p.id)}`,
          pageUrl: `${appOrigin}/?product=${encodeURIComponent(p.id)}`,
          query: `product=${encodeURIComponent(p.id)}`,
        }
      : null;
  }
  return null;
}

/**
 * Returns the HTML to serve. `path` is the request path ("/", "/s/<id>", ...).
 * Falls back to the unmodified app page on any problem.
 */
export async function renderSharePreview(query: PreviewQuery, host: string, path: string): Promise<string> {
  try {
    const vendorId = String(query.storefront || "").trim();
    const productId = String(query.product || "").trim();
    const packageId = String(query.package || "").trim();
    if (!vendorId && !productId && !packageId) return readAppHtml();

    const data = getDataContext();
    const origin = `https://${host}`;
    let meta: PreviewMeta | null = null;

    if (vendorId) {
      const v = await data.asService((tx) => new SharingRepository(tx).storefront(vendorId));
      if (v) {
        meta = {
          title: `${v.business_name || "Levromart storefront"} | Levromart`,
          description: v.bio || `Check out ${v.business_name || "this store"} on Levromart.`,
          image: `${origin}/api/delete-account?ogstore=${encodeURIComponent(v.id)}`,
          pageUrl: `${origin}/?storefront=${encodeURIComponent(v.id)}`,
        };
      }
    } else if (packageId) {
      const k = await data.asService((tx) => new SharingRepository(tx).package(packageId));
      if (k) {
        meta = {
          title: `${k.name || "Levromart package"} | Levromart`,
          description: String(k.description || `${k.name || "This package"} on Levromart${k.vendor?.business_name ? ` from ${k.vendor.business_name}` : ""}.`).slice(0, 200),
          image: `${origin}/api/delete-account?ogpkg=${encodeURIComponent(k.id)}`,
          pageUrl: `${origin}/?package=${encodeURIComponent(k.id)}`,
        };
      }
    } else {
      const p = await data.asService((tx) => new SharingRepository(tx).product(productId));
      if (p) {
        meta = {
          title: `${p.name || "Levromart listing"} | Levromart`,
          description: String(p.description || `${p.name || "This listing"} on Levromart${p.vendor?.business_name ? ` from ${p.vendor.business_name}` : ""}.`).slice(0, 200),
          image: `${origin}/api/delete-account?ogprod=${encodeURIComponent(p.id)}`,
          pageUrl: `${origin}/?product=${encodeURIComponent(p.id)}`,
        };
      }
    }

    let html = readAppHtml();
    if (meta) html = applyPreviewMeta(html, meta);
    if (/^\/[spk]\//.test(path) || vendorId || productId || packageId) {
      const q = vendorId
        ? `storefront=${encodeURIComponent(vendorId)}`
        : productId
          ? `product=${encodeURIComponent(productId)}`
          : `package=${encodeURIComponent(packageId)}`;
      html = html.replace(
        "<head>",
        `<head><base href="/"><script>try{if(location.pathname!=="/"||!location.search)history.replaceState(null,"","/?${q}");}catch(e){}</script>`,
      );
    }
    return html;
  } catch (err) {
    console.error("Levromart share-preview error:", err);
    return readAppHtml();
  }
}
