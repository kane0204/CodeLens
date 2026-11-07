"""Notification helpers."""


class Notifier:
    """Send welcome messages."""

    def send_welcome(self, email):
        """Send a welcome message to the given address."""
        return f"welcome {email}"
