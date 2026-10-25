import { consumeRateLimit } from "../../middleware/rate-limit.js";
import { stableKey } from "../../lib/response-cache.js";
import { notFound } from "../../shared/errors/app-error.js";
import { controller, ok } from "../../shared/http/route.js";
import { rpcEntry } from "./rpc.dispatch.js";
import * as routes from "./rpc.routes.js";

/**
 * Every signed-in caller's calls, on top of each function's own limit (a screen makes many small reads). Signed-out
 * visitors are not counted here: they are counted by IP address, and many phones share one on mobile networks.
 */
const overall = { name: "rpc", limit: 600, windowMs: 60_000 };

/** The app's sb.rpc() calls - see rpc.routes.ts and rpc.dispatch.ts. */
export const rpcController = controller().route(routes.callRpc, async ({ services, identity, input, req, res }) => {
  const entry = rpcEntry(input.params.name);
  if (!entry) throw notFound("Unknown function.");
  if (identity) await consumeRateLimit(overall, req, res);
  if (entry.limit) await consumeRateLimit(entry.limit, req, res);
  const args = input.body ?? {};
  const store = services.responseCache;
  if (store && entry.cache && (entry.cache.who === "everyone" || !identity)) {
    const key = `rpc|${input.params.name}|${entry.cache.who === "everyone" ? "*" : "anon"}|${stableKey(args)}`;
    const { value, hit } = await store.getOrLoad(key, entry.cache.ttlMs, () => entry.run(services, identity, args), (v) => JSON.stringify(v ?? null).length + 256);
    res.setHeader("X-Levro-Cache", hit ? "hit" : "miss");
    return ok(value);
  }
  return ok(await entry.run(services, identity, args));
});
