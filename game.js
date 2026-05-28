'use strict';

/* ===== Konstanten ===== */

const BOARD_SIZE = 4;
const ROUND_SECONDS = 180; // 3 Minuten
const MIN_WORD_LENGTH = 3;

/**
 * Würfel-Konfiguration für die deutsche Variante.
 * 16 Würfel mit je 6 Seiten. Verteilung orientiert sich an deutscher
 * Buchstabenhäufigkeit. "QU" zählt als eine Seite (ein Feld).
 * Umlaute (Ä, Ö, Ü) und ß sind enthalten.
 */
const GERMAN_DICE = [
  ['E', 'E', 'N', 'I', 'S', 'A'],
  ['E', 'N', 'I', 'R', 'A', 'T'],
  ['E', 'N', 'I', 'S', 'R', 'D'],
  ['E', 'N', 'S', 'A', 'T', 'H'],
  ['E', 'I', 'R', 'D', 'L', 'M'],
  ['E', 'N', 'I', 'S', 'C', 'H'],
  ['E', 'A', 'T', 'H', 'U', 'B'],
  ['E', 'I', 'R', 'U', 'L', 'G'],
  ['E', 'N', 'A', 'T', 'O', 'F'],
  ['E', 'I', 'S', 'R', 'D', 'K'],
  ['E', 'N', 'I', 'S', 'O', 'W'],
  ['E', 'A', 'U', 'L', 'M', 'P'],
  ['E', 'N', 'I', 'C', 'G', 'Z'],
  ['E', 'I', 'R', 'B', 'F', 'V'],
  ['Ä', 'Ö', 'Ü', 'ß', 'Y', 'J'],
  ['QU', 'X', 'CH', 'SCH', 'ST', 'PF'],
];

/**
 * Punkteverteilung nach Wortlänge (Zeichen, Qu zählt als 2 Zeichen).
 */
function scoreFor(wordLength) {
  if (wordLength < 3) return 0;
  if (wordLength <= 4) return 1;
  if (wordLength === 5) return 2;
  if (wordLength === 6) return 3;
  if (wordLength === 7) return 5;
  return 11;
}

/* ===== Raum-Code & Seeded PRNG ===== */

const ROOM_CODE_LENGTH = 5;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne I/O/0/1 (verwechselbar)

/**
 * Mulberry32 — leichtgewichtige seeded 32-bit PRNG.
 * Gibt eine Funktion zurück, die bei jedem Aufruf die nächste Zufallszahl [0,1) liefert.
 */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Wandelt einen String (Raum-Code) in eine 32-bit-Zahl um (DJB2-Hash).
 */
function hashCode(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/**
 * Erzeugt einen zufälligen Raum-Code (5 Zeichen, z.B. "WOLF7").
 */
function generateRoomCode() {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  }
  return code;
}

/**
 * Liest den Raum-Code aus der URL (?raum=XXXXX).
 */
function getRoomFromURL() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('raum');
  return code ? code.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
}

/**
 * Schreibt den Raum-Code in die URL (ohne Neuladen).
 */
function setRoomInURL(code) {
  const url = new URL(window.location);
  url.searchParams.set('raum', code);
  history.replaceState(null, '', url);
}

/* ===== Hilfsfunktionen ===== */

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rollDie(die, rng) {
  return die[Math.floor(rng() * die.length)];
}

/**
 * Erzeugt ein 4x4-Brett aus einem Raum-Code (deterministisch).
 * @param {string} roomCode
 * @returns {string[][]} 2D-Array mit Tokens (z.B. "A", "QU", "Ä").
 */
function generateBoard(roomCode) {
  const rng = mulberry32(hashCode(roomCode));
  const dice = shuffle(GERMAN_DICE, rng);
  const board = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      row.push(rollDie(dice[r * BOARD_SIZE + c], rng));
    }
    board.push(row);
  }
  return board;
}

/**
 * Normalisiert Benutzereingaben:
 * - Großbuchstaben
 * - AE/OE/UE/SS -> Ä/Ö/Ü/ß (optional, falls Umlaute nicht direkt eingegeben werden)
 * - Whitespace entfernen
 *
 * Hinweis: Wir normalisieren nicht, falls echte Umlaute/ß bereits enthalten sind.
 */
function normalizeInput(raw) {
  let s = raw.trim().toUpperCase().replace(/\s+/g, '');
  // Nur dann ersetzen, wenn keine Umlaute vorhanden sind, um Konflikte zu vermeiden.
  if (!/[ÄÖÜß]/.test(s)) {
    s = s.replace(/AE/g, 'Ä').replace(/OE/g, 'Ö').replace(/UE/g, 'Ü').replace(/SS/g, 'ß');
  }
  return s;
}

/**
 * Prüft, ob ein Wort auf dem Brett gebildet werden kann (Pfad existiert).
 * Mehrbuchstaben-Felder (z.B. "QU", "SCH") werden korrekt verarbeitet.
 *
 * @param {string} word normalisiert, Großbuchstaben
 * @param {string[][]} board
 * @returns {{r:number,c:number}[]|null} Pfad oder null, wenn nicht bildbar.
 */
function findPath(word, board) {
  const rows = board.length;
  const cols = board[0].length;
  const visited = Array.from({ length: rows }, () => Array(cols).fill(false));

  function dfs(r, c, pos, path) {
    const cell = board[r][c];
    if (!startsWithAt(word, cell, pos)) return null;

    visited[r][c] = true;
    path.push({ r, c });
    const newPos = pos + cell.length;

    if (newPos === word.length) {
      return path.slice();
    }

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (visited[nr][nc]) continue;
        const result = dfs(nr, nc, newPos, path);
        if (result) return result;
      }
    }

    visited[r][c] = false;
    path.pop();
    return null;
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const result = dfs(r, c, 0, []);
      if (result) return result;
    }
  }
  return null;
}

function startsWithAt(word, token, pos) {
  if (pos + token.length > word.length) return false;
  for (let i = 0; i < token.length; i++) {
    if (word[pos + i] !== token[i]) return false;
  }
  return true;
}

/* ===== Spielzustand ===== */

const state = {
  board: null,
  running: false,
  timeLeft: ROUND_SECONDS,
  score: 0,
  foundWords: new Set(),
  timerId: null,
  roomCode: null,
};

/* ===== DOM ===== */

const els = {
  board: document.getElementById('board'),
  timer: document.getElementById('timer'),
  timerStat: null, // wird unten gesetzt
  score: document.getElementById('score'),
  input: document.getElementById('word-input'),
  form: document.getElementById('word-form'),
  submitBtn: document.getElementById('submit-btn'),
  message: document.getElementById('message'),
  wordsList: document.getElementById('words-list'),
  wordCount: document.getElementById('word-count'),
  startBtn: document.getElementById('start-btn'),
  overlay: document.getElementById('game-over'),
  finalScore: document.getElementById('final-score'),
  finalCount: document.getElementById('final-count'),
  restartBtn: document.getElementById('restart-btn'),
  roomInfo: document.getElementById('room-info'),
  roomCodeEl: document.getElementById('room-code'),
  copyLinkBtn: document.getElementById('copy-link-btn'),
  revealBtn: document.getElementById('reveal-btn'),
};
els.timerStat = els.timer.closest('.stat');

/* ===== Rendering ===== */

function renderBoard() {
  els.board.innerHTML = '';
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = state.board[r][c];
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.r = r;
      tile.dataset.c = c;
      // Anzeige: erster Buchstabe groß, Rest klein für Mehrbuchstaben-Felder
      tile.textContent =
        cell.length > 1 ? cell.charAt(0) + cell.slice(1).toLowerCase() : cell;
      els.board.appendChild(tile);
    }
  }
}

function flashPath(path) {
  for (const { r, c } of path) {
    const tile = els.board.querySelector(
      `.tile[data-r="${r}"][data-c="${c}"]`
    );
    if (tile) {
      tile.classList.remove('flash');
      // Reflow erzwingen, damit die Animation neu startet
      void tile.offsetWidth;
      tile.classList.add('flash');
    }
  }
}

function updateTimerDisplay() {
  const m = Math.floor(state.timeLeft / 60);
  const s = state.timeLeft % 60;
  els.timer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  els.timerStat.classList.toggle('warning', state.timeLeft <= 30 && state.timeLeft > 10);
  els.timerStat.classList.toggle('danger', state.timeLeft <= 10);
}

function updateScoreDisplay() {
  els.score.textContent = String(state.score);
}

function setMessage(text, kind = '') {
  els.message.textContent = text;
  els.message.className = 'message' + (kind ? ' ' + kind : '');
}

function addWordToList(word, points) {
  const li = document.createElement('li');
  const display = word.charAt(0) + word.slice(1).toLowerCase();
  li.innerHTML = `${display}<span class="pts">+${points}</span>`;
  els.wordsList.prepend(li);
  els.wordCount.textContent = `(${state.foundWords.size})`;
}

/* ===== Spiel-Steuerung ===== */

/**
 * Phase 1: Raum erstellen/beitreten, Code anzeigen.
 * Brett wird noch NICHT aufgedeckt, Timer läuft noch NICHT.
 */
function setupRoom() {
  // Falls ein Spiel läuft, stoppen
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
  state.running = false;

  // Raum-Code: aus URL übernehmen oder neu generieren
  const urlRoom = getRoomFromURL();
  if (urlRoom && !state.roomCode) {
    state.roomCode = urlRoom;
  } else {
    state.roomCode = generateRoomCode();
    setRoomInURL(state.roomCode);
  }

  state.board = generateBoard(state.roomCode);
  state.score = 0;
  state.foundWords = new Set();
  state.timeLeft = ROUND_SECONDS;

  els.wordsList.innerHTML = '';
  els.wordCount.textContent = '(0)';
  els.input.value = '';
  els.input.disabled = true;
  els.submitBtn.disabled = true;
  els.overlay.classList.add('hidden');
  updateScoreDisplay();
  updateTimerDisplay();

  // Platzhalter-Brett anzeigen
  els.board.innerHTML = '';
  for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.style.opacity = '0.25';
    tile.textContent = '?';
    els.board.appendChild(tile);
  }

  // Raum-Info + "Los!"-Button anzeigen
  els.roomCodeEl.textContent = state.roomCode;
  els.roomInfo.classList.remove('hidden');
  els.revealBtn.classList.remove('hidden');
  els.startBtn.textContent = 'Neuer Raum';

  setMessage('Link teilen, dann auf \u201eLos!\u201c klicken.', '');
}

/**
 * Phase 2: Brett aufdecken, Timer starten.
 */
function revealBoard() {
  state.running = true;

  els.input.disabled = false;
  els.submitBtn.disabled = false;
  els.revealBtn.classList.add('hidden');
  setMessage('Los geht\u2019s! Viel Erfolg.', 'good');

  renderBoard();

  if (state.timerId) clearInterval(state.timerId);
  state.timerId = setInterval(tick, 1000);

  els.input.focus();
}

function tick() {
  state.timeLeft -= 1;
  updateTimerDisplay();
  if (state.timeLeft <= 0) {
    endGame();
  }
}

function endGame() {
  state.running = false;
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
  els.input.disabled = true;
  els.submitBtn.disabled = true;
  els.finalScore.textContent = String(state.score);
  els.finalCount.textContent = String(state.foundWords.size);
  els.overlay.classList.remove('hidden');
}

function submitWord() {
  if (!state.running) return;
  const raw = els.input.value;
  const word = normalizeInput(raw);
  els.input.value = '';

  if (!word) return;

  // Längenprüfung anhand Zeichenanzahl
  if (word.length < MIN_WORD_LENGTH) {
    setMessage(`Wort zu kurz (mind. ${MIN_WORD_LENGTH} Buchstaben).`, 'bad');
    return;
  }

  if (state.foundWords.has(word)) {
    setMessage('Bereits gefunden.', 'bad');
    return;
  }

  const path = findPath(word, state.board);
  if (!path) {
    setMessage('Pfad auf dem Brett nicht gefunden.', 'bad');
    return;
  }

  const points = scoreFor(word.length);
  state.foundWords.add(word);
  state.score += points;
  updateScoreDisplay();
  addWordToList(word, points);
  flashPath(path);
  setMessage(`+${points} Punkt${points === 1 ? '' : 'e'} für „${word.charAt(0) + word.slice(1).toLowerCase()}".`, 'good');
}

/* ===== Events ===== */

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  submitWord();
});

els.startBtn.addEventListener('click', setupRoom);
els.restartBtn.addEventListener('click', setupRoom);
els.revealBtn.addEventListener('click', revealBoard);

// Link kopieren
els.copyLinkBtn.addEventListener('click', () => {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    els.copyLinkBtn.textContent = 'Kopiert!';
    setTimeout(() => {
      els.copyLinkBtn.textContent = 'Link kopieren';
    }, 2000);
  });
});

// Eingabe nur erlaubte Zeichen filtern (Buchstaben, Umlaute, ß)
els.input.addEventListener('input', () => {
  const cleaned = els.input.value.replace(/[^a-zA-ZäöüÄÖÜß]/g, '');
  if (cleaned !== els.input.value) {
    els.input.value = cleaned;
  }
});

// Initialer Zustand: Brett unsichtbar (leere Felder als Platzhalter)
(function initPlaceholderBoard() {
  for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.style.opacity = '0.25';
    tile.textContent = '?';
    els.board.appendChild(tile);
  }
})();
