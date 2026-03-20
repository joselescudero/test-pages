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
 * Helper to analyze PGN games and extract Study Name and Chapter list.
 * Handles "StudyName: ChapterName" format common in Lichess studies.
 * parsePGN flattens variants, so we group by chapterIndex.
 */
function extractPgnMetadata(games) {
  const uniqueChapters = [];
  const seen = new Set();
  
  for (const g of games) {
    if (g.chapterIndex !== undefined && !seen.has(g.chapterIndex)) {
      seen.add(g.chapterIndex);
      uniqueChapters.push({
        index: g.chapterIndex,
        headers: g.headers || {}
      });
    }
  }

  if (uniqueChapters.length === 0) return { name: 'PGN Desconocido', chapters: [] };

  // 1. Determine PGN Name (Study Name)
  const events = uniqueChapters.map(c => c.headers['Event'] || '').filter(e => e && e !== '?');
  let pgnName = '';
  let studyPrefix = '';

  if (events.length > 0) {
      // Check for common prefix ending in ": "
      const first = events[0];
      const colonIdx = first.indexOf(': ');
      if (colonIdx > 0) {
          const prefix = first.substring(0, colonIdx);
          const isCommon = events.every(e => e.startsWith(prefix + ': '));
          if (isCommon) {
              pgnName = prefix;
              studyPrefix = prefix + ': ';
          }
      }
      
      // Fallback: Use first event
      if (!pgnName) pgnName = first;
  } else {
      // Fallback: Use players of first game or generic
      const h = uniqueChapters[0].headers;
      if (h['White'] && h['Black']) pgnName = `${h['White']} vs ${h['Black']}`;
      else pgnName = 'Partida Importada';
  }

  // 2. Build Chapter List
  const chapters = uniqueChapters.map(c => {
      const h = c.headers;
      let name = '';

      // Cleaned Study Name
      if (studyPrefix && h['Event'] && h['Event'].startsWith(studyPrefix)) {
          name = h['Event'].substring(studyPrefix.length);
      } else {
          // Standard Name Construction
           if (h['White'] && h['Black'] && h['White'] !== '?' && h['Black'] !== '?') {
              name = `${h['White']} vs ${h['Black']}`;
              // Append Event if distinct and useful
              if (h['Event'] && h['Event'] !== '?' && h['Event'] !== name && h['Event'] !== pgnName) {
                  name = `${h['Event']} (${name})`;
              }
           } else if (h['Event'] && h['Event'] !== '?') {
               name = h['Event'];
           } else {
               name = `Capítulo ${c.index + 1}`;
           }
      }
      return { index: c.index, name: name };
  });

  return { name: pgnName, chapters };
}

/**
 * Builds the list of available PGN files for selection.
 */
function buildPgnSelectionList() {
  const container = document.getElementById('pgnList');
  container.innerHTML = '';
  
  // --- Controles: Aceptar y Deseleccionar ---
  const controlsDiv = document.createElement('div');
  controlsDiv.style.marginBottom = '15px';
  controlsDiv.style.display = 'flex';
  controlsDiv.style.gap = '10px';

  // Logic to handle parent/child checkbox interactions
  const handleCheckboxChange = (e) => {
    const cb = e.target;
    if (cb.dataset.role === 'parent') {
        // Parent toggles all children
        const parentLi = cb.closest('.pgn-parent-li');
        if (parentLi) {
            const children = parentLi.querySelectorAll('input[data-role="child"]');
            children.forEach(child => child.checked = cb.checked);
        }
    } else if (cb.dataset.role === 'child') {
        // Child updates parent state
        const parentLi = cb.closest('.pgn-parent-li');
        const parentCb = parentLi.querySelector('input[data-role="parent"]');
        const allChildren = parentLi.querySelectorAll('input[data-role="child"]');
        const checkedChildren = parentLi.querySelectorAll('input[data-role="child"]:checked');
        
        if (checkedChildren.length === 0) {
            parentCb.checked = false;
            parentCb.indeterminate = false;
        } else if (checkedChildren.length === allChildren.length) {
            parentCb.checked = true;
            parentCb.indeterminate = false;
        } else {
            parentCb.checked = false;
            parentCb.indeterminate = true;
        }
    }
  };

  const btnAccept = document.createElement('button');
  btnAccept.textContent = '✅ Cargar seleccionados';
  btnAccept.style.flex = '2';
  btnAccept.style.backgroundColor = '#e8f5e9'; // Verde claro
  btnAccept.style.fontWeight = 'bold';
  btnAccept.onclick = () => {
    const selected = [];
    
    // Group by PGN source
    const sources = new Map(); // url -> {type, name, chapters: Set}
    
    container.querySelectorAll('input[type="checkbox"]:checked, input[type="checkbox"]:indeterminate').forEach(cb => {
        const value = cb.dataset.value;
        if (!sources.has(value)) {
            sources.set(value, {
                value: value,
                type: cb.dataset.type,
                name: cb.dataset.name,
                chapters: new Set(),
                loadAll: false
            });
        }
        const entry = sources.get(value);
        
        if (cb.dataset.role === 'parent') {
            // If parent is checked and not indeterminate, load all
            if (cb.checked && !cb.indeterminate) {
                entry.loadAll = true;
            }
        } else if (cb.dataset.role === 'child' && cb.checked) {
            entry.chapters.add(parseInt(cb.dataset.chapter, 10));
        }
    });

    // Convert map to array
    sources.forEach(entry => {
        // If loadAll is true, we ignore individual chapters. 
        // If loadAll is false but chapters were selected, we pass the array.
        const finalEntry = {
            value: entry.value,
            type: entry.type,
            name: entry.name
        };
        if (!entry.loadAll && entry.chapters.size > 0) {
            finalEntry.chapters = Array.from(entry.chapters);
        }
        // Only add if we are loading something
        if (entry.loadAll || (finalEntry.chapters && finalEntry.chapters.length > 0)) {
            selected.push(finalEntry);
        }
    });

    if (selected.length === 0) {
      alert('Seleccione al menos un archivo PGN.');
      return;
    }
    loadMultiplePgns(selected);
  };

  const btnDeselect = document.createElement('button');
  btnDeselect.textContent = '❌ Quitar selección';
  btnDeselect.style.flex = '1';
  btnDeselect.onclick = () => {
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  };

  controlsDiv.appendChild(btnAccept);
  controlsDiv.appendChild(btnDeselect);
  container.appendChild(controlsDiv);

  // --- Lista de PGNs ---
  const ul = document.createElement('ul');

  // Recuperar selección guardada
  const savedList = JSON.parse(localStorage.getItem('selected_pgns_list')) || [];
  const isChecked = (val) => savedList.some(item => item.value === val);

  // 1. Static PGNs
  for (const displayName in PGN_SOURCES) {
    const pgnName = PGN_SOURCES[displayName];
    const li = document.createElement('li');
    
    li.style.display = 'flex';
    li.style.alignItems = 'center';
    li.style.padding = '5px 0';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.id = 'pgn_static_' + pgnName;
    chk.dataset.value = pgnName;
    chk.dataset.type = 'static';
    chk.dataset.name = displayName;
    chk.dataset.role = 'parent'; // Treat as parent with no children visible
    chk.onchange = handleCheckboxChange;
    chk.checked = isChecked(pgnName);
    chk.style.marginLeft = '12px'; // Checkbox a la derecha
    chk.style.transform = 'scale(1.3)'; // Checkbox más grande
    
    const lbl = document.createElement('label');
    lbl.htmlFor = chk.id;
    lbl.textContent = displayName;
    lbl.style.flex = '1';
    lbl.style.cursor = 'pointer';
    lbl.style.fontSize = '16px';

    li.appendChild(lbl);
    li.appendChild(chk);
    ul.appendChild(li);
  }

  // 2. Custom PGNs
  const customPgns = JSON.parse(localStorage.getItem(CUSTOM_PGNS_KEY)) || [];
  customPgns.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'pgn-parent-li';
    li.style.display = 'flex';
    li.style.flexDirection = 'column';
    li.style.padding = '5px 0';

    const headerDiv = document.createElement('div');
    headerDiv.style.display = 'flex';
    headerDiv.style.alignItems = 'center';
    headerDiv.style.width = '100%';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.id = 'pgn_custom_' + index;
    chk.dataset.value = item.url;
    chk.dataset.type = 'custom';
    chk.dataset.name = item.name;
    chk.dataset.role = 'parent';
    chk.checked = isChecked(item.url); // Default check if in saved list
    chk.onchange = handleCheckboxChange;
    chk.style.marginLeft = '12px';
    chk.style.transform = 'scale(1.3)';

    const lbl = document.createElement('label');
    lbl.htmlFor = chk.id;
    lbl.textContent = item.name;
    lbl.style.flex = '1';
    lbl.style.cursor = 'pointer';
    lbl.style.fontSize = '16px';

    const delBtn = document.createElement('button');
    delBtn.textContent = '❌';
    delBtn.title = 'Eliminar';
    delBtn.style.width = 'auto'; // Override css global
    delBtn.style.marginLeft = 'auto';
    delBtn.style.marginRight = '8px'; // Espacio con el checkbox
    delBtn.style.padding = '5px 10px';
    delBtn.onclick = (e) => {
      if (confirm(`¿Eliminar "${item.name}" de la lista?`)) {
        customPgns.splice(index, 1);
        localStorage.setItem(CUSTOM_PGNS_KEY, JSON.stringify(customPgns));
        buildPgnSelectionList();
      }
    };

    headerDiv.appendChild(lbl);
    headerDiv.appendChild(delBtn);
    headerDiv.appendChild(chk);
    li.appendChild(headerDiv);

    // If this PGN has chapters info, render children
    if (item.chapters && item.chapters.length > 0) {
        const chapterUl = document.createElement('ul');
        chapterUl.style.paddingLeft = '30px';
        chapterUl.style.marginTop = '5px';
        
        item.chapters.forEach(chap => {
            const cLi = document.createElement('li');
            cLi.style.listStyle = 'none';
            cLi.style.marginBottom = '4px';
            cLi.style.display = 'flex'; // Alineación flexible
            cLi.style.alignItems = 'center';
            
            const cChk = document.createElement('input');
            cChk.type = 'checkbox';
            cChk.id = `pgn_custom_${index}_ch_${chap.index}`;
            cChk.dataset.value = item.url; // Same value as parent to group them
            cChk.dataset.type = 'custom';
            cChk.dataset.role = 'child';
            cChk.dataset.chapter = chap.index;
            cChk.checked = chk.checked; // Init state based on parent
            cChk.onchange = handleCheckboxChange;
            cChk.style.marginLeft = '8px';
            
            const cLbl = document.createElement('label');
            cLbl.htmlFor = cChk.id;
            cLbl.textContent = chap.name;
            cLbl.style.cursor = 'pointer';
            cLbl.style.fontSize = '14px';
            cLbl.style.flex = '1'; // Ocupar espacio restante
            
            cLi.appendChild(cLbl);
            cLi.appendChild(cChk);
            chapterUl.appendChild(cLi);
        });
        li.appendChild(chapterUl);
    }

    ul.appendChild(li);
  });

  // 3. Add Custom PGN Button
  const liAdd = document.createElement('li');
  const btnAdd = document.createElement('button');
  btnAdd.textContent = '➕ Añadir PGN URL';
  btnAdd.style.backgroundColor = '#eef';
  btnAdd.style.width = '100%';
  btnAdd.onclick = async () => {
    const url = prompt('URL del archivo .pgn:');
    if (!url) return;
    
    btnAdd.textContent = '⏳ Leyendo archivo...';
    btnAdd.disabled = true;

    try {
        // Fetch and parse immediately to get chapters
        const rawText = await fetchPgnText(url);
        // We parse to verify it works and extract metadata
        const games = parsePGN(rawText);
        const metadata = extractPgnMetadata(games);

        const list = JSON.parse(localStorage.getItem(CUSTOM_PGNS_KEY)) || [];
        list.push({ name: metadata.name, url, chapters: metadata.chapters });
        localStorage.setItem(CUSTOM_PGNS_KEY, JSON.stringify(list));
        buildPgnSelectionList();
    } catch (e) {
        alert('Error al leer o procesar el PGN: ' + e.message);
        console.error(e);
    } finally {
        btnAdd.textContent = '➕ Añadir PGN URL';
        btnAdd.disabled = false;
    }
  };
  liAdd.appendChild(btnAdd);
  ul.appendChild(liAdd);

  container.appendChild(ul);
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
 * Carga múltiples PGNs basados en la lista de selección.
 * @param {Array<{value: string, type: string, name: string, chapters?: number[]}>} selectionList
 */
async function loadMultiplePgns(selectionList) {
  if (isLoading) return;
  isLoading = true;

  document.getElementById('gameList').innerHTML = 'Cargando PGNs...';
  document.getElementById('movesBox').innerHTML = 'Cargando...';

  // Guardar selección actual
  localStorage.setItem('selected_pgns_list', JSON.stringify(selectionList));
  // Limpiar selección antigua para evitar confusiones
  localStorage.removeItem('selected_pgn');

  // Reset UI
  listModeActive = false;
  document.getElementById('listModeBtn').classList.remove('active');
  savedVariants = [];
  rawPgnGames = [];

  try {
    for (const item of selectionList) {
      let url;
      if (item.type === 'static') {
        url = `${PGN_BASE_URL}${item.value}.pgn`;
      } else {
        url = item.value;
      }
      
      try {
        const rawPGN = await fetchPgnText(url);
        const games = parsePGN(rawPGN);
        
        // Filter by chapters if specified
        if (item.chapters && item.chapters.length > 0) {
            const filtered = games.filter(g => item.chapters.includes(g.chapterIndex));
            rawPgnGames.push(...filtered);
        } else {
            // Load all (default behavior)
            rawPgnGames.push(...games);
        }
      } catch (err) {
        console.error(`Error cargando ${item.name}:`, err);
      }
    }

    // Obtener variantes guardadas (estrellas) para esta combinación
    const key = getSavedVariantsKey();
    savedVariants = key ? JSON.parse(localStorage.getItem(key)) || [] : [];

    console.log('Total partidas cargadas:', rawPgnGames.length);
    applyGameSorting();

    if (pgnData.length > 0) {
      currentVar = 0;
      currentMove = startMove();
      gotoMove();
      switchTab('tablero');
    } else {
      document.getElementById('gameList').innerHTML = 'No se encontraron partidas válidas.';
      resetBoardToInitialState();
    }
  } catch (error) {
    console.error('Error multi-carga:', error);
    document.getElementById('gameList').innerHTML = `Error: ${error.message}`;
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
  const randomOrder = document.getElementById('randomOrderCheck') ? document.getElementById('randomOrderCheck').checked : false;

  function movesString(game) {
    return game.moves.map(m => m.san).join(' ');
  }

  // Helper para barajar array (Fisher-Yates)
  const shuffle = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  };

  if (mainLineFirst) {
    // Keep main line first, sort the rest
    const mainLineGame = rawPgnGames[0];
    const variantGames = rawPgnGames.slice(1);
    
    if (randomOrder) shuffle(variantGames);
    else variantGames.sort((a, b) => movesString(a).localeCompare(movesString(b)));
    
    pgnData = [mainLineGame, ...variantGames];
  } else {
    // Sort/Shuffle all games
    let games = [...rawPgnGames];
    if (randomOrder) shuffle(games);
    else games.sort((a, b) => movesString(a).localeCompare(movesString(b)));
    
    pgnData = games;
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

function initCommentBox() {
  const movesBox = document.getElementById('movesBox');
  if (!movesBox) return;
  
  const commentBox = document.createElement('div');
  commentBox.id = 'commentBox';
  commentBox.style.display = 'none'; // Oculto por defecto si no hay comentario
  
  movesBox.parentNode.insertBefore(commentBox, movesBox);
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

  // Update Comment Box
  const commentBox = document.getElementById('commentBox');
  if (commentBox) {
    const commentText = (curMove && curMove.comment) ? curMove.comment : '';
    if (commentText) {
      commentBox.textContent = commentText;
      commentBox.style.display = 'block';
    } else {
      commentBox.style.display = 'none';
    }
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
    // 1. Intentar usar la lista múltiple
    const listStr = localStorage.getItem('selected_pgns_list');
    if (listStr) {
      const list = JSON.parse(listStr);
      // Generar hash basado en los valores ordenados para consistencia
      const str = list.map(i => i.value).sort().join('|');
      let hash = 0;
      for(let i=0; i<str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i) | 0;
      return `pgn_savedVariants_multi_${hash}`;
    }
    // 2. Fallback antiguo
    const pgnName = localStorage.getItem('selected_pgn');
    if (pgnName) return `pgn_savedVariants_${pgnName}`;
    return null;
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

  // Helper para alinear checkboxes a la derecha en la configuración
  const alignConfigCheckbox = (id) => {
    const cb = document.getElementById(id);
    if (!cb) return;
    cb.style.transform = 'scale(1.3)';
    const row = cb.closest('.config-row');
    if (row) {
      // Si está dentro de un label, lo sacamos para que flex space-between funcione
      if (cb.parentElement.tagName === 'LABEL') {
         cb.parentElement.classList.add('config-label');
         row.appendChild(cb);
      } else {
         // Asegurar que sea el último elemento
         row.appendChild(cb);
      }
    }
  };

  const mainLineFirstCheck = document.getElementById('mainLineFirstCheck');
  alignConfigCheckbox('mainLineFirstCheck');

  // Inyectar opción de Orden Aleatorio si no existe
  if (mainLineFirstCheck && !document.getElementById('randomOrderCheck')) {
    const parentRow = mainLineFirstCheck.closest('.config-row');
    if (parentRow && parentRow.parentNode) {
      const div = document.createElement('div');
      div.className = 'config-row';
      div.innerHTML = `
        <span class="config-label">Orden Aleatorio</span>
        <input type="checkbox" id="randomOrderCheck" style="transform: scale(1.3);">
      `;
      parentRow.parentNode.insertBefore(div, parentRow.nextSibling);
    }
  }
  const randomOrderCheck = document.getElementById('randomOrderCheck');

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

  if (randomOrderCheck) {
    const savedRandom = localStorage.getItem('pgn_randomOrder');
    randomOrderCheck.checked = savedRandom === 'true';
    randomOrderCheck.addEventListener('change', function() {
      localStorage.setItem('pgn_randomOrder', this.checked);
      applyGameSorting();
      currentVar = 0;
      currentMove = startMove();
      gotoMove();
    });
  }

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
  alignConfigCheckbox('automoveCheck');
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

  initCommentBox();
  initArrowMarkers();
  initStockfish();
  setupEventListeners();
  initVariosMenu();
  registerServiceWorker();
  
  // Load saved variants for the initially selected PGN
  const initialKey = getSavedVariantsKey();
  savedVariants = initialKey ? JSON.parse(localStorage.getItem(initialKey)) || [] : [];
  
  buildPgnSelectionList();

  // Intentar cargar selección múltiple guardada
  const savedListStr = localStorage.getItem('selected_pgns_list');
  if (savedListStr) {
    const list = JSON.parse(savedListStr);
    if (list && list.length > 0) {
      await loadMultiplePgns(list);
      // Restaurar posición si es posible
      const savedVar = parseInt(localStorage.getItem('pgn_var'), 10);
      const savedMove = parseInt(localStorage.getItem('pgn_move'), 10);
      if (pgnData.length > 0) {
        currentVar = (savedVar >= 0 && savedVar < pgnData.length) ? savedVar : 0;
        currentMove = (savedMove >= 0) ? savedMove : startMove();
        gotoMove();
      }
    }
  } else {
    // Migración: Comprobar selección antigua simple
    const savedPgn = localStorage.getItem('selected_pgn');
    const isCustom = localStorage.getItem('selected_pgn_is_custom') === 'true';
    const isValidSavedPgn = savedPgn && (isCustom || Object.values(PGN_SOURCES).includes(savedPgn));
    
    if (isValidSavedPgn) {
      const type = isCustom ? 'custom' : 'static';
      let name = savedPgn;
      if (!isCustom) {
         const found = Object.entries(PGN_SOURCES).find(([k,v]) => v === savedPgn);
         if (found) name = found[0];
      }
      // Cargar como lista de un elemento
      await loadMultiplePgns([{ value: savedPgn, type, name }]);
    } else {
      resetBoardToInitialState();
    }
  }

  switchTab('tablero');
};