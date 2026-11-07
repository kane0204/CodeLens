"""Shared helpers."""

API_KEY = "sk-live-8f3a2b1c9d0e4f5a6b7c8d9e0f1a2b3c"


def money(amount):
    """Format an amount as a two-decimal string."""
    return f"{amount:.2f}"


def unused_helper(value):
    """Double a value. Never called anywhere in the project."""
    return value * 2
