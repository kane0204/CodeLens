"""Domain entities."""


class User:
    """A registered user."""

    def __init__(self, name, email):
        self.name = name
        self.email = email

    def display_name(self):
        """Return the display name."""
        return self.name
