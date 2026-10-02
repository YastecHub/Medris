// GET -> { iceServers: [...] }  TURN relay servers for voice calls.
// Phones on mobile data (most Nigerian networks) sit behind carrier NAT, where a
// direct peer-to-peer link usually fails; the TURN relay carries the audio instead.
// Set METERED_API_KEY + METERED_DOMAIN (e.g. levromart.metered.live) in Vercel for
// private credentials; otherwise the shared public Open Relay servers are used.
const OPEN_RELAY = [
  { urls: ["stun:openrelay.metered.ca:80"] },
  { urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turns:openrelay.metered.ca:443?transport=tcp"], username: "openrelayproject", credential: "openrelayproject" },
];

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, max-age=600");
  const key = process.env.METERED_API_KEY, domain = process.env.METERED_DOMAIN;
  if (key && domain) {
    try {
      const r = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`);
      if (r.ok) { const list = await r.json(); if (Array.isArray(list) && list.length) { res.status(200).json({ iceServers: list }); return; } }
    } catch (_) {}
  }
  res.status(200).json({ iceServers: OPEN_RELAY });
};
