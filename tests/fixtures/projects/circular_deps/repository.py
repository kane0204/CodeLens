"""Persistence layer."""

from services import DEFAULT_SOURCE


class UserRepository:
    """Store and look up users."""

    def save(self, user):
        """Persist a user and return its storage key."""
        return f"{DEFAULT_SOURCE}:{user.email}"
