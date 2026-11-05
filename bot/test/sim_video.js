// Prueba rápida: envío de video, mini reto y registro de la prueba.
const { handleMessage } = require('../flows');

const log = [];
const client = {
  sendText: async (to, text) => log.push('T: ' + text.slice(0, 90).replace(/\n/g, ' ')),
  sendFile: async (to, file, name, caption) => log.push('FILE: ' + name + ' | ' + caption.slice(0, 40).replace(/\n/g, ' ')),
  startTyping: async () => {},
  stopTyping: async () => {},
};

(async () => {
  const phone = 'v' + Date.now();
  for (const body of ['hola', '2', '2', 'r', 'a', '9', 'menu', '3', 'a', 'a', 'a', 'a', 'a', '4']) {
    log.push('U: ' + body);
    await handleMessage(client, { from: phone, body, sender: { pushname: 'Pepe' } });
  }
  console.log(log.join('\n'));
  process.exit(0);
})();
