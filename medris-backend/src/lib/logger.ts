/**
 * Structured (JSON lines) logging with secret redaction.
 *
 * Every line is one JSON object: { level, time, msg, ...fields }. Vercel and
 * most log drains index these fields. Values under sensitive-looking keys
 * (tokens, passwords, cookies, keys, authorization headers) are replaced with
 * "[redacted]", and bearer tokens / JWTs embedded in strings are masked, so a
 * stray `logger.info("...", { headers })` cannot leak a credential.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY = /(pass(word)?|secret|token|authorization|cookie|api[-_]?key|apikey|private[-_]?key|service[-_]?role|signature|otp|code_verifier|refresh)/i;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const MAX_DEPTH = 6;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.replace(BEARER, "$1 [redacted]").replace(JWT, "[redacted-jwt]");
  if (typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message, depth + 1), ...("code" in value ? { code: (value as { code: unknown }).code } : {}) };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Headers) return redact(Object.fromEntries(value.entries()), depth + 1);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export type LogSink = (line: string, level: LogLevel) => void;

const defaultSink: LogSink = (line, level) => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

export function createLogger(options: { level?: LogLevel; base?: LogFields; sink?: LogSink } = {}): Logger {
  const threshold = LEVELS[options.level ?? "info"];
  const base = options.base ?? {};
  const sink = options.sink ?? defaultSink;

  const write = (level: LogLevel, msg: string, fields?: LogFields) => {
    if (LEVELS[level] < threshold) return;
    const entry = redact({ level, time: new Date().toISOString(), msg, ...base, ...fields }) as LogFields;
    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      line = JSON.stringify({ level, time: entry.time, msg, note: "unserialisable log fields dropped" });
    }
    sink(line, level);
  };

  return {
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
    child: (fields) => createLogger({ level: options.level, base: { ...base, ...fields }, sink }),
  };
}

/** A logger that discards everything (tests). */
export const silentLogger: Logger = createLogger({ sink: () => {} });
