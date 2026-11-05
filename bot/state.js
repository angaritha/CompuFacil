/**
 * state.js
 * Estado de conversación por usuario, guardado en data/state.json para que
 * un reinicio del bot no saque a nadie de la prueba o del formulario.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

let users = {};
try {
  users = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
} catch (_) {
  users = {};
}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(users, null, 2));
    } catch (err) {
      console.warn('⚠️ No se pudo guardar el estado:', err.message);
    }
  }, 300);
}

function fresh(name) {
  return { step: 'MENU', name: name || null, quiz: null, tutorial: null, feedback: null, lastAnswerId: null };
}

function get(phone, name) {
  if (!users[phone]) {
    users[phone] = fresh(name);
    users[phone].isNew = true;
    save();
  } else if (name && users[phone].name !== name) {
    users[phone].name = name;
    save();
  }
  return users[phone];
}

module.exports = { get, save, users };
