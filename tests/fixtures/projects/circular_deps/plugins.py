"""Plugin lookup used for dynamic base classes."""

from models import User


def get_base():
    """Return the base class for admin users."""
    return User
