// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const PGN_SOURCES = {
  'Apertura del Alfil': 'apertura_alfil',
  'Variantes Ruy Lopez': '2-variantes'
};
const PGN_BASE_URL = 'https://joselescudero.github.io/test-pages/pgn/';

// ─────────────────────────────────────────────────────────────────────────────
// Global state
// ─────────────────────────────────────────────────────────────────────────────
let board, chess, stockfish;
let pgnData = []; // Holds all games (main + variants) from the loaded PGN
let rawPgnGames = []; // Holds the original, unsorted games from the parser
const CUSTOM_PGNS_KEY = 'pgn_custom_sources';
const LICHESS_API_TOKEN_KEY = 'lichess_api_token';
let currentVar = 0, currentMove = 0;
let automoveTimer = null;
let savedVariants = [];
let listModeActive = false;
let lastDisplayedPvDepth = 0;
let isLoading = false;

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

  // 1. Static PGNs
  for (const displayName in PGN_SOURCES) {
    const pgnName = PGN_SOURCES[displayName];
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.textContent = displayName;
    button.dataset.pgnName = pgnName;
    button.dataset.type = 'static';
    li.appendChild(button);
    ul.appendChild(li);
  }

  // 2. Custom PGNs
  const customPgns = JSON.parse(localStorage.getItem(CUSTOM_PGNS_KEY)) || [];
  customPgns.forEach((item, index) => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.gap = '5px';

    const button = document.createElement('button');
    button.textContent = item.name;
    button.dataset.pgnUrl = item.url;
    button.dataset.type = 'custom';
    button.style.flex = '1';

    const delBtn = document.createElement('button');
    delBtn.textContent = '❌';
    delBtn.title = 'Eliminar';
    delBtn.style.width = 'auto';
    delBtn.style.padding = '0 10px';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm(`¿Eliminar "${item.name}" de la lista?`)) {
        customPgns.splice(index, 1);
        localStorage.setItem(CUSTOM_PGNS_KEY, JSON.stringify(customPgns));
        buildPgnSelectionList();
      }
    };

    li.appendChild(button);
    li.appendChild(delBtn);
    ul.appendChild(li);
  });

  // 3. Add Custom PGN Button
  const liAdd = document.createElement('li');
  const btnAdd = document.createElement('button');
  btnAdd.textContent = '➕ Añadir PGN URL';
  btnAdd.style.backgroundColor = '#eef';
  btnAdd.onclick = () => {
    const name = prompt('Nombre de la partida:');
    if (!name) return;
    const url = prompt('URL del archivo .pgn:');
    if (!url) return;
    const list = JSON.parse(localStorage.getItem(CUSTOM_PGNS_KEY)) || [];
    list.push({ name, url });
    localStorage.setItem(CUSTOM_PGNS_KEY, JSON.stringify(list));
    buildPgnSelectionList();
  };
  liAdd.appendChild(btnAdd);
  ul.appendChild(liAdd);

  container.appendChild(ul);

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (btn && btn.dataset.type) {
      const isStatic = btn.dataset.type === 'static';
      const pgnSource = isStatic ? btn.dataset.pgnName : btn.dataset.pgnUrl;
      
      localStorage.setItem('selected_pgn', pgnSource);
      localStorage.setItem('selected_pgn_is_custom', !isStatic);

      const success = isStatic ? await loadPgnByName(pgnSource) : await loadPgnFromUrl(pgnSource);
      
      if (success) {
        currentVar = 0;
        currentMove = startMove();
        gotoMove();
        switchTab('tablero');
      }
    }
  });
}

/**
 * Loads a static PGN by name (constructs the URL).
 */
async function loadPgnByName(pgnName) {
  if (!pgnName) return;
  const url = `${PGN_BASE_URL}${pgnName}.pgn`;
  return await loadPgnFromUrl(url);
}

/**
 * Fetches the raw text of a PGN file, handling Lichess private studies and CORS.
 * @param {string} url The URL of the PGN file.
 * @returns {Promise<string>} The raw PGN text.
 */
async function fetchPgnText(url) {
    const isLichess = url.includes('lichess.org');
    let token = localStorage.getItem(LICHESS_API_TOKEN_KEY);
    
    const getOptions = (authToken) => {
        const headers = {};
        if (isLichess) {
            headers['Accept'] = 'application/x-chess-pgn';
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }
        }
        return { headers };
    };

    // --- 1. First attempt (direct, with token if available) ---
    try {
        const response = await fetch(url, getOptions(token));
        if (response.ok) {
            return await response.text();
        }

        // --- 2. Handle Lichess private study error ---
        if (isLichess && (response.status === 401 || response.status === 404)) {
            const newToken = prompt(
                'Este estudio de Lichess es privado o no se encontró.\n\n' +
                'Si es un estudio privado, introduce tu "Personal API access token" de Lichess para acceder.\n' +
                'Puedes crearlo aquí: https://lichess.org/account/oauth/token/create\n\n' +
                'Asegúrate de que el token tenga el permiso "Read your studies".',
                token || ''
            );

            if (newToken && newToken.trim() !== '') {
                localStorage.setItem(LICHESS_API_TOKEN_KEY, newToken);
                const retryResponse = await fetch(url, getOptions(newToken));
                if (retryResponse.ok) return await retryResponse.text();
                
                alert(`El token proporcionado no funcionó (Error: ${retryResponse.status}). No se pudo cargar el PGN.`);
                throw new Error(`Lichess auth failed with new token: ${retryResponse.status}`);
            } else {
                throw new Error('Acceso a Lichess cancelado por el usuario.');
            }
        }
        
        throw new Error(`La carga directa falló con estado: ${response.status}`);

    } catch (err) {
        // --- 3. Fallback to CORS proxy ---
        if (err.message.includes('Lichess auth failed') || err.message.includes('cancelado por el usuario')) {
            throw err; // Re-throw specific user/auth errors to be displayed.
        }

        console.warn('Fallo la carga directa, intentando vía proxy CORS...', err.message);
        if (!url.startsWith('http')) throw err; // Can't proxy non-http URLs
        const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
        const proxyResponse = await fetch(proxyUrl);
        if (!proxyResponse.ok) throw new Error(`El proxy CORS también falló con estado: ${proxyResponse.status}`);
        return await proxyResponse.text();
    }
}

/**
 * Fetches a PGN file from a direct URL, processes it, and updates the UI.
 * @param {string} url - The URL of the PGN file.
 */
async function loadPgnFromUrl(url) {
  if (!url) return false;
  if (isLoading) return false; // Evita cargas simultáneas (doble clic)

  isLoading = true;
  try {
    document.getElementById('gameList').innerHTML = 'Cargando PGN...';
    document.getElementById('movesBox').innerHTML = 'Cargando...';

    // Before fetching, reset current state
    listModeActive = false;
    document.getElementById('listModeBtn').classList.remove('active');
    savedVariants = [];

    const rawPGN = await fetchPgnText(url);

    // After a successful load, update the saved variants list for this PGN
    const key = getSavedVariantsKey();
    savedVariants = key ? JSON.parse(localStorage.getItem(key)) || [] : [];
    processPgnData(rawPGN);
    return true;
  } catch (error) {
    console.error('Failed to load PGN:', error);
    document.getElementById('gameList').innerHTML = `<span style="color:red;">Error al cargar PGN: ${error.message}</span>`;
    pgnData = [];
    resetBoardToInitialState();
    return false;
  } finally {
    isLoading = false;
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
    updateSaveButtonState();
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Worker
// ─────────────────────────────────────────────────────────────────────────────
function registerServiceWorker() {
  // Evitar SW en entorno local para prevenir problemas de caché/red durante desarrollo
  const isLocal = window.location.hostname === 'localhost' || window.location.protocol === 'file:';
  
  if ('serviceWorker' in navigator && !isLocal) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('service-worker.js').catch(err => {
        console.warn('SW registration failed:', err);
      });
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
  const rank = parseInt(sq[1], 10) - 1; // 0-based rank (0..7)

  if (board && board.orientation() === 'black') {
    return {
      x: (7 - file) * squareSize + squareSize / 2,
      y: rank * squareSize + squareSize / 2
    };
  } else {
    return {
      x: file * squareSize + squareSize / 2,
      y: (7 - rank) * squareSize + squareSize / 2
    };
  }
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
    const depthMatch = line.match(/info depth (\d+)/);
    const currentDepth = depthMatch ? parseInt(depthMatch[1], 10) : 0;

    const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
    if (scoreMatch) {
      const score = {
        type: scoreMatch[1],
        value: parseInt(scoreMatch[2], 10)
      };

      // If the game is decisively over, use the game state, not the engine score value.
      if (chess.in_checkmate()) {
          // chess.turn() is the player who is mated.
          score.type = 'mate';
          // Use a large number to ensure updateEvalBar reads it as a win/loss
          score.value = chess.turn() === 'b' ? Infinity : -Infinity;
      } else if (chess.turn() === 'b') {
        // For any score type, if it's black's turn, the score is from black's perspective.
        // We negate it to get white's perspective.
        score.value = -score.value;
      }
      updateEvalBar(score);

      const pvMatch = line.match(/ pv (.+)/);
      if (pvMatch) {
        updatePvDisplay(pvMatch[1], currentDepth);
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

function updatePvDisplay(pvString, depth) {
  if (currentMove !== pgnData[currentVar]?.moves.length) {
    lastDisplayedPvDepth = 0; // Reset for next time
    return;
  }
  // Don't update display with a result from a shallower search, which can happen
  // if a new search starts or the engine reports intermediate results.
  if (depth < lastDisplayedPvDepth) {
    return;
  }
  lastDisplayedPvDepth = depth;

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
  lastDisplayedPvDepth = 0; // Reset for new analysis
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

function getSavedVariantsKey() {
    const pgnName = localStorage.getItem('selected_pgn');
    if (!pgnName) return null;
    return `pgn_savedVariants_${pgnName}`;
}

function updateSaveButtonState() {
    const btn = document.getElementById('saveVariantBtn');
    if (!pgnData || pgnData.length === 0) {
        btn.innerHTML = '💾';
        btn.style.opacity = 0.5;
        btn.title = 'Guardar Variante';
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
            const key = getSavedVariantsKey();
            if (key) localStorage.setItem(key, JSON.stringify(savedVariants));
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
            const key = getSavedVariantsKey();
            if (key) localStorage.setItem(key, JSON.stringify(savedVariants));
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

function initVariosMenu() {
  // 1. Mover (ocultar) la opcion original Partidas
  const tabBtns = document.querySelectorAll('.tab-btn');
  let gamesTabBtn = null;
  // Intentamos buscar por texto
  for (const btn of tabBtns) {
    if (btn.textContent.trim().includes('Partidas')) {
      gamesTabBtn = btn;
      break;
    }
  }
  // Fallback: si no la encuentra por texto, usa la 3a (índice 2)
  if (!gamesTabBtn && tabBtns.length > 2) gamesTabBtn = tabBtns[2];
  
  if (gamesTabBtn) gamesTabBtn.style.display = 'none';

  // 2. Crear boton y menu Varios
  const saveBtn = document.getElementById('saveVariantBtn');
  if (!saveBtn) return;

  const wrapper = document.createElement('div');
  wrapper.style.display = 'inline-block';
  wrapper.style.position = 'relative';
  wrapper.style.flex = '1';

  const menuBtn = document.createElement('button');
  menuBtn.innerHTML = '☰';
  menuBtn.className = saveBtn.className; // Heredar estilo del boton save
  menuBtn.style.cursor = 'pointer';
  menuBtn.style.width = '100%';

  const dropdown = document.createElement('div');
  Object.assign(dropdown.style, {
    display: 'none', position: 'absolute', top: '100%', right: '0', left: 'auto',
    backgroundColor: '#fff', color: '#000', border: '1px solid #ccc',
    zIndex: '1000', minWidth: '110px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
    borderRadius: '4px', marginTop: '2px', textAlign: 'left'
  });

  const addItem = (text, onClick) => {
    const item = document.createElement('div');
    item.textContent = text;
    Object.assign(item.style, { padding: '8px 12px', cursor: 'pointer' });
    item.onmouseover = () => item.style.backgroundColor = '#eee';
    item.onmouseout = () => item.style.backgroundColor = '#fff';
    item.onclick = (e) => { onClick(); dropdown.style.display = 'none'; };
    dropdown.appendChild(item);
  };

  addItem('Partidas', () => { if (gamesTabBtn) gamesTabBtn.click(); });

  addItem('Lichess', () => {
    let url;
    if (pgnData && pgnData[currentVar]) {
      const pgn = gameToString(pgnData[currentVar]);
      url = 'https://lichess.org/analysis/pgn/' + encodeURIComponent(pgn) + '#' + currentMove;
    } else {
      url = 'https://lichess.org/analysis/' + chess.fen().replace(/ /g, '_');
    }
    window.open(url, '_blank');
  });

  addItem('Girar Tablero', () => {
    board.flip();
    // Redibujar flechas/círculos en la nueva orientación
    const game = pgnData[currentVar];
    const moveData = (game && currentMove > 0) ? game.moves[currentMove - 1] : null;
    // Pequeño timeout para asegurar que el tablero ha actualizado su estado interno antes de dibujar
    setTimeout(() => drawOverlays(moveData), 50);
  });

  addItem('Copiar FEN', () => {
    navigator.clipboard.writeText(chess.fen())
      .then(() => alert('Posición (FEN) copiada al portapapeles.'));
  });

  menuBtn.onclick = (e) => { e.stopPropagation(); dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block'; };
  window.addEventListener('click', () => dropdown.style.display = 'none');

  wrapper.appendChild(menuBtn);
  wrapper.appendChild(dropdown);
  saveBtn.parentNode.insertBefore(wrapper, saveBtn.nextSibling);
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
window.onload = async function () {
  chess = new Chess();
  board = Chessboard('board', {
    position: 'start',
    pieceTheme: 'https://raw.githubusercontent.com/oakmac/chessboardjs/master/website/img/chesspieces/wikipedia/{piece}.png'
  });

  initArrowMarkers();
  initStockfish();
  setupEventListeners();
  initVariosMenu();
  registerServiceWorker();
  
  // Load saved variants for the initially selected PGN
  const initialKey = getSavedVariantsKey();
  savedVariants = initialKey ? JSON.parse(localStorage.getItem(initialKey)) || [] : [];
  
  buildPgnSelectionList();

  const savedPgn = localStorage.getItem('selected_pgn');
  const isCustom = localStorage.getItem('selected_pgn_is_custom') === 'true';
  
  // Check validity: if static, must be in list. If custom, must be a truthy string.
  const isValidSavedPgn = savedPgn && (isCustom || Object.values(PGN_SOURCES).includes(savedPgn));

  if (isValidSavedPgn) {
    const savedVar = parseInt(localStorage.getItem('pgn_var'), 10);
    const savedMove = parseInt(localStorage.getItem('pgn_move'), 10);
    
    // Load the PGN and then apply the saved position
    const success = isCustom ? await loadPgnFromUrl(savedPgn) : await loadPgnByName(savedPgn);
    
    if (success) {
        if (!isNaN(savedVar) && savedVar >= 0 && savedVar < pgnData.length) {
            currentVar = savedVar;
            if (!isNaN(savedMove) && savedMove >= 0 && savedMove <= pgnData[currentVar].moves.length) {
                currentMove = savedMove;
            }
        } else {
            currentVar = 0;
            currentMove = startMove();
        }
        gotoMove();
    }
  } else {
    resetBoardToInitialState();
  }

  switchTab('tablero');
};