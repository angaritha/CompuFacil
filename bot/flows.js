/**
 * flows.js
 * Lógica de conversación de CompuFácil (máquina de estados por usuario).
 * Es independiente de WhatsApp: recibe un "client" con sendText/sendFile/
 * startTyping/stopTyping, lo que permite probarla con un cliente simulado.
 */

const fs = require('fs');
const path = require('path');
const api = require('./api');
const store = require('./state');
const { TOPICS, TUTORIALS, QUIZ } = require('./content');
const intent = require('./intent');

const QUIZ_LENGTH = 5;
const LINE = '━━━━━━━━━━━━━━━━';
const TTS_DIR = path.join(__dirname, 'data', 'tts');

// ---------------------------------------------------------------------------
// Accesibilidad: texto limpio para lectores de pantalla y notas de voz
// ---------------------------------------------------------------------------

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** Quita emojis, líneas y adornos para lectores de pantalla. */
function plain(text) {
  return String(text || '')
    .replace(EMOJI_RE, '')
    .replace(/━+/g, '')
    .replace(/[🟩⬜]/gu, '')
    .replace(/[*_~]/g, '')
    .replace(/ · /g, ': ')
    .replace(/[ \t]+/g, ' ')
    .replace(/^ +| +$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function sendVoice(base, phone, text) {
  const audio = await api.tts(text, phone);
  if (!audio) return false;
  const file = path.join(TTS_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.mp3`);
  try {
    fs.mkdirSync(TTS_DIR, { recursive: true });
    fs.writeFileSync(file, audio);
    try {
      await base.sendPtt(phone, file);
    } catch (err) {
      await base.sendFile(phone, file, 'respuesta.mp3', '');
    }
    return true;
  } catch (err) {
    console.warn('⚠️ No se pudo enviar la nota de voz:', err.message);
    return false;
  } finally {
    setTimeout(() => fs.unlink(file, () => {}), 60000);
  }
}

/**
 * Envuelve el cliente de WhatsApp: en modo accesible cada mensaje sale sin
 * adornos y acompañado de su nota de voz. Además recuerda el último texto
 * enviado para el comando AUDIO.
 */
function wrapClient(base, st, ctx) {
  if (base.__wrapped) return base;
  return {
    ...base,
    __wrapped: true,
    __base: base,
    sendText: async (to, text) => {
      st.lastText = plain(text);
      await base.sendText(to, st.accessible ? st.lastText : text);
      // Si el estudiante habló o está en modo accesible, al final del turno
      // se le envía una sola nota de voz con todo lo que el bot respondió.
      if (st.accessible || ctx.voiceTurn) ctx.voiceQueue.push(st.lastText);
    },
    sendFile: (...args) => base.sendFile(...args),
    startTyping: (...args) => (base.startTyping ? base.startTyping(...args) : Promise.resolve()),
    stopTyping: (...args) => (base.stopTyping ? base.stopTyping(...args) : Promise.resolve()),
  };
}

// Palabras que suelen salir al transcribir audios ("uno", "la be"…)
const SPOKEN = {
  uno: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8',
  'opcion uno': '1', 'opcion dos': '2', 'opcion tres': '3', 'opcion cuatro': '4',
  'opcion cinco': '5', 'opcion seis': '6', 'opcion siete': '7', 'opcion ocho': '8',
  'numero uno': '1', 'numero dos': '2', 'numero tres': '3', 'numero cuatro': '4',
  'numero cinco': '5', 'numero seis': '6', 'numero siete': '7', 'numero ocho': '8',
  be: 'b', ve: 'b', ce: 'c', se: 'c', 'la be': 'b', 'la ce': 'c', 'letra a': 'a', 'letra b': 'b', 'letra be': 'b', 'letra c': 'c', 'letra ce': 'c',
  'opcion a': 'a', 'opcion b': 'b', 'opcion be': 'b', 'opcion c': 'c', 'opcion ce': 'c', 'la a': 'a',
  erre: 'r',
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const EMOJI_DIGITS = { '0️⃣': '0', '1️⃣': '1', '2️⃣': '2', '3️⃣': '3', '4️⃣': '4', '5️⃣': '5', '6️⃣': '6', '7️⃣': '7', '8️⃣': '8', '9️⃣': '9' };

function normalize(text) {
  let t = (text || '').trim();
  for (const [e, d] of Object.entries(EMOJI_DIGITS)) t = t.split(e).join(d);
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^[\s¿¡.,;:!?*_-]+|[\s.,;:!?*_-]+$/g, '');
}

function firstName(name) {
  if (!name) return '';
  return String(name).trim().split(/\s+/)[0];
}

function progressBar(done, total) {
  return '🟩'.repeat(done) + '⬜'.repeat(Math.max(0, total - done));
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Elige `count` preguntas al azar procurando que sean de temas distintos. */
function pickQuizSet(count = QUIZ_LENGTH) {
  const pool = shuffle(QUIZ);
  const picked = [];
  const usedTopics = new Set();
  for (const q of pool) {
    if (picked.length >= count) break;
    if (!usedTopics.has(q.topic)) {
      picked.push(q);
      usedTopics.add(q.topic);
    }
  }
  for (const q of pool) {
    if (picked.length >= count) break;
    if (!picked.includes(q)) picked.push(q);
  }
  return picked;
}

const questionById = (id) => QUIZ.find((q) => q.id === id);
const tutorialById = (id) => TUTORIALS.find((t) => t.id === id);
const tutorialNumber = (id) => TUTORIALS.findIndex((t) => t.id === id) + 1;

function parseLetter(text) {
  const n = normalize(text);
  if (SPOKEN[n] && /^[abc]$/.test(SPOKEN[n])) return SPOKEN[n];
  const m = n.match(/^(?:opcion\s*|respuesta\s*|la\s+|letra\s+)?([abc])(?:\)|\.|\b|$)/);
  return m ? m[1] : null;
}

function formatQuestion(q, index, total) {
  return (
    `📝 *Pregunta ${index + 1} de ${total}*  ${progressBar(index, total)}\n\n` +
    `${q.question}\n\n` +
    `*A)* ${q.options.a}\n*B)* ${q.options.b}\n*C)* ${q.options.c}\n\n` +
    `_Responde *A*, *B* o *C*_`
  );
}

function answerFeedback(q, letter) {
  if (letter === q.correct) {
    return `✅ *¡Correcto!*\n${q.explain}`;
  }
  return (
    `❌ *No es esa.* La respuesta correcta es *${q.correct.toUpperCase()})* ${q.options[q.correct]}.\n` +
    `${q.explain}`
  );
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

function menuText(st) {
  const name = st && st.name;
  const hello = firstName(name) ? `¡Hola, ${firstName(name)}! 👋` : '¡Hola! 👋';
  const access = st && st.accessible ? 'Desactivar modo accesible' : 'Modo accesible (respuestas en audio)';
  return (
    `🖥️ *CompuFácil* · Tu tutor de hardware\n${LINE}\n` +
    `${hello} ¿Qué quieres hacer hoy?\n\n` +
    `*1* · 🤖 Pregúntale al Tutor IA\n` +
    `*2* · 🎬 Videotutoriales\n` +
    `*3* · 📝 Prueba diagnóstica\n` +
    `*4* · 📊 Mi progreso\n` +
    `*5* · 💬 Déjanos tu opinión\n` +
    `*6* · ℹ️ Ayuda\n` +
    `*7* · ♿ ${access}\n\n` +
    `_Escribe el número o envía una *nota de voz*. Con *MENU* vuelves aquí cuando quieras._`
  );
}

const WELCOME_TEXT =
  `🎓 *Bienvenido a CompuFácil*\n\n` +
  `Soy un asistente creado para estudiantes de primer semestre de la ` +
  `*Fundación Universitaria San Mateo* que están aprendiendo *fundamentos de hardware*.\n\n` +
  `Conmigo puedes resolver dudas a cualquier hora, ver videos cortos, ` +
  `medir lo que sabes y seguir tu progreso. 🚀\n\n` +
  `♿ ¿Usas lector de pantalla o prefieres escuchar? Escribe *ACCESIBLE* o envíame una *nota de voz*.`;

const TUTOR_WELCOME_TEXT =
  `🤖 *Tutor IA activado*\n\n` +
  `Pregúntame lo que quieras sobre *hardware y computación*. Por ejemplo:\n` +
  `• _¿Qué diferencia hay entre RAM y ROM?_\n` +
  `• _¿Me conviene un SSD o un HDD?_\n` +
  `• _Explícame qué hace la placa madre como si tuviera 10 años_\n\n` +
  `Recuerdo lo que vamos hablando, así que puedes pedirme que te explique ` +
  `algo más fácil o con un ejemplo.\n\n` +
  `_*NUEVO* empieza otro tema · *MENU* sale del tutor_`;

const TUTOR_FOOTER = `\n\n${LINE}\n👍 / 👎 _¿Te sirvió?_ · *NUEVO* otro tema · *MENU* salir`;
const TUTOR_FOOTER_ACCESSIBLE = '\n\nSi te sirvió, di "me sirvió". Di NUEVO para otro tema o MENU para salir.';

function tutorialsText() {
  let t = `🎬 *Videotutoriales*\n${LINE}\nVideos cortos para entender cada componente. Escribe el número:\n\n`;
  TUTORIALS.forEach((tut, i) => {
    t += `*${i + 1}* · ${tut.title}\n`;
  });
  t += `\n_*MENU* para volver_`;
  return t;
}

const FEEDBACK_RATING_TEXT =
  `💬 *Tu opinión nos importa*\n\n` +
  `¿Cómo calificarías tu experiencia con CompuFácil?\n\n` +
  `*1* · 😞 Muy mala\n*2* · 🙁 Mala\n*3* · 😐 Regular\n*4* · 🙂 Buena\n*5* · 🤩 Excelente`;

const FEEDBACK_CATEGORIES = { 1: 'Sugerencia', 2: 'Algo no funcionó', 3: 'Felicitación', 4: 'Otro' };

const FEEDBACK_CATEGORY_TEXT =
  `¿Sobre qué es tu comentario?\n\n` +
  `*1* · 💡 Una sugerencia\n*2* · 🐞 Algo no funcionó\n*3* · 👏 Una felicitación\n*4* · 📌 Otro`;

const FEEDBACK_COMMENT_TEXT =
  `✍️ Cuéntanos con tus palabras: ¿qué te gustó, qué mejorarías o qué falló?\n\n` +
  `_Si prefieres no escribir nada, responde *OMITIR*._`;

const HELP_TEXT =
  `ℹ️ *Cómo usar CompuFácil*\n${LINE}\n` +
  `🤖 *Tutor IA:* escribe tus dudas como se las harías a un profesor. Recuerda la conversación.\n` +
  `🎬 *Videotutoriales:* elige un tema y te llega el video aquí mismo. Después puedes hacer un *mini reto*.\n` +
  `📝 *Prueba diagnóstica:* 5 preguntas al azar con explicación inmediata y recomendaciones.\n` +
  `📊 *Mi progreso:* tus intentos, tu promedio y los temas por reforzar.\n` +
  `💬 *Opinión:* califícanos y déjanos tus comentarios.\n\n` +
  `*Comandos útiles*\n` +
  `• *MENU* → volver al inicio\n` +
  `• *NUEVO* → empezar otro tema con el tutor\n` +
  `• 👍 o 👎 → calificar la última respuesta del tutor\n` +
  `• *AUDIO* → escuchar en voz alta el último mensaje\n` +
  `• *ACCESIBLE* / *NORMAL* → activar o desactivar el modo accesible\n\n` +
  `🎙️ También puedes enviarme *notas de voz*: las escucho y te respondo.\n\n` +
  `_CompuFácil · Proyecto de la Especialización en Docencia · Fundación Universitaria San Mateo_`;

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

async function sendMenu(client, phone, st) {
  st.step = 'MENU';
  st.quiz = null;
  st.feedback = null;
  store.save();
  await client.sendText(phone, menuText(st));
}

async function startTutor(client, phone, st) {
  st.step = 'TUTOR';
  store.save();
  await client.sendText(phone, TUTOR_WELCOME_TEXT);
}

async function askTutor(client, phone, st, text) {
  if (st.busy && Date.now() - st.busy < 45000) {
    await client.sendText(phone, '⏳ Sigo preparando la respuesta anterior, dame unos segundos…');
    return;
  }
  st.busy = Date.now();
  try {
    await client.startTyping(phone).catch(() => {});
    const data = await api.chat(phone, text, st.name);
    await client.stopTyping(phone).catch(() => {});
    st.lastAnswerId = data && data.message_id ? data.message_id : null;
    const reply = data && data.reply ? data.reply : 'No pude generar una respuesta en este momento.';
    await client.sendText(phone, reply + (st.accessible ? TUTOR_FOOTER_ACCESSIBLE : TUTOR_FOOTER));
  } catch (err) {
    await client.stopTyping(phone).catch(() => {});
    console.error(`Error consultando el Tutor IA para ${phone}:`, err.message);
    await client.sendText(
      phone,
      '⚠️ El Tutor IA no está disponible en este momento. Intenta de nuevo en un minuto o escribe *MENU* para usar las otras opciones.'
    );
  } finally {
    st.busy = null;
    store.save();
  }
}

async function showTutorials(client, phone, st) {
  st.step = 'TUTORIALS';
  st.tutorial = null;
  store.save();
  await client.sendText(phone, tutorialsText());
}

async function sendTutorial(client, phone, st, tut) {
  st.step = 'TUTORIALS';
  st.tutorial = tut.id;
  store.save();

  const n = tutorialNumber(tut.id);
  const caption =
    `🎬 *${n}. ${tut.title}*\n\n` +
    `*Ideas clave*\n` +
    tut.points.map((p) => `• ${p}`).join('\n');
  const nextSteps =
    `\n\n${LINE}\n🧠 *R* · mini reto de este tema\n🔢 Otro número · ver otro video\n🏠 *MENU* · volver`;

  const filePath = tut.file ? path.join(__dirname, tut.file) : null;
  if (filePath && fs.existsSync(filePath)) {
    await client.sendText(phone, `⏳ Enviando el video *${tut.title}*…`);
    try {
      await client.sendFile(phone, filePath, path.basename(filePath), caption);
      await client.sendText(phone, nextSteps.trim());
      api.event(phone, 'video_view', tut.id, st.name);
      return;
    } catch (err) {
      console.warn(`⚠️ No se pudo enviar el video ${tut.id}: ${err.message}`);
      if (!tut.url) {
        await client.sendText(phone, `${caption}\n\n⚠️ No pude enviar el video en este momento, intenta de nuevo más tarde.${nextSteps}`);
        return;
      }
    }
  }
  if (tut.url) {
    await client.sendText(phone, `${caption}\n\n▶️ Míralo aquí: ${tut.url}${nextSteps}`);
    api.event(phone, 'video_view', tut.id, st.name);
    return;
  }
  await client.sendText(phone, `${caption}\n\n🎥 _El video de este tema está en producción. ¡Muy pronto lo verás aquí!_${nextSteps}`);
  api.event(phone, 'video_pending', tut.id, st.name);
}

async function startMiniChallenge(client, phone, st) {
  const tut = tutorialById(st.tutorial);
  let pool = QUIZ.filter((q) => tut && q.topic === tut.id);
  if (pool.length === 0) pool = QUIZ;
  const q = shuffle(pool.filter((x) => x.id !== st.lastChallenge))[0] || pool[0];
  st.step = 'MINI_CHALLENGE';
  st.lastChallenge = q.id;
  store.save();
  await client.sendText(
    phone,
    `🧠 *Mini reto*\n\n${q.question}\n\n*A)* ${q.options.a}\n*B)* ${q.options.b}\n*C)* ${q.options.c}\n\n_Responde *A*, *B* o *C*_`
  );
}

async function startQuiz(client, phone, st) {
  const set = pickQuizSet();
  st.step = 'QUIZ';
  st.quiz = { ids: set.map((q) => q.id), index: 0, answers: [] };
  store.save();
  api.event(phone, 'quiz_start', null, st.name);

  const prog = await api.progress(phone);
  let intro =
    `📝 *Prueba diagnóstica*\n\n` +
    `Son *${set.length} preguntas* al azar sobre fundamentos de hardware. ` +
    `Después de cada respuesta te explico por qué. ¡Sin presión! 💪`;
  if (prog && prog.attempts && prog.attempts.length) {
    const last = prog.attempts[prog.attempts.length - 1];
    intro += `\n\n_Tu último intento: *${last.score}/${last.total}*. ¡A superarlo!_`;
  }
  await client.sendText(phone, intro);
  await client.sendText(phone, formatQuestion(set[0], 0, set.length));
}

async function finishQuiz(client, phone, st) {
  const answers = st.quiz.answers;
  const total = answers.length;
  const score = answers.filter((a) => a.correct).length;
  const pct = Math.round((score / total) * 100);
  st.quiz = null;
  store.save();

  await api.quizAttempt(phone, score, total, answers, st.name);
  api.event(phone, 'quiz_finish', `${score}/${total}`, st.name);

  let medal = '📘';
  let message = 'Vale la pena repasar los conceptos básicos. ¡Vamos paso a paso!';
  if (pct === 100) {
    medal = '🏆';
    message = '¡Perfecto! Dominas estos conceptos. 👏';
  } else if (pct >= 80) {
    medal = '🥇';
    message = '¡Muy bien! Tienes una base sólida.';
  } else if (pct >= 60) {
    medal = '🥈';
    message = 'Vas por buen camino; repasa los temas en los que fallaste.';
  }

  let text =
    `${medal} *Resultado de tu prueba*\n${LINE}\n` +
    `Aciertos: *${score}/${total}* (${pct} %)\n${progressBar(score, total)}\n\n${message}`;

  const failedTopics = [...new Set(answers.filter((a) => !a.correct).map((a) => a.topic))];
  if (failedTopics.length) {
    text += `\n\n📌 *Para reforzar:*`;
    for (const topic of failedTopics) {
      const info = TOPICS[topic];
      const tut = info && info.tutorial ? tutorialById(info.tutorial) : null;
      text += tut
        ? `\n• ${info.name} → video *${tutorialNumber(tut.id)}* en 🎬 Videotutoriales`
        : `\n• ${info ? info.name : topic} → pregúntale al 🤖 Tutor IA`;
    }
  }
  text += `\n\n_¿Qué te pareció CompuFácil? Cuéntanos en la opción *5* del menú._`;
  await client.sendText(phone, text);
  await sendMenu(client, phone, st);
}

async function showProgress(client, phone, st) {
  const prog = await api.progress(phone);
  if (!prog) {
    await client.sendText(phone, '⚠️ No pude consultar tu progreso en este momento. Intenta más tarde.');
    await sendMenu(client, phone, st);
    return;
  }
  const attempts = prog.attempts || [];
  let text = `📊 *Mi progreso*\n${LINE}\n`;

  if (!attempts.length) {
    text += `Aún no has hecho la prueba diagnóstica. Escribe *3* en el menú para hacerla. 📝\n`;
  } else {
    const avg = Math.round(attempts.reduce((s, a) => s + (100 * a.score) / a.total, 0) / attempts.length);
    text += `📝 Intentos de la prueba: *${attempts.length}* · Promedio: *${avg} %*\n\n`;
    attempts.slice(-5).forEach((a, i, arr) => {
      const n = attempts.length - arr.length + i + 1;
      const date = String(a.created_at).slice(0, 10).split('-').reverse().join('/');
      text += `${n}. ${date} · ${progressBar(a.score, a.total)} *${a.score}/${a.total}*\n`;
    });
    if (attempts.length >= 2) {
      const last = attempts[attempts.length - 1];
      const prev = attempts[attempts.length - 2];
      const d = last.score / last.total - prev.score / prev.total;
      text += d > 0 ? '\n🚀 ¡Mejoraste respecto al intento anterior!\n' : d < 0 ? '\n💡 Bajaste un poco; repasa con los videos o el tutor.\n' : '\n➡️ Te mantienes estable.\n';
    }
  }

  const weak = (prog.weak_topics || []).slice(0, 3);
  if (weak.length) {
    text += `\n📌 *Temas por reforzar:*\n`;
    weak.forEach((w) => {
      const info = TOPICS[w.topic];
      const tut = info && info.tutorial ? tutorialById(info.tutorial) : null;
      text += `• ${info ? info.name : w.topic}${tut ? ` → video *${tutorialNumber(tut.id)}*` : ''}\n`;
    });
  }

  const seen = new Set(prog.videos_seen || []);
  text += `\n🎬 Videos vistos: *${seen.size}/${TUTORIALS.length}*`;
  text += `\n🤖 Preguntas al tutor: *${(prog.counts && prog.counts.tutor_questions) || 0}*`;

  await client.sendText(phone, text);
  await sendMenu(client, phone, st);
}

async function startFeedback(client, phone, st) {
  st.step = 'FEEDBACK_RATING';
  st.feedback = {};
  store.save();
  await client.sendText(phone, FEEDBACK_RATING_TEXT);
}

// ---------------------------------------------------------------------------
// Manejador principal
// ---------------------------------------------------------------------------

const MENU_WORDS = ['menu', 'inicio', 'volver', 'salir', 'regresar', 'menu principal'];
const GREETINGS = /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|hi|hello|ola|holi)\b/;

async function handleMessage(baseClient, message) {
  const phone = message.from;
  const name = (message.sender && (message.sender.pushname || message.sender.name)) || message.notifyName || null;
  const st = store.get(phone, name);
  const ctx = { voiceTurn: message.type === 'ptt' || message.type === 'audio', voiceQueue: [] };
  const client = wrapClient(baseClient, st, ctx);
  try {
    await processMessage(baseClient, client, message, st, ctx);
  } finally {
    if (ctx.voiceQueue.length) await sendVoice(baseClient, phone, ctx.voiceQueue.join('\n\n'));
  }
}

const TUTORIAL_PHRASES = {
  1: ['procesador', 'cpu', 'microprocesador'],
  2: ['memoria ram', 'ram', 'memoria'],
  3: ['almacenamiento', 'disco duro', 'ssd', 'hdd', 'disco'],
  4: ['placa madre', 'tarjeta madre', 'motherboard', 'placa base'],
  5: ['tarjeta grafica', 'grafica', 'gpu', 'tarjeta de video'],
  6: ['fuente de poder', 'fuente', 'fuente de alimentacion'],
  7: ['perifericos', 'puertos', 'usb'],
  8: ['ensamble', 'armar un pc', 'armar computador', 'ensamblar'],
};

const MENU_PHRASES = {
  1: ['tutor', 'tutor ia', 'inteligencia artificial', 'preguntar', 'hacer una pregunta'],
  2: ['videos', 'video', 'tutoriales', 'videotutoriales', 'ver videos'],
  3: ['prueba', 'prueba diagnostica', 'quiz', 'examen', 'evaluacion', 'test'],
  4: ['progreso', 'mi progreso', 'historial', 'mis resultados'],
  5: ['opinion', 'comentario', 'calificar', 'dejar opinion', 'sugerencia'],
  6: ['ayuda', 'instrucciones'],
  7: ['modo accesible', 'accesibilidad', 'accesible'],
};

const GLOBAL_COMMANDS = {
  menu: ['menu', 'menu principal', 'ir al menu', 'volver al menu', 'inicio', 'volver', 'regresar'],
  ayuda: ['ayuda', 'necesito ayuda', 'como funciona'],
  audio: ['audio', 'escuchar', 'leer en voz alta', 'repetir', 'repitelo'],
  accesible: ['modo accesible', 'accesible', 'activar modo accesible', 'activar accesible'],
  normal: ['modo normal', 'desactivar modo accesible', 'desactivar accesible'],
};

async function processMessage(baseClient, client, message, st, ctx) {
  const phone = message.from;
  const name = st.name;

  // En imágenes, audios o stickers, "body" trae datos del archivo, no texto.
  const TEXT_TYPES = ['chat', 'list_response', 'buttons_response', 'template_button_reply'];
  const isText = !message.type || TEXT_TYPES.includes(message.type);
  const isVoice = message.type === 'ptt' || message.type === 'audio';
  let raw = isText ? (message.body || '').trim() : '';

  // Primer contacto
  if (st.isNew) {
    delete st.isNew;
    store.save();
    api.event(phone, 'first_contact', null, name);
    await client.sendText(phone, WELCOME_TEXT);
    await sendMenu(client, phone, st);
    if (!isVoice) return;
  }

  // Notas de voz → texto
  if (isVoice) {
    let transcript = null;
    try {
      const buffer = await baseClient.decryptFile(message);
      const result = await api.transcribe(phone, buffer.toString('base64'), message.mimetype || 'audio/ogg', st.name);
      transcript = result && result.text ? result.text.trim() : null;
    } catch (err) {
      console.warn('⚠️ No se pudo procesar la nota de voz:', err.message);
    }
    if (!transcript) {
      await client.sendText(phone, '🎙️ No pude entender el audio. ¿Puedes repetirlo más despacio o escribirlo?');
      return;
    }
    await baseClient.sendText(phone, st.accessible ? `Escuché: «${transcript}»` : `🎧 _Escuché:_ «${transcript}»`);
    raw = transcript;
  }

  // Mensajes que no son texto ni voz (imágenes, stickers…)
  if (!raw) {
    await client.sendText(phone, '✍️ Por ahora puedo leer *texto* y escuchar *notas de voz*. Escribe tu pregunta o *MENU*.');
    return;
  }

  let text = normalize(raw);
  if (isVoice) {
    const spoken = text.replace(/^(el|la)\s+/, '');
    if (SPOKEN[text]) text = SPOKEN[text];
    else if (SPOKEN[spoken]) text = SPOKEN[spoken];
  }
  // Comandos globales dichos o escritos con errores ("menú principal", "ayudaa")
  if (text.split(' ').length <= 4 && !['FEEDBACK_COMMENT'].includes(st.step)) {
    const g = intent.pick(text, GLOBAL_COMMANDS, 0.84);
    if (g) text = g.value;
  }

  // Comandos globales
  if (MENU_WORDS.includes(text)) {
    if (st.step === 'QUIZ' && st.quiz) api.event(phone, 'quiz_abandon', `${st.quiz.index}`, st.name);
    await sendMenu(client, phone, st);
    return;
  }
  if (text === 'ayuda' || text === 'help') {
    api.event(phone, 'help', null, st.name);
    await client.sendText(phone, HELP_TEXT);
    return;
  }
  if (['audio', 'escuchar', 'leer', 'leer en voz alta', 'repetir'].includes(text)) {
    api.event(phone, 'audio_request', null, st.name);
    const ok = st.lastText ? await sendVoice(baseClient, phone, st.lastText) : false;
    if (!ok) await baseClient.sendText(phone, '⚠️ No pude generar el audio en este momento. Intenta de nuevo en un momento.');
    return;
  }
  if (['accesible', 'modo accesible', 'activar modo accesible', 'activar accesible'].includes(text)) {
    return setAccessible(client, phone, st, true);
  }
  if (['normal', 'modo normal', 'desactivar modo accesible', 'desactivar accesible'].includes(text)) {
    return setAccessible(client, phone, st, false);
  }

  return route(client, phone, st, raw, text);
}

async function setAccessible(client, phone, st, on) {
  st.accessible = on;
  store.save();
  api.event(phone, on ? 'accessible_on' : 'accessible_off', null, st.name);
  await client.sendText(
    phone,
    on
      ? '♿ *Modo accesible activado.* A partir de ahora te envío cada mensaje sin adornos y también en *nota de voz*. Puedes responderme escribiendo o con audios. Para desactivarlo escribe *NORMAL*.'
      : '✅ Modo accesible desactivado. Si quieres escuchar un mensaje, escribe *AUDIO*.'
  );
  return sendMenu(client, phone, st);
}

async function route(client, phone, st, raw, text) {
  // eslint-disable-next-line no-param-reassign
  text = text || '';
  switch (st.step) {
    case 'MENU': {
      const options = {
        1: ['tutor', 'tutor ia', 'ia', 'pregunta', 'preguntar'],
        2: ['videos', 'video', 'tutoriales', 'tutorial', 'videotutoriales'],
        3: ['prueba', 'quiz', 'examen', 'evaluacion', 'prueba diagnostica'],
        4: ['progreso', 'mi progreso', 'historial'],
        5: ['opinion', 'comentario', 'comentarios', 'feedback', 'sugerencia'],
        6: ['ayuda', 'info'],
        7: ['accesibilidad', 'modo audio', 'audios'],
      };
      let choice = Object.keys(options).find((k) => text === k || options[k].includes(text));
      if (!choice) {
        const num = intent.extractNumber(text, 5);
        if (num >= 1 && num <= 7) choice = String(num);
      }
      if (!choice && text.split(' ').length <= 4) {
        const p = intent.pick(text, MENU_PHRASES, 0.78);
        if (p) choice = p.value;
      }
      const labels = { 1: 'tutor', 2: 'videotutoriales', 3: 'prueba', 4: 'progreso', 5: 'opinion', 6: 'ayuda', 7: 'accesible' };
      if (choice) api.event(phone, 'menu_option', labels[choice], st.name);

      if (choice === '1') return startTutor(client, phone, st);
      if (choice === '2') return showTutorials(client, phone, st);
      if (choice === '3') return startQuiz(client, phone, st);
      if (choice === '4') return showProgress(client, phone, st);
      if (choice === '5') return startFeedback(client, phone, st);
      if (choice === '6') return client.sendText(phone, HELP_TEXT);
      if (choice === '7') return setAccessible(client, phone, st, !st.accessible);

      if (GREETINGS.test(text)) return sendMenu(client, phone, st);
      // Si escribe una pregunta directamente desde el menú, la pasamos al tutor.
      if (raw.length > 12 && /[a-z]/.test(text)) {
        st.step = 'TUTOR';
        store.save();
        api.event(phone, 'menu_option', 'tutor_directo', st.name);
        return askTutor(client, phone, st, raw);
      }
      await client.sendText(phone, '🤔 No reconocí esa opción. Escribe un número del *1* al *7*, o *MENU* para ver las opciones.');
      return;
    }

    case 'TUTOR': {
      // Un número solo (1-7) no es una pregunta: es una opción del menú.
      const spokenOption = text.split(' ').length <= 2 ? intent.extractNumber(text, 2) : null;
      if (/^[1-7]$/.test(text) || (spokenOption >= 1 && spokenOption <= 7)) {
        if (spokenOption) text = String(spokenOption);
        st.step = 'MENU';
        store.save();
        return route(client, phone, st, raw, text);
      }
      if (text === 'nuevo' || text === 'nuevo tema') {
        await api.resetChat(phone);
        await client.sendText(phone, '🧹 Listo, empezamos un tema nuevo. ¿Qué quieres saber?');
        return;
      }
      const thumbsUp = /^(👍|👍🏻|👍🏼|👍🏽|👍🏾|👍🏿|si me sirvio|me sirvio|util)$/u.test(raw.toLowerCase()) || text === 'si me sirvio' || text === 'me sirvio';
      const thumbsDown = /^(👎|👎🏻|👎🏼|👎🏽|👎🏾|👎🏿)$/u.test(raw) || text === 'no me sirvio';
      if (thumbsUp || thumbsDown) {
        await api.rate(phone, thumbsUp ? 1 : -1, st.lastAnswerId);
        await client.sendText(
          phone,
          thumbsUp
            ? '🙌 ¡Gracias! Me alegra que te haya servido. ¿Seguimos? Pregúntame otra cosa.'
            : '🙏 Gracias por contarme. Prueba pedirme: _"explícalo más fácil"_ o _"dame un ejemplo"_ y lo intento de otra forma.'
        );
        return;
      }
      return askTutor(client, phone, st, raw);
    }

    case 'TUTORIALS': {
      if (st.tutorial && (['r', 'reto', 'mini reto', 'otro reto', 'erre'].includes(text) || intent.pick(text, { r: ['mini reto', 'otro reto', 'reto'] }, 0.8))) {
        return startMiniChallenge(client, phone, st);
      }
      let n = intent.extractNumber(text, 5);
      if (!(n >= 1 && n <= TUTORIALS.length)) {
        const p = intent.pick(text, TUTORIAL_PHRASES, 0.8);
        n = p ? parseInt(p.value, 10) : null;
      }
      if (n >= 1 && n <= TUTORIALS.length) {
        return sendTutorial(client, phone, st, TUTORIALS[n - 1]);
      }
      await client.sendText(phone, `Escribe un número del *1* al *${TUTORIALS.length}* para ver un video, o *MENU* para volver.`);
      return;
    }

    case 'MINI_CHALLENGE': {
      const letter = parseLetter(raw) || intent.answerLetter(raw, questionById(st.lastChallenge));
      if (!letter) {
        await client.sendText(phone, '⚠️ Responde con *A*, *B* o *C*.');
        return;
      }
      const q = questionById(st.lastChallenge);
      api.event(phone, 'mini_challenge', `${q.id}:${letter === q.correct ? 'ok' : 'fail'}`, st.name);
      st.step = 'TUTORIALS';
      store.save();
      await client.sendText(
        phone,
        `${answerFeedback(q, letter)}\n\n${LINE}\n🧠 *R* · otro reto\n🔢 Número · ver otro video\n🏠 *MENU* · volver`
      );
      return;
    }

    case 'QUIZ': {
      if (!st.quiz) return sendMenu(client, phone, st);
      const letter = parseLetter(raw) || intent.answerLetter(raw, questionById(st.quiz.ids[st.quiz.index]));
      if (!letter) {
        await client.sendText(phone, `⚠️ No entendí «${raw.slice(0, 60)}». Responde con *A*, *B* o *C* (o di "la a", "la be", "la ce"). Escribe *MENU* si quieres salir de la prueba.`);
        return;
      }
      const q = questionById(st.quiz.ids[st.quiz.index]);
      st.quiz.answers.push({ question_id: q.id, question: q.question.replace(/\*/g, ''), topic: q.topic, answer: letter, correct: letter === q.correct });
      st.quiz.index += 1;
      store.save();

      await client.sendText(phone, answerFeedback(q, letter));
      if (st.quiz.index < st.quiz.ids.length) {
        const next = questionById(st.quiz.ids[st.quiz.index]);
        await client.sendText(phone, formatQuestion(next, st.quiz.index, st.quiz.ids.length));
      } else {
        await finishQuiz(client, phone, st);
      }
      return;
    }

    case 'FEEDBACK_RATING': {
      const stars = (raw.match(/⭐/g) || []).length;
      let n = stars || intent.extractNumber(text, 6);
      if (!(n >= 1 && n <= 5)) {
        const p = intent.pick(text, { 1: ['muy mala', 'pesima', 'horrible'], 2: ['mala'], 3: ['regular', 'mas o menos'], 4: ['buena', 'bien', 'chevere'], 5: ['excelente', 'muy buena', 'genial', 'perfecta', 'super'] }, 0.8);
        n = p ? parseInt(p.value, 10) : null;
      }
      if (!(n >= 1 && n <= 5)) {
        await client.sendText(phone, 'Responde con un número del *1* al *5*, por favor.');
        return;
      }
      st.feedback = { rating: n };
      st.step = 'FEEDBACK_CATEGORY';
      store.save();
      await client.sendText(phone, `${'⭐'.repeat(n)} ¡Gracias!\n\n${FEEDBACK_CATEGORY_TEXT}`);
      return;
    }

    case 'FEEDBACK_CATEGORY': {
      let n = intent.extractNumber(text, 5);
      if (!FEEDBACK_CATEGORIES[n]) {
        const p = intent.pick(text, { 1: ['sugerencia', 'sugerir', 'una idea'], 2: ['algo no funciono', 'no funciono', 'error', 'falla', 'problema'], 3: ['felicitacion', 'felicitar', 'felicitaciones'], 4: ['otro', 'otra cosa'] }, 0.78);
        n = p ? parseInt(p.value, 10) : null;
      }
      if (!FEEDBACK_CATEGORIES[n]) {
        await client.sendText(phone, 'Responde con un número del *1* al *4*, por favor.');
        return;
      }
      st.feedback.category = FEEDBACK_CATEGORIES[n];
      st.step = 'FEEDBACK_COMMENT';
      store.save();
      await client.sendText(phone, FEEDBACK_COMMENT_TEXT);
      return;
    }

    case 'FEEDBACK_COMMENT': {
      const skip = ['omitir', 'no', 'nada', 'ninguno'].includes(text) || (text.split(' ').length <= 2 && intent.similarity(text, 'omitir') >= 0.75);
      const comment = skip ? null : raw.slice(0, 2000);
      const data = { ...st.feedback, comment };
      const saved = await api.feedback(phone, data, st.name);
      api.event(phone, 'feedback', String(data.rating), st.name);
      await client.sendText(
        phone,
        saved
          ? '🙏 *¡Gracias por tu opinión!* La leeremos con atención para seguir mejorando CompuFácil.'
          : '⚠️ No pude guardar tu comentario en este momento. Intenta de nuevo más tarde desde la opción *5*.'
      );
      return sendMenu(client, phone, st);
    }

    default:
      return sendMenu(client, phone, st);
  }
}

module.exports = { handleMessage, normalize, parseLetter, pickQuizSet, menuText, plain };
