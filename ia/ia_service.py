"""
ia_service.py
Motor de IA de CompuFácil. Usa la API de Groq (compatible con el SDK de OpenAI)
para responder como tutor de hardware, recordando la conversación reciente de
cada estudiante. Si Groq falla, responde con contenido local de contingencia.
"""

import logging
import os
import re

import openai
from dotenv import load_dotenv
from openai import AsyncOpenAI

logger = logging.getLogger("ia_service")
logging.basicConfig(level=logging.INFO)

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
# Modelo configurable por .env para futuras migraciones sin tocar código.
MODEL_NAME = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
MAX_RESPONSE_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "700"))
# gpt-oss "razona" antes de responder; en "low" responde más rápido y gasta
# menos tokens del plan gratuito.
REASONING_EFFORT = os.getenv("GROQ_REASONING_EFFORT", "low")

client = AsyncOpenAI(
    api_key=GROQ_API_KEY or "sin-clave",
    base_url="https://api.groq.com/openai/v1",
)

SYSTEM_PROMPT = (
    "Eres *CompuFácil*, un tutor universitario de hardware y computación que "
    "atiende por WhatsApp a estudiantes de primer semestre de Ingeniería de "
    "Sistemas de la Fundación Universitaria San Mateo (Colombia). Muchos "
    "llegan con pocos conocimientos previos.\n\n"
    "Temas: CPU, RAM, ROM, almacenamiento (HDD, SSD, NVMe), placa madre, GPU, "
    "fuente de poder, periféricos, puertos, unidades de medida (bits, bytes, "
    "GB, GHz), ensamble, mantenimiento, compatibilidad entre componentes, "
    "comparativas y novedades de hardware, y temas afines de arquitectura de "
    "computadores.\n\n"
    "Cómo respondes:\n"
    "- Siempre en español, con tono cercano, paciente y motivador.\n"
    "- Explica primero la idea central en palabras sencillas y luego el "
    "detalle técnico. Usa analogías de la vida cotidiana cuando ayuden.\n"
    "- Entre 1 y 3 párrafos cortos; si el tema lo exige, una lista breve con "
    "guiones. Nada de respuestas larguísimas: es un chat de celular.\n"
    "- Formato de WhatsApp: *negrita* con un asterisco, _cursiva_ con guion "
    "bajo. No uses títulos con #, tablas, ** dobles ni fórmulas LaTeX.\n"
    "- Tienes en cuenta lo que se habló antes en la conversación: si el "
    "estudiante dice '¿y la otra?' o 'explícalo más fácil', entiende a qué se "
    "refiere.\n"
    "- Si la pregunta es ambigua, responde lo más probable y ofrece aclarar.\n"
    "- No inventes cifras ni modelos; si no estás seguro de un dato reciente, "
    "dilo.\n"
    "- Si te piden resolver una tarea o examen, guía con explicaciones y "
    "pistas en lugar de entregar solo la respuesta final.\n\n"
    "Si la pregunta no tiene relación con hardware, computación o tecnología "
    "(otras materias, temas personales, política, salud, etc.), responde en "
    "una o dos frases amables que solo puedes ayudar con hardware y "
    "computación, y sugiere un tema relacionado."
)

FALLBACK_TOPICS = [
    {
        "keywords": ["ram", "memoria ram", "ddr"],
        "response": (
            "La *memoria RAM* es la memoria de trabajo del computador: guarda de "
            "forma *temporal* los datos y programas que estás usando en ese "
            "momento. Es *volátil*, es decir, se borra al apagar el equipo.\n\n"
            "Piensa en ella como el escritorio donde pones lo que estás usando: "
            "entre más grande, más cosas puedes tener abiertas a la vez sin que "
            "el equipo se ponga lento."
        ),
    },
    {
        "keywords": ["cpu", "procesador", "microprocesador", "nucleo", "núcleo"],
        "response": (
            "El *CPU* o procesador es el 'cerebro' del computador: ejecuta las "
            "instrucciones de los programas mediante operaciones aritméticas y "
            "lógicas.\n\n"
            "Su rendimiento depende de la *frecuencia* (medida en *GHz*), del "
            "número de *núcleos* y de su arquitectura."
        ),
    },
    {
        "keywords": ["ssd", "nvme", "disco solido", "disco sólido", "estado solido", "estado sólido"],
        "response": (
            "Un *SSD* guarda la información en memoria flash, sin partes "
            "móviles. Por eso es mucho más *rápido* y resistente a golpes que un "
            "disco duro tradicional.\n\n"
            "En la práctica se nota en que el equipo *arranca* y abre los "
            "programas en segundos."
        ),
    },
    {
        "keywords": ["hdd", "disco duro", "disco mecanico", "disco mecánico"],
        "response": (
            "Un *HDD* o disco duro guarda la información en platos magnéticos "
            "que giran y un cabezal que los lee.\n\n"
            "Es más *económico* por gigabyte que un SSD, pero más lento y "
            "frágil ante golpes."
        ),
    },
    {
        "keywords": ["rom", "memoria rom", "bios", "uefi", "firmware"],
        "response": (
            "La *ROM* es una memoria de solo lectura que conserva instrucciones "
            "básicas y permanentes, como el *firmware* de arranque (BIOS/UEFI). "
            "A diferencia de la RAM, no se borra al apagar el equipo.\n\n"
            "Gracias a ella el computador 'sabe' cómo iniciar cada vez que lo "
            "enciendes."
        ),
    },
    {
        "keywords": ["gpu", "tarjeta grafica", "tarjeta gráfica", "tarjeta de video", "tarjeta de vídeo"],
        "response": (
            "La *GPU* o tarjeta gráfica procesa imágenes, video y gráficos 3D, "
            "y así le quita esa carga al CPU.\n\n"
            "Es clave en videojuegos, edición de video, diseño y en tareas de "
            "inteligencia artificial."
        ),
    },
    {
        "keywords": ["placa madre", "motherboard", "placa base", "tarjeta madre"],
        "response": (
            "La *placa madre* es la tarjeta principal donde se conectan todos "
            "los componentes: CPU, RAM, almacenamiento, GPU y periféricos. "
            "Permite que se comuniquen entre sí.\n\n"
            "Es como la ciudad con sus calles: sin ella, los componentes no "
            "tendrían cómo hablarse."
        ),
    },
    {
        "keywords": ["fuente de poder", "fuente de alimentacion", "fuente de alimentación", "psu", "vatios", "watts"],
        "response": (
            "La *fuente de poder (PSU)* convierte la corriente alterna del "
            "tomacorriente en corriente continua para los componentes "
            "internos.\n\n"
            "Elegir una de buena calidad y con la *potencia* adecuada protege "
            "al resto del hardware."
        ),
    },
    {
        "keywords": ["usb", "puerto", "hdmi", "periferico", "periférico", "teclado", "mouse", "monitor"],
        "response": (
            "Los *periféricos* son los dispositivos que se conectan al "
            "computador: de *entrada* (teclado, mouse, micrófono), de *salida* "
            "(monitor, impresora, parlantes) o de *entrada y salida* (memoria "
            "USB, pantalla táctil).\n\n"
            "Se conectan por *puertos* como USB, HDMI o de audio, que varían en "
            "velocidad y en el tipo de señal que transmiten."
        ),
    },
]

FALLBACK_DEFAULT = (
    "En este momento el Tutor IA está muy ocupado (puede ser un límite de uso "
    "temporal) 😅. Mientras tanto: la *arquitectura de un computador* se basa "
    "en cómo trabajan juntos el *CPU*, la *RAM*, el *almacenamiento* y la "
    "*placa madre*.\n\n"
    "Intenta de nuevo en un par de minutos, o pregunta usando un término "
    "concreto (RAM, CPU, GPU, SSD, HDD, placa madre, fuente de poder, USB…). "
    "También puedes ver los *videotutoriales* desde el MENU."
)


def fallback_response(user_message: str) -> str:
    text = user_message.lower()
    for topic in FALLBACK_TOPICS:
        if any(keyword in text for keyword in topic["keywords"]):
            return topic["response"]
    return FALLBACK_DEFAULT


def to_whatsapp(text: str) -> str:
    """Convierte restos de markdown al formato de WhatsApp."""
    text = re.sub(r"\*\*(.+?)\*\*", r"*\1*", text, flags=re.S)
    text = re.sub(r"__(.+?)__", r"_\1_", text, flags=re.S)
    text = re.sub(r"^\s*#{1,6}\s*(.+)$", r"*\1*", text, flags=re.M)
    text = re.sub(r"^\s*[\*•]\s+", "- ", text, flags=re.M)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


async def _complete(messages: list[dict], with_reasoning: bool):
    kwargs = dict(
        model=MODEL_NAME,
        messages=messages,
        temperature=0.5,
        max_tokens=MAX_RESPONSE_TOKENS,
        timeout=25.0,
    )
    if with_reasoning and REASONING_EFFORT:
        kwargs["extra_body"] = {"reasoning_effort": REASONING_EFFORT}
    return await client.chat.completions.create(**kwargs)


async def get_ai_response(user_message: str, history: list | None = None) -> tuple[str, str]:
    """
    Devuelve (respuesta, origen). origen = "ia" si respondió Groq o
    "contingencia" si se usó la respuesta local.
    """
    if not GROQ_API_KEY:
        logger.error("Falta GROQ_API_KEY en ia/.env")
        return fallback_response(user_message), "contingencia"

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    try:
        try:
            completion = await _complete(messages, with_reasoning=True)
        except openai.BadRequestError as exc:
            logger.warning(f"Reintentando sin reasoning_effort: {exc}")
            completion = await _complete(messages, with_reasoning=False)
        content = (completion.choices[0].message.content or "").strip()
        if not content:
            return fallback_response(user_message), "contingencia"
        return to_whatsapp(content), "ia"
    except openai.RateLimitError as exc:
        logger.warning(f"Límite de uso de Groq alcanzado: {exc}")
    except openai.AuthenticationError as exc:
        logger.error(f"API Key de Groq inválida o revocada: {exc}")
    except Exception as exc:
        logger.error(f"Error al conectar con Groq: {exc}")
    return fallback_response(user_message), "contingencia"


# ---------------------------------------------------------------------------
# Estado de la API de Groq (clave y cupo del plan)
# ---------------------------------------------------------------------------

_STATUS_CACHE: dict = {"at": 0.0, "data": None}
STATUS_TTL = 300  # segundos; cada revisión gasta 1 solicitud del cupo diario


def _to_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _limits_from(headers) -> dict:
    return {
        "requests_day_limit": _to_int(headers.get("x-ratelimit-limit-requests")),
        "requests_day_remaining": _to_int(headers.get("x-ratelimit-remaining-requests")),
        "requests_reset_in": headers.get("x-ratelimit-reset-requests"),
        "tokens_min_limit": _to_int(headers.get("x-ratelimit-limit-tokens")),
        "tokens_min_remaining": _to_int(headers.get("x-ratelimit-remaining-tokens")),
        "tokens_reset_in": headers.get("x-ratelimit-reset-tokens"),
        "retry_after": headers.get("retry-after"),
    }


async def ia_status(force: bool = False) -> dict:
    """Prueba la clave de Groq con una solicitud mínima y lee el cupo restante."""
    import time

    now = time.time()
    if not force and _STATUS_CACHE["data"] and now - _STATUS_CACHE["at"] < STATUS_TTL:
        return _STATUS_CACHE["data"]

    base = {"model": MODEL_NAME, "key_configured": bool(GROQ_API_KEY), "checked_at": int(now)}
    if not GROQ_API_KEY:
        data = {**base, "state": "sin_clave", "message": "No hay GROQ_API_KEY en ia/.env"}
    else:
        try:
            raw = await client.chat.completions.with_raw_response.create(
                model=MODEL_NAME,
                messages=[{"role": "user", "content": "ok"}],
                max_tokens=16,
                timeout=20.0,
            )
            limits = _limits_from(raw.headers)
            remaining = limits["requests_day_remaining"]
            state = "ok" if remaining is None or remaining > 50 else "bajo"
            msg = "La IA está activa"
            if remaining is not None and limits["requests_day_limit"]:
                msg += f": quedan {remaining} de {limits['requests_day_limit']} solicitudes del día"
            data = {**base, **limits, "state": state, "message": msg}
        except openai.AuthenticationError:
            data = {**base, "state": "clave_invalida",
                    "message": "La clave de Groq no es válida o fue revocada. Crea otra en console.groq.com"}
        except openai.RateLimitError as exc:
            limits = _limits_from(exc.response.headers)
            wait = limits.get("retry_after") or limits.get("requests_reset_in") or "unos minutos"
            data = {**base, **limits, "state": "agotado",
                    "message": f"Se agotó el cupo gratuito de Groq; se libera en {wait}. Mientras tanto el tutor usa respuestas de contingencia"}
        except openai.APIConnectionError:
            data = {**base, "state": "sin_conexion", "message": "No hay conexión con Groq (revisa el internet)"}
        except Exception as exc:  # noqa: BLE001
            data = {**base, "state": "error", "message": f"Groq respondió con un error: {str(exc)[:160]}"}

    _STATUS_CACHE.update(at=now, data=data)
    return data
