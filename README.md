# CompuFácil 🖥️ — Chatbot Educativo de WhatsApp

Sistema de dos microservicios:

1. **`bot.js`** (Node.js) — Bot de WhatsApp con `@wppconnect-team/wppconnect`. Maneja el menú, el quiz de evaluación diagnóstica y la conexión con el Tutor IA.
2. **`main.py` + `ia_service.py`** (Python/FastAPI) — Motor de IA que consulta a **Groq** (modelo `llama-3.3-70b-versatile`) y responde como tutor universitario.

```
┌─────────────┐         POST /api/chat         ┌──────────────────┐        ┌────────────┐
│   bot.js    │ ─────────────────────────────▶ │   main.py         │ ─────▶ │  Groq API   │
│ (WhatsApp)  │ ◀───────────────────────────── │   (FastAPI)       │ ◀───── │ (Llama 3.3) │
└─────────────┘        JSON { reply }          └──────────────────┘        └────────────┘
```

---

## 1. Requisitos previos

| Componente | Versión recomendada |
|---|---|
| Node.js | 18.x o superior |
| Python | 3.10 o superior |
| npm | 9.x o superior |
| pip | actualizado |
| Cuenta en Groq | https://console.groq.com |
| WhatsApp | un número activo para escanear el QR |

Verifica lo que tienes instalado:

```bash
node -v
python3 --version
pip3 --version
```

---

## 2. Estructura de carpetas sugerida

```
compufacil/
├── ia/
│   ├── main.py
│   ├── ia_service.py
│   └── .env
└── bot/
    ├── bot.js
    ├── package.json
    └── .env
```

Coloca `main.py` e `ia_service.py` juntos en una carpeta (ej. `ia/`), y `bot.js` en otra (ej. `bot/`). Deben poder ejecutarse de forma independiente, ya que son dos procesos distintos.

---

## 3. Obtener tu API Key de Groq

1. Entra a **https://console.groq.com** y crea una cuenta (gratuita).
2. Ve a la sección **API Keys** y genera una nueva clave.
3. Cópiala; la usarás en el paso 4.2 (nunca la subas a un repositorio público).

---

## 4. Instalación del motor de IA (Python / FastAPI)

### 4.1 Crear entorno e instalar dependencias

```bash
cd ia
python3 -m venv venv

# Activar el entorno virtual
source venv/bin/activate        # Linux / Mac
venv\Scripts\activate           # Windows

pip install fastapi "uvicorn[standard]" openai pydantic
```

### 4.2 Configurar la API Key de Groq

Crea un archivo `.env` en la carpeta `ia/` (o exporta la variable directamente en la terminal):

```bash
# ia/.env
GROQ_API_KEY=gsk_tu_clave_real_aqui
```

Si usas `.env`, puedes cargarlo con `python-dotenv` (`pip install python-dotenv`) agregando al inicio de `ia_service.py`:

```python
from dotenv import load_dotenv
load_dotenv()
```

O simplemente exporta la variable antes de arrancar:

```bash
export GROQ_API_KEY="gsk_tu_clave_real_aqui"   # Linux / Mac
set GROQ_API_KEY=gsk_tu_clave_real_aqui        # Windows (cmd)
```

### 4.3 Levantar el servicio

```bash
python main.py
```

Deberías ver algo como:

```
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### 4.4 Probar que funciona

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"phone": "573000000000", "message": "¿Qué es la RAM?"}'
```

Deberías recibir un JSON con el campo `"reply"` conteniendo la explicación y el pie de página estándar. También puedes verificar que el servicio está vivo en:

```
http://localhost:8000/health
```

---

## 5. Instalación del bot de WhatsApp (Node.js)

### 5.1 Instalar dependencias

```bash
cd bot
npm init -y
npm install @wppconnect-team/wppconnect axios
```

### 5.2 Configurar la URL del motor de IA

Por defecto el bot busca la IA en `http://localhost:8000/api/chat`. Si el servicio de Python corre en otra máquina o puerto, define la variable de entorno `FASTAPI_URL` antes de iniciar:

```bash
export FASTAPI_URL="http://localhost:8000/api/chat"   # Linux / Mac
set FASTAPI_URL=http://localhost:8000/api/chat         # Windows (cmd)
```

### 5.3 Levantar el bot

```bash
node bot.js
```

### 5.4 Escanear el código QR

- En la terminal aparecerá un **código QR en ASCII**.
- Abre WhatsApp en tu teléfono → **Ajustes → Dispositivos vinculados → Vincular un dispositivo**.
- Escanea el QR que aparece en la terminal.
- Cuando la sesión quede activa, verás en consola:

```
✅ CompuFácil bot iniciado correctamente.
```

> La sesión se guarda localmente (carpeta `tokens/` que crea wppconnect), así que no necesitarás escanear el QR cada vez que reinicies el bot, salvo que cierres sesión desde el teléfono.

---

## 6. Orden de arranque correcto

**Siempre inicia primero el motor de IA y después el bot**, para que la opción 3 (Tutor IA) tenga a dónde conectarse:

```bash
# Terminal 1
cd ia && python main.py

# Terminal 2 (cuando el anterior ya esté "Running")
cd bot && node bot.js
```

---

## 7. Cómo usar el bot (flujo para el estudiante)

Al escribir cualquier mensaje por primera vez, o al escribir **`MENU`** en cualquier momento, el bot muestra:

```
1 - 📚 Conceptos básicos de Hardware
2 - 📝 Prueba Piloto (Evaluación diagnóstica)
3 - 🤖 Tutor IA (preguntas libres)
```

- **Opción 1 — Conceptos**: responde `A`, `B` o `C` para ver CPU, RAM o Almacenamiento. Puedes cambiar de letra sin salir del submenú.
- **Opción 2 — Prueba Piloto**: responde `A`, `B` o `C` a las 2 preguntas. Al terminar, el bot muestra el puntaje (ej. `2/2`) y una retroalimentación pedagógica, y regresa automáticamente al menú.
- **Opción 3 — Tutor IA**: escribe cualquier pregunta libre sobre computación. El bot muestra "escribiendo..." mientras consulta a Groq (hasta 35 segundos de espera) y responde en máximo 2 párrafos con conceptos en *negrita*.
- Escribir **`MENU`** desde cualquier estado regresa siempre al menú principal.

---

## 8. Apagado seguro

Para detener el bot de WhatsApp sin dejar procesos de Chromium colgados, usa `Ctrl + C` en la terminal donde corre `bot.js`. El manejador `SIGINT` cierra el navegador correctamente antes de terminar el proceso:

```
🛑 Señal SIGINT recibida. Cerrando sesión de WhatsApp...
✅ Chromium cerrado correctamente.
```

Para el servicio de Python, `Ctrl + C` en la terminal de `main.py` es suficiente (uvicorn se apaga limpiamente por defecto).

---

## 9. Solución de problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| El bot responde "El Tutor IA tardó demasiado..." | `main.py` no está corriendo, o `FASTAPI_URL` apunta mal | Verifica que `http://localhost:8000/health` responda `{"status":"ok"}` |
| Groq responde error de autenticación | `GROQ_API_KEY` mal configurada o vencida | Regenera la clave en console.groq.com y vuelve a exportarla |
| El QR no aparece o expira | Conexión lenta o sesión previa corrupta | Borra la carpeta `tokens/` en `bot/` y vuelve a ejecutar `node bot.js` |
| Las sesiones de dos usuarios se mezclan | No debería pasar: `userState` está indexado por número de teléfono | Revisa que no estés reiniciando el proceso Node entre mensajes |
| Error `Cannot find module '@wppconnect-team/wppconnect'` | Dependencias no instaladas en esa carpeta | Ejecuta `npm install` dentro de `bot/` |

---

## 10. Notas de producción

- **Persistencia de estado**: `userState` vive en memoria; si reinicias `bot.js`, los usuarios que estaban a mitad de un quiz volverán al menú. Para producción a mayor escala, considera mover el estado a Redis.
- **Escalado del motor de IA**: para más de ~15 usuarios concurrentes sostenidos, puedes correr `main.py` con varios workers: `gunicorn -k uvicorn.workers.UvicornWorker -w 4 main:app`.
- **Seguridad**: nunca subas tu `GROQ_API_KEY` a un repositorio público; usa `.env` + `.gitignore`.
