// captured-pieces.js — improved version
// Shows captured pieces with correct orientation (top = pieces of current top player)

function updateCapturedPieces(chess, orientation = 'white') {
  const topContainer    = document.getElementById('captured-top');
  const bottomContainer = document.getElementById('captured-bottom');
  const materialDiff    = document.getElementById('material-difference');

  if (!topContainer || !bottomContainer) return;

  topContainer.innerHTML    = '';
  bottomContainer.innerHTML = '';
  if (materialDiff) materialDiff.textContent = '';

  const history = chess.history({ verbose: true });
  const counts = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 }
  };

  for (const move of history) {
    if ('captured' in move) {
      const pieceColor = move.color === 'w' ? 'b' : 'w';
      counts[pieceColor][move.captured]++;
    }
  }

  const pieceValue = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const types      = ['q', 'r', 'b', 'n', 'p']; // order: most valuable first
  let whiteTotalValue = 0, blackTotalValue = 0;

  // Determine which color is on top / bottom
  const topColor    = orientation === 'black' ? 'w' : 'b';
  const bottomColor = orientation === 'black' ? 'b' : 'w';

  for (const t of types) {
    const diff = counts.w[t] - counts.b[t];

    if (diff > 0) {
      // More white pieces captured → advantage for black → show in black's row
      const target = (bottomColor === 'b') ? bottomContainer : topContainer;
      for (let i = 0; i < diff; i++) target.appendChild(getPieceImage({ type: t, color: 'w' }));
    } else if (diff < 0) {
      // More black pieces captured → advantage for white → show in white's row
      const target = (bottomColor === 'w') ? bottomContainer : topContainer;
      for (let i = 0; i < Math.abs(diff); i++) target.appendChild(getPieceImage({ type: t, color: 'b' }));
    }

    whiteTotalValue += counts.w[t] * pieceValue[t];
    blackTotalValue += counts.b[t] * pieceValue[t];
  }

  // Material difference text — show next to the advantaged side
  if (materialDiff) {
    materialDiff.className = 'material-score'; // Para darle estilo CSS
    // difference from white's perspective (positive = white ahead)
    const diff = blackTotalValue - whiteTotalValue;
    if (diff > 0) {
      // White has material advantage → show "+N" in bottom row (white is usually bottom)
      materialDiff.textContent = `+${diff}`;
      const target = orientation === 'white' ? bottomContainer : topContainer;
      if (target) target.appendChild(materialDiff);
    } else if (diff < 0) {
      materialDiff.textContent = `${diff}`; // negative
      const target = orientation === 'white' ? topContainer : bottomContainer;
      if (target) target.appendChild(materialDiff);
    }
  }
}

function getPieceImage(piece) {
  const img = document.createElement('img');
  img.src = `https://raw.githubusercontent.com/oakmac/chessboardjs/master/website/img/chesspieces/wikipedia/${piece.color}${piece.type.toUpperCase()}.png`;
  img.alt = piece.color + piece.type;
  return img;
}
