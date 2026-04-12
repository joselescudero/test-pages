// Node.js test script for pgn-parser.js
const Chess = require('/Users/J.ESCUDEROGONZALEZ/node_modules/chess.js/chess.js').Chess || require('/Users/J.ESCUDEROGONZALEZ/node_modules/chess.js/chess.js');

// Import parser functions (inline since the file uses browser globals)
eval(require('fs').readFileSync('./pgn-parser.js', 'utf8'));

const rawPGN = `
1. e4 { [%csl Ge4] } e5
2. Nf3 Nc6
  ( 2... f5
    3. Nxe5 Qe7
      ( 3... Nc6 4. Nc3 Nf6 )
    4. Nf3 fxe4 5. Ne5 )
  ( 2... d6
    3. d4 exd4
      ( 3... Nd7 4. Bc4 Be7 5. O-O )
    4. Nxd4 Nf6 5. Nc3 )
3. Bb5 a6
  ( 3... Nf6
    4. O-O Nxe4
      ( 4... d6 5. d4 exd4 6. e5 dxe5 7. Nxe5 )
    5. d4
      ( 5. Re1 Nd6 6. Nxe5 Be7 7. Nf3 )
      ( 5. d3 Nf6 6. Nc3 Be7 )
    5... exd4 6. Re1 d5 )
  ( 3... Bc5
    4. c3 Nf6
      ( 4... Qe7 5. O-O Nf6
          ( 5... d6 6. d4 Bb6 )
        6. d4 )
    5. d4 exd4 6. cxd4 Bb4+ 7. Nc3 Nxe4 )
  ( 3... d6
    4. d4 Bd7 5. Nc3 Nf6
      ( 5... g6 6. O-O Bg7 )
    6. O-O Be7 )
4. Ba4 Nf6
5. O-O Be7
  ( 5... b5 6. Bb3 Bc5
      ( 6... Na5 7. c3 d6
          ( 7... c5 8. d4 )
        8. d4 )
    7. c3 d6 8. d4 )
6. Re1 b5
  ( 6... d6
    7. c3 O-O 8. h3 Na5 9. Bc2 c5 )
7. Bb3 d6
  ( 7... O-O 8. c3 d5
      ( 8... d6 9. h3 Na5 10. Bc2 c5 )
    9. exd5 Nxd5 10. Nxe5 Nxe5 11. Rxe5 )
8. c3 O-O *
`;

const games = parsePGN(rawPGN);
console.log('Total games: ' + games.length);

let allOk = true;
games.forEach((game, idx) => {
  const chess = new Chess();
  let err = null;
  for (let i = 0; i < game.moves.length; i++) {
    if (!chess.move(game.moves[i].san)) {
      const prev = game.moves.slice(Math.max(0, i - 3), i).map(x => x.san).join(' ');
      err = 'Bad move "' + game.moves[i].san + '" at idx ' + i + ' (prev: ' + prev + ')';
      break;
    }
  }
  const lbl = idx === 0 ? 'Main line' : 'Variant ' + idx;
  if (err) {
    allOk = false;
    console.log('FAIL G' + (idx + 1) + ' [' + lbl + ']: ' + err);
  } else {
    console.log('OK   G' + (idx + 1) + ' [' + lbl + '] (' + game.moves.length + 'hm): ' + game.moves.map(m => m.san).join(' '));
  }
});

console.log('');
console.log(allOk ? '=== ALL VALID ===' : '=== SOME FAILURES ===');
process.exit(allOk ? 0 : 1);
