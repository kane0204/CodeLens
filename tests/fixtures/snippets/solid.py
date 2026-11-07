"""SOLID rule snippets (SRS FR-15, rules SRP-01 / OCP-01 / DIP-01).

Naming convention: ``*_positive`` must trigger the rule; ``*_negative`` must not.
"""


class SrpPositive:
    """Positive: methods cluster on two unrelated field groups."""

    def __init__(self):
        self.x = 0
        self.y = 0
        self.log_lines = []

    def move_x(self):
        """Move along x."""
        self.x += 1

    def move_y(self):
        """Move along y."""
        self.y += 1

    def log(self, message):
        """Append a log line."""
        self.log_lines.append(message)

    def flush_log(self):
        """Drop all log lines."""
        self.log_lines.clear()


class SrpNegative:
    """Negative: single responsibility, one field group."""

    def __init__(self):
        self.x = 0
        self.y = 0

    def move_x(self):
        """Move along x."""
        self.x += 1

    def move_y(self):
        """Move along y."""
        self.y += 1


def ocp_positive(shape):
    """Positive: type branch chain of length 3 (threshold >=3)."""
    if shape.kind == "circle":
        return 3.14 * shape.r * shape.r
    elif shape.kind == "square":
        return shape.side * shape.side
    elif shape.kind == "triangle":
        return shape.base * shape.height / 2
    return 0.0


def ocp_negative(shape):
    """Negative: only two type branches, below the threshold."""
    if shape.kind == "circle":
        return 3.14 * shape.r * shape.r
    return 0.0


class MySqlDatabase:
    """A concrete database implementation."""

    def query(self, sql):
        """Run a query."""
        return sql


class DipPositive:
    """Positive: high-level service hard-wires a concrete implementation."""

    def __init__(self):
        self.db = MySqlDatabase()

    def run(self):
        """Run the report query."""
        return self.db.query("select 1")


class DipNegative:
    """Negative: the database is injected as an abstraction."""

    def __init__(self, database):
        self.db = database

    def run(self):
        """Run the report query."""
        return self.db.query("select 1")
