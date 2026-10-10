import fs from "node:fs";
import { SupabaseAdmin } from "../../integrations/supabase.js";
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
}

interface NamedRow {
  id: string;
  name?: string;
  description?: string;
  vendor?: { business_name?: string };
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

    const db = SupabaseAdmin.fromEnv();
    const origin = `https://${host}`;
    let meta: PreviewMeta | null = null;

    if (vendorId) {
      const v = await db.first<{ id: string; business_name?: string; bio?: string }>(
        `vendors?id=eq.${encodeURIComponent(vendorId)}&verification_status=eq.verified&is_active=eq.true&select=id,business_name,bio,logo_url`,
      );
      if (v) {
        meta = {
          title: `${v.business_name || "Levromart storefront"} | Levromart`,
          description: v.bio || `Check out ${v.business_name || "this store"} on Levromart.`,
          image: `${origin}/api/delete-account?ogstore=${encodeURIComponent(v.id)}`,
          pageUrl: `${origin}/?storefront=${encodeURIComponent(v.id)}`,
        };
      }
    } else if (packageId) {
      const k = await db.first<NamedRow>(`vendor_packages?id=eq.${encodeURIComponent(packageId)}&select=id,name,description,vendor:vendors(business_name)`);
      if (k) {
        meta = {
          title: `${k.name || "Levromart package"} | Levromart`,
          description: String(k.description || `${k.name || "This package"} on Levromart${k.vendor?.business_name ? ` from ${k.vendor.business_name}` : ""}.`).slice(0, 200),
          image: `${origin}/api/delete-account?ogpkg=${encodeURIComponent(k.id)}`,
          pageUrl: `${origin}/?package=${encodeURIComponent(k.id)}`,
        };
      }
    } else {
      const p = await db.first<NamedRow>(`products?id=eq.${encodeURIComponent(productId)}&select=id,name,description,photos,vendor:vendors(business_name)`);
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
