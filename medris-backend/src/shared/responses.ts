import { BlockList, isIP } from "node:net";
import type { Request } from "express";

/** Cloudflare's addresses (https://www.cloudflare.com/ips/), the only ones allowed to say who the visitor is. */
const CLOUDFLARE = new BlockList();
for (const range of [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
]) {
  const [net, bits] = range.split("/");
  CLOUDFLARE.addSubnet(net!, Number(bits), "ipv4");
}
for (const range of ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"]) {
  const [net, bits] = range.split("/");
  CLOUDFLARE.addSubnet(net!, Number(bits), "ipv6");
}

function fromCloudflare(ip: string): boolean {
  const family = isIP(ip);
  return family !== 0 && CLOUDFLARE.check(ip, family === 6 ? "ipv6" : "ipv4");
}

/**
 * The visitor's address, for rate limits and sign-in records.
 *
 * Heroku's router adds the address that connected to it as the LAST entry of X-Forwarded-For; earlier entries come
 * from the client and can be anything, so they are not trusted. When that address is Cloudflare's (the app reaches the
 * backend through api.levromart.com, proxied by Cloudflare), the visitor is in CF-Connecting-IP, which Cloudflare
 * always sets itself. Without X-Forwarded-For (local runs): X-Real-IP.
 */
export function clientIp(req: Request): string {
  const hops = (req.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const peer = hops[hops.length - 1];
  if (peer && fromCloudflare(peer)) return req.get("cf-connecting-ip")?.trim() || peer;
  return peer || req.get("x-real-ip") || "unknown";
}
