"""
content_admin.py
Contenido del chatbot que se administra desde el panel:

- videos:   videotutoriales (título, tema, ideas clave, enlace, archivo MP4)
- quiz:     banco de preguntas de la prueba diagnóstica y de los mini retos
- fallback: respuestas que usa el tutor cuando la IA no está disponible
- topics:   temas del curso (los envía el bot; solo lectura en el panel)

El bot de WhatsApp siembra sus valores de fábrica la primera vez y luego
consulta /api/content cada pocos segundos para aplicar los cambios.
"""

import os
import re
import unicodedata
from pathlib import Path

import db
from ia_service import fallback_defaults

BOT_DIR = Path(os.getenv("BOT_DIR", Path(__file__).resolve().parent.parent / "bot"))
VIDEO_DIR = BOT_DIR / "assets" / "videos"
MAX_VIDEO_MB = int(os.getenv("MAX_VIDEO_MB", "16"))
SECTIONS = ("videos", "quiz", "fallback")


class ContentError(ValueError):
    """Error de validación con un mensaje listo para mostrar en el panel."""


def slug(text: str) -> str:
    t = unicodedata.normalize("NFD", str(text).lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    return t[:40] or "video"


def _text(value, field: str, max_len: int, required: bool = True) -> str:
    v = str(value or "").strip()
    if required and not v:
        raise ContentError(f"Falta {field}.")
    if len(v) > max_len:
        raise ContentError(f"{field.capitalize()} es demasiado largo (máximo {max_len} caracteres).")
    return v


def _list(values, max_items: int, max_len: int) -> list[str]:
    if isinstance(values, str):
        values = values.splitlines()
    out = [str(v).strip() for v in (values or []) if str(v).strip()]
    return [v[:max_len] for v in out[:max_items]]


def topics() -> dict:
    return db.get_content("topics") or {}


# ---------------------------------------------------------------------------
# Validación por sección
# ---------------------------------------------------------------------------

def clean_videos(items) -> list[dict]:
    if not isinstance(items, list) or not items:
        raise ContentError("Debe haber al menos un video.")
    if len(items) > 30:
        raise ContentError("Máximo 30 videos.")
    known_topics = topics()
    seen, out = set(), []
    for i, it in enumerate(items, 1):
        title = _text(it.get("title"), f"el título del video {i}", 80)
        vid = slug(it.get("id") or title)
        base, n = vid, 2
        while vid in seen:
            vid, n = f"{base}-{n}", n + 1
        seen.add(vid)
        topic = it.get("topic") or None
        if topic and known_topics and topic not in known_topics:
            topic = None
        url = str(it.get("url") or "").strip()
        if url and not re.match(r"^https?://", url):
            raise ContentError(f"El enlace del video «{title}» debe empezar por http:// o https://")
        file = str(it.get("file") or "").strip().replace("\\", "/")
        if file and not re.match(r"^assets/videos/[\w.\-]+\.mp4$", file):
            file = ""
        out.append({
            "id": vid,
            "title": title,
            "topic": topic,
            "points": _list(it.get("points"), 6, 220),
            "keywords": _list(it.get("keywords"), 12, 40),
            "url": url,
            "file": file,
        })
    return out


def clean_quiz(items) -> list[dict]:
    if not isinstance(items, list) or len(items) < 5:
        raise ContentError("El banco necesita al menos 5 preguntas (la prueba usa 5).")
    if len(items) > 300:
        raise ContentError("Máximo 300 preguntas.")
    known_topics = topics()
    used, out = set(), []
    for it in items:
        if it.get("id") and str(it["id"]) not in used:
            used.add(str(it["id"]))
    counter = 1
    seen = set()
    for i, it in enumerate(items, 1):
        qid = str(it.get("id") or "").strip()
        if not qid or qid in seen:
            while f"q{counter:02d}" in used or f"q{counter:02d}" in seen:
                counter += 1
            qid = f"q{counter:02d}"
        seen.add(qid)
        opts = it.get("options") or {}
        options = {k: _text(opts.get(k), f"la opción {k.upper()} de la pregunta {i}", 200) for k in ("a", "b", "c")}
        correct = str(it.get("correct") or "").lower()
        if correct not in options:
            raise ContentError(f"Elige la respuesta correcta de la pregunta {i}.")
        topic = str(it.get("topic") or "").strip()
        if known_topics and topic not in known_topics:
            raise ContentError(f"Elige el tema de la pregunta {i}.")
        out.append({
            "id": qid,
            "topic": topic,
            "question": _text(it.get("question"), f"el enunciado de la pregunta {i}", 400),
            "options": options,
            "correct": correct,
            "explain": _text(it.get("explain"), f"la explicación de la pregunta {i}", 600),
        })
    return out


def clean_fallback(data) -> dict:
    if not isinstance(data, dict):
        raise ContentError("Formato no válido.")
    default = _text(data.get("default"), "la respuesta general", 1500)
    out = []
    for i, it in enumerate(data.get("topics") or [], 1):
        keywords = [k.lower() for k in _list(it.get("keywords"), 20, 40)]
        response = str(it.get("response") or "").strip()
        if not keywords and not response:
            continue
        if not keywords:
            raise ContentError(f"Agrega al menos una palabra clave en la respuesta {i}.")
        out.append({"keywords": keywords, "response": _text(response, f"el texto de la respuesta {i}", 1500)})
    if len(out) > 100:
        raise ContentError("Máximo 100 respuestas.")
    return {"default": default, "topics": out}


CLEANERS = {"videos": clean_videos, "quiz": clean_quiz, "fallback": clean_fallback}


# ---------------------------------------------------------------------------
# Lectura y escritura
# ---------------------------------------------------------------------------

def file_info(rel: str) -> dict:
    if not rel:
        return {"file_exists": False, "file_size": 0}
    p = BOT_DIR / rel
    if p.is_file():
        return {"file_exists": True, "file_size": p.stat().st_size}
    return {"file_exists": False, "file_size": 0}


def admin_content() -> dict:
    videos = db.get_content("videos") or []
    return {
        "videos": [{**v, **file_info(v.get("file", ""))} for v in videos],
        "quiz": db.get_content("quiz") or [],
        "fallback": db.get_content("fallback") or fallback_defaults(),
        "fallback_custom": db.get_content("fallback") is not None,
        "topics": topics(),
        "seeded": db.get_content("videos") is not None,
        "max_video_mb": MAX_VIDEO_MB,
        "version": db.content_version(),
    }


def bot_content() -> dict:
    return {
        "version": db.content_version(),
        "videos": db.get_content("videos"),
        "quiz": db.get_content("quiz"),
    }


def save(section: str, data):
    if section not in CLEANERS:
        raise ContentError("Sección desconocida.")
    clean = CLEANERS[section](data)
    db.set_content(section, clean)
    return clean


def reset(section: str) -> None:
    """Solo las respuestas sin IA tienen valores de fábrica en Python."""
    if section != "fallback":
        raise ContentError("Solo se pueden restaurar las respuestas sin IA.")
    conn = db.get_conn()
    conn.execute("DELETE FROM content WHERE key='fallback'")
    conn.commit()


def seed(payload: dict) -> dict:
    """El bot envía sus valores de fábrica; solo se guardan si no existen."""
    done = {}
    if isinstance(payload.get("topics"), dict):
        done["topics"] = db.set_content("topics", payload["topics"], only_if_missing=True)
    for section in ("videos", "quiz"):
        if payload.get(section):
            try:
                clean = CLEANERS[section](payload[section])
            except ContentError:
                continue
            # Conserva los ids originales del bot para no romper estadísticas.
            done[section] = db.set_content(section, clean, only_if_missing=True)
            if section == "videos" and not done[section]:
                done["video_urls"] = _fill_missing_urls(clean)
    return done


def _fill_missing_urls(defaults: list[dict]) -> int:
    """Completa el enlace de respaldo de los videos guardados que no lo tienen,
    con el de fábrica del mismo id. Nunca reemplaza un enlace puesto en el panel."""
    saved = db.get_content("videos") or []
    by_id = {v["id"]: v.get("url") for v in defaults if v.get("url")}
    filled = 0
    for v in saved:
        if not (v.get("url") or "").strip() and by_id.get(v.get("id")):
            v["url"] = by_id[v["id"]]
            filled += 1
    if filled:
        db.set_content("videos", saved)
    return filled


# ---------------------------------------------------------------------------
# Archivos de video
# ---------------------------------------------------------------------------

def _video(vid: str) -> tuple[list[dict], dict]:
    videos = db.get_content("videos") or []
    for v in videos:
        if v["id"] == vid:
            return videos, v
    raise ContentError("Ese video no existe. Guarda los cambios antes de subir el archivo.")


def save_video_file(vid: str, data: bytes) -> dict:
    videos, v = _video(vid)
    if not data:
        raise ContentError("El archivo está vacío.")
    if len(data) > MAX_VIDEO_MB * 1024 * 1024:
        raise ContentError(
            f"El video pesa {len(data) / 1048576:.1f} MB. WhatsApp acepta hasta {MAX_VIDEO_MB} MB: "
            "comprímelo a 720p o súbelo a YouTube y pega el enlace."
        )
    if data[4:8] != b"ftyp":
        raise ContentError("El archivo no parece un MP4. Expórtalo como MP4 (H.264 + AAC).")
    rel = v.get("file") or f"assets/videos/{vid}.mp4"
    target = BOT_DIR / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".subiendo")
    tmp.write_bytes(data)
    os.replace(tmp, target)
    v["file"] = rel
    db.set_content("videos", videos)
    return {**v, **file_info(rel)}


def delete_video_file(vid: str) -> dict:
    videos, v = _video(vid)
    rel = v.get("file") or ""
    if rel:
        p = BOT_DIR / rel
        if p.is_file():
            p.unlink()
    return {**v, **file_info(rel)}


def video_path(vid: str) -> Path | None:
    _, v = _video(vid)
    rel = v.get("file") or ""
    p = BOT_DIR / rel if rel else None
    return p if p and p.is_file() else None
