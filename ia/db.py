"""
db.py
Persistencia de CompuFácil en SQLite (archivo compufacil.db, sin instalar nada
extra: sqlite3 viene incluido en Python).

Guarda: usuarios, eventos de uso, conversación con el Tutor IA, valoraciones
de respuestas (👍/👎), intentos de la prueba diagnóstica y comentarios
(feedback). Todo lo consulta el panel web.
"""

import json
import os
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

DB_PATH = Path(os.getenv("COMPUFACIL_DB", Path(__file__).with_name("compufacil.db")))
LEGACY_HISTORY = Path(__file__).resolve().parent.parent / "bot" / "quiz_history.json"

_lock = threading.Lock()


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


_conn = None


def get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = connect()
    return _conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    tutor_reset_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    message_id INTEGER,
    value INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quiz_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quiz_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id INTEGER NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    question TEXT,
    topic TEXT,
    answer TEXT,
    correct INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    rating INTEGER,
    category TEXT,
    comment TEXT,
    status TEXT NOT NULL DEFAULT 'nuevo',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON quiz_attempts(user_id);
"""


def init_db() -> None:
    conn = get_conn()
    with _lock:
        conn.executescript(SCHEMA)
        cols = [r[1] for r in conn.execute("PRAGMA table_info(quiz_answers)").fetchall()]
        if "question" not in cols:
            conn.execute("ALTER TABLE quiz_answers ADD COLUMN question TEXT")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS content ("
            "key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        conn.commit()
    _import_legacy_history()


def _import_legacy_history() -> None:
    """Importa una sola vez el quiz_history.json de la versión anterior."""
    if not LEGACY_HISTORY.exists():
        return
    conn = get_conn()
    already = conn.execute("SELECT COUNT(*) FROM quiz_attempts").fetchone()[0]
    if already:
        return
    try:
        data = json.loads(LEGACY_HISTORY.read_text(encoding="utf-8"))
    except Exception:
        return
    with _lock:
        for user_id, attempts in data.items():
            for a in attempts:
                try:
                    d = datetime.strptime(a["date"], "%d/%m/%Y").strftime("%Y-%m-%d 12:00:00")
                except Exception:
                    d = now()
                _touch_user(conn, user_id, None, d)
                conn.execute(
                    "INSERT INTO quiz_attempts(user_id, score, total, created_at) VALUES (?,?,?,?)",
                    (user_id, int(a["score"]), int(a["total"]), d),
                )
        conn.commit()


# ---------------------------------------------------------------------------
# Escritura
# ---------------------------------------------------------------------------

def _touch_user(conn, user_id: str, name: str | None, when: str | None = None) -> None:
    when = when or now()
    row = conn.execute("SELECT id, name FROM users WHERE id=?", (user_id,)).fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO users(id, name, first_seen, last_seen) VALUES (?,?,?,?)",
            (user_id, name, when, when),
        )
    else:
        conn.execute(
            "UPDATE users SET last_seen=?, name=COALESCE(?, name) WHERE id=?",
            (when, name, user_id),
        )


def touch_user(user_id: str, name: str | None = None) -> None:
    conn = get_conn()
    with _lock:
        _touch_user(conn, user_id, name)
        conn.commit()


def log_event(user_id: str, type_: str, detail: str | None = None, name: str | None = None) -> None:
    conn = get_conn()
    with _lock:
        _touch_user(conn, user_id, name)
        conn.execute(
            "INSERT INTO events(user_id, type, detail, created_at) VALUES (?,?,?,?)",
            (user_id, type_, detail, now()),
        )
        conn.commit()


def add_message(user_id: str, role: str, content: str, source: str | None = None) -> int:
    conn = get_conn()
    with _lock:
        cur = conn.execute(
            "INSERT INTO messages(user_id, role, content, source, created_at) VALUES (?,?,?,?,?)",
            (user_id, role, content, source, now()),
        )
        conn.commit()
        return cur.lastrowid


def recent_history(user_id: str, limit: int = 8) -> list[dict]:
    """Últimos mensajes del tutor desde el último 'NUEVO' del usuario."""
    conn = get_conn()
    reset = conn.execute("SELECT tutor_reset_at FROM users WHERE id=?", (user_id,)).fetchone()
    since = reset["tutor_reset_at"] if reset and reset["tutor_reset_at"] else "0000"
    rows = conn.execute(
        "SELECT role, content FROM messages WHERE user_id=? AND created_at>=? "
        "ORDER BY id DESC LIMIT ?",
        (user_id, since, limit),
    ).fetchall()
    return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]


def reset_tutor(user_id: str) -> None:
    conn = get_conn()
    with _lock:
        _touch_user(conn, user_id, None)
        conn.execute("UPDATE users SET tutor_reset_at=? WHERE id=?", (now(), user_id))
        conn.commit()


def add_rating(user_id: str, value: int, message_id: int | None = None) -> int | None:
    conn = get_conn()
    with _lock:
        if message_id is None:
            row = conn.execute(
                "SELECT id FROM messages WHERE user_id=? AND role='assistant' ORDER BY id DESC LIMIT 1",
                (user_id,),
            ).fetchone()
            message_id = row["id"] if row else None
        conn.execute(
            "INSERT INTO ratings(user_id, message_id, value, created_at) VALUES (?,?,?,?)",
            (user_id, message_id, value, now()),
        )
        conn.commit()
        return message_id


def add_quiz_attempt(user_id: str, score: int, total: int, answers: list[dict], name: str | None = None) -> int:
    conn = get_conn()
    with _lock:
        _touch_user(conn, user_id, name)
        cur = conn.execute(
            "INSERT INTO quiz_attempts(user_id, score, total, created_at) VALUES (?,?,?,?)",
            (user_id, score, total, now()),
        )
        attempt_id = cur.lastrowid
        for a in answers:
            conn.execute(
                "INSERT INTO quiz_answers(attempt_id, question_id, question, topic, answer, correct) VALUES (?,?,?,?,?,?)",
                (attempt_id, a.get("question_id", "?"), a.get("question"), a.get("topic"), a.get("answer"), 1 if a.get("correct") else 0),
            )
        conn.commit()
        return attempt_id


def add_feedback(user_id: str, rating: int | None, category: str | None, comment: str | None, name: str | None = None) -> int:
    conn = get_conn()
    with _lock:
        _touch_user(conn, user_id, name)
        cur = conn.execute(
            "INSERT INTO feedback(user_id, rating, category, comment, created_at) VALUES (?,?,?,?,?)",
            (user_id, rating, category, comment, now()),
        )
        conn.commit()
        return cur.lastrowid


def set_feedback_status(feedback_id: int, status: str) -> None:
    conn = get_conn()
    with _lock:
        conn.execute("UPDATE feedback SET status=? WHERE id=?", (status, feedback_id))
        conn.commit()


# ---------------------------------------------------------------------------
# Lectura para el bot
# ---------------------------------------------------------------------------

def user_progress(user_id: str) -> dict:
    conn = get_conn()
    attempts = [
        dict(r)
        for r in conn.execute(
            "SELECT id, score, total, created_at FROM quiz_attempts WHERE user_id=? ORDER BY id",
            (user_id,),
        ).fetchall()
    ]
    weak = [
        dict(r)
        for r in conn.execute(
            "SELECT qa.topic AS topic, SUM(1-qa.correct) AS wrong, COUNT(*) AS total "
            "FROM quiz_answers qa JOIN quiz_attempts a ON a.id=qa.attempt_id "
            "WHERE a.user_id=? AND qa.topic IS NOT NULL GROUP BY qa.topic "
            "HAVING wrong>0 ORDER BY (1.0*wrong/total) DESC, wrong DESC",
            (user_id,),
        ).fetchall()
    ]
    counts = {
        r["type"]: r["n"]
        for r in conn.execute(
            "SELECT type, COUNT(*) AS n FROM events WHERE user_id=? GROUP BY type", (user_id,)
        ).fetchall()
    }
    counts["tutor_questions"] = conn.execute(
        "SELECT COUNT(*) FROM messages WHERE user_id=? AND role='user'", (user_id,)
    ).fetchone()[0]
    videos = [
        r["detail"]
        for r in conn.execute(
            "SELECT DISTINCT detail FROM events WHERE user_id=? AND type='video_view'", (user_id,)
        ).fetchall()
    ]
    return {"attempts": attempts, "weak_topics": weak, "counts": counts, "videos_seen": videos}


# ---------------------------------------------------------------------------
# Lectura para el panel
# ---------------------------------------------------------------------------

def _rows(sql: str, params: tuple = ()) -> list[dict]:
    return [dict(r) for r in get_conn().execute(sql, params).fetchall()]


def _one(sql: str, params: tuple = ()):
    return get_conn().execute(sql, params).fetchone()[0]


def admin_summary() -> dict:
    return {
        "users": _one("SELECT COUNT(*) FROM users"),
        "active_7d": _one("SELECT COUNT(*) FROM users WHERE last_seen >= datetime('now','localtime','-7 day')"),
        "tutor_questions": _one("SELECT COUNT(*) FROM messages WHERE role='user'"),
        "quiz_attempts": _one("SELECT COUNT(*) FROM quiz_attempts"),
        "quiz_avg": _one("SELECT ROUND(AVG(100.0*score/total),1) FROM quiz_attempts"),
        "video_views": _one("SELECT COUNT(*) FROM events WHERE type='video_view'"),
        "feedback_count": _one("SELECT COUNT(*) FROM feedback"),
        "feedback_new": _one("SELECT COUNT(*) FROM feedback WHERE status='nuevo'"),
        "feedback_avg": _one("SELECT ROUND(AVG(rating),2) FROM feedback WHERE rating IS NOT NULL"),
        "thumbs_up": _one("SELECT COUNT(*) FROM ratings WHERE value>0"),
        "thumbs_down": _one("SELECT COUNT(*) FROM ratings WHERE value<0"),
        "voice_in": _one("SELECT COUNT(*) FROM events WHERE type='voice_in' AND detail='ok'"),
        "voice_out": _one("SELECT COUNT(*) FROM events WHERE type='voice_out'"),
        "accessible_users": _one(
            "SELECT COUNT(*) FROM (SELECT user_id, MAX(id) AS last FROM events "
            "WHERE type IN ('accessible_on','accessible_off') GROUP BY user_id) t "
            "JOIN events e ON e.id=t.last WHERE e.type='accessible_on'"
        ),
        "menu_usage": _rows(
            "SELECT detail AS option, COUNT(*) AS n FROM events WHERE type='menu_option' "
            "GROUP BY detail ORDER BY n DESC"
        ),
        "daily": _rows(
            "SELECT substr(created_at,1,10) AS day, COUNT(*) AS n, COUNT(DISTINCT user_id) AS users "
            "FROM events GROUP BY day ORDER BY day DESC LIMIT 30"
        ),
        "rating_dist": _rows(
            "SELECT rating, COUNT(*) AS n FROM feedback WHERE rating IS NOT NULL GROUP BY rating ORDER BY rating"
        ),
    }


def admin_feedback() -> list[dict]:
    return _rows(
        "SELECT f.id, f.user_id, u.name, f.rating, f.category, f.comment, f.status, f.created_at "
        "FROM feedback f LEFT JOIN users u ON u.id=f.user_id ORDER BY f.id DESC"
    )


def admin_quiz() -> dict:
    return {
        "attempts": _rows(
            "SELECT a.id, a.user_id, u.name, a.score, a.total, "
            "ROUND(100.0*a.score/a.total,0) AS pct, a.created_at "
            "FROM quiz_attempts a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC"
        ),
        "by_topic": _rows(
            "SELECT topic, COUNT(*) AS answered, SUM(correct) AS correct, "
            "ROUND(100.0*SUM(correct)/COUNT(*),0) AS pct FROM quiz_answers "
            "WHERE topic IS NOT NULL GROUP BY topic ORDER BY pct"
        ),
        "by_question": _rows(
            "SELECT question_id, MAX(question) AS question, topic, COUNT(*) AS answered, ROUND(100.0*SUM(correct)/COUNT(*),0) AS pct "
            "FROM quiz_answers GROUP BY question_id ORDER BY pct"
        ),
    }


def admin_tutor(limit: int = 300) -> list[dict]:
    return _rows(
        "SELECT q.id, q.user_id, u.name, q.content AS question, q.created_at, "
        "(SELECT a.content FROM messages a WHERE a.user_id=q.user_id AND a.role='assistant' AND a.id>q.id ORDER BY a.id LIMIT 1) AS answer, "
        "(SELECT a.source FROM messages a WHERE a.user_id=q.user_id AND a.role='assistant' AND a.id>q.id ORDER BY a.id LIMIT 1) AS source, "
        "(SELECT r.value FROM ratings r WHERE r.message_id=(SELECT a.id FROM messages a WHERE a.user_id=q.user_id AND a.role='assistant' AND a.id>q.id ORDER BY a.id LIMIT 1) ORDER BY r.id DESC LIMIT 1) AS rating "
        "FROM messages q LEFT JOIN users u ON u.id=q.user_id WHERE q.role='user' ORDER BY q.id DESC LIMIT ?",
        (limit,),
    )


def admin_videos() -> list[dict]:
    return _rows(
        "SELECT detail AS video, COUNT(*) AS views, COUNT(DISTINCT user_id) AS users, MAX(created_at) AS last_view "
        "FROM events WHERE type='video_view' GROUP BY detail ORDER BY views DESC"
    )


def admin_users() -> list[dict]:
    return _rows(
        "SELECT u.id, u.name, u.first_seen, u.last_seen, "
        "(SELECT COUNT(*) FROM messages m WHERE m.user_id=u.id AND m.role='user') AS questions, "
        "(SELECT COUNT(*) FROM quiz_attempts a WHERE a.user_id=u.id) AS attempts, "
        "(SELECT ROUND(AVG(100.0*score/total),0) FROM quiz_attempts a WHERE a.user_id=u.id) AS avg_pct, "
        "(SELECT COUNT(*) FROM events e WHERE e.user_id=u.id AND e.type='video_view') AS videos, "
        "(SELECT COUNT(*) FROM feedback f WHERE f.user_id=u.id) AS feedback "
        "FROM users u ORDER BY u.last_seen DESC"
    )


# ---------------------------------------------------------------------------
# Contenido administrable (videos, banco de preguntas, respuestas sin IA)
# ---------------------------------------------------------------------------

def get_content(key: str):
    row = get_conn().execute("SELECT data FROM content WHERE key=?", (key,)).fetchone()
    return json.loads(row[0]) if row else None


def set_content(key: str, data, only_if_missing: bool = False) -> bool:
    conn = get_conn()
    with _lock:
        if only_if_missing and conn.execute("SELECT 1 FROM content WHERE key=?", (key,)).fetchone():
            return False
        conn.execute(
            "INSERT INTO content(key, data, updated_at) VALUES (?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            (key, json.dumps(data, ensure_ascii=False), now()),
        )
        conn.commit()
    return True


def content_version() -> str:
    import hashlib

    rows = get_conn().execute("SELECT key, data FROM content ORDER BY key").fetchall()
    return hashlib.md5("|".join(f"{k}={d}" for k, d in rows).encode("utf-8")).hexdigest()[:12]


EXPORTS = {
    "usuarios": admin_users,
    "comentarios": admin_feedback,
    "intentos": lambda: admin_quiz()["attempts"],
    "temas": lambda: admin_quiz()["by_topic"],
    "tutor": lambda: admin_tutor(100000),
    "videos": admin_videos,
    "eventos": lambda: _rows("SELECT * FROM events ORDER BY id DESC"),
}
