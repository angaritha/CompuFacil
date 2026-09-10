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
# 'llama-3.3-70b-versatile' fue descontinuado por Groq el 16/08/2026.
# Reemplazo oficial recomendado por Groq: openai/gpt-oss-120b.
# Configurable por variable de entorno para futuras migraciones sin tocar código.
MODEL_NAME = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

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
    "Eres 'CompuFácil', un tutor universitario experto en hardware y "
    "computación: CPU, RAM, ROM, almacenamiento (SSD/HDD), tarjetas "
    "gráficas/GPU, placas madre, periféricos, generaciones y modelos de "
    "componentes (incluye lanzamientos recientes o de 2026), mantenimiento "
    "de equipos, comparativas entre componentes, y temas afines de "
    "arquitectura de computadoras. Tu tono es cercano, paciente y didáctico.\n\n"
    "Responde SIEMPRE en español, con el desarrollo que la pregunta merezca "
    "(puedes usar hasta 3-4 párrafos si el tema lo amerita, no te limites a "
    "una respuesta demasiado corta). Usa *negritas* (formato WhatsApp, con "
    "asteriscos simples) para resaltar los conceptos clave técnicos. No uses "
    "encabezados de markdown; puedes usar guiones simples para listas breves "
    "si ayuda a la claridad. Mantén un tono conversacional, como si le "
    "explicaras a un estudiante de primer semestre de informática.\n\n"
    "Solo debes rechazar preguntas que NO tengan relación alguna con "
    "hardware, computación o tecnología (por ejemplo: tareas de otras "
    "materias, temas personales, política, salud, etc.). Ante esos casos, "
    "responde en un solo párrafo breve indicando que solo puedes ayudar con "
    "temas de hardware y computación. Cualquier pregunta relacionada con "
    "componentes de computador, comparativas entre ellos, o tecnología en "
    "general SÍ debes responderla con gusto."
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
    "rom": (
        "La *ROM* (Read Only Memory) es una memoria de solo lectura que "
        "guarda instrucciones básicas y permanentes (como el firmware de "
        "arranque), a diferencia de la RAM, que es temporal y se borra al "
        "apagar el equipo.\n\n"
        "La ROM no se pierde sin energía; por eso el computador 'recuerda' "
        "cómo iniciar cada vez que lo enciendes."
    ),
    "gpu": (
        "La *GPU* o tarjeta gráfica es el componente encargado de procesar "
        "y renderizar imágenes, video y gráficos 3D, liberando esa carga del "
        "CPU.\n\n"
        "Es especialmente importante para videojuegos, edición de video y "
        "tareas de inteligencia artificial."
    ),
    "tarjeta grafica": (
        "La *tarjeta gráfica (GPU)* procesa y renderiza imágenes, video y "
        "gráficos 3D, liberando esa carga del CPU.\n\n"
        "Es especialmente importante para videojuegos, edición de video y "
        "tareas de inteligencia artificial."
    ),
    "placa madre": (
        "La *placa madre (motherboard)* es el componente que conecta y "
        "permite la comunicación entre todos los demás: CPU, RAM, "
        "almacenamiento, tarjeta gráfica, etc.\n\n"
        "Es literalmente la base física sobre la que se arma todo el "
        "computador."
    ),
    "fuente de poder": (
        "La *fuente de poder (PSU)* convierte la corriente eléctrica de la "
        "toma de pared en la energía que necesitan los componentes internos "
        "del computador para funcionar.\n\n"
        "Elegir una de buena calidad y con la potencia adecuada protege al "
        "resto del hardware."
    ),
    "usb": (
        "Un puerto *USB* permite conectar dispositivos externos al "
        "computador, como memorias, mouse, teclados o discos, y transferir "
        "datos o energía entre ellos.\n\n"
        "Existen varias versiones (USB 2.0, 3.0, USB-C) que varían "
        "principalmente en velocidad de transferencia."
    ),
    "default": (
        "En este momento no puedo conectarme con el motor de inteligencia "
        "artificial, pero con gusto te doy una idea general: la "
        "*arquitectura de computadoras* estudia cómo interactúan el *CPU*, "
        "la *RAM*, la *GPU* y el *almacenamiento* para ejecutar tareas.\n\n"
        "Intenta reformular tu pregunta usando un término más específico "
        "(RAM, CPU, GPU, SSD, HDD, ROM, placa madre...), o vuelve a "
        "intentarlo en unos segundos."
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
            max_tokens=850,
            timeout=25.0,
        )
        content = completion.choices[0].message.content.strip()
        return content + FOOTER
    except Exception as exc:
        logger.error(f"Error al conectar con Groq: {exc}")
        return _fallback_response(user_message) + FOOTER