/**
 * contentSync.js
 * Mantiene el contenido del bot (videos y banco de preguntas) igual al que
 * se edita en el panel. La primera vez envía los valores de fábrica; después
 * consulta /api/content cada pocos segundos y aplica los cambios en caliente.
 */

const api = require('./api');
const content = require('./content');

const INTERVAL_MS = Number(process.env.CONTENT_SYNC_MS || 20000);
let version = null;
let timer = null;
let seeded = false;

async function syncOnce() {
  let data = await api.content();
  if (!data) return false;
  // Al arrancar se envían siempre los valores de fábrica: el servidor solo
  // guarda lo que falta (y completa enlaces de video vacíos), nunca pisa el panel.
  if (!seeded || !data.videos || !data.quiz) {
    seeded = Boolean(await api.seedContent(content.DEFAULTS)) || seeded;
    data = await api.content();
    if (!data) return false;
  }
  if (data.version === version) return false;
  const first = version === null;
  version = data.version;
  if (content.applyRemote(data) && !first) {
    console.log(`🔄 Contenido actualizado desde el panel (${content.TUTORIALS.length} videos, ${content.QUIZ.length} preguntas)`);
  }
  return true;
}

function start() {
  syncOnce().catch(() => {});
  if (!timer) timer = setInterval(() => syncOnce().catch(() => {}), INTERVAL_MS);
}

module.exports = { start, syncOnce };
