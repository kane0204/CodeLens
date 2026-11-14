"""Privacy and structure guarantees for the local API logger."""
import io
import json
import logging
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from contextlib import redirect_stderr
from unittest.mock import Mock, patch

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "code"))
from backend import observability as obs


class RedactionTests(unittest.TestCase):
    def test_secret_pairs_and_bearer_are_scrubbed(self):
        cleaned = obs.redact('api_key="SENTINEL_KEY" token: SENTINEL_TOKEN Bearer abc.def-ghi')
        for marker in ("SENTINEL_KEY", "SENTINEL_TOKEN", "abc.def-ghi"):
            self.assertNotIn(marker, cleaned)
        self.assertIn("<redacted>", cleaned)

    def test_json_credentials_with_spaces_and_escaped_quotes_are_scrubbed(self):
        message = json.dumps({"api_key": 'BEFORE "AFTER" TAIL', "token": "PRIVATE", "status": 500})
        cleaned = obs.redact(message)
        for marker in ("BEFORE", "AFTER", "TAIL", "PRIVATE"):
            self.assertNotIn(marker, cleaned)
        self.assertIn("500", cleaned)

    def test_control_chars_and_length_limit(self):
        cleaned = obs.redact("a\n\tb\x00" + "x" * 500, limit=60)
        self.assertNotIn("\n", cleaned)
        self.assertNotIn("\x00", cleaned)
        self.assertLessEqual(len(cleaned), 61)

    def test_unknown_routes_are_opaque(self):
        self.assertEqual(obs.safe_path("/api/analyze"), "/api/analyze")
        self.assertEqual(obs.safe_path("/api/analyze?project=SECRET"), "<other>")
        self.assertEqual(obs.safe_path("/etc/passwd"), "<other>")

    def test_sensitive_fields_are_dropped(self):
        line = obs.format_fields({
            "project": "SENTINEL_PROJECT",
            "content": "SENTINEL_CODE",
            "status": 200,
        })
        self.assertNotIn("SENTINEL_PROJECT", line)
        self.assertNotIn("SENTINEL_CODE", line)
        self.assertIn("status=200", line)

    def test_exception_summary_never_includes_source_lines(self):
        try:
            raise ValueError("boom")
        except ValueError as exc:
            detail = obs.exception_summary(exc)
        self.assertEqual(detail["type"], "ValueError")
        self.assertIn("test_exception_summary", detail["frames"])
        self.assertNotIn("raise ValueError", detail["frames"])

    def test_new_id_is_unique_and_short(self):
        ids = {obs.new_id() for _ in range(50)}
        self.assertEqual(len(ids), 50)
        self.assertTrue(all(len(item) == 8 for item in ids))

    def test_levels_are_public(self):
        self.assertIn("DEBUG", obs.LEVELS)
        self.assertIn("ERROR", obs.LEVELS)


class FileLoggingTests(unittest.TestCase):
    def setUp(self):
        obs.reset_for_tests()
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "api.log"

    def tearDown(self):
        obs.reset_for_tests()
        self.tmp.cleanup()

    def test_file_log_receives_redacted_records_only(self):
        logger = obs.configure_logging("INFO", str(self.path))
        logger.info("event name=probe %s", obs.format_fields({
            "api_key": "SENTINEL_KEY",
            "status": 200,
        }))
        for handler in logger.handlers:
            handler.flush()
        text = self.path.read_text(encoding="utf-8")
        self.assertIn("event name=probe", text)
        self.assertIn("status=200", text)
        self.assertNotIn("SENTINEL_KEY", text)

    def test_configure_is_idempotent(self):
        first = obs.configure_logging("INFO", str(self.path))
        second = obs.configure_logging("ERROR", str(self.path))
        self.assertIs(first, second)
        self.assertEqual(len(first.handlers), 2)

    def test_file_open_failure_keeps_console_logging_and_hides_path(self):
        with redirect_stderr(io.StringIO()) as console, patch.object(
            obs.logging.handlers, "RotatingFileHandler",
            side_effect=PermissionError("cannot open PRIVATE_DIAGNOSTICS_PATH"),
        ):
            logger = obs.configure_logging("invalid-level", str(self.path))
            logger.info("still running")
        self.assertEqual(len(logger.handlers), 1)
        self.assertIn("file log disabled", console.getvalue())
        self.assertIn("still running", console.getvalue())
        self.assertNotIn("PRIVATE_DIAGNOSTICS_PATH", console.getvalue())

    def test_log_path_with_file_parent_is_nonfatal(self):
        self.path.touch()
        with redirect_stderr(io.StringIO()) as console:
            logger = obs.configure_logging("INFO", str(self.path / "nested.log"))
        self.assertEqual(len(logger.handlers), 1)
        self.assertIn("file log disabled", console.getvalue())

    def test_child_logger_respects_environment_level(self):
        with patch.dict(obs.os.environ, {"CODELENS_LOG_LEVEL": "WARNING", "CODELENS_LOG_FILE": ""}):
            with redirect_stderr(io.StringIO()) as console:
                logger = obs.get_logger("http")
                logger.info("filtered-out")
                logger.warning("survives")
        self.assertEqual(logger.name, "codelens.http")
        self.assertIn("survives", console.getvalue())
        self.assertNotIn("filtered-out", console.getvalue())

class DefaultFileLoggingTests(unittest.TestCase):
    def setUp(self):
        obs.reset_for_tests()
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "nested" / "logs" / "codelens.log"

    def tearDown(self):
        obs.reset_for_tests()
        self.tmp.cleanup()

    def test_default_path_is_created_automatically(self):
        self.assertFalse(self.path.parent.exists())
        with patch.object(obs, "DEFAULT_LOG_FILE", self.path):
            logger = obs.configure_logging()
            obs.log_event(logger, logging.INFO, "startup", pid=1)
            obs.flush_all(logger)
        self.assertTrue(self.path.is_file())
        self.assertEqual(obs.active_log_file(), self.path)
        self.assertIn("event name=startup", self.path.read_text(encoding="utf-8"))

    def test_can_be_disabled_by_flag(self):
        logger = obs.configure_logging(enable_file=False)
        self.assertIsNone(obs.active_log_file())
        self.assertEqual(len(logger.handlers), 1)
        self.assertFalse(self.path.exists())

    def test_can_be_disabled_by_environment(self):
        with patch.dict(os.environ, {"CODELENS_LOG_DISABLE_FILE": "1"}):
            logger = obs.configure_logging()
        self.assertIsNone(obs.active_log_file())
        self.assertEqual(len(logger.handlers), 1)

    def test_custom_path_overrides_default(self):
        logger = obs.configure_logging(log_file=str(self.path))
        obs.log_event(logger, logging.INFO, "probe")
        obs.flush_all(logger)
        self.assertEqual(obs.active_log_file(), self.path)
        self.assertTrue(self.path.exists())

    def test_flush_all_is_safe_without_handlers(self):
        obs.reset_for_tests()
        obs.flush_all(logging.getLogger(obs.LOGGER_NAME))


class CrashHookTests(unittest.TestCase):
    def setUp(self):
        self.sink = Mock()
        self.logger = Mock(handlers=[self.sink])
        self.enterContext(patch.object(obs, "_HOOKS_INSTALLED", False))
        self.previous_uncaught = self.enterContext(patch.object(sys, "excepthook"))
        self.previous_thread = self.enterContext(patch.object(threading, "excepthook"))
        self.register = self.enterContext(patch.object(obs.atexit, "register"))
        obs.install_crash_hooks(self.logger)
        self.on_exit = self.register.call_args.args[0]

    def test_hooks_are_installed_once(self):
        installed = sys.excepthook
        self.assertIsNot(installed, self.previous_uncaught)
        obs.install_crash_hooks(self.logger)
        self.assertIs(sys.excepthook, installed)
        self.register.assert_called_once()

    def test_uncaught_exception_is_logged_flushed_and_forwarded(self):
        error = ValueError("token=HIDE")
        sys.excepthook(ValueError, error, None)
        self.assertIn("token=<redacted>", self.logger.error.call_args.args)
        self.assertIn("event=uncaught", self.logger.error.call_args.args)
        self.previous_uncaught.assert_called_once_with(ValueError, error, None)
        self.sink.flush.assert_called_once()

    def test_keyboard_interrupt_is_recorded_as_exit(self):
        interrupt = KeyboardInterrupt()
        sys.excepthook(KeyboardInterrupt, interrupt, None)
        self.assertIn("reason=keyboard_interrupt", self.logger.log.call_args.args)
        self.logger.error.assert_not_called()
        self.previous_uncaught.assert_called_once_with(KeyboardInterrupt, interrupt, None)
        self.sink.flush.assert_called_once()

    def test_thread_failure_is_logged_flushed_and_forwarded(self):
        args = SimpleNamespace(exc_value=RuntimeError("crash"), thread=threading.current_thread())
        threading.excepthook(args)
        self.assertIn("event=thread_uncaught thread=" + args.thread.name, self.logger.error.call_args.args)
        self.previous_thread.assert_called_once_with(args)
        self.sink.flush.assert_called_once()

    def test_process_exit_is_logged_even_if_a_sink_fails_to_flush(self):
        self.sink.flush.side_effect = OSError("disk full")
        second_sink = Mock()
        self.logger.handlers.append(second_sink)
        with redirect_stderr(io.StringIO()) as console:
            try:
                raise RuntimeError("process crashed")
            except RuntimeError:
                self.on_exit()
        self.assertIn("log flush failed (OSError)", console.getvalue())
        self.assertNotIn("disk full", console.getvalue())
        self.assertIn("event=process_exit", self.logger.error.call_args.args)
        self.assertIn("process_exit", self.logger.log.call_args.args)
        second_sink.flush.assert_called_once()

    def test_process_exit_skips_logger_without_handlers(self):
        self.logger.handlers.clear()
        self.on_exit()
        self.logger.log.assert_not_called()
