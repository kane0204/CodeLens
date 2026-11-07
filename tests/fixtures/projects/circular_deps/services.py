"""User-facing services."""

from notifications import Notifier
from plugins import get_base
from repository import UserRepository

DEFAULT_SOURCE = "web"


class User:
    """A user DTO used by the service layer."""

    def __init__(self, name, email):
        self.name = name
        self.email = email


class Vip(User):
    """A VIP user DTO."""

    def __init__(self, name, email, level):
        super().__init__(name, email)
        self.level = level


class Admin(get_base()):
    """Admin users; the base class is resolved at runtime."""


class UserService:
    """Coordinate user registration."""

    def __init__(self):
        self.repo = UserRepository()
        self.notifier = Notifier()

    def register(self, name, email):
        """Register a new user."""
        user = User(name, email)
        saved = self.repo.save(user)
        self.notifier.send_welcome(email)
        return saved
