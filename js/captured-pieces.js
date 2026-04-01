// captured-pieces.js

function updateCapturedPieces(chess, orientation = 'white') {
  const capturedWhiteContainer = document.getElementById('captured-white-pieces');
  const capturedBlackContainer = document.getElementById('captured-black-pieces');
  const materialDiffContainer = document.getElementById('material-difference');

  // Clear previous state
  capturedWhiteContainer.innerHTML = '';
  capturedBlackContainer.innerHTML = '';
  materialDiffContainer.innerHTML = '';

  const history = chess.history({ verbose: true });
  const counts = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 }
  };

  for (const move of history) {
    if ('captured' in move) {
      // The color of the piece is the OPPOSITE of the player who moved
      const pieceColor = move.color === 'w' ? 'b' : 'w';
      counts[pieceColor][move.captured]++;
    }
  }

  const pieceValue = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  let whiteTotalValue = 0;
  let blackTotalValue = 0;

  const types = ['p', 'n', 'b', 'r', 'q'];
  for (const t of types) {
    const diff = counts.w[t] - counts.b[t];
    if (diff > 0) {
      // Hay más piezas blancas capturadas que negras de este tipo (ventaja para el negro)
      for (let i = 0; i < diff; i++) {
        capturedWhiteContainer.appendChild(getPieceImage({ type: t, color: 'w' }));
      }
    } else if (diff < 0) {
      // Hay más piezas negras capturadas que blancas de este tipo (ventaja para el blanco)
      for (let i = 0; i < Math.abs(diff); i++) {
        capturedBlackContainer.appendChild(getPieceImage({ type: t, color: 'b' }));
      }
    }

    whiteTotalValue += counts.w[t] * pieceValue[t];
    blackTotalValue += counts.b[t] * pieceValue[t];
  }

  // Material difference is from white's perspective
  // (value of captured black pieces) - (value of captured white pieces)
  const difference = blackTotalValue - whiteTotalValue;
  const displayedDifference = (orientation === 'black') ? -difference : difference;

  if (displayedDifference > 0) {
    materialDiffContainer.textContent = `+${displayedDifference}`;
  } else if (displayedDifference < 0) {
    materialDiffContainer.textContent = `${displayedDifference}`;
  }
}

function getPieceImage(piece) {
  const img = document.createElement('img');
  img.src = `https://raw.githubusercontent.com/oakmac/chessboardjs/master/website/img/chesspieces/wikipedia/${piece.color}${piece.type.toUpperCase()}.png`;
  return img;
}
