"""
main.py
Microservicio FastAPI de CompuFácil. Expone POST /api/chat, consumido por bot.js.
Diseñado para manejar 15+ usuarios simultáneos: al usar `async def` junto con el
cliente AsyncOpenAI (Groq) de ia_service.py, las peticiones no bloquean el event
loop mientras esperan la respuesta del modelo.
"""

import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

from ia_service import get_ai_response

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

app = FastAPI(title="CompuFácil - Motor de IA", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    phone: str = Field(..., description="Número de WhatsApp del usuario")
    message: str = Field(..., min_length=1, max_length=1000)


class ChatResponse(BaseModel):
    reply: str


@app.get("/health")
def health_check():
    """Endpoint simple para verificar que el servicio está vivo."""
    return {"status": "ok", "service": "CompuFacil IA"}


@app.post("/api/chat", response_model=ChatResponse)
async def chat_endpoint(payload: ChatRequest):
    """
    Recibe el mensaje de un usuario de WhatsApp (vía bot.js) y devuelve la
    respuesta del tutor de IA, ya con el pie de página estándar incluido
    (eso se resuelve dentro de ia_service.get_ai_response).
    """
    try:
        reply = await get_ai_response(payload.message)
        return ChatResponse(reply=reply)
    except Exception as exc:
        logger.exception(f"Fallo crítico procesando chat de {payload.phone}: {exc}")
        raise HTTPException(
            status_code=500, detail="Error interno procesando la solicitud"
        )


if __name__ == "__main__":
    import uvicorn

    # workers=1 porque el paralelismo real lo da async/await + threadpool de
    # Starlette/uvicorn; para más throughput se puede levantar detrás de un
    # proceso gestor (gunicorn -k uvicorn.workers.UvicornWorker -w N).
    uvicorn.run("main:app", host="0.0.0.0", port=8000, workers=1)
