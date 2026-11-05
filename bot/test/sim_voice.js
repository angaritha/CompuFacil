/**
 * test/sim_voice.js
 * Prueba el modo accesible y las notas de voz con un cliente simulado.
 * Simula la transcripción y la síntesis para no depender de internet.
 */

const api = require('../api');
const transcripts = ['Uno.', '¿Qué es la memoria RAM?', 'Menú', 'Tres', 'la be'];
api.transcribe = async () => ({ text: transcripts.shift() });
api.tts = async () => Buffer.from('ID3-fake-mp3');

const { handleMessage } = require('../flows');

const log = [];
const client = {
  sendText: async (to, text) => log.push('TXT: ' + text.slice(0, 100).replace(/\n/g, ' ')),
  sendFile: async (to, file, name) => log.push('FILE: ' + name),
  sendPtt: async (to, file) => log.push('VOZ: ' + require('path').basename(file)),
  decryptFile: async () => Buffer.from('fake-ogg'),
  startTyping: async () => {},
  stopTyping: async () => {},
};

(async () => {
  const phone = 'voz' + Date.now();
  const msgs = [
    { body: 'hola' },
    { body: '7' },               // activa modo accesible
    { type: 'ptt', body: 'xxx' }, // "Uno." → tutor
    { type: 'ptt', body: 'xxx' }, // pregunta por voz
    { body: 'audio' },
    { type: 'ptt', body: 'xxx' }, // "Menú"
    { type: 'ptt', body: 'xxx' }, // "Tres" → prueba
    { type: 'ptt', body: 'xxx' }, // "la be" → respuesta B
    { body: 'normal' },
    { type: 'image', body: '/9j/abc' },
  ];
  for (const m of msgs) {
    log.push(`\n👤 ${m.type || 'chat'}: ${m.body}`);
    await handleMessage(client, { from: phone, type: m.type || 'chat', body: m.body, sender: { pushname: 'Ana' } });
  }
  console.log(log.join('\n'));
  process.exit(0);
})();
