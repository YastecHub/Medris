import { sharePage } from "./_share.js";

// "/?storefront=<id>", "/?product=<id>", "/?package=<id>" links get their own preview; everything else is the app page.
export async function onRequestGet(context) {
  const q = new URL(context.request.url).searchParams;
  for (const kind of ["storefront", "product", "package"]) {
    if (q.get(kind)) return sharePage(context, { [kind]: q.get(kind) });
  }
  return context.next();
}
