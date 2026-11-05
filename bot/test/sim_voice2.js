// Prueba: interpretación aproximada de audios y una sola nota de voz por turno.
const api = require('../api');
const said = ['Menú principal.', 'Quiero hacer la prueba.', 'La be.', 'aumentar la memoria ram', 'Videos.', 'memoria ram', 'mini reto', 'la ce', 'opinion', 'cinco estrellas', 'felicitación', 'omitir'];
api.transcribe = async () => ({ text: said.shift() });
api.tts = async () => Buffer.from('ID3');
const { handleMessage } = require('../flows');
const log = [];
const client = {
  sendText: async (to, t) => log.push('TXT: ' + t.slice(0, 70).replace(/\n/g, ' ')),
  sendFile: async (to, f, n) => log.push('FILE: ' + n),
  sendPtt: async () => log.push('🔊 VOZ'),
  decryptFile: async () => Buffer.from('x'),
  startTyping: async () => {}, stopTyping: async () => {},
};
(async () => {
  const phone = 'v2' + Date.now();
  await handleMessage(client, { from: phone, type: 'chat', body: 'hola' });
  for (let i = 0; i < 12; i++) {
    log.push('\n🎙️ (audio)');
    await handleMessage(client, { from: phone, type: 'ptt', body: '' });
  }
  console.log(log.join('\n'));
  process.exit(0);
})();
