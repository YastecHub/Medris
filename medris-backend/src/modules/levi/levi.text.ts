/** Text helpers and catalogue search scoring for Levi. Pure functions. */

export function jsonSafe<T>(value: T): T | null {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return null;
  }
}

export function enc(value: unknown): string {
  return encodeURIComponent(String(value ?? ""));
}

export function cleanText(value: unknown, max = 500): string {
  // eslint-disable-next-line no-control-regex
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function normalize(value: unknown): string {
  return cleanText(value, 300).toLowerCase().replace(/[’']/g, "'");
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function scoreText(query: string, fields: unknown[]): number {
  const q = normalize(query);
  if (!q) return 0;
  const tokens = q.split(/\s+/).filter(Boolean);
  const hay = fields.map(normalize).join(" ");
  const compact = hay.replace(/[^a-z0-9 ]/g, " ");
  let score = 0;
  if (hay.includes(q)) score += 20;
  for (const token of tokens) if (compact.includes(token)) score += 5;
  return score;
}

const SYNONYMS: Record<string, string[]> = {
  shoe: ["shoes", "footwear", "sneaker", "sneakers", "slipper", "slippers", "sandals", "boots"],
  shoes: ["shoe", "footwear", "sneaker", "sneakers", "slipper", "slippers", "sandals", "boots"],
  watch: ["wristwatch", "wrist watch", "smartwatch", "smart watch", "timepiece"],
  jewelry: ["jewellery", "ring", "rings", "necklace", "bracelet", "earrings", "earring", "chain"],
  clothes: ["clothing", "fashion", "shirt", "shirts", "trouser", "trousers", "dress", "dresses", "jacket", "jeans"],
  cloth: ["clothing", "fashion", "shirt", "dress", "trouser", "fabric", "textile"],
  food: ["foodstuff", "groceries", "grocery", "rice", "pasta", "spaghetti", "penne", "macaroni", "snacks", "candy"],
  icecream: ["ice cream", "icecream", "frozen dessert", "dessert", "candy", "sweet", "yogurt"],
  ice: ["ice cream", "icecream", "frozen", "cold drink"],
  laptop: ["computer", "notebook", "macbook", "pc"],
  phone: ["smartphone", "mobile", "iphone", "android", "telephone"],
  medical: ["healthcare", "health", "hospital", "clinical", "medical equipment", "diagnostic"],
  jewellery: ["jewelry", "ring", "necklace", "bracelet", "earrings", "chain"],
};

export function relatedTerms(query: string): string[] {
  const q = normalize(query);
  const terms = new Set<string>([q]);
  for (const token of q.split(/\s+/)) (SYNONYMS[token] || []).forEach((x) => terms.add(x));
  for (const [key, values] of Object.entries(SYNONYMS)) {
    if (q.includes(key) || values.some((v) => q.includes(v))) {
      terms.add(key);
      values.forEach((v) => terms.add(v));
    }
  }
  return [...terms].filter(Boolean).slice(0, 18);
}

/**
 * Removes executable UI directives from older assistant turns before they are
 * sent back to Gemini, so an old destination can't leak into a new request.
 */
export function stripOldUiDirectives(value: unknown): string {
  return String(value || "")
    .replace(/\[\[NAV:[\s\S]*?\]\]/g, "")
    .replace(/\[\[PRODUCTS:[\s\S]*?\]\]/g, "")
    .replace(/\[\[DRAFTMSG[\s\S]*?\]\][\s\S]*?\[\[\/DRAFTMSG\]\]/g, "")
    .replace(/\[\[ADD_CART:[\s\S]*?\]\]/g, "")
    .replace(/\[\[REMOVE_CART:[\s\S]*?\]\]/g, "")
    .replace(/\[\[SYNC_CART:[\s\S]*?\]\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function stripUnsafeTechnicalFallback(text: string): string {
  let out = cleanText(text, 6000);
  const banned = [
    /the smart assistant is unreachable[^.]*\.?/gi,
    /smart assistant is unreachable[^.]*\.?/gi,
    /ai assistant is unreachable[^.]*\.?/gi,
    /the ai is unreachable[^.]*\.?/gi,
    /assistant is unreachable[^.]*\.?/gi,
  ];
  for (const re of banned) out = out.replace(re, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Appends any browser directives returned by tools that the model left out of its reply. */
export function appendClientDirectives(reply: string, toolResults: unknown[]): string {
  const directives: string[] = [];
  for (const r of toolResults) {
    const d = (r as { clientDirective?: string } | null)?.clientDirective;
    if (d) directives.push(d);
  }
  if (!directives.length) return reply;
  const existing = directives.filter((d) => reply.includes(d));
  if (existing.length === directives.length) return reply;
  return `${reply.replace(/\s+$/g, "")} ${directives.join(" ")}`.trim();
}
