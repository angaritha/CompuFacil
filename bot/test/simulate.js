/**
 * test/simulate.js
 * Simula conversaciones de WhatsApp contra la lógica real del bot (sin
 * WhatsApp). Requiere el servicio de IA corriendo (cd ia && python main.py).
 *
 * Uso:  node test/simulate.js
 */

const { handleMessage } = require('../flows');

function makeClient(log) {
  return {
    sendText: async (to, text) => log.push({ to, type: 'text', text }),
    sendFile: async (to, file, name, caption) => log.push({ to, type: 'file', file, caption }),
    startTyping: async () => {},
    stopTyping: async () => {},
  };
}

async function run(phone, name, inputs) {
  const log = [];
  const client = makeClient(log);
  for (const body of inputs) {
    log.push({ type: 'user', text: body });
    await handleMessage(client, { from: phone, body, sender: { pushname: name } });
  }
  return log;
}

function print(log) {
  for (const m of log) {
    if (m.type === 'user') console.log(`\n👤 ${m.text}`);
    else if (m.type === 'file') console.log(`🤖 [VIDEO ${m.file}]\n${m.caption}`);
    else console.log(`🤖 ${m.text}`);
  }
}

(async () => {
  const phone = `test${Date.now()}@c.us`;
  const script = [
    'hola',               // primer contacto → bienvenida + menú
    '1',                  // tutor
    '¿Qué es la RAM?',
    '👍',
    'nuevo',
    'menu',
    '2', '3', 'r', 'b',   // video 3 + mini reto
    'menu',
    '3', 'a', 'b', 'c', 'a', 'b', // prueba
    '4',                  // progreso
    '5', '4', '1', 'Me gustaría más videos de ensamble', // feedback
    'xyz',
    'ayuda',
  ];
  const log = await run(phone, 'Laura Gómez', script);
  print(log);
  process.exit(0);
})();
