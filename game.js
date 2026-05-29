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
 * - Whitespace entfernen
 */
function normalizeInput(raw) {
  let s = raw.trim().toUpperCase().replace(/\s+/g, '');

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
  dragging: false,
  dragPath: [], // [{r, c}, ...]
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
  finalWordsList: document.getElementById('final-words-list'),
  restartBtn: document.getElementById('restart-btn'),
  roomInfo: document.getElementById('room-info'),
  roomCodeEl: document.getElementById('room-code'),
  copyLinkBtn: document.getElementById('copy-link-btn'),
  revealBtn: document.getElementById('reveal-btn'),
  joinForm: document.getElementById('join-form'),
  joinInput: document.getElementById('join-input'),
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

  // Wortliste im Overlay aufbauen
  els.finalWordsList.innerHTML = '';
  const words = Array.from(state.foundWords);
  const struckWords = new Set();

  function updateFinalScoreDisplay() {
    let activeCount = 0;
    let activeScore = 0;
    for (const w of words) {
      if (!struckWords.has(w)) {
        activeCount++;
        activeScore += scoreFor(w.length);
      }
    }
    els.finalScore.textContent = String(activeScore);
    els.finalCount.textContent = String(activeCount);
  }

  for (const word of words) {
    const li = document.createElement('li');
    const display = word.charAt(0) + word.slice(1).toLowerCase();
    const pts = scoreFor(word.length);
    li.innerHTML = `${display}<span class="pts">+${pts}</span>`;
    li.addEventListener('click', () => {
      if (struckWords.has(word)) {
        struckWords.delete(word);
        li.classList.remove('struck');
      } else {
        struckWords.add(word);
        li.classList.add('struck');
      }
      updateFinalScoreDisplay();
    });
    els.finalWordsList.appendChild(li);
  }

  updateFinalScoreDisplay();
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

// Raum beitreten
els.joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = els.joinInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < ROOM_CODE_LENGTH) {
    setMessage(`Bitte ${ROOM_CODE_LENGTH}-stelligen Raum-Code eingeben.`, 'bad');
    return;
  }
  // Code in URL setzen und Raum-Setup starten
  state.roomCode = null; // Reset, damit setupRoom den neuen Code übernimmt
  setRoomInURL(code);
  setupRoom();
  els.joinInput.value = '';
});

// Eingabe nur erlaubte Zeichen filtern (Buchstaben, Umlaute, ß)
els.input.addEventListener('input', () => {
  const cleaned = els.input.value.replace(/[^a-zA-ZäöüÄÖÜß]/g, '');
  if (cleaned !== els.input.value) {
    els.input.value = cleaned;
  }
});

/* ===== Swipe/Drag-Eingabe ===== */

/**
 * Ermittelt die Tile-Koordinaten {r, c} an einem Bildschirmpunkt, oder null.
 */
function getTileFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el || !el.classList.contains('tile')) return null;
  const r = parseInt(el.dataset.r, 10);
  const c = parseInt(el.dataset.c, 10);
  if (isNaN(r) || isNaN(c)) return null;
  return { r, c };
}

/**
 * Prüft, ob zwei Felder benachbart sind (inkl. diagonal).
 */
function isAdjacent(a, b) {
  return Math.abs(a.r - b.r) <= 1 && Math.abs(a.c - b.c) <= 1 && !(a.r === b.r && a.c === b.c);
}

/**
 * Setzt die visuelle Markierung aller Tiles im aktuellen Pfad.
 */
function updateDragVisuals() {
  // Alle Tiles zurücksetzen
  const tiles = els.board.querySelectorAll('.tile');
  tiles.forEach((t) => t.classList.remove('selected'));

  // Aktuelle Pfad-Tiles markieren
  for (const { r, c } of state.dragPath) {
    const tile = els.board.querySelector(`.tile[data-r="${r}"][data-c="${c}"]`);
    if (tile) tile.classList.add('selected');
  }
}

function startDrag(r, c) {
  if (!state.running) return;
  state.dragging = true;
  state.dragPath = [{ r, c }];
  els.board.classList.add('dragging');
  updateDragVisuals();
}

function extendDrag(r, c) {
  if (!state.dragging || !state.running) return;
  const path = state.dragPath;
  const last = path[path.length - 1];

  // Bereits letztes Feld — nichts tun
  if (last.r === r && last.c === c) return;

  // Backtracking: Zug zurück zum vorletzten Feld → letztes entfernen
  if (path.length >= 2) {
    const prev = path[path.length - 2];
    if (prev.r === r && prev.c === c) {
      path.pop();
      updateDragVisuals();
      return;
    }
  }

  // Nur benachbarte, noch nicht besuchte Felder erlauben
  if (!isAdjacent(last, { r, c })) return;
  if (path.some((p) => p.r === r && p.c === c)) return;

  path.push({ r, c });
  updateDragVisuals();
}

function endDrag() {
  if (!state.dragging) return;
  state.dragging = false;
  els.board.classList.remove('dragging');

  const path = state.dragPath;
  state.dragPath = [];
  updateDragVisuals();

  // Pfad zu kurz → still ignorieren
  if (path.length < MIN_WORD_LENGTH) return;

  // Wort aus den Board-Tokens zusammensetzen
  const word = path.map(({ r, c }) => state.board[r][c]).join('');

  // Validierung (wie bei Tastatureingabe, aber Pfad ist schon bekannt)
  if (word.length < MIN_WORD_LENGTH) return;
  if (state.foundWords.has(word)) {
    setMessage('Bereits gefunden.', 'bad');
    return;
  }

  // Pfad ist per Konstruktion gültig (adjacent + no revisits), keine findPath nötig
  const points = scoreFor(word.length);
  state.foundWords.add(word);
  state.score += points;
  updateScoreDisplay();
  addWordToList(word, points);
  flashPath(path);
  setMessage(`+${points} Punkt${points === 1 ? '' : 'e'} für „${word.charAt(0) + word.slice(1).toLowerCase()}".`, 'good');
}

// Mouse-Events
els.board.addEventListener('mousedown', (e) => {
  const pos = getTileFromPoint(e.clientX, e.clientY);
  if (pos) {
    e.preventDefault();
    startDrag(pos.r, pos.c);
  }
});

els.board.addEventListener('mousemove', (e) => {
  if (!state.dragging) return;
  const pos = getTileFromPoint(e.clientX, e.clientY);
  if (pos) extendDrag(pos.r, pos.c);
});

els.board.addEventListener('mouseup', () => {
  endDrag();
});

els.board.addEventListener('mouseleave', () => {
  endDrag();
});

// Touch-Events
els.board.addEventListener('touchstart', (e) => {
  const touch = e.touches[0];
  const pos = getTileFromPoint(touch.clientX, touch.clientY);
  if (pos) {
    e.preventDefault();
    startDrag(pos.r, pos.c);
  }
}, { passive: false });

els.board.addEventListener('touchmove', (e) => {
  if (!state.dragging) return;
  e.preventDefault();
  const touch = e.touches[0];
  const pos = getTileFromPoint(touch.clientX, touch.clientY);
  if (pos) extendDrag(pos.r, pos.c);
}, { passive: false });

els.board.addEventListener('touchend', () => {
  endDrag();
});

els.board.addEventListener('touchcancel', () => {
  endDrag();
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
