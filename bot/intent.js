/**
 * intent.js
 * Interpreta respuestas escritas con errores o dictadas por voz y elige la
 * opción más parecida ("tres", "la be", "prueva", "memoria ram"…).
 */

function norm(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Similitud 0..1 entre dos textos. */
function similarity(a, b) {
  a = norm(a);
  b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/** Mejor similitud de `phrase` contra cualquier fragmento de `text` del mismo número de palabras. */
function bestWindow(text, phrase) {
  const t = norm(text).split(' ');
  const p = norm(phrase).split(' ');
  if (!p[0]) return 0;
  let best = similarity(text, phrase);
  for (let i = 0; i + p.length <= t.length; i++) {
    best = Math.max(best, similarity(t.slice(i, i + p.length).join(' '), p.join(' ')));
  }
  return best;
}

const NUMBER_WORDS = {
  cero: 0, uno: 1, primero: 1, primera: 1, dos: 2, segundo: 2, segunda: 2,
  tres: 3, tercero: 3, tercera: 3, cuatro: 4, cuarto: 4, cuarta: 4, cinco: 5, quinto: 5, quinta: 5,
  seis: 6, sexto: 6, sexta: 6, siete: 7, septimo: 7, septima: 7, ocho: 8, octavo: 8, octava: 8,
  nueve: 9, diez: 10,
};

/** Devuelve el número dicho o escrito en un mensaje corto ("opción tres", "el 2"), o null. */
function extractNumber(text, maxWords = 5) {
  const words = norm(text).split(' ').filter(Boolean);
  if (!words.length || words.length > maxWords) return null;
  for (const w of words) {
    if (/^\d{1,2}$/.test(w)) return parseInt(w, 10);
    if (NUMBER_WORDS[w] !== undefined) return NUMBER_WORDS[w];
  }
  // tolera errores de transcripción leves: "tress", "sinco", "ocho."
  for (const w of words) {
    if (w.length < 3) continue;
    let best = null;
    let score = 0;
    for (const [word, n] of Object.entries(NUMBER_WORDS)) {
      const s = similarity(w, word);
      if (s > score) {
        score = s;
        best = n;
      }
    }
    if (score >= 0.75) return best;
  }
  return null;
}

/**
 * Elige la opción más parecida. options: { valor: ['frase', ...] }.
 * Devuelve { value, score } o null si nada supera el umbral.
 */
function pick(text, options, threshold = 0.78) {
  let best = null;
  for (const [value, phrases] of Object.entries(options)) {
    for (const phrase of phrases) {
      const score = bestWindow(text, phrase);
      if (!best || score > best.score) best = { value, score };
    }
  }
  return best && best.score >= threshold ? best : null;
}

const STOPWORDS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'y', 'o', 'a', 'en', 'que', 'es', 'por', 'para', 'con', 'se', 'lo', 'al', 'mas', 'creo', 'pienso', 'seria', 'respuesta', 'opcion']);

function contentWords(text) {
  return norm(text).split(' ').filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Qué parte de las palabras importantes del usuario aparecen en la opción. */
function tokenCoverage(userText, optionText) {
  const u = contentWords(userText);
  const o = contentWords(optionText);
  if (u.length < 2 || !o.length) return 0;
  const hits = u.filter((w) => o.some((x) => similarity(w, x) >= 0.8)).length;
  return hits / u.length;
}

const LETTERS = {
  a: ['a', 'ah', 'la a', 'letra a', 'opcion a', 'respuesta a'],
  b: ['b', 'be', 've', 'la b', 'la be', 'b de burro', 'be larga', 'letra b', 'opcion b', 'respuesta b'],
  c: ['c', 'ce', 'se', 'la c', 'la ce', 'letra c', 'opcion c', 'respuesta c'],
};

/** Respuesta A/B/C: por la letra dicha o por el texto de la opción. */
function answerLetter(text, question) {
  const n = norm(text);
  if (!n) return null;
  const words = n.split(' ');
  if (words.length <= 4) {
    for (const [letter, phrases] of Object.entries(LETTERS)) {
      if (phrases.includes(n)) return letter;
    }
    const m = n.match(/^(?:la |letra |opcion |respuesta |es la |es )?([abc])$/);
    if (m) return m[1];
    const num = extractNumber(n, 2);
    if (num >= 1 && num <= 3) return 'abc'[num - 1];
  }
  if (question) {
    // ¿Dijo el contenido de la opción? ("aumentar la memoria ram")
    const ranked = Object.entries(question.options)
      .map(([letter, optText]) => ({
        letter,
        score: Math.max(similarity(n, optText), bestWindow(optText, n), tokenCoverage(n, optText)),
      }))
      .sort((x, y) => y.score - x.score);
    if (ranked[0].score >= 0.7 && ranked[0].score - ranked[1].score >= 0.15) return ranked[0].letter;
  }
  return null;
}

module.exports = { norm, similarity, extractNumber, pick, answerLetter };
