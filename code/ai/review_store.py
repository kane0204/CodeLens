"""Local SQLite storage for completed reviews and resumable reading notes."""

from contextlib import closing
import json
from pathlib import Path
import sqlite3


DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "reviews.sqlite3"
MAX_CHECKPOINTS = 256


class ReviewStore:
    """SQLite 检查点库。审查指纹标识完整结果或尚未完成的阅读进度。"""

    def __init__(self, path):
        self.path = Path(path)

    def _connect(self):
        # 各次读写使用独立连接，后台模型线程不需要共享 SQLite 连接。
        self.path.parent.mkdir(parents=True, exist_ok=True)
        return sqlite3.connect(self.path)

    def load(self, fingerprint):
        """缺少检查点时返回 None，供审查层决定是否重新开始。"""
        with closing(self._connect()) as db:
            db.execute(_CREATE_TABLE)
            row = db.execute("SELECT payload FROM review_checkpoint WHERE fingerprint = ?", (fingerprint,)).fetchone()
        return json.loads(row[0]) if row else None

    def save(self, fingerprint, checkpoint, updated):
        """原子保存进度并淘汰旧记录。同一更新时间按指纹稳定排序。"""
        # 编码可能涉及较大的审查结果，放在开启写事务之前。
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
