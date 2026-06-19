"""SQLite 存储层 —— 帖子、评论、抓取记录。"""
from __future__ import annotations

import os
import sqlite3
import json
import time
from contextlib import contextmanager
from typing import Iterable, Iterator, Optional

DB_PATH = os.environ.get("DB_PATH", "./data/sentiment.db")


SCHEMA = """
CREATE TABLE IF NOT EXISTS posts (
  id              TEXT PRIMARY KEY,         -- platform:native_id
  platform        TEXT NOT NULL,
  type            TEXT NOT NULL,            -- video / note / post
  stock_code      TEXT NOT NULL,            -- 关联股票
  stock_name      TEXT,
  title           TEXT NOT NULL,
  content         TEXT,
  author          TEXT,
  url             TEXT NOT NULL,
  ts              INTEGER NOT NULL,         -- 发布时间 ms
  likes           INTEGER,
  comments        INTEGER,
  views           INTEGER,
  sentiment       INTEGER,                  -- -1 / 0 / 1
  sentiment_score REAL,
  raw_json        TEXT,                     -- 原始记录（调试用）
  fetched_at      INTEGER NOT NULL          -- 落库时间 ms
);
CREATE INDEX IF NOT EXISTS idx_posts_stock_ts ON posts(stock_code, ts DESC);
CREATE INDEX IF NOT EXISTS idx_posts_platform_ts ON posts(platform, ts DESC);

CREATE TABLE IF NOT EXISTS fetch_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_code  TEXT NOT NULL,
  platform    TEXT NOT NULL,
  ok          INTEGER NOT NULL,
  count       INTEGER,
  error       TEXT,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_stock ON fetch_runs(stock_code, started_at DESC);
"""


def _ensure_dir() -> None:
    d = os.path.dirname(DB_PATH)
    if d:
        os.makedirs(d, exist_ok=True)


@contextmanager
def conn() -> Iterator[sqlite3.Connection]:
    _ensure_dir()
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init_db() -> None:
    with conn() as c:
        c.executescript(SCHEMA)


# ---------------------------- 写 ----------------------------

def upsert_posts(rows: Iterable[dict]) -> int:
    rows = list(rows)
    if not rows:
        return 0
    now = int(time.time() * 1000)
    with conn() as c:
        cur = c.executemany(
            """
            INSERT INTO posts (id, platform, type, stock_code, stock_name, title,
                               content, author, url, ts, likes, comments, views,
                               sentiment, sentiment_score, raw_json, fetched_at)
            VALUES (:id, :platform, :type, :stock_code, :stock_name, :title,
                    :content, :author, :url, :ts, :likes, :comments, :views,
                    :sentiment, :sentiment_score, :raw_json, :fetched_at)
            ON CONFLICT(id) DO UPDATE SET
              likes = excluded.likes,
              comments = excluded.comments,
              views = excluded.views,
              sentiment = excluded.sentiment,
              sentiment_score = excluded.sentiment_score,
              fetched_at = excluded.fetched_at
            """,
            [
                {
                    "id": r["id"],
                    "platform": r["platform"],
                    "type": r.get("type", "post"),
                    "stock_code": r["stock_code"],
                    "stock_name": r.get("stock_name"),
                    "title": r["title"],
                    "content": r.get("content"),
                    "author": r.get("author"),
                    "url": r["url"],
                    "ts": int(r.get("ts") or 0),
                    "likes": r.get("likes"),
                    "comments": r.get("comments"),
                    "views": r.get("views"),
                    "sentiment": r.get("sentiment"),
                    "sentiment_score": r.get("sentiment_score"),
                    "raw_json": json.dumps(r.get("raw"), ensure_ascii=False) if r.get("raw") else None,
                    "fetched_at": now,
                }
                for r in rows
            ],
        )
        return cur.rowcount or 0


def log_run(stock_code: str, platform: str, ok: bool, count: int, error: Optional[str], started: int) -> None:
    with conn() as c:
        c.execute(
            """INSERT INTO fetch_runs (stock_code, platform, ok, count, error, started_at, finished_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (stock_code, platform, 1 if ok else 0, count, error, started, int(time.time() * 1000)),
        )


# ---------------------------- 读 ----------------------------

def list_posts(stock_code: str, platforms: list[str], limit: int = 40) -> list[dict]:
    if not platforms:
        return []
    placeholders = ",".join("?" for _ in platforms)
    with conn() as c:
        rows = c.execute(
            f"""SELECT * FROM posts
                 WHERE stock_code = ?
                   AND platform IN ({placeholders})
                 ORDER BY ts DESC
                 LIMIT ?""",
            (stock_code, *platforms, limit),
        ).fetchall()
    return [dict(r) for r in rows]
