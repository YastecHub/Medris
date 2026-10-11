import { optionalEnv } from "../../config/env.js";

/**
 * ICE/TURN servers for WebRTC voice calls, in order of preference:
 *  1. Cloudflare Realtime TURN (CF_TURN_KEY_ID + CF_TURN_API_TOKEN)
 *  2. Metered (METERED_API_KEY + METERED_DOMAIN)
 *  3. the shared Open Relay, a last resort that often does not relay at all.
 */

export interface IceServer {
  urls: string[] | string;
  username?: string;
  credential?: string;
}

export const OPEN_RELAY_ICE_SERVERS: IceServer[] = [
  { urls: ["stun:openrelay.metered.ca:80"] },
  {
    urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turns:openrelay.metered.ca:443?transport=tcp"],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export async function getIceServers(): Promise<{ iceServers: unknown[]; source: string }> {
  const cfId = optionalEnv("CF_TURN_KEY_ID");
  const cfToken = optionalEnv("CF_TURN_API_TOKEN");
  if (cfId && cfToken) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cfId)}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 86400 }),
      });
      if (r.ok) {
        const j = (await r.json()) as { iceServers?: IceServer | IceServer[] };
        let list: IceServer[] = Array.isArray(j?.iceServers) ? j.iceServers : j?.iceServers ? [j.iceServers] : [];
        // Keep the relay entries, drop port 53 (browsers block it).
        list = list
          .map((s) => ({ ...s, urls: ([] as string[]).concat(s.urls || []).filter((u) => !/:53(\?|$)/.test(u)) }))
          .filter((s) => s.urls.length);
        if (list.length) return { iceServers: list, source: "cloudflare" };
      }
    } catch {
      /* try the next provider */
    }
  }
  const key = optionalEnv("METERED_API_KEY");
  const domain = optionalEnv("METERED_DOMAIN");
  if (key && domain) {
    try {
      const r = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`);
      if (r.ok) {
        const list = (await r.json()) as unknown;
        if (Array.isArray(list) && list.length) return { iceServers: list, source: "metered" };
      }
    } catch {
      /* fall back to Open Relay */
    }
  }
  return { iceServers: OPEN_RELAY_ICE_SERVERS, source: "open-relay (shared, unreliable)" };
}
