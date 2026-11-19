// Share links (/s/<shop>, /p/<product>, /k/<package>, /l/<Levi chat>, and /?product=... etc.) on Cloudflare Pages.
//
// Chat apps and social sites read the page's title, description and picture to draw a preview. The app's page is the
// same for every link, so this fills those in for the shared item: the backend on Heroku looks it up
// (GET /api/delete-account?sharemeta=1) and draws the picture cards. People who open the link get the app as usual,
// already on that item. Any problem: the plain app page.

const DEFAULT_API = "https://levromart-5212f03a7e44.herokuapp.com";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function applyMeta(html, meta) {
  const t = esc(meta.title), d = esc(meta.description), u = esc(meta.pageUrl);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${d}">`);
  html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${t}">`);
  html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${d}">`);
  html = html.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${u}">`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${t}">`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${d}">`);
  if (meta.image) {
    const img = esc(meta.image);
    html = html.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${img}">`);
    html = html.replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${img}">`);
  }
  return html;
}

/** `item` is { storefront | product | package | levi: id }. */
export async function sharePage(context, item) {
  const { request, env } = context;
  const url = new URL(request.url);
  const page = await env.ASSETS.fetch(new Request(new URL("/", url).toString(), { headers: request.headers }));
  let html = await page.text();
  const [kind, id] = Object.entries(item)[0];
  const cleanId = String(id || "").replace(/[^0-9a-zA-Z-]/g, "").slice(0, 64);
  if (!cleanId) return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });

  let query = kind === "levi" ? `share=${encodeURIComponent(cleanId)}` : `${kind}=${encodeURIComponent(cleanId)}`;
  try {
    const api = String(env.API_ORIGIN || DEFAULT_API).replace(/\/$/, "");
    const qs = new URLSearchParams({ sharemeta: "1", origin: url.origin, [kind]: cleanId });
    const r = await fetch(`${api}/api/delete-account?${qs}`, { headers: { Accept: "application/json" }, cf: { cacheTtl: 300, cacheEverything: true } });
    if (r.ok) {
      const meta = await r.json();
      html = applyMeta(html, meta);
      if (meta.query) query = meta.query;
    }
  } catch {
    /* the plain page */
  }
  const m = kind === "levi" ? String(url.searchParams.get("m") || "").replace(/[^0-9a-fA-F-]/g, "") : "";
  if (m) query += `&m=${m}`;
  // the app opens the shared item from its own address form (/?storefront=...)
  html = html.replace("<head>", `<head><base href="/"><script>try{if(location.pathname!=="/"||!location.search)history.replaceState(null,"","/?${query}");}catch(e){}</script>`);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
}
