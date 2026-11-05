# CompuFácil 🖥️ — Chatbot educativo de hardware en WhatsApp

CompuFácil acompaña a estudiantes de primer semestre de Ingeniería de Sistemas
de la Fundación Universitaria San Mateo en los fundamentos de hardware:
resuelve dudas con IA, envía videotutoriales, aplica una prueba diagnóstica,
muestra el progreso y recoge la opinión de los estudiantes. Todo se puede
seguir desde un panel web.

## Qué hace

| Opción del menú | Función |
|---|---|
| 1 · 🤖 Tutor IA | Responde preguntas de hardware y **recuerda la conversación**. *NUEVO* empieza otro tema; 👍/👎 califican la respuesta. |
| 2 · 🎬 Videotutoriales | 8 temas. El video llega **dentro del chat** con sus ideas clave y un **mini reto** (*R*). |
| 3 · 📝 Prueba diagnóstica | 5 preguntas al azar (banco de 20, temas distintos), explicación inmediata y videos recomendados según lo que falló. |
| 4 · 📊 Mi progreso | Intentos, promedio, tendencia, temas por reforzar, videos vistos y preguntas hechas. |
| 5 · 💬 Opinión | Calificación de 1 a 5, categoría y comentario libre. |
| 6 · ℹ️ Ayuda | Instrucciones y comandos. |
| 7 · ♿ Modo accesible | Mensajes sin emojis ni adornos (mejor para lectores de pantalla) y cada respuesta también en **nota de voz**. |

**Accesibilidad por voz**
- El estudiante puede enviar **notas de voz** en cualquier momento: se transcriben con Whisper (Groq) y se procesan como texto (sirve decir "uno", "la be", "menú"…).
- *AUDIO* envía en voz alta el último mensaje del bot.
- *ACCESIBLE* / *NORMAL* activan o desactivan el modo accesible (se recuerda por estudiante).
- La voz es neural en español de Colombia (edge-tts), con gTTS como respaldo.

**Panel web** (`http://localhost:8000/panel`): resumen de uso, comentarios
(con estados nuevo/leído/resuelto), resultados de la prueba por tema y por
pregunta, preguntas al tutor con sus respuestas y valoraciones, videos más
vistos, usuarios y **exportación a Excel (CSV)** para el informe.

## Arquitectura

```
WhatsApp ⇄ bot/ (Node.js + wppconnect) ──HTTP──▶ ia/ (Python + FastAPI) ──▶ Groq (IA)
                                                     │
                                                     ├─ compufacil.db (SQLite)
                                                     └─ /panel (panel web)
```

```
CompuFacil/
├── CompuFacil.exe          ← doble clic para arrancar todo (Windows)
├── iniciar_compufacil.bat   alternativa en dos ventanas
├── launcher/                código del lanzador (Go)
├── ia/
│   ├── main.py              API + panel
│   ├── ia_service.py        Tutor IA (Groq) con respaldo local
│   ├── db.py                Base de datos SQLite
│   ├── voice.py             Notas de voz: transcripción y síntesis
│   ├── panel.html           Panel web
│   ├── .env                 Claves (no se sube a GitHub)
│   └── .env.example         Plantilla del .env
└── bot/
    ├── bot.js               Conexión con WhatsApp
    ├── flows.js             Conversación (menú, tutor, videos, prueba, opinión)
    ├── content.js           Contenido: temas, videos y banco de preguntas
    ├── api.js / state.js    Comunicación con la API y estado por usuario
    ├── assets/videos/       Aquí van los MP4 (ver LEEME.md)
    └── test/                Simulaciones sin WhatsApp
```

## Instalación (una sola vez)

Requisitos: **Node.js 18+**, **Python 3.10+** y una clave de **Groq**
(https://console.groq.com).

```bash
# Motor de IA
cd ia
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt

# Bot
cd ../bot
npm install
```

Crea `ia/.env` a partir de `ia/.env.example` y pon tu `GROQ_API_KEY` y una
`PANEL_PASSWORD` propia.

## Uso diario

**Doble clic en `CompuFacil.exe`.** En una sola ventana:

1. Revisa e instala las dependencias (solo cuando cambian).
2. Enciende el motor de IA y el panel.
3. Comprueba la clave de Groq y cuánto cupo gratuito queda hoy.
4. Conecta el bot de WhatsApp (si aparece un QR, escanéalo).
5. Abre el panel en el navegador.

Para apagar todo, cierra la ventana o presiona Ctrl+C. Los registros
completos quedan en `logs/` (`ia.log`, `bot.log`, `setup.log`).

`iniciar_compufacil.bat` sigue disponible como alternativa (abre dos ventanas).

**Manual:**

```bash
# Terminal 1
cd ia && python main.py
# Terminal 2 (cuando la anterior diga "Uvicorn running")
cd bot && node bot.js
```

La primera vez, escanea el QR desde WhatsApp → *Dispositivos vinculados*. La
sesión queda guardada en `bot/tokens/`.

### Cupo de la IA (Groq)

El plan gratuito de Groq no se paga ni se recarga: tiene límites que se
recuperan solos. Para el modelo del tutor (`openai/gpt-oss-120b`) son unas
**1.000 preguntas al día** y **8.000 tokens por minuto**; para las notas de voz
(Whisper) unas **2.000 transcripciones al día**. El límite diario funciona como
una ventana de 24 horas. El lanzador y el panel (*Resumen*) muestran si la clave
funciona y cuántas solicitudes quedan. Si el cupo se agota, el tutor responde
con contenido local hasta que se libere.

## Personalizar el contenido

- **Videos:** copia los MP4 en `bot/assets/videos/` con los nombres de `LEEME.md`.
- **Preguntas, temas, títulos de los videos:** `bot/content.js`.
- **Personalidad del tutor:** `SYSTEM_PROMPT` en `ia/ia_service.py`.

## Probar sin WhatsApp

Con el servicio de IA encendido:

```bash
cd bot && npm test
```

Simula una conversación completa (tutor, videos, prueba, progreso y opinión) y
la imprime en la consola. Los datos aparecen en el panel.

## Solución de problemas

| Síntoma | Solución |
|---|---|
| El lanzador dice "clave no válida" | Crea otra clave en https://console.groq.com/keys y ponla en `ia/.env` (`GROQ_API_KEY=...`). |
| Windows avisa "protegió su PC" al abrir el .exe | Clic en *Más información* → *Ejecutar de todas formas* (el .exe no está firmado digitalmente). |
| "El Tutor IA no está disponible" | Verifica que la ventana de IA esté abierta y que `http://localhost:8000/health` responda. |
| El tutor responde con textos genéricos | Groq alcanzó su límite gratuito o la clave falló; revisa la ventana de IA. Se recupera solo. |
| El QR no aparece o expira | Cierra el bot, borra `bot/tokens/` y vuelve a iniciarlo. |
| No llega el video | Revisa el nombre del archivo y que pese menos de 16 MB. |
| No llegan las notas de voz del bot | Ejecuta `pip install -r requirements.txt` en `ia/` (el .bat lo hace solo) y revisa que haya internet. |
| El panel pide clave | Es la `PANEL_PASSWORD` de `ia/.env` (por defecto `compu2026`). |

## Notas

- El historial de la versión anterior (`bot/quiz_history.json`) se importa automáticamente la primera vez.
- Los datos de los estudiantes quedan solo en tu PC (`ia/compufacil.db`); el panel muestra los números abreviados.
- El bot usa WhatsApp Web (wppconnect); funciona mientras el PC esté encendido y conectado.

---
Proyecto de la Especialización en Docencia · Fundación Universitaria San Mateo ·
Juan Felipe Angarita Cepeda y Luis Miguel Umaña Suárez.
