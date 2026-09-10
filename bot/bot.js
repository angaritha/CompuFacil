/**
 * bot.js
 * Bot de WhatsApp "CompuFácil" con @wppconnect-team/wppconnect.
 * Mantiene un estado de conversación independiente por número de teléfono
 * (userState) para soportar 15+ usuarios simultáneos sin cruzar sesiones.
 */

const wppconnect = require('@wppconnect-team/wppconnect');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8000/api/chat';
const HISTORY_FILE = path.join(__dirname, 'quiz_history.json');

// Estado independiente por cada usuario (número de teléfono), en memoria.
const userState = {};

// -----------------------------------------------------------------------
// Historial de intentos del quiz, persistido en un archivo JSON local para
// que sobreviva a reinicios del bot. Estructura:
// { "573000000000@c.us": [ { date: "10/09/2026", score: 4, total: 5 }, ... ] }
// -----------------------------------------------------------------------
let quizHistory = {};
try {
  quizHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
} catch (err) {
  quizHistory = {}; // Archivo aún no existe o está vacío: empezamos limpio.
}

function saveQuizHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(quizHistory, null, 2));
  } catch (err) {
    console.error('⚠️ No se pudo guardar el historial de quiz:', err.message);
  }
}

function recordQuizAttempt(phone, score, total) {
  if (!quizHistory[phone]) quizHistory[phone] = [];
  const dateStr = new Date().toLocaleDateString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  quizHistory[phone].push({ date: dateStr, score, total });
  saveQuizHistory();
}

// ---------------------------------------------------------------------------
// Textos y contenido estático
// ---------------------------------------------------------------------------

const MENU_TEXT =
  `🖥️ *Bienvenido a CompuFácil* 🖥️\n\n` +
  `Selecciona una opción escribiendo el número:\n\n` +
  `*1* - 🤖 Tutor IA de Hardware (pregunta lo que quieras)\n` +
  `*2* - 📝 Prueba Piloto (Evaluación diagnóstica)\n` +
  `*3* - 🎬 Tutoriales (próximamente)\n\n` +
  `_Escribe *MENU* en cualquier momento para volver aquí._`;

const TUTOR_WELCOME_TEXT =
  `🤖 *Tutor IA de Hardware activado*\n\n` +
  `Pregúntame lo que quieras sobre *hardware y computación*: CPU, RAM, ` +
  `almacenamiento, tarjetas gráficas, periféricos, mantenimiento, etc. Te ` +
  `respondo como un tutor, en un par de párrafos.\n\n` +
  `_Solo puedo ayudarte con temas de hardware/computación. Escribe *MENU* ` +
  `para salir en cualquier momento._`;

const TUTORIALES_TEXT =
  `🎬 *Tutoriales*\n\n` +
  `Esta sección está *en desarrollo*. Aquí encontrarás videos e imágenes ` +
  `paso a paso sobre hardware muy pronto.\n\n` +
  `Mientras tanto, prueba la opción *1* para preguntarme lo que necesites.`;

// -----------------------------------------------------------------------
// Multimedia reservada para la futura sección de Tutoriales (opción 3).
// Cada valor puede ser una ruta LOCAL ('./assets/cpu.jpg') o una URL
// ('https://ejemplo.com/cpu.jpg'); sendImage() de wppconnect acepta ambas
// sin distinción. Por ahora no se está usando en ningún flujo activo.
// -----------------------------------------------------------------------
const TUTORIAL_MEDIA = {
  cpu: './assets/cpu.jpg',
  ram: './assets/ram.jpg',
  almacenamiento: './assets/almacenamiento.jpg',
};

/**
 * Envía una imagen de la carpeta de tutoriales de forma 100% segura: si el
 * archivo no existe, la URL falla o hay cualquier error, se registra en
 * consola y el flujo continúa sin interrumpir la conversación del usuario.
 * (Reservada para cuando se active la sección de Tutoriales).
 */
async function sendTutorialMedia(client, phone, key) {
  const mediaPath = TUTORIAL_MEDIA[key];
  if (!mediaPath) return;

  try {
    await client.sendImage(phone, mediaPath, `${key}.jpg`, '📷 Material de apoyo');
  } catch (error) {
    console.warn(
      `⚠️ No se pudo enviar la imagen del tutorial "${key}": ${error.message}`
    );
  }
}

// Prueba piloto pedagógica: 5 preguntas generales de evaluación diagnóstica,
// pensadas para alguien con poco conocimiento previo de hardware.
// El encabezado "Pregunta X/N" se arma solo a partir de QUIZ.length,
// así que si agregas o quitas preguntas no hay que tocar nada más.
const QUIZ = [
  {
    prompt:
      `¿Cuál es la función de la memoria *RAM*?\n\n` +
      `*A)* Almacenar archivos de forma permanente\n` +
      `*B)* Guardar temporalmente los datos y programas en uso\n` +
      `*C)* Enfriar el procesador`,
    correct: 'b',
    feedback: {
      correct:
        '✅ ¡Correcto! La RAM efectivamente guarda de forma temporal los ' +
        'datos que el sistema está usando en ese momento.',
      incorrect:
        '❌ No es así. La función real de la RAM es guardar *temporalmente* ' +
        'los datos y programas mientras se usan (no almacenar de forma ' +
        'permanente ni enfriar el procesador).',
    },
  },
  {
    prompt:
      `¿Qué ventaja tiene un *SSD* sobre un *HDD*?\n\n` +
      `*A)* Es más lento pero más barato\n` +
      `*B)* Usa discos magnéticos giratorios\n` +
      `*C)* Es más rápido y resistente porque no tiene partes móviles`,
    correct: 'c',
    feedback: {
      correct:
        '✅ ¡Exacto! El SSD no tiene partes móviles, lo que lo hace más ' +
        'rápido y resistente que el HDD.',
      incorrect:
        '❌ No es correcto. La ventaja real del SSD es ser *más rápido y ' +
        'resistente* al no tener partes móviles (eso describe al HDD, no ' +
        'al SSD).',
    },
  },
  {
    prompt:
      `¿Cuál es la función principal del *CPU* (procesador)?\n\n` +
      `*A)* Ejecutar las instrucciones y operaciones del computador\n` +
      `*B)* Guardar los archivos de forma permanente\n` +
      `*C)* Mostrar las imágenes en la pantalla`,
    correct: 'a',
    feedback: {
      correct:
        '✅ ¡Correcto! El CPU es el encargado de ejecutar las instrucciones ' +
        'de los programas, como el "cerebro" del computador.',
      incorrect:
        '❌ No es así. Guardar archivos es tarea del *almacenamiento* ' +
        '(SSD/HDD) y mostrar imágenes es tarea de la *tarjeta gráfica*. El ' +
        'CPU es quien ejecuta las instrucciones de los programas.',
    },
  },
  {
    prompt:
      `Cuando ves que un computador tiene "512 GB", ¿a qué se refiere esa ` +
      `cifra normalmente?\n\n` +
      `*A)* A la velocidad del internet\n` +
      `*B)* A la capacidad de almacenamiento del disco\n` +
      `*C)* A la cantidad de programas abiertos`,
    correct: 'b',
    feedback: {
      correct:
        '✅ ¡Correcto! Los *GB (gigabytes)* miden cuánto espacio de ' +
        'almacenamiento tiene el disco para guardar archivos, fotos y ' +
        'programas.',
      incorrect:
        '❌ No es así. Los *GB* en este contexto miden la *capacidad de ' +
        'almacenamiento* del disco, no la velocidad de internet ni los ' +
        'programas abiertos.',
    },
  },
  {
    prompt:
      `¿Cuál de las siguientes opciones es un *dispositivo de entrada* ` +
      `(sirve para dar información al computador)?\n\n` +
      `*A)* El monitor\n` +
      `*B)* La impresora\n` +
      `*C)* El teclado`,
    correct: 'c',
    feedback: {
      correct:
        '✅ ¡Correcto! El *teclado* es un dispositivo de entrada: le ' +
        'permite al usuario enviar información al computador.',
      incorrect:
        '❌ No es así. El monitor y la impresora son dispositivos de ' +
        '*salida* (muestran información). El *teclado* es el dispositivo ' +
        'de entrada en esta lista.',
    },
  },
  {
    prompt:
      `¿Cuál es la función de la *placa madre* (motherboard)?\n\n` +
      `*A)* Conectar y coordinar la comunicación entre todos los componentes\n` +
      `*B)* Almacenar el sistema operativo\n` +
      `*C)* Enfriar el procesador`,
    correct: 'a',
    feedback: {
      correct:
        '✅ ¡Correcto! La placa madre es la base física que conecta y ' +
        'coordina la comunicación entre el CPU, la RAM, el almacenamiento ' +
        'y los demás componentes.',
      incorrect:
        '❌ No es así. Guardar el sistema operativo es tarea del ' +
        '*almacenamiento*, y enfriar es tarea del *disipador/ventilador*. ' +
        'La placa madre conecta y coordina todos los componentes.',
    },
  },
  {
    prompt:
      `¿Qué mide la unidad *GHz* en un procesador?\n\n` +
      `*A)* La velocidad de procesamiento\n` +
      `*B)* La capacidad de almacenamiento\n` +
      `*C)* La resolución de la pantalla`,
    correct: 'a',
    feedback: {
      correct:
        '✅ ¡Correcto! Los *GHz (gigahercios)* miden la velocidad a la que ' +
        'el procesador ejecuta instrucciones.',
      incorrect:
        '❌ No es así. Los *GHz* miden la *velocidad de procesamiento* del ' +
        'CPU, no el almacenamiento ni la resolución de pantalla.',
    },
  },
  {
    prompt:
      `¿Cuál es la función principal de la *tarjeta gráfica* (GPU)?\n\n` +
      `*A)* Procesar y mostrar imágenes, video y gráficos\n` +
      `*B)* Guardar archivos de forma permanente\n` +
      `*C)* Conectarse a internet`,
    correct: 'a',
    feedback: {
      correct:
        '✅ ¡Correcto! La GPU procesa y renderiza imágenes, video y ' +
        'gráficos 3D, liberando esa carga del CPU.',
      incorrect:
        '❌ No es así. Guardar archivos es tarea del *almacenamiento*, y ' +
        'conectarse a internet depende de la *tarjeta de red*. La GPU se ' +
        'encarga de procesar y mostrar gráficos.',
    },
  },
  {
    prompt:
      `¿Para qué sirve un puerto *USB*?\n\n` +
      `*A)* Para conectar dispositivos externos como memorias, mouse o ` +
      `teclados\n` +
      `*B)* Para enfriar el computador\n` +
      `*C)* Para aumentar la memoria RAM`,
    correct: 'a',
    feedback: {
      correct:
        '✅ ¡Correcto! Los puertos USB permiten conectar dispositivos ' +
        'externos y transferir datos o energía entre ellos.',
      incorrect:
        '❌ No es así. Un puerto USB sirve para *conectar dispositivos ' +
        'externos* (memorias, mouse, teclados, discos), no para enfriar ni ' +
        'para aumentar la RAM.',
    },
  },
  {
    prompt:
      `¿Cuál es la función de la *fuente de poder* (PSU)?\n\n` +
      `*A)* Suministrar energía eléctrica a los componentes del computador\n` +
      `*B)* Almacenar archivos de forma permanente\n` +
      `*C)* Procesar gráficos y video`,
    correct: 'a',
    feedback: {
      correct:
        '✅ ¡Correcto! La fuente de poder convierte la corriente eléctrica ' +
        'de la toma de pared en la energía que necesitan los componentes ' +
        'internos para funcionar.',
      incorrect:
        '❌ No es así. Almacenar archivos es tarea del *disco* y procesar ' +
        'gráficos es tarea de la *GPU*. La fuente de poder suministra ' +
        'energía eléctrica a todo el computador.',
    },
  },
];

/**
 * Elige `count` preguntas al azar del banco completo QUIZ (sin repetir),
 * mezclando el orden con Fisher-Yates. Así cada intento puede tener una
 * combinación distinta de preguntas aunque el banco tenga más que `count`.
 */
function getRandomQuizSet(count = 5) {
  const pool = [...QUIZ];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

// ---------------------------------------------------------------------------
// Manejo de estado por usuario
// ---------------------------------------------------------------------------

/**
 * Arma el texto completo de una pregunta del quiz con su encabezado
 * "Pregunta X/N" calculado dinámicamente. Recibe el set de preguntas ya
 * seleccionado al azar para este intento (no el banco completo).
 */
function buildQuizQuestionText(quizSet, index) {
  return `📝 *Pregunta ${index + 1}/${quizSet.length}*\n\n${quizSet[index].prompt}`;
}

function initUser(phone) {
  userState[phone] = {
    step: 'MENU',
    quizIndex: 0,
    quizAnswers: [],
    quizSet: [],
  };
}

function getUser(phone) {
  if (!userState[phone]) initUser(phone);
  return userState[phone];
}

async function sendMenu(client, phone) {
  const state = getUser(phone);
  state.step = 'MENU';
  await client.sendText(phone, MENU_TEXT);
}

// ---------------------------------------------------------------------------
// Máquina de estados principal
// ---------------------------------------------------------------------------

async function handleMessage(client, message) {
  const phone = message.from;
  const body = (message.body || '').trim();
  const bodyLower = body.toLowerCase();
  const state = getUser(phone);

  // Comando global: volver al menú desde cualquier estado.
  if (bodyLower === 'menu') {
    await sendMenu(client, phone);
    return;
  }

  switch (state.step) {
    // -----------------------------------------------------------------
    case 'MENU': {
      if (body === '1') {
        state.step = 'TUTOR_IA';
        await client.sendText(phone, TUTOR_WELCOME_TEXT);
      } else if (body === '2') {
        state.step = 'QUIZ';
        state.quizIndex = 0;
        state.quizAnswers = [];
        state.quizSet = getRandomQuizSet(5); // 5 al azar de las 10 del banco

        const previousAttempts = quizHistory[phone] || [];
        if (previousAttempts.length > 0) {
          const last = previousAttempts[previousAttempts.length - 1];
          await client.sendText(
            phone,
            `📊 Ya realizaste esta prueba antes. Tu último intento fue el ` +
              `*${last.date}* y obtuviste *${last.score}/${last.total}* ` +
              `aciertos (intento nº ${previousAttempts.length}).\n\n` +
              `¡Vamos con un nuevo intento! 💪`
          );
        }

        await client.sendText(phone, buildQuizQuestionText(state.quizSet, 0));
      } else if (body === '3') {
        await client.sendText(phone, TUTORIALES_TEXT);
        await sendMenu(client, phone); // Vuelve al menú automáticamente
      } else {
        await client.sendText(
          phone,
          '⚠️ Opción no válida. Por favor escribe *1*, *2* o *3*.'
        );
      }
      break;
    }

    // -----------------------------------------------------------------
    case 'QUIZ': {
      const answer = bodyLower;
      if (!['a', 'b', 'c'].includes(answer)) {
        await client.sendText(phone, '⚠️ Por favor responde con *A*, *B* o *C*.');
        break;
      }

      const currentQuestion = state.quizSet[state.quizIndex];
      const isCorrect = answer === currentQuestion.correct;
      state.quizAnswers.push({ answer, isCorrect });

      const feedback = isCorrect
        ? currentQuestion.feedback.correct
        : currentQuestion.feedback.incorrect;
      await client.sendText(phone, feedback);

      state.quizIndex += 1;

      if (state.quizIndex < state.quizSet.length) {
        // Todavía hay preguntas pendientes: lanzar la siguiente.
        await client.sendText(phone, buildQuizQuestionText(state.quizSet, state.quizIndex));
      } else {
        // Quiz terminado: calificar, guardar en el historial y dar
        // retroalimentación pedagógica.
        const score = state.quizAnswers.filter((a) => a.isCorrect).length;
        const total = state.quizSet.length;

        recordQuizAttempt(phone, score, total);

        let closingMessage =
          `🎓 *Resultado de tu Prueba Piloto*\n\n` +
          `Obtuviste *${score}/${total}* aciertos.\n\n`;

        if (score === total) {
          closingMessage +=
            'Dominas bien estos conceptos de hardware. ¡Excelente base ' +
            'para seguir avanzando! 👏';
        } else if (score === 0) {
          closingMessage +=
            'Vale la pena repasar los conceptos básicos de hardware. Te ' +
            'recomiendo preguntarle al *Tutor IA* (opción 1) sobre lo que ' +
            'no te quedó claro.';
        } else {
          closingMessage +=
            'Vas por buen camino, pero conviene repasar los conceptos en ' +
            'los que fallaste. Puedes preguntarle al *Tutor IA* (opción 1) ' +
            'sobre esos temas específicos.';
        }

        closingMessage += '\n\nRegresando al menú principal...';
        await client.sendText(phone, closingMessage);
        await sendMenu(client, phone);
      }
      break;
    }

    // -----------------------------------------------------------------
    case 'TUTOR_IA': {
      try {
        await client.startTyping(phone);

        const response = await axios.post(
          FASTAPI_URL,
          { phone, message: body },
          { timeout: 35000 }
        );

        await client.stopTyping(phone);
        const reply =
          response.data && response.data.reply
            ? response.data.reply
            : 'No pude generar una respuesta en este momento.';
        await client.sendText(phone, reply);
      } catch (error) {
        await client.stopTyping(phone).catch(() => {});
        console.error(`Error consultando FastAPI para ${phone}:`, error.message);
        await client.sendText(
          phone,
          '⚠️ El Tutor IA tardó demasiado en responder o hubo un error de ' +
            'conexión. Intenta de nuevo o escribe *MENU*.'
        );
      }
      break;
    }

    // -----------------------------------------------------------------
    default: {
      await sendMenu(client, phone);
    }
  }
}

// ---------------------------------------------------------------------------
// Arranque del bot
// ---------------------------------------------------------------------------

wppconnect
  .create({
    session: 'compufacil-bot',
    catchQR: (base64Qr, asciiQR) => {
      console.log('Escanea el siguiente código QR para iniciar sesión:');
      console.log(asciiQR);
    },
    statusFind: (statusSession) => {
      console.log('Estado de sesión:', statusSession);
    },
    headless: true,
    logQR: true,
  })
  .then((client) => start(client))
  .catch((error) => console.error('Error al iniciar wppconnect:', error));

function start(client) {
  console.log('✅ CompuFácil bot iniciado correctamente.');

  client.onMessage(async (message) => {
    try {
      if (message.isGroupMsg) return; // Ignorar mensajes de grupos.
      if (!message.body) return;

      const phone = message.from;

      if (!userState[phone]) {
        initUser(phone);
        await client.sendText(phone, MENU_TEXT);
        return;
      }

      await handleMessage(client, message);
    } catch (err) {
      console.error('Error procesando mensaje:', err);
      try {
        await client.sendText(
          message.from,
          '⚠️ Ocurrió un error inesperado. Escribe *MENU* para reiniciar.'
        );
      } catch (_) {
        /* noop */
      }
    }
  });

  // Cierre seguro del navegador Chromium ante SIGINT (Ctrl+C).
  process.on('SIGINT', async () => {
    console.log('\n🛑 Señal SIGINT recibida. Cerrando sesión de WhatsApp...');
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

module.exports = { userState };