import json
import math
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


TOKEN_RE = re.compile(r"[a-z0-9]+")


@dataclass
class SearchResult:
    transcript_id: int
    score: float
    language: str
    transcript: str
    summary: str
    keywords: list[str]
    created_at: str


class TranscriptVectorStore:
    """A lightweight local vector store backed by SQLite.

    This keeps a persistent embedding for each analyzed transcript so the project
    can demonstrate transcript indexing and semantic retrieval without adding an
    external infrastructure dependency.
    """

    def __init__(self, db_path: str | Path, dimensions: int = 256):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.dimensions = dimensions
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS transcript_vectors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    language TEXT NOT NULL,
                    transcript TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    keywords_json TEXT NOT NULL,
                    embedding_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def _tokenize(self, text: str) -> list[str]:
        return TOKEN_RE.findall((text or "").lower())

    def embed_text(self, text: str) -> list[float]:
        vector = [0.0] * self.dimensions
        tokens = self._tokenize(text)
        if not tokens:
            return vector

        for token in tokens:
            bucket = hash(token) % self.dimensions
            sign = 1.0 if (hash(f"{token}:sign") % 2 == 0) else -1.0
            vector[bucket] += sign

        norm = math.sqrt(sum(value * value for value in vector))
        if norm == 0:
            return vector
        return [value / norm for value in vector]

    def add_transcript(
        self,
        *,
        language: str,
        transcript: str,
        summary: str,
        keywords: list[str],
    ) -> int:
        searchable_text = " ".join(
            part for part in [transcript, summary, " ".join(keywords)] if part
        )
        embedding = self.embed_text(searchable_text)
        created_at = datetime.now(timezone.utc).isoformat()

        with self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO transcript_vectors (
                    language,
                    transcript,
                    summary,
                    keywords_json,
                    embedding_json,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    language,
                    transcript,
                    summary,
                    json.dumps(keywords),
                    json.dumps(embedding),
                    created_at,
                ),
            )
            conn.commit()
            return int(cursor.lastrowid)

    def count(self) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS total FROM transcript_vectors").fetchone()
            return int(row["total"])

    def search(self, query: str, limit: int = 5) -> list[SearchResult]:
        query_embedding = self.embed_text(query)
        results: list[SearchResult] = []

        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, language, transcript, summary, keywords_json, embedding_json, created_at
                FROM transcript_vectors
                ORDER BY id DESC
                """
            ).fetchall()

        for row in rows:
            stored_embedding = json.loads(row["embedding_json"])
            score = sum(a * b for a, b in zip(query_embedding, stored_embedding))
            results.append(
                SearchResult(
                    transcript_id=int(row["id"]),
                    score=float(score),
                    language=row["language"],
                    transcript=row["transcript"],
                    summary=row["summary"],
                    keywords=json.loads(row["keywords_json"]),
                    created_at=row["created_at"],
                )
            )

        results.sort(key=lambda item: item.score, reverse=True)
        return results[:limit]

    def stats(self) -> dict[str, Any]:
        return {
            "enabled": True,
            "db_path": str(self.db_path),
            "dimensions": self.dimensions,
            "indexed_transcripts": self.count(),
        }
