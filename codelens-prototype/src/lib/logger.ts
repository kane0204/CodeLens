/** Client-side structured logging. Never stores source text, project names or credentials. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  context?: Record<string, string | number | boolean | undefined>;
}

const MAX_ENTRIES = 200;
const MAX_PERSISTED = 100;
const STORAGE_KEY = 'codelens.diag.v1';
const MAX_TEXT = 200;
const SENSITIVE_KEY = /(api[_-]?key|token|secret|password|authorization|project|file[_-]?(?:name|path)|^file$|source|content|payload|body)/i;
const CONTROL = /[\x00-\x1f\x7f-\x9f]/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._-]+/gi;
const SECRET_PAIRS = /\b(api[_-]?key|token|secret|password|authorization)\b["']?\s*[=:]\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;&]+)/gi;

export function redactText(value: unknown): string {
  let text = String(value).replace(CONTROL, ' ');
  text = text.replace(BEARER, 'Bearer <redacted>').replace(SECRET_PAIRS, '$1=<redacted>');
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

function safeContext(context?: Record<string, unknown>): LogEntry['context'] {
  if (!context) return undefined;
  const out: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = '<redacted>';
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = redactText(value);
    } else if (value != null) {
      out[key] = `<${typeof value}>`;
    }
  }
  return out;
}

class ClientLogger {
  private buffer: LogEntry[] = [];
  private persisted: LogEntry[] = [];

  constructor() {
    this.restore();
  }

  /** Recover pre-crash records after a reload so diagnostics survive a white screen. */
  private restore(): void {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const valid = parsed
        .filter(
          (item): item is LogEntry =>
            Boolean(item) &&
            typeof item === 'object' &&
            typeof (item as LogEntry).ts === 'string' &&
            typeof (item as LogEntry).message === 'string' &&
            typeof (item as LogEntry).level === 'string',
        )
        .slice(-MAX_PERSISTED);
      this.persisted = valid;
      this.buffer = [...valid];
    } catch {
      // Storage disabled or corrupted: in-memory logging still works.
    }
  }

  /** Synchronous write, so a killed tab does not lose the most recent events. */
  private persist(entry: LogEntry): void {
    if (entry.level === 'debug') return;
    this.persisted.push(entry);
    if (this.persisted.length > MAX_PERSISTED) {
      this.persisted.splice(0, this.persisted.length - MAX_PERSISTED);
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.persisted));
    } catch {
      // Quota or privacy mode: keep the in-memory buffer only.
    }
  }

  write(level: LogLevel, scope: string, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      scope,
      message: redactText(message),
      context: safeContext(context),
    };
    this.buffer.push(entry);
    if (this.buffer.length > MAX_ENTRIES) {
      this.buffer.splice(0, this.buffer.length - MAX_ENTRIES);
    }
    this.persist(entry);
    if (import.meta.env.DEV || level === 'warn' || level === 'error') {
      const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.debug;
      sink(`[codelens:${scope}] ${entry.message}`, entry.context ?? '');
    }
  }

  debug(scope: string, message: string, context?: Record<string, unknown>): void {
    this.write('debug', scope, message, context);
  }

  info(scope: string, message: string, context?: Record<string, unknown>): void {
    this.write('info', scope, message, context);
  }

  warn(scope: string, message: string, context?: Record<string, unknown>): void {
    this.write('warn', scope, message, context);
  }

  error(scope: string, message: string, context?: Record<string, unknown>): void {
    this.write('error', scope, message, context);
  }

  entries(): LogEntry[] {
    return this.buffer.map((item) => ({
      ...item,
      context: item.context ? { ...item.context } : undefined,
    }));
  }

  restoredCount(): number {
    return this.persisted.length;
  }

  clear(): void {
    this.buffer = [];
    this.persisted = [];
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  /** Export the ring buffer as a local JSON file; nothing is sent to a server. */
  download(): void {
    const payload = JSON.stringify(
      { exported_at: new Date().toISOString(), entries: this.entries() },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `codelens-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export const logger = new ClientLogger();

function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : `<${typeof reason}>`;
}

let attached = false;

/** Capture crashes that never reach an application-level catch. */
export function attachGlobalErrorHandlers(): void {
  if (attached || typeof window === 'undefined') return;
  attached = true;
  logger.info('app', 'session.started', { restored: logger.restoredCount() });
  window.addEventListener('error', (event) => {
    logger.error('window', 'uncaught_error', {
      message: event.message,
      line: event.lineno,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    logger.error('window', 'unhandled_rejection', { message: reasonText(event.reason) });
  });
  window.addEventListener('pagehide', () => {
    logger.info('app', 'session.ended');
  });
}
