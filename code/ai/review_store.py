"""Local SQLite storage for completed reviews and resumable reading notes."""

from contextlib import closing
import json
from pathlib import Path
import sqlite3


DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "reviews.sqlite3"
MAX_CHECKPOINTS = 256


class ReviewStore:
    def __init__(self, path):
        self.path = Path(path)

    def _connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        return sqlite3.connect(self.path)

    def load(self, fingerprint):
        with closing(self._connect()) as db:
            db.execute(_CREATE_TABLE)
            row = db.execute("SELECT payload FROM review_checkpoint WHERE fingerprint = ?", (fingerprint,)).fetchone()
        return json.loads(row[0]) if row else None

    def save(self, fingerprint, checkpoint, updated):
        payload = json.dumps(checkpoint, ensure_ascii=True, separators=(",", ":"))
        with closing(self._connect()) as db, db:
            db.execute(_CREATE_TABLE)
            db.execute(
                """INSERT INTO review_checkpoint (fingerprint, payload, updated) VALUES (?, ?, ?)
                   ON CONFLICT(fingerprint) DO UPDATE SET payload = excluded.payload, updated = excluded.updated""",
                (fingerprint, payload, updated),
            )
            db.execute(
                """DELETE FROM review_checkpoint WHERE fingerprint IN (
                       SELECT fingerprint FROM review_checkpoint
                       ORDER BY updated DESC, fingerprint LIMIT -1 OFFSET ?
                   )""",
                (MAX_CHECKPOINTS,),
            )


_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS review_checkpoint (
    fingerprint TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated REAL NOT NULL
)
"""
