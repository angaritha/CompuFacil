/**
 * content.js
 * Todo el contenido pedagógico de CompuFácil: temas, videotutoriales y banco
 * de preguntas de la prueba diagnóstica. Para agregar un video o una
 * pregunta basta con editar este archivo.
 */

// Temas del curso. "tutorial" indica qué video recomendar si el estudiante
// falla preguntas de ese tema.
const TOPICS = {
  cpu: { name: 'Procesador (CPU)', tutorial: 'cpu' },
  ram: { name: 'Memoria RAM', tutorial: 'ram' },
  almacenamiento: { name: 'Almacenamiento', tutorial: 'almacenamiento' },
  placa: { name: 'Placa madre', tutorial: 'placa' },
  gpu: { name: 'Tarjeta gráfica (GPU)', tutorial: 'gpu' },
  psu: { name: 'Fuente de poder', tutorial: 'psu' },
  perifericos: { name: 'Periféricos y puertos', tutorial: 'perifericos' },
  unidades: { name: 'Unidades de medida', tutorial: null },
};

// ---------------------------------------------------------------------------
// Videotutoriales
// file: ruta del MP4 dentro de bot/ (recomendado: máx. 16 MB, 720p, 1-3 min)
// url:  enlace opcional (YouTube, Drive) que se envía si el archivo no existe
// ---------------------------------------------------------------------------
const TUTORIALS = [
  {
    id: 'cpu',
    title: 'El procesador (CPU)',
    file: 'assets/videos/01-cpu.mp4',
    url: 'https://youtu.be/bJrfPQJ_Ks4',
    points: [
      'Es el "cerebro": ejecuta las instrucciones de los programas.',
      'Su velocidad se mide en *GHz* y trabaja con varios *núcleos*.',
      'Debe ser compatible con el *socket* de la placa madre.',
    ],
  },
  {
    id: 'ram',
    title: 'La memoria RAM',
    file: 'assets/videos/02-ram.mp4',
    url: 'https://youtu.be/RZyd7Cww82k',
    points: [
      'Guarda *temporalmente* lo que estás usando en este momento.',
      'Es *volátil*: se borra al apagar el equipo.',
      'Más RAM = más programas abiertos sin que el PC se ponga lento.',
    ],
  },
  {
    id: 'almacenamiento',
    title: 'Almacenamiento: HDD, SSD y NVMe',
    file: 'assets/videos/03-almacenamiento.mp4',
    url: 'https://youtu.be/mVLlPIyvxkY',
    points: [
      'Guarda tus archivos de forma *permanente*.',
      'El *HDD* es mecánico y económico; el *SSD* no tiene partes móviles y es mucho más rápido.',
      'Los *SSD NVMe* se conectan por PCIe y son los más veloces.',
    ],
  },
  {
    id: 'placa',
    title: 'La placa madre',
    file: 'assets/videos/04-placa-madre.mp4',
    url: 'https://youtu.be/fLgumz2q6Cw',
    points: [
      'Es la tarjeta principal donde se conectan todos los componentes.',
      'Tiene el *socket* del CPU, las ranuras de RAM y los puertos.',
      'Define qué componentes son *compatibles* con tu equipo.',
    ],
  },
  {
    id: 'gpu',
    title: 'La tarjeta gráfica (GPU)',
    file: 'assets/videos/05-gpu.mp4',
    url: 'https://youtu.be/lSTKcpz6Ioo',
    points: [
      'Procesa imágenes, video y gráficos 3D.',
      'Puede ser *integrada* (en el procesador) o *dedicada* (tarjeta aparte).',
      'Es clave en videojuegos, diseño, edición e inteligencia artificial.',
    ],
  },
  {
    id: 'psu',
    title: 'La fuente de poder',
    file: 'assets/videos/06-fuente-de-poder.mp4',
    url: 'https://youtu.be/fBfd5dAMcCk',
    points: [
      'Convierte la corriente del tomacorriente en energía para los componentes.',
      'Su potencia se mide en *vatios (W)*.',
      'Una fuente de calidad protege todo el equipo.',
    ],
  },
  {
    id: 'perifericos',
    title: 'Periféricos y puertos',
    file: 'assets/videos/07-perifericos.mp4',
    url: 'https://youtu.be/E1zPmR9YlCY',
    points: [
      'Hay periféricos de *entrada* (teclado), *salida* (monitor) y *entrada/salida* (USB).',
      'Se conectan por puertos como *USB*, *HDMI* o de audio.',
      'Cada versión de puerto tiene una velocidad diferente.',
    ],
  },
  {
    id: 'ensamble',
    title: 'Arma un PC paso a paso',
    file: 'assets/videos/08-ensamble.mp4',
    url: 'https://youtu.be/uUGI3Grx4qU',
    points: [
      'Descárgate de la estática antes de manipular componentes.',
      'Orden típico: CPU → RAM → placa en el chasis → almacenamiento → fuente → GPU.',
      'Revisa conexiones y cables antes de encender por primera vez.',
    ],
  },
];

// ---------------------------------------------------------------------------
// Banco de preguntas (cada intento toma 5 al azar, procurando temas distintos)
// ---------------------------------------------------------------------------
const QUIZ = [
  {
    id: 'q01', topic: 'ram',
    question: '¿Cuál es la función de la memoria *RAM*?',
    options: { a: 'Almacenar archivos de forma permanente', b: 'Guardar temporalmente los datos y programas en uso', c: 'Enfriar el procesador' },
    correct: 'b',
    explain: 'La RAM guarda *temporalmente* los datos y programas mientras los usas. Lo permanente es tarea del disco.',
  },
  {
    id: 'q02', topic: 'almacenamiento',
    question: '¿Qué ventaja tiene un *SSD* sobre un *HDD*?',
    options: { a: 'Es más lento pero más barato', b: 'Usa discos magnéticos giratorios', c: 'Es más rápido y resistente porque no tiene partes móviles' },
    correct: 'c',
    explain: 'El SSD no tiene partes móviles: por eso es *más rápido y resistente*. Los discos giratorios son del HDD.',
  },
  {
    id: 'q03', topic: 'cpu',
    question: '¿Cuál es la función principal del *CPU* (procesador)?',
    options: { a: 'Ejecutar las instrucciones y operaciones del computador', b: 'Guardar los archivos de forma permanente', c: 'Mostrar las imágenes en la pantalla' },
    correct: 'a',
    explain: 'El CPU *ejecuta las instrucciones* de los programas. Guardar archivos es del almacenamiento y mostrar imágenes, de la GPU.',
  },
  {
    id: 'q04', topic: 'almacenamiento',
    question: 'Si un computador dice "512 GB", ¿a qué se refiere normalmente?',
    options: { a: 'A la velocidad del internet', b: 'A la capacidad de almacenamiento del disco', c: 'A la cantidad de programas abiertos' },
    correct: 'b',
    explain: 'Los *GB* en ese contexto indican cuánto espacio tiene el disco para guardar archivos.',
  },
  {
    id: 'q05', topic: 'perifericos',
    question: '¿Cuál es un *dispositivo de entrada* (le da información al computador)?',
    options: { a: 'El monitor', b: 'La impresora', c: 'El teclado' },
    correct: 'c',
    explain: 'El *teclado* envía información al computador. El monitor y la impresora son de *salida*.',
  },
  {
    id: 'q06', topic: 'placa',
    question: '¿Cuál es la función de la *placa madre*?',
    options: { a: 'Conectar y coordinar la comunicación entre todos los componentes', b: 'Almacenar el sistema operativo', c: 'Enfriar el procesador' },
    correct: 'a',
    explain: 'La placa madre *conecta y comunica* el CPU, la RAM, el almacenamiento y lo demás.',
  },
  {
    id: 'q07', topic: 'cpu',
    question: '¿Qué mide la unidad *GHz* en un procesador?',
    options: { a: 'La velocidad de procesamiento', b: 'La capacidad de almacenamiento', c: 'La resolución de la pantalla' },
    correct: 'a',
    explain: 'Los *GHz (gigahercios)* indican la frecuencia a la que el procesador ejecuta ciclos de instrucciones.',
  },
  {
    id: 'q08', topic: 'gpu',
    question: '¿Cuál es la función principal de la *tarjeta gráfica* (GPU)?',
    options: { a: 'Procesar y mostrar imágenes, video y gráficos', b: 'Guardar archivos de forma permanente', c: 'Conectarse a internet' },
    correct: 'a',
    explain: 'La GPU procesa *imágenes, video y gráficos*. Internet depende de la tarjeta de red.',
  },
  {
    id: 'q09', topic: 'perifericos',
    question: '¿Para qué sirve un puerto *USB*?',
    options: { a: 'Para conectar dispositivos externos como memorias, mouse o teclados', b: 'Para enfriar el computador', c: 'Para aumentar la memoria RAM' },
    correct: 'a',
    explain: 'El USB sirve para *conectar dispositivos externos* y transferir datos o energía.',
  },
  {
    id: 'q10', topic: 'psu',
    question: '¿Cuál es la función de la *fuente de poder* (PSU)?',
    options: { a: 'Suministrar energía eléctrica a los componentes', b: 'Almacenar archivos de forma permanente', c: 'Procesar gráficos y video' },
    correct: 'a',
    explain: 'La fuente convierte la corriente del tomacorriente en la *energía* que usan los componentes.',
  },
  {
    id: 'q11', topic: 'ram',
    question: '¿Qué pasa con la información guardada en la *RAM* cuando apagas el computador?',
    options: { a: 'Se conserva para la próxima vez', b: 'Se borra, porque la RAM es volátil', c: 'Se pasa automáticamente a la GPU' },
    correct: 'b',
    explain: 'La RAM es *volátil*: sin energía, su contenido se pierde. Por eso hay que guardar los archivos en el disco.',
  },
  {
    id: 'q12', topic: 'almacenamiento',
    question: '¿Cuál de estas unidades suele ser la *más rápida*?',
    options: { a: 'Disco duro HDD', b: 'SSD SATA', c: 'SSD NVMe' },
    correct: 'c',
    explain: 'El *SSD NVMe* usa la conexión PCIe, mucho más veloz que SATA. El HDD es el más lento de los tres.',
  },
  {
    id: 'q13', topic: 'cpu',
    question: '¿Qué significa que un procesador tenga *8 núcleos*?',
    options: { a: 'Que puede trabajar en varias tareas al mismo tiempo', b: 'Que tiene 8 GB de memoria', c: 'Que tiene 8 ventiladores' },
    correct: 'a',
    explain: 'Cada *núcleo* puede procesar tareas por su cuenta, así que más núcleos permiten trabajar en paralelo.',
  },
  {
    id: 'q14', topic: 'placa',
    question: 'Para que un procesador funcione en una placa madre, ¿qué debe coincidir?',
    options: { a: 'El *socket* (zócalo) del procesador', b: 'El color de la placa', c: 'La marca del teclado' },
    correct: 'a',
    explain: 'El CPU y la placa deben tener el mismo *socket*; si no, el procesador ni siquiera encaja.',
  },
  {
    id: 'q15', topic: 'gpu',
    question: '¿Qué es una *gráfica integrada*?',
    options: { a: 'Una GPU que viene dentro del procesador y comparte la RAM', b: 'Una tarjeta gráfica que se compra por separado', c: 'Un tipo de monitor' },
    correct: 'a',
    explain: 'La gráfica *integrada* vive dentro del procesador y usa parte de la RAM. La que se compra aparte es *dedicada*.',
  },
  {
    id: 'q16', topic: 'psu',
    question: '¿En qué unidad se mide la *potencia* de una fuente de poder?',
    options: { a: 'Gigabytes (GB)', b: 'Vatios (W)', c: 'Gigahercios (GHz)' },
    correct: 'b',
    explain: 'La potencia se mide en *vatios (W)*, por ejemplo una fuente de 550 W.',
  },
  {
    id: 'q17', topic: 'perifericos',
    question: '¿Cuál de estos es un dispositivo de *salida*?',
    options: { a: 'El micrófono', b: 'El escáner', c: 'La impresora' },
    correct: 'c',
    explain: 'La *impresora* saca información del computador. El micrófono y el escáner son de *entrada*.',
  },
  {
    id: 'q18', topic: 'unidades',
    question: '¿Cuántos *bits* forman un *byte*?',
    options: { a: '8', b: '10', c: '1024' },
    correct: 'a',
    explain: 'Un *byte* tiene *8 bits*. El número 1024 aparece al pasar de KB a MB, de MB a GB, etc.',
  },
  {
    id: 'q19', topic: 'unidades',
    question: '¿Cuál de estas cantidades es la *mayor*?',
    options: { a: '1 MB', b: '1 GB', c: '1 KB' },
    correct: 'b',
    explain: 'El orden es KB < MB < GB < TB. Un *GB* equivale a unos mil MB.',
  },
  {
    id: 'q20', topic: 'ram',
    question: 'Un computador se pone lento cuando abres muchas pestañas y programas. ¿Qué mejora ayudaría más?',
    options: { a: 'Aumentar la memoria RAM', b: 'Cambiar el mouse', c: 'Comprar un monitor más grande' },
    correct: 'a',
    explain: 'Con muchos programas abiertos se llena la *RAM*; ampliarla es la mejora más directa.',
  },
];

// Palabras con las que el estudiante puede pedir cada video ("memoria ram", "ensamble"…)
const TUTORIAL_KEYWORDS = {
  cpu: ['procesador', 'cpu', 'microprocesador'],
  ram: ['memoria ram', 'ram', 'memoria'],
  almacenamiento: ['almacenamiento', 'disco duro', 'ssd', 'hdd', 'disco'],
  placa: ['placa madre', 'tarjeta madre', 'motherboard', 'placa base'],
  gpu: ['tarjeta grafica', 'grafica', 'gpu', 'tarjeta de video'],
  psu: ['fuente de poder', 'fuente', 'fuente de alimentacion'],
  perifericos: ['perifericos', 'puertos', 'usb'],
  ensamble: ['ensamble', 'armar un pc', 'armar computador', 'ensamblar'],
};
for (const t of TUTORIALS) {
  t.topic = TOPICS[t.id] ? t.id : null;
  t.keywords = TUTORIAL_KEYWORDS[t.id] || [];
}

// Valores de fábrica (se envían al panel la primera vez).
const DEFAULTS = JSON.parse(JSON.stringify({ topics: TOPICS, videos: TUTORIALS, quiz: QUIZ }));

// Preguntas que alguna vez existieron: si el docente borra una pregunta en
// medio de una prueba, el estudiante puede terminarla igual.
const QUESTION_ARCHIVE = new Map(QUIZ.map((q) => [q.id, q]));

function replaceArray(target, items) {
  target.splice(0, target.length, ...items);
}

/** Aplica el contenido que llega del panel sin cambiar las referencias. */
function applyRemote(data) {
  if (!data) return false;
  let changed = false;
  if (Array.isArray(data.videos) && data.videos.length) {
    replaceArray(TUTORIALS, data.videos.map((v) => ({ ...v, points: v.points || [], keywords: v.keywords || [] })));
    changed = true;
  }
  if (Array.isArray(data.quiz) && data.quiz.length >= 5) {
    replaceArray(QUIZ, data.quiz);
    data.quiz.forEach((q) => QUESTION_ARCHIVE.set(q.id, q));
    changed = true;
  }
  if (changed) {
    // Video recomendado por tema: el primero que tenga ese tema.
    for (const key of Object.keys(TOPICS)) {
      const tut = TUTORIALS.find((t) => t.topic === key);
      TOPICS[key].tutorial = tut ? tut.id : null;
    }
  }
  return changed;
}

module.exports = { TOPICS, TUTORIALS, QUIZ, DEFAULTS, QUESTION_ARCHIVE, applyRemote };
