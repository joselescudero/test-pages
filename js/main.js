// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const PGN_SOURCES = {
  'Apertura del Alfil': 'apertura_alfil',
  'Variantes Ruy Lopez': '2-variantes'
};
const PGN_BASE_URL = 'https://joselescudero.github.io/test-pages/';

// ─────────────────────────────────────────────────────────────────────────────
// Global state
// ─────────────────────────────────────────────────────────────────────────────
let board, chess, stockfish;
let pgnData = []; // Holds all games (main + variants) from the loaded PGN
let rawPgnGames = []; // Holds the original, unsorted games from the parser
let currentVar = 0, currentMove = 0;
let automoveTimer = null;
let savedVariants = [];
let listModeActive = false;

// ─────────────────────────────────────────────────────────────────────────────
// PGN Loading and Processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the list of available PGN files for selection.
 */
function buildPgnSelectionList() {
  const container = document.getElementById('pgnList');
  container.innerHTML = '';
  const ul = document.createElement('ul');

  for (const displayName in PGN_SOURCES) {
    const pgnName = PGN_SOURCES[displayName];
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.textContent = displayName;
    button.dataset.pgnName = pgnName;
    li.appendChild(button);
    ul.appendChild(li);
  }
  container.appendChild(ul);

  container.addEventListener('click', (e) => {
    if (e.target.matches('button')) {
      const pgnName = e.target.dataset.pgnName;
      localStorage.setItem('selected_pgn', pgnName);
      loadPgnByName(pgnName);
      // The user is now automatically switched to the board after selecting a PGN
      switchTab('tablero');
    }
  });
}

/**
 * Fetches a PGN file from the server, processes it, and updates the UI.
 * @param {string} pgnName - The name of the PGN file (e.g., 'apertura_alfil').
 */
async function loadPgnByName(pgnName) {
  if (!pgnName) return;
  const url = `${PGN_BASE_URL}${pgnName}.pgn`;
  try {
    document.getElementById('gameList').innerHTML = 'Cargando PGN...';
    document.getElementById('movesBox').innerHTML = 'Cargando...';
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const rawPGN = await response.text();
    processPgnData(rawPGN);
  } catch (error) {
    console.error('Failed to load PGN:', error);
    document.getElementById('gameList').innerHTML = `<span style="color:red;">Error al cargar ${pgnName}.pgn</span>`;
    pgnData = [];
    resetBoardToInitialState();
  }
}

/**
 * Parses raw PGN text, populates game data, and updates UI components.
 * @param {string} rawPGN
 */
function processPgnData(rawPGN) {
  rawPgnGames = parsePGN(rawPGN);
  console.log('Total games (main + variants):', rawPgnGames.length);

  applyGameSorting();
  
  // After loading a new PGN, always reset to the first game in the list
  currentVar = 0;
  currentMove = startMove();
  gotoMove();
}

/**
 * Sorts the loaded PGN games based on user config and updates the game list.
 */
function applyGameSorting() {
  if (rawPgnGames.length === 0) {
    pgnData = [];
    buildGameList();
    return;
  }

  const mainLineFirst = document.getElementById('mainLineFirstCheck').checked;
  function movesString(game) {
    return game.moves.map(m => m.san).join(' ');
  }

  if (mainLineFirst) {
    // Keep main line first, sort the rest
    const mainLineGame = rawPgnGames[0];
    const variantGames = rawPgnGames.slice(1).sort((a, b) => movesString(a).localeCompare(movesString(b)));
    pgnData = [mainLineGame, ...variantGames];
  } else {
    // Sort all games together alphabetically
    pgnData = [...rawPgnGames].sort((a, b) => movesString(a).localeCompare(movesString(b)));
  }
  
  buildGameList();
}

/**
 * Resets the board and UI to a clean, initial state when no PGN is loaded.
 */
function resetBoardToInitialState() {
    chess.reset();
    board.position(chess.fen());
    document.getElementById('movesBox').innerHTML = 'Seleccione un PGN desde la pestaña "PGN" para empezar.';
    document.getElementById('gameList').innerHTML = '';
    document.getElementById('nagBox').style.display = 'none';
    clearOverlays();
    if (chess) updateCapturedPieces(chess);
    updateEvalBar({ type: 'cp', value: 0 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Worker
// ─────────────────────────────────────────────────────────────────────────────
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('service-worker.js');
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Board state & UI
// ─────────────────────────────────────────────────────────────────────────────

function initArrowMarkers() {
  const svg  = document.getElementById('arrowOverlay');
  const defs = svg.querySelector('defs');
  ['green', 'red', 'blue', 'yellow'].forEach(color => {
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'ah_' + color);
    marker.setAttribute('markerWidth',  '4');
    marker.setAttribute('markerHeight', '4');
    marker.setAttribute('refX', '2.5');
    marker.setAttribute('refY', '2');
    marker.setAttribute('orient', 'auto');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', '0 0, 4 2, 0 4');
    poly.setAttribute('fill', color);
    marker.appendChild(poly);
    defs.appendChild(marker);
  });
}

function clearOverlays() {
  const svg = document.getElementById('arrowOverlay');
  Array.from(svg.children).forEach(child => {
    if (child.tagName.toLowerCase() !== 'defs') svg.removeChild(child);
  });
  document.querySelectorAll('.circle').forEach(e => e.remove());
}

function squareCenter(sq, squareSize) {
  const file = sq.charCodeAt(0) - 97;
  const rank = 8 - parseInt(sq[1], 10);
  return {
    x: file * squareSize + squareSize / 2,
    y: rank * squareSize + squareSize / 2
  };
}

function drawOverlays(moveData) {
  clearOverlays();
  if (!moveData) return;

  const boardEl    = document.getElementById('board');
  const squareSize = boardEl.offsetWidth / 8;
  const svg        = document.getElementById('arrowOverlay');
  const container  = document.getElementById('boardContainer');

  moveData.arrows.forEach(a => {
    const from = squareCenter(a.from, squareSize);
    const to   = squareCenter(a.to,   squareSize);
    const dx   = to.x - from.x;
    const dy   = to.y - from.y;
    const len  = Math.sqrt(dx * dx + dy * dy);
    const shorten = squareSize * 0.35;
    const ux = dx / len, uy = dy / len;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', from.x);
    line.setAttribute('y1', from.y);
    line.setAttribute('x2', to.x - ux * shorten);
    line.setAttribute('y2', to.y - uy * shorten);
    line.setAttribute('stroke', a.color);
    line.setAttribute('stroke-width', squareSize * 0.14);
    line.setAttribute('stroke-opacity', '0.75');
    line.setAttribute('marker-end', 'url(#ah_' + a.color + ')');
    svg.appendChild(line);
  });

  moveData.circles.forEach(c => {
    const file = c.square.charCodeAt(0) - 97;
    const rank = 8 - parseInt(c.square[1], 10);
    const el = document.createElement('div');
    el.className = 'circle';
    el.style.left        = (file * squareSize) + 'px';
    el.style.top         = (rank * squareSize) + 'px';
    el.style.width       = squareSize + 'px';
    el.style.height      = squareSize + 'px';
    el.style.borderColor = c.color;
    container.appendChild(el);
  });
}

function gotoMove() {
  if (!pgnData || pgnData.length === 0) {
    resetBoardToInitialState();
    return;
  }

  chess.reset();
  const game = pgnData[currentVar];
  document.querySelectorAll('.square-55d63').forEach(el => el.classList.remove('highlight-square'));
  let fromSq = null, toSq = null;
  for (let i = 0; i < currentMove; i++) {
    const move = chess.move(game.moves[i].san);
    if (!move) {
      console.error('Illegal move', game.moves[i].san, 'in game', currentVar + 1, 'at index', i);
      break;
    }
    if (i === currentMove - 1) {
      fromSq = move.from;
      toSq = move.to;
    }
  }
  board.position(chess.fen());

  if (fromSq && toSq) {
    const fromEl = document.querySelector('.square-' + fromSq);
    const toEl = document.querySelector('.square-' + toSq);
    if (fromEl) fromEl.classList.add('highlight-square');
    if (toEl) toEl.classList.add('highlight-square');
  }
  localStorage.setItem('pgn_var', currentVar);
  localStorage.setItem('pgn_move', currentMove);
  updateMovesBox();
  if (currentMove > 0) drawOverlays(game.moves[currentMove - 1]);
  else clearOverlays();
  updateCapturedPieces(chess);
  // Update the save button icon based on the current variant
  updateSaveButtonState();
  startAnalysis();
}

function sanToSpanish(san) {
  const pieceMap = { K: 'R', Q: 'D', R: 'T', B: 'A', N: 'C' };
  san = san.replace(/([=])([KQRBN])/, (m, eq, p) => eq + pieceMap[p]);
  if (/^[KQRBN]/.test(san)) {
    return pieceMap[san[0]] + san.slice(1);
  }
  return san;
}

function updateMovesBox() {
  if (!pgnData || pgnData.length === 0) return;
  const game = pgnData[currentVar];
  let html = `<b>Partida ${currentVar + 1} / ${pgnData.length}</b><br>`;
  let n = 1;
  for (let i = 0; i < game.moves.length; i++) {
    if (i % 2 === 0) html += `${n++}. `;
    const san = sanToSpanish(game.moves[i].san);
    if (i === currentMove - 1) {
      html += `<b style="font-size:15px;color:#900;">${san}</b> `;
    } else {
      html += `${san} `;
    }
  }
  if (currentMove === game.moves.length) {
    html += '<div id="pvBox"></div>';
  }
  document.getElementById('movesBox').innerHTML = html;

  const nagBox = document.getElementById('nagBox');
  const curMove = currentMove > 0 ? game.moves[currentMove - 1] : null;
  const nagTexts = (curMove && curMove.nags && curMove.nags.length)
    ? curMove.nags.map(n => NAG_DESCRIPTIONS[n]).filter(Boolean)
    : [];
  if (nagTexts.length) {
    nagBox.textContent = nagTexts.join(' · ');
    nagBox.style.display = '';
  } else {
    nagBox.textContent = '';
    nagBox.style.display = 'none';
  }
}

function buildGameList() {
  const container = document.getElementById('gameList');
  container.innerHTML = '';
  if (!pgnData || pgnData.length === 0) return;

  pgnData.forEach((game, idx) => {
    const div = document.createElement('div');
    div.className = 'game-entry';
    if (savedVariants.includes(idx)) {
        div.classList.add('saved-variant');
    }
    const label = (document.getElementById('mainLineFirstCheck').checked && idx === 0) ? 'Línea principal' : `Variante`;
    let movesHtml = '';
    let n = 1;
    game.moves.forEach((m, i) => {
      if (i % 2 === 0) movesHtml += `${n++}. `;
      movesHtml += sanToSpanish(m.san) + ' ';
    });

    div.innerHTML =
      `<span class="game-label" data-idx="${idx}">&#9654; Partida ${idx + 1} &ndash; ${label} (${game.moves.length} jugadas)</span>` +
      `<span class="game-moves">${movesHtml.trim()}</span>`;
    container.appendChild(div);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stockfish Engine Analysis
// ─────────────────────────────────────────────────────────────────────────────
function onEngineMessage(event) {
  const line = (event && typeof event === 'object' && event.data) ? event.data : event;
  if (typeof line !== 'string') return;

  if (line.startsWith('info depth')) {
    const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
    if (scoreMatch) {
      const score = {
        type: scoreMatch[1],
        value: parseInt(scoreMatch[2], 10)
      };
      if (chess.turn() === 'b') {
        score.value = -score.value;
      }
      updateEvalBar(score);

      const pvMatch = line.match(/ pv (.+)/);
      if (pvMatch) {
        updatePvDisplay(pvMatch[1]);
      }
    }
  }
}

function updateEvalBar(score) {
  const whiteBar = document.getElementById('evalBar-white');
  let whitePct = 50;

  if (score.type === 'mate') {
    whitePct = score.value > 0 ? 100 : 0;
  } else {
    const advantage = 2 / (1 + Math.exp(-0.0035 * score.value)) - 1;
    whitePct = (1 + advantage) / 2 * 100;
  }
  whiteBar.style.height = `${whitePct}%`;
}

function updatePvDisplay(pvString) {
  if (!pgnData || pgnData.length === 0 || currentMove !== pgnData[currentVar].moves.length) return;
  const pvBox = document.getElementById('pvBox');
  if (!pvBox) return;

  const uciMoves = pvString.split(' ').slice(0, 8);
  const tempChess = new Chess(chess.fen());
  const sanMoves = [];

  for (const uci of uciMoves) {
    const move = tempChess.move({ from: uci.substring(0, 2), to: uci.substring(2, 4), promotion: uci.length > 4 ? uci.substring(4, 5) : undefined });
    if (move) sanMoves.push(sanToSpanish(move.san));
    else break;
  }
  pvBox.textContent = 'Mejor: ' + sanMoves.join(' ');
}

function startAnalysis() {
  if (!stockfish) return;
  stockfish.postMessage('stop');
  stockfish.postMessage('position fen ' + chess.fen());
  stockfish.postMessage('go movetime 2000');
  const pvBox = document.getElementById('pvBox');
  if (pvBox) pvBox.textContent = 'Analizando...';
}

function initStockfish() {
  const stockfishUrl = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';
  fetch(stockfishUrl)
    .then(res => res.text())
    .then(text => {
      const blob = new Blob([text], { type: 'application/javascript' });
      stockfish = new Worker(URL.createObjectURL(blob));
      stockfish.onmessage = onEngineMessage;
      startAnalysis();
    })
    .catch(e => {
      console.warn('Stockfish init failed:', e);
      document.getElementById('evalBar').style.display = 'none';
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// NAG descriptions in Spanish
// ─────────────────────────────────────────────────────────────────────────────
const NAG_DESCRIPTIONS = {
  1: '! Buena jugada', 2: '? Error', 3: '!! Jugada brillante',
  4: '?? Error grave', 5: '!? Jugada interesante', 6: '?! Jugada dudosa',
  7: '□ Única jugada', 10: '= Posición igualada', 13: '∞ Posición poco clara',
  14: '⩲ Las blancas están ligeramente mejor', 15: '⩱ Las negras están ligeramente mejor',
  16: '± Las blancas están mejor', 17: '∓ Las negras están mejor',
  18: '+- Las blancas tienen ventaja decisiva', 19: '-+ Las negras tienen ventaja decisiva',
  22: '⊙ Las blancas tienen zugzwang', 23: '⊙ Las negras tienen zugzwang',
  32: '⟳ Las blancas tienen ventaja en desarrollo', 33: '⟳ Las negras tienen ventaja en desarrollo',
  36: '→ Las blancas tienen la iniciativa', 37: '→ Las negras tienen la iniciativa',
  40: '↑ Las blancas atacan', 41: '↑ Las negras atacan',
  44: '⌓ Las blancas tienen compensación', 45: '⌓ Las negras tienen compensación',
  132: '⇆ Las blancas tienen contrajuego', 133: '⇆ Las negras tienen contrajuego',
  138: '⊕ Las blancas con ligera presión de tiempo', 139: '⊕ Las negras con ligera presión de tiempo',
  140: '△ Con la idea...', 141: '▽ Con la amenaza...', 142: '⌀ La mejor jugada sería', 143: '⌀ Peor sería',
};

// ─────────────────────────────────────────────────────────────────────────────
// Event Handlers & Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getIgnoreMoves() {
  const val = parseInt(document.getElementById('ignoreMoves').value);
  return isNaN(val) ? 0 : Math.max(0, val);
}
function startMove() {
  return getIgnoreMoves();
}

function startAutomove() {
  stopAutomove();
  const ms = Math.max(100, parseInt(document.getElementById('automoveMs').value) || 2000);
  automoveTimer = setInterval(() => {
    const game = pgnData[currentVar];
    if (currentMove < game.moves.length) {
      currentMove++;
      gotoMove();
    } else if (currentVar < pgnData.length - 1) {
      currentVar++;
      currentMove = startMove();
      gotoMove();
    } else {
      stopAutomove();
      document.getElementById('automoveCheck').checked = false;
    }
  }, ms);
}

function stopAutomove() {
  if (automoveTimer) { clearInterval(automoveTimer); automoveTimer = null; }
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  
  const pane = document.getElementById('tab-' + tabName);
  if (pane) pane.style.display = '';
  
  const button = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (button) button.classList.add('active');
}

function updateSaveButtonState() {
    const btn = document.getElementById('saveVariantBtn');
    if (!pgnData || pgnData.length === 0) {
        btn.innerHTML = '💾';
        btn.style.opacity = 0.5;
        return;
    }
    btn.style.opacity = 1;
    const isSaved = savedVariants.includes(currentVar);
    btn.innerHTML = isSaved ? '🗑️' : '💾';
    btn.title = isSaved ? 'Quitar Variante' : 'Guardar Variante';
}

function handleSaveVariant() {
    if (!pgnData || pgnData.length === 0) return;

    const isSaved = savedVariants.includes(currentVar);
    if (isSaved) {
        if (confirm('¿Quieres eliminar esta variante de la lista de guardadas?')) {
            savedVariants = savedVariants.filter(v => v !== currentVar);
            localStorage.setItem('pgn_savedVariants', JSON.stringify(savedVariants));
            console.log('Variant removed:', currentVar);
            // If we were in list mode and removed the last item, exit list mode
            if (listModeActive && savedVariants.length === 0) {
                toggleListMode();
            }
        }
    } else {
        if (confirm('¿Quieres guardar esta variante?')) {
            savedVariants.push(currentVar);
            savedVariants.sort((a, b) => a - b); // Keep it sorted
            localStorage.setItem('pgn_savedVariants', JSON.stringify(savedVariants));
            console.log('Variant saved:', currentVar);
        }
    }
    updateSaveButtonState();
    buildGameList(); // Rebuild to show/hide star
}

function toggleListMode() {
    if (savedVariants.length === 0 && !listModeActive) {
        alert("No hay variantes guardadas para entrar en modo lista.");
        return;
    }
    listModeActive = !listModeActive;
    document.getElementById('listModeBtn').classList.toggle('active', listModeActive);
    console.log('List mode active:', listModeActive);
}

function setupEventListeners() {
  document.getElementById('nextBtn').onclick = () => {
    stopAutomove();
    const game = pgnData[currentVar];
    if (currentMove < game.moves.length) {
      currentMove++;
      gotoMove();
    } else if (currentVar < pgnData.length - 1) {
      currentVar++;
      currentMove = startMove();
      gotoMove();
    }
  };

  document.getElementById('prevBtn').onclick = () => {
    stopAutomove();
    const ignore = startMove();
    if (currentMove > ignore) {
      currentMove--;
    } else if (currentVar > 0) {
      currentVar--;
      currentMove = pgnData[currentVar].moves.length;
    }
    gotoMove();
  };

  document.getElementById('nextGameBtn').onclick = () => {
    stopAutomove();
    if (listModeActive) {
        if (savedVariants.length === 0) return;
        const currentIndexInSaved = savedVariants.indexOf(currentVar);
        let nextIndex;
        if (currentIndexInSaved === -1 || currentIndexInSaved === savedVariants.length - 1) {
            nextIndex = 0; // Loop to start
        } else {
            nextIndex = currentIndexInSaved + 1;
        }
        currentVar = savedVariants[nextIndex];
        currentMove = startMove();
        gotoMove();
    } else {
        // Original logic
        if (currentVar < pgnData.length - 1) {
            currentVar++;
            currentMove = startMove();
            gotoMove();
        }
    }
  };

  document.getElementById('prevGameBtn').onclick = () => {
    stopAutomove();
    const ignore = startMove();
    if (listModeActive) {
        if (savedVariants.length === 0) return;
        const currentIndexInSaved = savedVariants.indexOf(currentVar);
        let prevIndex;
        if (currentIndexInSaved === -1 || currentIndexInSaved === 0) {
            prevIndex = savedVariants.length - 1; // Loop to end
        } else {
            prevIndex = currentIndexInSaved - 1;
        }
        currentVar = savedVariants[prevIndex];
        currentMove = startMove();
        gotoMove();
    } else {
        // Original logic
        if (currentMove > ignore) {
            currentMove = ignore;
        } else if (currentVar > 0) {
            currentVar--;
            currentMove = startMove();
        }
    }
    gotoMove();
  };

  document.getElementById('gameList').addEventListener('click', e => {
    const t = e.target.closest('.game-label');
    if (!t) return;
    stopAutomove();
    currentVar  = parseInt(t.dataset.idx, 10);
    currentMove = startMove();
    gotoMove();
    switchTab('tablero');
    window.scrollTo(0, 0);
  });

  document.getElementById('tabBar').addEventListener('click', (e) => {
    if (e.target.matches('.tab-btn')) {
      const tabName = e.target.dataset.tab;
      if (tabName) switchTab(tabName);
    }
  });

  document.getElementById('saveVariantBtn').addEventListener('click', handleSaveVariant);
  document.getElementById('listModeBtn').addEventListener('click', toggleListMode);

  const mainLineFirstCheck = document.getElementById('mainLineFirstCheck');
  const automoveMsInput = document.getElementById('automoveMs');
  const ignoreMovesInput = document.getElementById('ignoreMoves');

  const savedMainLineFirst = localStorage.getItem('pgn_mainLineFirst');
  mainLineFirstCheck.checked = savedMainLineFirst === null || savedMainLineFirst === 'true'; // Default to true
  mainLineFirstCheck.addEventListener('change', function() {
    localStorage.setItem('pgn_mainLineFirst', this.checked);
    applyGameSorting();
    // When re-sorting, it's safest to reset the view to the top of the new list
    currentVar = 0;
    currentMove = startMove();
    gotoMove();
  });

  const savedAutomoveMs = localStorage.getItem('pgn_automoveMs');
  if (savedAutomoveMs) automoveMsInput.value = savedAutomoveMs;
  automoveMsInput.addEventListener('change', () => localStorage.setItem('pgn_automoveMs', automoveMsInput.value));

  const savedIgnoreMoves = localStorage.getItem('pgn_ignoreMoves');
  if (savedIgnoreMoves) ignoreMovesInput.value = savedIgnoreMoves;
  ignoreMovesInput.addEventListener('change', () => localStorage.setItem('pgn_ignoreMoves', ignoreMovesInput.value));

  document.getElementById('automoveCheck').addEventListener('change', function() {
    if (this.checked) startAutomove();
    else stopAutomove();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
window.onload = function () {
  chess = new Chess();
  board = Chessboard('board', {
    position: 'start',
    pieceTheme: 'https://raw.githubusercontent.com/oakmac/chessboardjs/master/website/img/chesspieces/wikipedia/{piece}.png'
  });

  initArrowMarkers();
  initStockfish();
  setupEventListeners();
  registerServiceWorker();
  
  savedVariants = JSON.parse(localStorage.getItem('pgn_savedVariants')) || [];
  
  buildPgnSelectionList();

  const savedPgn = localStorage.getItem('selected_pgn');
  const isValidSavedPgn = savedPgn && Object.values(PGN_SOURCES).includes(savedPgn);

  if (isValidSavedPgn) {
    const savedVar = parseInt(localStorage.getItem('pgn_var'), 10);
    const savedMove = parseInt(localStorage.getItem('pgn_move'), 10);
    
    // Load the PGN and then apply the saved position
    loadPgnByName(savedPgn).then(() => {
        if (pgnData.length > 0) {
            if (!isNaN(savedVar) && savedVar >= 0 && savedVar < pgnData.length) {
                currentVar = savedVar;
                if (!isNaN(savedMove) && savedMove >= 0 && savedMove <= pgnData[currentVar].moves.length) {
                    currentMove = savedMove;
                }
            }
            gotoMove();
        }
    });
  } else {
    resetBoardToInitialState();
  }

  switchTab('tablero');
};