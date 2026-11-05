"""
main.py
Servicio FastAPI de CompuFácil.

- API para el bot de WhatsApp (bot.js): tutor IA con memoria, registro de uso,
  prueba diagnóstica, progreso y comentarios.
- Panel web de administración en http://localhost:8000/panel
"""

import csv
import io
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

import base64

import content_admin
import db
import voice
from ia_service import get_ai_response, ia_status

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

PANEL_PASSWORD = os.getenv("PANEL_PASSWORD") or "compu2026"
HISTORY_TURNS = int(os.getenv("TUTOR_HISTORY_TURNS", "8"))
PANEL_FILE = Path(__file__).with_name("panel.html")

app = FastAPI(title="CompuFácil - Servicio", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def startup() -> None:
    db.init_db()
    logger.info("Base de datos lista en %s", db.DB_PATH)
    logger.info("Panel: http://localhost:8000/panel")


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    phone: str
    message: str = Field(..., min_length=1, max_length=1500)
    name: str | None = None


class ChatResponse(BaseModel):
    reply: str
    message_id: int | None = None
    source: str = "ia"


class PhoneRequest(BaseModel):
    phone: str
    name: str | None = None


class RateRequest(BaseModel):
    phone: str
    value: int
    message_id: int | None = None


class EventRequest(BaseModel):
    phone: str
    type: str = Field(..., max_length=40)
    detail: str | None = Field(None, max_length=200)
    name: str | None = None


class QuizAnswer(BaseModel):
    question_id: str
    question: str | None = None
    topic: str | None = None
    answer: str | None = None
    correct: bool


class QuizAttemptRequest(BaseModel):
    phone: str
    score: int
    total: int
    answers: list[QuizAnswer] = []
    name: str | None = None


class FeedbackRequest(BaseModel):
    phone: str
    rating: int | None = Field(None, ge=1, le=5)
    category: str | None = Field(None, max_length=40)
    comment: str | None = Field(None, max_length=2000)
    name: str | None = None


class TranscribeRequest(BaseModel):
    phone: str
    audio_base64: str
    mimetype: str = "audio/ogg"
    name: str | None = None


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=6000)
    phone: str | None = None


class FeedbackStatus(BaseModel):
    status: str = Field(..., pattern="^(nuevo|leido|resuelto)$")


# ---------------------------------------------------------------------------
# API del bot
# ---------------------------------------------------------------------------

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "CompuFacil IA"}


@app.get("/api/ia-status")
async def ia_status_endpoint(force: bool = False):
    """Estado de la clave y del cupo de Groq (lo usan el lanzador y el panel)."""
    return await ia_status(force)


@app.post("/api/chat", response_model=ChatResponse)
async def chat_endpoint(payload: ChatRequest):
    try:
        db.touch_user(payload.phone, payload.name)
        history = db.recent_history(payload.phone, HISTORY_TURNS)
        db.add_message(payload.phone, "user", payload.message)
        reply, source = await get_ai_response(payload.message, history)
        message_id = db.add_message(payload.phone, "assistant", reply, source)
        return ChatResponse(reply=reply, message_id=message_id, source=source)
    except Exception as exc:
        logger.exception(f"Fallo procesando chat de {payload.phone}: {exc}")
        raise HTTPException(status_code=500, detail="Error interno procesando la solicitud")


@app.post("/api/chat/reset")
def chat_reset(payload: PhoneRequest):
    db.reset_tutor(payload.phone)
    return {"ok": True}


@app.post("/api/chat/rate")
def chat_rate(payload: RateRequest):
    value = 1 if payload.value > 0 else -1
    message_id = db.add_rating(payload.phone, value, payload.message_id)
    return {"ok": True, "message_id": message_id}


@app.post("/api/event")
def event(payload: EventRequest):
    db.log_event(payload.phone, payload.type, payload.detail, payload.name)
    return {"ok": True}


@app.post("/api/quiz/attempt")
def quiz_attempt(payload: QuizAttemptRequest):
    attempt_id = db.add_quiz_attempt(
        payload.phone, payload.score, payload.total,
        [a.model_dump() for a in payload.answers], payload.name,
    )
    return {"ok": True, "attempt_id": attempt_id}


@app.get("/api/progress/{phone}")
def progress(phone: str):
    return db.user_progress(phone)


@app.post("/api/feedback")
def feedback(payload: FeedbackRequest):
    feedback_id = db.add_feedback(payload.phone, payload.rating, payload.category, payload.comment, payload.name)
    return {"ok": True, "id": feedback_id}


@app.post("/api/transcribe")
async def transcribe(payload: TranscribeRequest):
    try:
        audio = base64.b64decode(payload.audio_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Audio inválido")
    if len(audio) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio demasiado largo")
    text = await voice.transcribe(audio, payload.mimetype)
    db.log_event(payload.phone, "voice_in", "ok" if text else "fail", payload.name)
    return {"text": text}


@app.post("/api/tts")
async def tts(payload: TTSRequest):
    audio = await voice.synthesize(payload.text)
    if not audio:
        raise HTTPException(status_code=503, detail="Síntesis de voz no disponible")
    if payload.phone:
        db.log_event(payload.phone, "voice_out", None)
    return Response(content=audio, media_type="audio/mpeg")


# ---------------------------------------------------------------------------
# Panel de administración
# ---------------------------------------------------------------------------

def require_admin(x_panel_key: str | None = Header(None), key: str | None = Query(None)):
    if (x_panel_key or key) != PANEL_PASSWORD:
        raise HTTPException(status_code=401, detail="Clave del panel incorrecta")
    return True


@app.get("/")
def root():
    return RedirectResponse("/panel")


@app.get("/panel")
def panel():
    return FileResponse(PANEL_FILE)


@app.get("/api/admin/check")
def admin_check(_: bool = Depends(require_admin)):
    return {"ok": True}


@app.get("/api/admin/summary")
def admin_summary(_: bool = Depends(require_admin)):
    return db.admin_summary()


@app.get("/api/admin/feedback")
def admin_feedback(_: bool = Depends(require_admin)):
    return db.admin_feedback()


@app.patch("/api/admin/feedback/{feedback_id}")
def admin_feedback_status(feedback_id: int, payload: FeedbackStatus, _: bool = Depends(require_admin)):
    db.set_feedback_status(feedback_id, payload.status)
    return {"ok": True}


@app.get("/api/admin/quiz")
def admin_quiz(_: bool = Depends(require_admin)):
    return db.admin_quiz()


@app.get("/api/admin/tutor")
def admin_tutor(_: bool = Depends(require_admin)):
    return db.admin_tutor()


@app.get("/api/admin/videos")
def admin_videos(_: bool = Depends(require_admin)):
    return db.admin_videos()


@app.get("/api/admin/users")
def admin_users(_: bool = Depends(require_admin)):
    return db.admin_users()


# ---- Contenido administrable ------------------------------------------------

def _content_call(fn, *args):
    try:
        return fn(*args)
    except content_admin.ContentError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/content")
def content_for_bot():
    """Lo consulta el bot cada pocos segundos para aplicar los cambios del panel."""
    return content_admin.bot_content()


@app.post("/api/content/seed")
def content_seed(payload: dict = Body(...)):
    return content_admin.seed(payload)


@app.get("/api/admin/content")
def admin_content(_: bool = Depends(require_admin)):
    return content_admin.admin_content()


@app.put("/api/admin/content/{section}")
def admin_content_save(section: str, data=Body(...), _: bool = Depends(require_admin)):
    clean = _content_call(content_admin.save, section, data)
    return {"ok": True, "data": clean, "version": db.content_version()}


@app.delete("/api/admin/content/{section}")
def admin_content_reset(section: str, _: bool = Depends(require_admin)):
    _content_call(content_admin.reset, section)
    return {"ok": True}


@app.post("/api/admin/fallback/test")
def admin_fallback_test(payload: dict = Body(...), _: bool = Depends(require_admin)):
    from ia_service import fallback_response

    return {"reply": fallback_response(str(payload.get("message") or ""))}


@app.put("/api/admin/videos/{vid}/file")
async def admin_video_upload(vid: str, request: Request, _: bool = Depends(require_admin)):
    data = await request.body()
    return _content_call(content_admin.save_video_file, vid, data)


@app.delete("/api/admin/videos/{vid}/file")
def admin_video_delete(vid: str, _: bool = Depends(require_admin)):
    return _content_call(content_admin.delete_video_file, vid)


@app.get("/api/admin/videos/{vid}/file")
def admin_video_file(vid: str, _: bool = Depends(require_admin)):
    path = _content_call(content_admin.video_path, vid)
    if not path:
        raise HTTPException(status_code=404, detail="Este video aún no tiene archivo")
    return FileResponse(path, media_type="video/mp4")


@app.get("/api/admin/export/{name}.csv")
def admin_export(name: str, _: bool = Depends(require_admin)):
    if name not in db.EXPORTS:
        raise HTTPException(status_code=404, detail="Exportación no disponible")
    rows = db.EXPORTS[name]()
    buf = io.StringIO()
    buf.write("﻿")  # BOM: Excel abre bien tildes y eñes
    if rows:
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()), delimiter=";")
        writer.writeheader()
        writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="compufacil_{name}.csv"'},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), workers=1)
