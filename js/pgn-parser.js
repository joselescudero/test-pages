/**
 * PGN Parser
 * Parses a PGN string (with nested variants and annotations) into an array of games.
 * Main line = index 0, variants follow in DFS order.
 * Each variant is a full game: all ancestor moves up to the branch point + variant moves.
 */

const PGN_COLOR_MAP = { G: "green", R: "red", B: "blue", Y: "yellow" };

/**
 * Tokenizes a PGN string into structured tokens.
 * @param {string} pgn
 * @returns {Array<{type: string, ...}>}
 */
function tokenizePGN(pgn) {
  const tokens = [];
  const len = pgn.length;
  let i = 0;

  while (i < len) {
    const ch = pgn[i];

    // Skip whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // Comment block { ... }
    if (ch === '{') {
      let j = i + 1;
      // Support nested braces? PGN standard doesn't allow them, but just scan to closing }
      while (j < len && pgn[j] !== '}') j++;
      tokens.push({ type: 'comment', text: pgn.slice(i + 1, j) });
      i = j + 1;
      continue;
    }

    // Variation delimiters
    if (ch === '(') { tokens.push({ type: 'open' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'close' }); i++; continue; }

    // Result tokens: *, 1-0, 0-1, 1/2-1/2
    if (ch === '*') { tokens.push({ type: 'result', text: '*' }); i++; continue; }
    if (pgn.startsWith('1-0', i)) { tokens.push({ type: 'result', text: '1-0' }); i += 3; continue; }
    if (pgn.startsWith('0-1', i)) { tokens.push({ type: 'result', text: '0-1' }); i += 3; continue; }
    if (pgn.startsWith('1/2-1/2', i)) { tokens.push({ type: 'result', text: '1/2-1/2' }); i += 7; continue; }

    // PGN tag headers  [TagName "..."]
    if (ch === '[') {
      while (i < len && pgn[i] !== ']') i++;
      i++; // skip ']'
      continue;
    }

    // NAG (Numeric Annotation Glyph): $1, $2, ...
    if (ch === '$') {
      i++;
      const numStart = i;
      while (i < len && /\d/.test(pgn[i])) i++;
      const nagNum = parseInt(pgn.slice(numStart, i), 10);
      if (!isNaN(nagNum)) tokens.push({ type: 'nag', num: nagNum });
      continue;
    }

    // Move quality glyphs: !, ?, !!, ??, !?, ?!
    if (ch === '!' || ch === '?') {
      while (i < len && (pgn[i] === '!' || pgn[i] === '?')) i++;
      continue;
    }

    // Move number (digits followed by dots): 1. 2. 3... 4.
    if (/\d/.test(ch)) {
      while (i < len && /\d/.test(pgn[i])) i++;   // digits
      while (i < len && pgn[i] === '.') i++;       // dots
      continue; // move numbers are skipped
    }

    // SAN move (starts with a-h, N, B, R, Q, K, O)
    if (/[a-zA-Z]/.test(ch)) {
      let j = i;
      // Read until whitespace, {, (, ), !, ?
      while (j < len && !/[\s{}()!?]/.test(pgn[j])) j++;
      const san = pgn.slice(i, j);
      // Filter out ellipsis artifacts "..." that sometimes appear in variant notation
      if (san && san !== '...') {
        tokens.push({ type: 'move', san });
      }
      i = j;
      continue;
    }

    // Anything else - skip
    i++;
  }

  return tokens;
}

/**
 * Parses annotation text extracting arrows ([%cal]) and circles ([%csl]).
 * @param {string} text
 * @returns {{arrows: Array, circles: Array}}
 */
function parseAnnotation(text) {
  const arrows = [], circles = [];
  const calMatch = text.match(/\[%cal ([^\]]+)\]/);
  const cslMatch = text.match(/\[%csl ([^\]]+)\]/);
  if (calMatch) {
    calMatch[1].split(',').forEach(a => {
      a = a.trim();
      if (a.length < 5) return;
      const color = PGN_COLOR_MAP[a[0]] || 'green';
      arrows.push({ from: a.slice(1, 3), to: a.slice(3, 5), color });
    });
  }
  if (cslMatch) {
    cslMatch[1].split(',').forEach(c => {
      c = c.trim();
      if (c.length < 3) return;
      const color = PGN_COLOR_MAP[c[0]] || 'green';
      circles.push({ square: c.slice(1, 3), color });
    });
  }
  return { arrows, circles };
}

/**
 * Recursively parses a variant line from the token stream.
 * Appends any sub-variants found to allGames.
 * Returns the array of moves for this line.
 *
 * @param {Array} tokens  - full token array
 * @param {{i: number}} pos - current position (object for pass-by-ref)
 * @param {Array} ancestorMoves - moves inherited from the parent line up to branch point
 * @param {Array} allGames - accumulator for all games found (will be pushed into)
 * @returns {Array} moves of this line (deep-copied objects)
 */
function parseVariantLine(tokens, pos, ancestorMoves, allGames) {
  // Deep-copy ancestor moves so each line is independent
  const moves = ancestorMoves.map(m => ({
    san: m.san,
    nags: m.nags ? [...m.nags] : [],
    arrows: m.arrows.map(a => ({ ...a })),
    circles: m.circles.map(c => ({ ...c }))
  }));

  while (pos.i < tokens.length) {
    const t = tokens[pos.i];

    if (t.type === 'close' || t.type === 'result') {
      pos.i++;
      break;
    }

    if (t.type === 'open') {
      pos.i++;
      // The variant is an ALTERNATIVE to the last move that was just played.
      // So we branch from moves WITHOUT the last move.
      const branchMoves = moves.slice(0, Math.max(0, moves.length - 1));
      const variantMoves = parseVariantLine(tokens, pos, branchMoves, allGames);
      allGames.push({ moves: variantMoves });
      continue;
    }

    if (t.type === 'move') {
      pos.i++;
      const move = { san: t.san, nags: [], arrows: [], circles: [] };
      // Consume NAGs immediately following the move
      while (pos.i < tokens.length && tokens[pos.i].type === 'nag') {
        move.nags.push(tokens[pos.i].num);
        pos.i++;
      }
      // Consume optional comment annotation
      if (pos.i < tokens.length && tokens[pos.i].type === 'comment') {
        const ann = parseAnnotation(tokens[pos.i].text);
        move.arrows = ann.arrows;
        move.circles = ann.circles;
        pos.i++;
      }
      moves.push(move);
      continue;
    }

    if (t.type === 'comment') {
      // Comment not directly after a move - if there's a previous move, attach to it
      if (moves.length > 0) {
        const ann = parseAnnotation(t.text);
        if (ann.arrows.length > 0 || ann.circles.length > 0) {
          // Attach to the last move (overwrite only if empty)
          const last = moves[moves.length - 1];
          if (last.arrows.length === 0) last.arrows = ann.arrows;
          if (last.circles.length === 0) last.circles = ann.circles;
        }
      }
      pos.i++;
      continue;
    }

    // Unknown token - skip
    pos.i++;
  }

  return moves;
}

/**
 * Main entry point.
 * Parses a PGN string and returns an array of game objects.
 * Index 0 is the main line; subsequent entries are variants in DFS order.
 *
 * @param {string} pgn
 * @returns {Array<{moves: Array<{san: string, arrows: Array, circles: Array}>}>}
 */
function parsePGN(pgn) {
  const tokens = tokenizePGN(pgn);
  const allGames = []; // will hold variants
  const pos = { i: 0 };
  const mainMoves = parseVariantLine(tokens, pos, [], allGames);

  // Main line first, then variants in discovery order
  return [{ moves: mainMoves }, ...allGames];
}

/**
 * Converts a game's moves back to a PGN-style string for display.
 * @param {{moves: Array}} game
 * @returns {string}
 */
function gameToString(game) {
  let result = '';
  let moveNumber = 1;
  game.moves.forEach((m, i) => {
    if (i % 2 === 0) result += moveNumber + '. ';
    result += m.san + ' ';
    if (i % 2 === 1) moveNumber++;
  });
  return result.trim();
}

/**
 * Validates that a list of games can actually be played on a chess board.
 * Returns an array of validation results.
 * @param {Array} games
 * @returns {Array<{index: number, valid: boolean, error?: string, moves: number}>}
 */
function validateGames(games) {
  return games.map((game, index) => {
    const chess = new Chess();
    let error = null;
    for (let i = 0; i < game.moves.length; i++) {
      const result = chess.move(game.moves[i].san);
      if (!result) {
        error = `Invalid move "${game.moves[i].san}" at position ${i + 1} (after: ${game.moves.slice(0, i).map(m => m.san).join(' ')})`;
        break;
      }
    }
    return { index, valid: !error, error, moves: game.moves.length };
  });
}
