/**
 * bot.js
 * Punto de entrada del bot de WhatsApp "CompuFácil" (@wppconnect-team/wppconnect).
 * La lógica de conversación está en flows.js y el contenido en content.js.
 */

const wppconnect = require('@wppconnect-team/wppconnect');
const api = require('./api');
const { handleMessage } = require('./flows');

// Cola por usuario: los mensajes de una misma persona se procesan en orden,
// y los de personas distintas en paralelo.
const queues = new Map();
function enqueue(phone, task) {
  const prev = queues.get(phone) || Promise.resolve();
  const next = prev.then(task, task).finally(() => {
    if (queues.get(phone) === next) queues.delete(phone);
  });
  queues.set(phone, next);
  return next;
}

function start(client) {
  console.log('✅ CompuFácil bot iniciado correctamente.');

  api.health().then((h) =>
    console.log(h ? `🧠 Servicio de IA conectado (${api.BASE_URL})` : `⚠️ El servicio de IA no responde en ${api.BASE_URL}. Inícialo con: cd ia && python main.py`)
  );

  client.onMessage((message) => {
    if (message.isGroupMsg || message.fromMe) return;
    if (message.from === 'status@broadcast') return;

    enqueue(message.from, async () => {
      try {
        await handleMessage(client, message);
      } catch (err) {
        console.error('Error procesando mensaje:', err);
        try {
          await client.sendText(message.from, '⚠️ Ocurrió un error inesperado. Escribe *MENU* para continuar.');
        } catch (_) {
          /* noop */
        }
      }
    });
  });

  process.on('SIGINT', async () => {
    console.log('\n🛑 Cerrando sesión de WhatsApp...');
    try {
      await client.close();
      console.log('✅ Chromium cerrado correctamente.');
    } catch (err) {
      console.error('Error cerrando el cliente:', err);
    } finally {
      process.exit(0);
    }
  });
}

wppconnect
  .create({
    session: 'compufacil-bot',
    catchQR: (base64Qr, asciiQR) => {
      console.log('Escanea el siguiente código QR con WhatsApp (Dispositivos vinculados):');
      console.log(asciiQR);
    },
    statusFind: (statusSession) => console.log('Estado de sesión:', statusSession),
    headless: true,
    logQR: true,
    autoClose: 0,
  })
  .then(start)
  .catch((error) => console.error('Error al iniciar wppconnect:', error));
