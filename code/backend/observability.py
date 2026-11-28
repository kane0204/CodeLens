"""本机 CodeLens API 的结构化日志与隐私保护。

新增日志时遵守以下约束。

* 不记录源码文本、项目名、文件路径、令牌、API Key 或请求体。
* 请求日志仅记录接口、方法、状态、耗时、字节数和异常类型等元数据。
  请求编号会同时返回给界面，用户反馈「请求 a1b2c3d4」即可关联日志。
* 异常消息脱敏后截断，堆栈只保留帧的定位信息，不附上源码行文本。

默认将日志写入 ``<repo>/logs/codelens.log``，自动创建目录，单文件达到
5 MiB 时轮转，最多保留 5 个备份。进程意外退出后仍可查看已写入的日志。

* ``--log-file <path>`` 或 ``CODELENS_LOG_FILE`` 可替换默认路径。
* ``--no-log-file`` 或 ``CODELENS_LOG_DISABLE_FILE=1`` 仅输出到控制台。
* ``--log-level`` 或 ``CODELENS_LOG_LEVEL`` 可设置 DEBUG、INFO、WARNING、ERROR。
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
from collections import deque
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
API_CREDENTIAL_SAVE = "/api/credentials/save"
API_CREDENTIAL_DELETE = "/api/credentials/delete"
API_HISTORY_PROJECTS = "/api/history/projects"
API_HISTORY_RUNS = "/api/history/runs"
API_HISTORY_DETAIL = "/api/history/detail"
API_HISTORY_DELETE = "/api/history/delete"
API_PATHS = frozenset({API_STATUS, API_AI_STATUS, API_ANALYZE, API_AI,
                       API_EXPLAIN, API_REVIEW, API_REVIEW_CACHED,
                       API_CREDENTIAL_SAVE, API_CREDENTIAL_DELETE,
                       API_HISTORY_PROJECTS, API_HISTORY_RUNS,
                       API_HISTORY_DETAIL, API_HISTORY_DELETE})

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f]")
# 日志入口的补充脱敏，识别形似凭据或源码内容的键值对。
_SECRET_PAIRS = re.compile(
    r"(?i)\b(api[_-]?key|token|secret|password|authorization|content_base64|source|content)\b"
    r"""["']?\s*[=:]\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;&]+)"""
)
_BEARER = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._\-]+")
# 按字段名识别敏感信息，后续新增日志字段也沿用此规则。
_SENSITIVE_FIELD = re.compile(
    r"(?i)(project|filename|file_path|filepath|source|content|payload|body|code|api[_-]?key|token|secret)"
)
_DISABLE_VALUES = {"1", "true", "yes", "on"}

_LOCK = threading.Lock()
_CONFIGURED = False
_HOOKS_INSTALLED = False
ACTIVE_LOG_FILE: Path | None = None


def new_id() -> str:
    """生成可在界面展示的随机短编号，用于关联请求日志。"""
    return secrets.token_hex(4)


def redact(value: Any, limit: int = MAX_MESSAGE) -> str:
    """规整控制字符、遮盖疑似凭据的键值对，再截断超长文本。"""
    text = _CONTROL_CHARS.sub(" ", str(value))
    text = _BEARER.sub("Bearer <redacted>", text)
    text = _SECRET_PAIRS.sub(lambda m: f"{m.group(1)}=<redacted>", text)
    text = " ".join(text.split())
    if len(text) > limit:
        text = text[:limit] + "…"
    return text


def safe_path(path: str) -> str:
    """只原样记录已知的 API 路由，其他路径统一占位。"""
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
    """在处理器输出前，为日志文本再执行一次脱敏。"""

    def filter(self, record: logging.LogRecord) -> bool:
        # 先合并参数再脱敏，清空 args 避免 handler 二次格式化原始参数。
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
    """线程安全地初始化日志，同一进程内复用 ``codelens`` 日志记录器。"""
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
        # 文件系统异常可能带有路径，只记录异常类型。
        logger.warning("file log disabled reason=%s", type(exc).__name__)
        return None
    logger.info("file log enabled rotation_mb=%s backups=%s",
                MAX_FILE_BYTES // (1024 * 1024), BACKUP_COUNT)
    return path


def active_log_file() -> Path | None:
    """返回当前日志文件路径，None 表示仅输出到控制台。"""
    return ACTIVE_LOG_FILE


def get_logger(suffix: str | None = None) -> logging.Logger:
    """完成基本配置后返回共享日志记录器，或指定名称的子记录器。"""
    root = configure_logging()
    return logging.getLogger(f"{LOGGER_NAME}.{suffix}") if suffix else root


def reset_for_tests() -> None:
    """清除现有处理器，供测试重新设置日志等级和文件位置。"""
    global _CONFIGURED, ACTIVE_LOG_FILE
    with _LOCK:
        logger = logging.getLogger(LOGGER_NAME)
        for handler in list(logger.handlers):
            handler.close()
            logger.removeHandler(handler)
        ACTIVE_LOG_FILE = None
        _CONFIGURED = False


def flush_all(logger: logging.Logger) -> None:
    """进程退出前刷新日志处理器中尚未输出的记录。"""
    for handler in list(logger.handlers):
        try:
            handler.flush()
        except Exception as exc:
            # 日志处理器本身失败时，绕过它并只输出异常类型。
            with suppress(OSError, ValueError):
                print(f"codelens: log flush failed ({type(exc).__name__})", file=sys.stderr)


def exception_summary(exc: BaseException) -> dict[str, str]:
    """提取异常类型、脱敏消息和栈帧定位信息，不读取源码行文本。"""
    # 从 traceback 直接读取元数据，避免查找源码行或生成完整堆栈。
    frames = deque(
        ((frame.f_code.co_filename, frame.f_code.co_name, line)
         for frame, line in traceback.walk_tb(exc.__traceback__)),
        maxlen=6,
    )
    chain = ";".join(
        f"{Path(filename).name}:{name}:{line}" for filename, name, line in frames
    )
    return {
        "type": type(exc).__name__,
        "message": redact(exc),
        "frames": chain or "-",
    }


def log_exception(logger: logging.Logger, exc: BaseException, request_id: str,
                  **context: Any) -> None:
    """使用请求编号关联异常摘要，仅记录脱敏消息和栈帧位置。"""
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
    """记录主线程和工作线程的未捕获异常，以及进程退出信息，供事后排查。

    ThreadingHTTPServer 每个请求使用单独线程，因此同时安装
    ``threading.excepthook`` 和 ``sys.excepthook``。
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
        # 测试等场景可能已关闭处理器，先确认还有处理器可用。
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
