/**
 * bot.js
 * Bot de WhatsApp "CompuFácil" con @wppconnect-team/wppconnect.
 * Mantiene un estado de conversación independiente por número de teléfono
 * (userState) para soportar 15+ usuarios simultáneos sin cruzar sesiones.
 */

const wppconnect = require('@wppconnect-team/wppconnect');
const axios = require('axios');

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8000/api/chat';

// Estado independiente por cada usuario (número de teléfono), en memoria.
const userState = {};

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
];

// ---------------------------------------------------------------------------
// Manejo de estado por usuario
// ---------------------------------------------------------------------------

/**
 * Arma el texto completo de una pregunta del quiz con su encabezado
 * "Pregunta X/N" calculado dinámicamente a partir de QUIZ.length.
 */
function buildQuizQuestionText(index) {
  return `📝 *Pregunta ${index + 1}/${QUIZ.length}*\n\n${QUIZ[index].prompt}`;
}

function initUser(phone) {
  userState[phone] = {
    step: 'MENU',
    quizIndex: 0,
    quizAnswers: [],
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
        await client.sendText(phone, buildQuizQuestionText(0));
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

      const currentQuestion = QUIZ[state.quizIndex];
      const isCorrect = answer === currentQuestion.correct;
      state.quizAnswers.push({ answer, isCorrect });

      const feedback = isCorrect
        ? currentQuestion.feedback.correct
        : currentQuestion.feedback.incorrect;
      await client.sendText(phone, feedback);

      state.quizIndex += 1;

      if (state.quizIndex < QUIZ.length) {
        // Todavía hay preguntas pendientes: lanzar la siguiente.
        await client.sendText(phone, buildQuizQuestionText(state.quizIndex));
      } else {
        // Quiz terminado: calificar y dar retroalimentación pedagógica.
        const score = state.quizAnswers.filter((a) => a.isCorrect).length;
        const total = QUIZ.length;

        let closingMessage =
          `🎓 *Resultado de tu Prueba Piloto*\n\n` +
          `Obtuviste *${score}/${total}* aciertos.\n\n`;

        if (score === total) {
          closingMessage +=
            'Dominas bien los conceptos de *RAM* y *SSD/HDD*. ¡Excelente ' +
            'base para seguir avanzando! 👏';
        } else if (score === 0) {
          closingMessage +=
            'Vale la pena repasar la función de la *RAM* (memoria temporal) ' +
            'y las ventajas del *SSD* (velocidad, sin partes móviles). Te ' +
            'recomiendo revisar la opción *1* del menú.';
        } else {
          closingMessage +=
            'Vas por buen camino, pero conviene repasar el concepto en el ' +
            'que fallaste. Puedes revisarlo en la opción *1* del menú.';
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