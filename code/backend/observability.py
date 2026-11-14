"""Structured, privacy-preserving logging for the local CodeLens API.

Invariants — do not relax these when adding new log sites:

* Never log source text, project names, file paths, tokens, API keys or request
  bodies. This service handles private code that only lives in memory.
* Only metadata is recorded: endpoint, verb, status, duration, byte counts and
  exception types. A short correlation id is shared with the UI so a user can
  report "请求 a1b2c3d4" without disclosing what was analysed.
* Exception messages are sanitised and truncated; tracebacks are reduced to
  frame names, never source lines.

File logging is ON by default: ``<repo>/logs/codelens.log`` (directory created
automatically, 5 MiB x 5 rotation). It exists so a crashed process still leaves
a trace. Override or disable:

* ``--log-file <path>`` / ``CODELENS_LOG_FILE``   replace the default path
* ``--no-log-file`` / ``CODELENS_LOG_DISABLE_FILE=1``   console only
* ``--log-level`` / ``CODELENS_LOG_LEVEL``   DEBUG / INFO / WARNING / ERROR
"""
from __future__ import annotations

import atexit
import logging
import logging.handlers
import os
import re
import secrets
import sys
import threading
import traceback
from contextlib import suppress
from pathlib import Path
from typing import Any

LOGGER_NAME = "codelens"
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LOG_FILE = REPO_ROOT / "logs" / "codelens.log"
MAX_MESSAGE = 200
MAX_FILE_BYTES = 5 * 1024 * 1024
BACKUP_COUNT = 5

LEVELS = {"DEBUG": logging.DEBUG, "INFO": logging.INFO, "WARNING": logging.WARNING,
          "ERROR": logging.ERROR, "CRITICAL": logging.CRITICAL}

API_STATUS = "/api/status"
API_AI_STATUS = "/api/ai/status"
API_ANALYZE = "/api/analyze"
API_AI = "/api/ai"
API_EXPLAIN = "/api/explain"
API_REVIEW = "/api/review"
API_REVIEW_CACHED = "/api/review/cached"
API_PATHS = frozenset({API_STATUS, API_AI_STATUS, API_ANALYZE, API_AI,
                       API_EXPLAIN, API_REVIEW, API_REVIEW_CACHED})

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f]")
# Defence in depth: even if a future call site passes a raw payload, scrub
# key/value pairs that look like credentials or embedded source.
_SECRET_PAIRS = re.compile(
    r"(?i)\b(api[_-]?key|token|secret|password|authorization|content_base64|source|content)\b"
    r"""["']?\s*[=:]\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;&]+)"""
)
_BEARER = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._\-]+")
# Field names that must never be emitted even if a call site adds them later.
_SENSITIVE_FIELD = re.compile(
    r"(?i)(project|filename|file_path|filepath|source|content|payload|body|code|api[_-]?key|token|secret)"
)
_DISABLE_VALUES = {"1", "true", "yes", "on"}

_LOCK = threading.Lock()
_CONFIGURED = False
_HOOKS_INSTALLED = False
ACTIVE_LOG_FILE: Path | None = None


def new_id() -> str:
    """Short, non-guessable correlation id safe to show in the UI."""
    return secrets.token_hex(4)


def redact(value: Any, limit: int = MAX_MESSAGE) -> str:
    """Collapse control characters, scrub credential-ish pairs, truncate."""
    text = _CONTROL_CHARS.sub(" ", str(value))
    text = _BEARER.sub("Bearer <redacted>", text)
    text = _SECRET_PAIRS.sub(lambda m: f"{m.group(1)}=<redacted>", text)
    text = " ".join(text.split())
    if len(text) > limit:
        text = text[:limit] + "…"
    return text


def safe_path(path: str) -> str:
    """Only known API routes are logged verbatim; everything else is opaque."""
    return path if path in API_PATHS else "<other>"


def format_fields(fields: dict[str, Any]) -> str:
    parts = []
    for key, value in fields.items():
        if value is None:
            continue
        if _SENSITIVE_FIELD.search(key):
            parts.append(f"{key}=<redacted>")
        else:
            parts.append(f"{key}={redact(value, 120)}")
    return " ".join(parts)


class _PrivacyFilter(logging.Filter):
    """Last line of defence: every outgoing record is sanitised."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact(record.getMessage(), 1000)
        record.args = ()
        return True


def _build_formatter() -> logging.Formatter:
    return logging.Formatter(
        fmt="%(asctime)s %(levelname)-5s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def configure_logging(level: str | None = None, log_file: str | None = None,
                      enable_file: bool = True) -> logging.Logger:
    """Idempotent, thread-safe setup. Returns the shared ``codelens`` logger."""
    global _CONFIGURED, ACTIVE_LOG_FILE
    with _LOCK:
        logger = logging.getLogger(LOGGER_NAME)
        if _CONFIGURED:
            return logger

        chosen = (level or os.environ.get("CODELENS_LOG_LEVEL") or "INFO").upper()
        logger.setLevel(LEVELS.get(chosen, logging.INFO))
        logger.propagate = False
        privacy = _PrivacyFilter()
        formatter = _build_formatter()

        console = logging.StreamHandler()
        console.setFormatter(formatter)
        console.addFilter(privacy)
        logger.addHandler(console)

        target = _file_log_target(log_file, enable_file)
        ACTIVE_LOG_FILE = _attach_file_log(logger, target, formatter, privacy) if target else None

        _CONFIGURED = True
        return logger


def _file_log_target(log_file: str | None, enable_file: bool) -> str | None:
    disabled = os.environ.get("CODELENS_LOG_DISABLE_FILE", "").strip().lower() in _DISABLE_VALUES
    if not enable_file or disabled:
        return None
    target = log_file if log_file is not None else os.environ.get("CODELENS_LOG_FILE")
    return str(DEFAULT_LOG_FILE) if target is None else target


def _attach_file_log(logger, target, formatter, privacy) -> Path | None:
    try:
        path = Path(target).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.handlers.RotatingFileHandler(
            path, maxBytes=MAX_FILE_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        file_handler.addFilter(privacy)
        logger.addHandler(file_handler)
    except OSError as exc:
        # Do not disclose filesystem paths from OS exceptions.
        logger.warning("file log disabled reason=%s", type(exc).__name__)
        return None
    logger.info("file log enabled rotation_mb=%s backups=%s",
                MAX_FILE_BYTES // (1024 * 1024), BACKUP_COUNT)
    return path


def active_log_file() -> Path | None:
    """Where the process currently writes its file log (None = console only)."""
    return ACTIVE_LOG_FILE


def get_logger(suffix: str | None = None) -> logging.Logger:
    """Return the shared logger (or a named child) after basic setup."""
    root = configure_logging()
    return logging.getLogger(f"{LOGGER_NAME}.{suffix}") if suffix else root


def reset_for_tests() -> None:
    """Drop handlers so a test can reconfigure with its own level/file."""
    global _CONFIGURED, ACTIVE_LOG_FILE
    with _LOCK:
        logger = logging.getLogger(LOGGER_NAME)
        for handler in list(logger.handlers):
            handler.close()
            logger.removeHandler(handler)
        ACTIVE_LOG_FILE = None
        _CONFIGURED = False


def flush_all(logger: logging.Logger) -> None:
    """Force buffered records to disk before a crash terminates the process."""
    for handler in list(logger.handlers):
        try:
            handler.flush()
        except Exception as exc:
            # Report only the exception type and bypass the failing logger.
            with suppress(OSError, ValueError):
                print(f"codelens: log flush failed ({type(exc).__name__})", file=sys.stderr)


def exception_summary(exc: BaseException) -> dict[str, str]:
    """Type + sanitised message + frame names. Never includes source lines."""
    frames = traceback.extract_tb(exc.__traceback__)[-6:]
    chain = ";".join(
        f"{Path(frame.filename).name}:{frame.name}:{frame.lineno}" for frame in frames
    )
    return {
        "type": type(exc).__name__,
        "message": redact(exc),
        "frames": chain or "-",
    }


def log_exception(logger: logging.Logger, exc: BaseException, request_id: str,
                  **context: Any) -> None:
    """Record an exception with a correlation id, without leaking source text."""
    detail = exception_summary(exc)
    logger.error(
        "exception request_id=%s type=%s message=%s frames=%s %s",
        request_id, detail["type"], detail["message"], detail["frames"],
        format_fields(context),
    )


def log_request(logger: logging.Logger, *, method: str, path: str, status: int,
                duration_ms: float, request_id: str, bytes_out: int | None = None,
                error_type: str | None = None) -> None:
    fields = {
        "request_id": request_id,
        "method": method,
        "path": safe_path(path),
        "status": status,
        "duration_ms": round(duration_ms, 1),
        "bytes": bytes_out,
        "error": error_type,
    }
    line = "request " + format_fields(fields)
    if status >= 500:
        logger.error(line)
    elif status >= 400:
        logger.warning(line)
    else:
        logger.info(line)


def log_event(logger: logging.Logger, level: int, event: str, **context: Any) -> None:
    logger.log(level, "event name=%s %s", event, format_fields(context))


def install_crash_hooks(logger: logging.Logger) -> None:
    """Persist uncaught / thread / process-exit traces for post-mortem debugging.

    ThreadingHTTPServer handles each request in its own thread, so
    ``threading.excepthook`` matters as much as ``sys.excepthook`` here.
    """
    global _HOOKS_INSTALLED
    with _LOCK:
        if _HOOKS_INSTALLED:
            return
        _HOOKS_INSTALLED = True

    previous_uncaught = sys.excepthook
    previous_thread = threading.excepthook

    def on_uncaught(exc_type, exc, tb):
        if issubclass(exc_type, KeyboardInterrupt):
            log_event(logger, logging.INFO, "process_exit", reason="keyboard_interrupt")
            flush_all(logger)
            previous_uncaught(exc_type, exc, tb)
            return
        log_exception(logger, exc, new_id(), event="uncaught")
        flush_all(logger)
        previous_uncaught(exc_type, exc, tb)

    def on_thread(args):
        exc = args.exc_value or Exception("unknown thread failure")
        log_exception(logger, exc, new_id(), event="thread_uncaught",
                      thread=args.thread.name if args.thread else "-")
        flush_all(logger)
        previous_thread(args)

    def on_exit():
        # Handlers may already be closed (e.g. by a test harness).
        if not logger.handlers:
            return
        exc = sys.exc_info()[1]
        if exc is not None and not isinstance(exc, (KeyboardInterrupt, SystemExit)):
            log_exception(logger, exc, new_id(), event="process_exit")
        log_event(logger, logging.INFO, "process_exit", pid=os.getpid())
        flush_all(logger)

    sys.excepthook = on_uncaught
    threading.excepthook = on_thread
    atexit.register(on_exit)
