"""
voice.py
Voz para CompuFácil (accesibilidad):
- transcribe(): nota de voz → texto, con Whisper en Groq (misma GROQ_API_KEY).
- synthesize(): texto → audio MP3 en español, con edge-tts (voces neuronales
  gratuitas) y gTTS como respaldo.
"""

import asyncio
import io
import logging
import os
import re

from dotenv import load_dotenv

from ia_service import GROQ_API_KEY, client

load_dotenv()
logger = logging.getLogger("voice")

STT_MODEL = os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo")
TTS_VOICE = os.getenv("TTS_VOICE", "es-CO-SalomeNeural")
TTS_RATE = os.getenv("TTS_RATE", "+0%")
TTS_MAX_CHARS = int(os.getenv("TTS_MAX_CHARS", "2500"))
# Vocabulario que ayuda a Whisper a reconocer las palabras del bot.
STT_PROMPT = os.getenv(
    "STT_PROMPT",
    "CompuFácil. Menú, tutor, videos, prueba, progreso, opinión, ayuda, modo accesible, audio, normal, "
    "nuevo, omitir, mini reto. Opción uno, dos, tres, cuatro, cinco, seis, siete, ocho. "
    "La A, la B, la C. RAM, ROM, CPU, GPU, SSD, HDD, NVMe, USB, HDMI, placa madre, fuente de poder, "
    "periféricos, gigabytes, gigahercios, núcleos.",
)

_EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U00002B00-\U00002BFF\U0001F1E6-\U0001F1FF️‍⃣]"
)


def speech_text(text: str) -> str:
    """Limpia el texto para que suene natural al leerlo en voz alta."""
    t = _EMOJI.sub("", text)
    t = re.sub(r"[━─_*~`#>]+", " ", t)
    t = t.replace("•", ".").replace(" · ", ": ").replace("·", ",")
    t = re.sub(r"\b([ABC])\)", r"Opción \1:", t)
    t = re.sub(r"https?://\S+", "enlace", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n\s*\n+", ".\n", t)
    t = re.sub(r"\.(\s*\.)+", ".", t)
    t = t.strip()
    if len(t) > TTS_MAX_CHARS:
        t = t[:TTS_MAX_CHARS].rsplit(" ", 1)[0] + "…"
    return t


async def transcribe(audio: bytes, mimetype: str = "audio/ogg") -> str | None:
    if not GROQ_API_KEY:
        logger.error("Falta GROQ_API_KEY para transcribir audios")
        return None
    ext = "ogg" if "ogg" in mimetype else "mp3" if "mpeg" in mimetype else "m4a" if "mp4" in mimetype else "ogg"
    try:
        result = await client.audio.transcriptions.create(
            model=STT_MODEL,
            file=(f"nota.{ext}", audio, mimetype.split(";")[0]),
            language="es",
            prompt=STT_PROMPT,
            temperature=0,
            timeout=30.0,
        )
        text = (getattr(result, "text", "") or "").strip()
        return text or None
    except Exception as exc:
        logger.error(f"No se pudo transcribir el audio: {exc}")
        return None


async def _edge(text: str) -> bytes | None:
    try:
        import edge_tts
    except ImportError:
        return None
    try:
        communicate = edge_tts.Communicate(text, TTS_VOICE, rate=TTS_RATE)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                buf.write(chunk["data"])
        data = buf.getvalue()
        return data or None
    except Exception as exc:
        logger.warning(f"edge-tts falló: {exc}")
        return None


def _gtts_sync(text: str) -> bytes | None:
    try:
        from gtts import gTTS
    except ImportError:
        return None
    try:
        buf = io.BytesIO()
        gTTS(text=text, lang="es", tld="com.mx").write_to_fp(buf)
        return buf.getvalue() or None
    except Exception as exc:
        logger.warning(f"gTTS falló: {exc}")
        return None


async def synthesize(text: str) -> bytes | None:
    clean = speech_text(text)
    if not clean:
        return None
    audio = await _edge(clean)
    if audio:
        return audio
    return await asyncio.to_thread(_gtts_sync, clean)
