/**
 * Ring buffer of recent renderer errors for support bundles.
 * Never stores chat message bodies — only error strings + coarse context.
 */

const MAX_ENTRIES = 80;

export type ClientErrorEntry = {
  ts: string;
  source: "window.onerror" | "unhandledrejection" | "console.error" | "manual";
  message: string;
  stack?: string;
  /** Coarse UI context (route-ish), never message content. */
  context?: string;
};

const buffer: ClientErrorEntry[] = [];
let installed = false;
let originalConsoleError: ((...args: unknown[]) => void) | null = null;

function push(entry: ClientErrorEntry): void {
  const scrubbed: ClientErrorEntry = {
    ...entry,
    message: scrubSecrets(truncate(entry.message, 2000)),
    stack: entry.stack ? scrubSecrets(truncate(entry.stack, 4000)) : undefined,
    context: entry.context ? scrubSecrets(truncate(entry.context, 200)) : undefined,
  };
  buffer.push(scrubbed);
  while (buffer.length > MAX_ENTRIES) buffer.shift();
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function scrubSecrets(s: string): string {
  return s
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL_REDACTED]")
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[IP_REDACTED]")
    .replace(/(bearer\s+)[a-z0-9._-]{8,}/gi, "$1[TOKEN_REDACTED]")
    .replace(/\b(sk-|nk-|ghp_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g, "[SECRET_REDACTED]");
}

function stringifyArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack || arg.message || String(arg);
  }
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/** Record an explicit app error (e.g. failed Tauri invoke). */
export function reportClientError(
  message: string,
  opts?: { stack?: string; context?: string; source?: ClientErrorEntry["source"] }
): void {
  push({
    ts: new Date().toISOString(),
    source: opts?.source ?? "manual",
    message,
    stack: opts?.stack,
    context: opts?.context,
  });
}

export function getClientErrorSnapshot(): ClientErrorEntry[] {
  return [...buffer];
}

export function clearClientErrors(): void {
  buffer.length = 0;
}

/**
 * Install once at app boot. Safe to call repeatedly.
 * Hooks window errors + mirrors console.error into the ring buffer.
 */
export function installClientErrorCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    push({
      ts: new Date().toISOString(),
      source: "window.onerror",
      message: event.message || String(event.error || "Unknown error"),
      stack: event.error instanceof Error ? event.error.stack : undefined,
      context: event.filename
        ? `${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0}`
        : undefined,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    push({
      ts: new Date().toISOString(),
      source: "unhandledrejection",
      message: stringifyArg(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    originalConsoleError?.(...args);
    push({
      ts: new Date().toISOString(),
      source: "console.error",
      message: args.map(stringifyArg).join(" "),
    });
  };
}

/** Payload attached to the support-bundle Tauri command. */
export function buildFrontendDiagnosticsPayload(extra?: Record<string, unknown>): string {
  const href =
    typeof window !== "undefined" ? scrubSecrets(window.location?.href || "") : "";
  const userAgent =
    typeof navigator !== "undefined" ? scrubSecrets(navigator.userAgent || "") : "";

  return JSON.stringify(
    {
      captured_at: new Date().toISOString(),
      user_agent: userAgent,
      href,
      recent_errors: getClientErrorSnapshot(),
      ...extra,
    },
    null,
    2
  );
}
