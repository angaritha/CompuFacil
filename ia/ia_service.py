"""
ia_service.py
Motor de IA de CompuFácil. Usa la API de Groq (compatible con el SDK de OpenAI)
para generar respuestas de tutoría rápidas, con contingencia local si Groq falla.
"""

import os
import logging
from dotenv import load_dotenv
from openai import AsyncOpenAI

logger = logging.getLogger("ia_service")
logging.basicConfig(level=logging.INFO)

# Carga automáticamente el archivo .env (si existe) para no tener que
# exportar la variable manualmente cada vez que se arranca el servicio.
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "TU_API_KEY_DE_GROQ_AQUI")
MODEL_NAME = "llama-3.3-70b-versatile"

# Cliente asíncrono apuntando a Groq (obligatorio por velocidad de respuesta,
# evita bloqueos por cuota con 15+ usuarios concurrentes).
client = AsyncOpenAI(
    api_key=GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1",
)

FOOTER = (
    "\n\n━━━━━━━━━━━━━━━━━━━━\n"
    "💬 _¿Quieres preguntar algo más o regresar al *MENU*?_"
)

SYSTEM_PROMPT = (
    "Eres 'CompuFácil', un tutor universitario experto EXCLUSIVAMENTE en "
    "hardware y computación: CPU, RAM, almacenamiento (SSD/HDD), tarjetas "
    "gráficas, placas madre, periféricos, mantenimiento de equipos, y temas "
    "afines. Tu tono es cercano, paciente y didáctico. "
    "Responde SIEMPRE en español, en un máximo de 2 párrafos cortos. "
    "Usa *negritas* (formato WhatsApp, con asteriscos simples) para resaltar "
    "los conceptos clave técnicos. No uses encabezados de markdown ni listas "
    "numeradas extensas: mantén un tono conversacional y claro, como si le "
    "explicaras a un estudiante de primer semestre de informática.\n\n"
    "IMPORTANTE: si el usuario pregunta algo que NO tiene relación con "
    "hardware o computación (por ejemplo temas personales, tareas de otras "
    "materias, noticias, opiniones, etc.), NO lo respondas. En su lugar, "
    "explícale amablemente en un solo párrafo breve que solo puedes ayudar "
    "con temas de hardware y computación, e invítalo a hacer una pregunta "
    "sobre ese tema."
)

# --- Contingencia local basada en palabras clave si Groq falla ---
FALLBACK_KEYWORDS = {
    "ram": (
        "La *memoria RAM* (Random Access Memory) es la memoria volátil donde "
        "el computador guarda temporalmente los datos y programas que está "
        "usando en este momento. Se llama volátil porque su contenido se "
        "borra al apagar el equipo.\n\n"
        "A mayor *capacidad de RAM*, más programas puede manejar el sistema "
        "de forma fluida al mismo tiempo."
    ),
    "cpu": (
        "El *CPU* (Unidad Central de Procesamiento) es el 'cerebro' del "
        "computador: se encarga de ejecutar las instrucciones de los "
        "programas mediante operaciones aritméticas y lógicas.\n\n"
        "Su velocidad se mide en *GHz* y su rendimiento también depende del "
        "número de *núcleos (cores)* que tenga."
    ),
    "ssd": (
        "Un *SSD* (Solid State Drive) usa memoria flash sin partes móviles, "
        "por lo que es mucho más *rápido* y resistente a golpes que un HDD "
        "tradicional.\n\n"
        "Esto se traduce en tiempos de *arranque* e *inicio de aplicaciones* "
        "considerablemente menores."
    ),
    "hdd": (
        "Un *HDD* (Hard Disk Drive) almacena información en discos "
        "magnéticos giratorios leídos por un cabezal mecánico.\n\n"
        "Es más *económico* por gigabyte que un SSD, pero más lento y frágil "
        "ante golpes o caídas."
    ),
    "default": (
        "En este momento no puedo conectarme con el motor de inteligencia "
        "artificial, pero con gusto te doy una idea general: la "
        "*arquitectura de computadoras* estudia cómo interactúan el *CPU*, "
        "la *RAM* y el *almacenamiento* para ejecutar tareas.\n\n"
        "Intenta reformular tu pregunta usando palabras como RAM, CPU, SSD o "
        "HDD, o vuelve a intentarlo en unos segundos."
    ),
}


def _fallback_response(user_message: str) -> str:
    """Respuesta local de contingencia basada en palabras clave."""
    text = user_message.lower()
    for keyword, response in FALLBACK_KEYWORDS.items():
        if keyword != "default" and keyword in text:
            return response
    return FALLBACK_KEYWORDS["default"]


async def get_ai_response(user_message: str, history: list | None = None) -> str:
    """
    Consulta a Groq (Llama 3.3 70B) y devuelve la respuesta ya formateada
    con el pie de página estándar. Si Groq falla, usa la contingencia local.
    """
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    try:
        completion = await client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages,
            temperature=0.6,
            max_tokens=500,
            timeout=25.0,
        )
        content = completion.choices[0].message.content.strip()
        return content + FOOTER
    except Exception as exc:
        logger.error(f"Error al conectar con Groq: {exc}")
        return _fallback_response(user_message) + FOOTER