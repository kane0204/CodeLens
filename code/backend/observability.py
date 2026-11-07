"""Structured, privacy-preserving logging for the local CodeLens API.

Invariants — do not relax these when adding new log sites:

* Never log source text, project names, file paths, tokens, API keys or request
  bodies. This service handles private code that only lives in memory.
* Only metadata is recorded: endpoint, verb, status, duration, byte counts and
  exception types. A short correlation id is shared with the UI so a user can
  report "请求 a1b2c3d4" without disclosing what was analysed.
* Exception messages are sanitised and truncated; tracebacks are reduced to
  frame names, never source lines.

Configuration (all optional):

* ``CODELENS_LOG_LEVEL``  DEBUG / INFO / WARNING / ERROR (default INFO)
* ``CODELENS_LOG_FILE``   absolute path; enables a 1 MiB x 3 rotating file log.
                         If it cannot be opened, the process keeps running with
                         console logging only.
"""
from __future__ import annotations

import logging
import logging.handlers
import os
import re
import secrets
import threading
import traceback
from pathlib import Path
from typing import Any

LOGGER_NAME = "codelens"
MAX_MESSAGE = 200
MAX_FILE_BYTES = 1024 * 1024
BACKUP_COUNT = 3

LEVELS = {"DEBUG": logging.DEBUG, "INFO": logging.INFO, "WARNING": logging.WARNING,
           "ERROR": logging.ERROR, "CRITICAL": logging.CRITICAL}
_API_PATHS = frozenset({"/api/status", "/api/ai/status", "/api/analyze", "/api/ai",
                        "/api/explain", "/api/review"})

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

_LOCK = threading.Lock()
_CONFIGURED = False


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
    return path if path in _API_PATHS else "<other>"


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


def configure_logging(level: str | None = None, log_file: str | None = None) -> logging.Logger:
    """Idempotent, thread-safe setup. Returns the shared ``codelens`` logger."""
    global _CONFIGURED
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

        target = log_file if log_file is not None else os.environ.get("CODELENS_LOG_FILE")
        if target:
            try:
                path = Path(target).expanduser()
                if not path.parent.is_dir():
                    raise OSError("log directory does not exist")
                file_handler = logging.handlers.RotatingFileHandler(
                    path, maxBytes=MAX_FILE_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8",
                )
                file_handler.setFormatter(formatter)
                file_handler.addFilter(privacy)
                logger.addHandler(file_handler)
            except OSError as exc:
                # Logging must never prevent the API from starting.
                logger.warning("file log disabled path=%s reason=%s", "<redacted>", type(exc).__name__)
            else:
                logger.info("file log enabled path=%s", "<redacted>")

        _CONFIGURED = True
        return logger


def get_logger(suffix: str | None = None) -> logging.Logger:
    """Return the shared logger (or a named child) after basic setup."""
    root = configure_logging()
    return logging.getLogger(f"{LOGGER_NAME}.{suffix}") if suffix else root


def reset_for_tests() -> None:
    """Drop handlers so a test can reconfigure with its own level/file."""
    global _CONFIGURED
    with _LOCK:
        logger = logging.getLogger(LOGGER_NAME)
        for handler in list(logger.handlers):
            handler.close()
            logger.removeHandler(handler)
        _CONFIGURED = False


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
