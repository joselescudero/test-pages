// captured-pieces.js

function updateCapturedPieces(chess) {
  const capturedWhiteContainer = document.getElementById('captured-white-pieces');
  const capturedBlackContainer = document.getElementById('captured-black-pieces');
  const materialDiffContainer = document.getElementById('material-difference');

  // Clear previous state
  capturedWhiteContainer.innerHTML = '';
  capturedBlackContainer.innerHTML = '';
  materialDiffContainer.innerHTML = '';

  const history = chess.history({ verbose: true });
  const capturedWhitePieces = []; // White pieces captured by black
  const capturedBlackPieces = []; // Black pieces captured by white

  for (const move of history) {
    if ('captured' in move) {
      // The color of the piece is the OPPOSITE of the player who moved
      const pieceColor = move.color === 'w' ? 'b' : 'w';
      const piece = {
        type: move.captured,
        color: pieceColor
      };

      if (pieceColor === 'w') {
        capturedWhitePieces.push(piece);
      } else {
        capturedBlackPieces.push(piece);
      }
    }
  }

  const pieceValue = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  let capturedWhiteValue = 0;
  let capturedBlackValue = 0;

  const sortOrder = { p: 1, n: 2, b: 3, r: 4, q: 5 };
  capturedWhitePieces.sort((a, b) => sortOrder[a.type] - sortOrder[b.type]);
  capturedBlackPieces.sort((a, b) => sortOrder[a.type] - sortOrder[b.type]);

  for (const piece of capturedWhitePieces) {
    capturedWhiteValue += pieceValue[piece.type];
    capturedWhiteContainer.appendChild(getPieceImage(piece));
  }

  for (const piece of capturedBlackPieces) {
    capturedBlackValue += pieceValue[piece.type];
    capturedBlackContainer.appendChild(getPieceImage(piece));
  }

  // Material difference is from white's perspective
  // (value of captured black pieces) - (value of captured white pieces)
  const difference = capturedBlackValue - capturedWhiteValue;
  if (difference > 0) {
    materialDiffContainer.textContent = `+${difference}`;
  } else if (difference < 0) {
    materialDiffContainer.textContent = `${difference}`;
  }
}

function getPieceImage(piece) {
  const img = document.createElement('img');
  img.src = `https://raw.githubusercontent.com/oakmac/chessboardjs/master/website/img/chesspieces/wikipedia/${piece.color}${piece.type.toUpperCase()}.png`;
  return img;
}
