/**
 * api.js
 * Comunicación del bot con el servicio de Python (FastAPI).
 * Si el servicio no responde, el bot sigue funcionando: solo se pierde el
 * registro de ese dato y se avisa en consola.
 */

const axios = require('axios');

// Compatibilidad con la versión anterior, que usaba FASTAPI_URL=.../api/chat
const BASE_URL = (process.env.API_URL || process.env.FASTAPI_URL || 'http://localhost:8000')
  .replace(/\/api\/chat\/?$/, '')
  .replace(/\/$/, '');

const http = axios.create({ baseURL: BASE_URL, timeout: 8000 });

async function safe(promise, label) {
  try {
    const res = await promise;
    return res.data;
  } catch (err) {
    console.warn(`⚠️ API (${label}) no disponible: ${err.message}`);
    return null;
  }
}

module.exports = {
  BASE_URL,
  chat: (phone, message, name) =>
    http.post('/api/chat', { phone, message, name }, { timeout: 40000 }).then((r) => r.data),
  resetChat: (phone) => safe(http.post('/api/chat/reset', { phone }), 'reset'),
  rate: (phone, value, messageId) =>
    safe(http.post('/api/chat/rate', { phone, value, message_id: messageId || null }), 'rate'),
  event: (phone, type, detail, name) =>
    safe(http.post('/api/event', { phone, type, detail: detail || null, name: name || null }), 'event'),
  quizAttempt: (phone, score, total, answers, name) =>
    safe(http.post('/api/quiz/attempt', { phone, score, total, answers, name }), 'quiz'),
  progress: (phone) => safe(http.get(`/api/progress/${encodeURIComponent(phone)}`), 'progress'),
  feedback: (phone, data, name) =>
    safe(http.post('/api/feedback', { phone, name, ...data }), 'feedback'),
  health: () => safe(http.get('/health', { timeout: 3000 }), 'health'),
  transcribe: (phone, audioBase64, mimetype, name) =>
    safe(http.post('/api/transcribe', { phone, audio_base64: audioBase64, mimetype, name }, { timeout: 45000 }), 'transcribe'),
  tts: async (text, phone) => {
    try {
      const res = await http.post('/api/tts', { text, phone }, { responseType: 'arraybuffer', timeout: 45000 });
      return Buffer.from(res.data);
    } catch (err) {
      console.warn(`⚠️ API (tts) no disponible: ${err.message}`);
      return null;
    }
  },
};
