/* global console */
// Builds the public web versions of the legal pages from the text inside the app, so there is one source of truth:
//   src/legacy/assets/js/01-app/85-legal-pages.js  ->  public/{terms,privacy,refund-policy}/index.html
// Run after changing that file:  node medris-frontend/scripts/build-public-legal-pages.mjs
// (Google Play, app stores and search engines need a plain web address that opens without signing in.)
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src/legacy/assets/js/01-app/85-legal-pages.js"), "utf8");
const ctx = vm.createContext({});
vm.runInContext(source.slice(0, source.indexOf("async function recordAuthActivity")), ctx);   // only the three text functions

const PAGES = [
  { slug: "privacy", fn: "renderPrivacy", title: "Privacy Policy", desc: "How Levromart collects, uses and protects your personal data." },
  { slug: "terms", fn: "renderTerms", title: "Terms of Service", desc: "The rules for using Levromart as a buyer, vendor or visitor." },
  { slug: "refund-policy", fn: "renderRefundPolicy", title: "Refund & Cancellation Policy", desc: "How cancellations and refunds work on Levromart." },
];
const LINKS = { terms: "/terms/", privacy: "/privacy/", refundPolicy: "/refund-policy/", supportRequest: "/" };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function page(p) {
  let body = vm.runInContext(`${p.fn}()`, ctx);
  // links that only worked inside the app become normal web links
  body = body.replace(/<a href="#"([^>]*?)onclick="navigate\('(\w+)'\);return false;"([^>]*)>([^<]*)<\/a>/g, (m, a, view, b, text) => {
    const href = LINKS[view] || "/";
    const label = view === "supportRequest" ? text.replace(/^support request$/, "support request in the Levromart app") : text;
    return `<a href="${href}"${a}${b}>${label}</a>`;
  });
  const nav = PAGES.map((x) => `<a href="/${x.slug}/"${x.slug === p.slug ? ' aria-current="page"' : ""}>${x.title.replace(" & ", " &amp; ")}</a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} | Levromart</title>
<meta name="description" content="${esc(p.desc)}">
<link rel="canonical" href="https://levromart.com/${p.slug}/">
<link rel="icon" href="/favicon.ico" sizes="any">
<meta name="theme-color" content="#0B6E4A">
<style>
:root{--bg:#fff;--text:#14211a;--muted:#5b6b63;--line:#e3e9e5;--green:#12a06a;--card:#f4f8f6}
@media (prefers-color-scheme:dark){:root{--bg:#0d1210;--text:#e9f1ec;--muted:#9fb1a8;--line:#24302a;--card:#151c19}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif}
header{border-bottom:1px solid var(--line);background:var(--bg);position:sticky;top:0}
.bar{max-width:780px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:14px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;color:var(--text);text-decoration:none}
.brand img{width:34px;height:34px;border-radius:9px}
.open{margin-left:auto;background:var(--green);color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:9px 16px;border-radius:99px}
nav{max-width:780px;margin:0 auto;padding:0 20px 10px;display:flex;gap:6px;flex-wrap:wrap}
nav a{font-size:14px;color:var(--muted);text-decoration:none;padding:6px 12px;border-radius:99px;background:var(--card)}
nav a[aria-current]{background:var(--green);color:#fff;font-weight:700}
main{max-width:780px;margin:0 auto;padding:26px 20px 60px}
h2{font-size:30px;line-height:1.2;margin:0 0 6px;letter-spacing:-.02em}
h3{font-size:19px;margin:28px 0 6px}
.muted{color:var(--muted)}
ul{padding-left:22px}li{margin:6px 0}
a{color:var(--green)}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:14px;text-align:center;padding:22px 20px}
</style>
</head>
<body>
<header><div class="bar"><a class="brand" href="/"><img src="/icon-192.png" alt="" width="34" height="34">Levromart</a><a class="open" href="/">Open Levromart</a></div><nav aria-label="Legal pages">${nav}</nav></header>
<main>
${body}
</main>
<footer>&copy; Levromart &middot; <a href="https://levromart.com/">levromart.com</a></footer>
</body>
</html>
`;
}

for (const p of PAGES) {
  const dir = path.join(root, "public", p.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), page(p));
  console.log("wrote public/" + p.slug + "/index.html");
}
