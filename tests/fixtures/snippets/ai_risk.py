"""AI-code risk rule snippets (SRS FR-16, rules A1-A5).

Naming convention: ``a<N>_positive`` must trigger rule A<N>; ``a<N>_negative``
must not. Rules A6-A8 are scheduled for W6-01 and are not covered here.
"""

import base64
import json
import os
import urllib.request

import ghost_sdk


def a1_negative_stdlib(payload):
    """Negative: dependency resolves to the standard library."""
    return json.dumps(payload)


def a1_positive_unresolved(payload):
    """Positive: ghost_sdk cannot be resolved to a declared dependency."""
    return ghost_sdk.transform(payload)


def a3_negative_protected(url):
    """Negative: network call wrapped in try/except."""
    try:
        return urllib.request.urlopen(url).read()
    except OSError:
        return b""


def a3_positive_unprotected(url):
    """Positive: network call without exception handling."""
    return urllib.request.urlopen(url).read()


def a4_negative_from_env():
    """Negative: secret read from the environment."""
    return os.environ.get("TOKEN", "")


def a4_positive_hardcoded():
    """Positive: secret literal embedded in source."""
    token = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q6r7"
    return token


def _a5_positive_never_called():
    """Positive: private function with no references anywhere."""
    return 42


def a2_positive_retry_a(client, payload):
    """Positive: duplicate of a2_positive_retry_b."""
    attempts = 0
    while attempts < 3:
        response = client.send(payload)
        if response.ok:
            return response.data
        attempts += 1
    return None


def a2_positive_retry_b(conn, body):
    """Positive: duplicate of a2_positive_retry_a."""
    tries = 0
    while tries < 3:
        reply = conn.send(body)
        if reply.ok:
            return reply.data
        tries += 1
    return None


def a5_negative_used():
    """Negative: referenced by a5_negative_caller below."""
    return base64.b64encode(b"payload").decode("ascii")


def a5_negative_caller():
    """Negative: calls a5_negative_used, so nothing is dead here."""
    return a5_negative_used()
