// ═══════════════════════════════════════════════════════════════════════
//  main.js — PGN Viewer v3
// ═══════════════════════════════════════════════════════════════════════

const PGN_SOURCES = {};
const PGN_BASE_URL = 'https://joselescudero.github.io/test-pages/pgn/';

const KEYS = {
  CUSTOM_PGNS:'pgn_custom_sources', LICHESS_TOKEN:'lichess_api_token',
  SELECTED_LIST:'selected_pgns_list', DARK_MODE:'pgn_darkMode',
  FULL_SCREEN:'pgn_fullScreen', MAIN_LINE_FIRST:'pgn_mainLineFirst',
  RANDOM_ORDER:'pgn_randomOrder', SKIP_IDENTICAL:'pgn_skipIdentical',
  AUTOMOVE_MS:'pgn_automoveMs', IGNORE_MOVES:'pgn_ignoreMoves',
  SPANISH:'pgn_spanishNotation', ENGINE_ON:'pgn_engineOn',
  PV_LINES:'pgn_pvLines', CUR_VAR:'pgn_var', CUR_MOVE:'pgn_move',
};

let board, chess, stockfish;
let pgnData=[], rawPgnGames=[];
let currentVar=0, currentMove=0;
let automoveTimer=null, savedVariants=[];
let listModeActive=false, isLoading=false, isFreeBoardActive=false;
let fenToGamesMap=new Map(), lastPvDepth=0;
let studyModeActive=false, studyAnswered=false;
let freeBoardHistory=[];   // FENs before each free-board move (for undo)
let pvLineData={};         // { multipvIdx: { depth, str, score } }

const NAG_DESCRIPTIONS={
  1:'! Buena jugada',2:'? Error',3:'!! Jugada brillante',4:'?? Error grave',
  5:'!? Jugada interesante',6:'?! Jugada dudosa',7:'□ Única jugada',
  10:'= Posición igualada',13:'∞ Posición poco clara',
  14:'⩲ Blancas ligeramente mejor',15:'⩱ Negras ligeramente mejor',
  16:'± Blancas mejor',17:'∓ Negras mejor',
  18:'+- Blancas ventaja decisiva',19:'-+ Negras ventaja decisiva',
  36:'→ Iniciativa blancas',37:'→ Iniciativa negras',
  40:'↑ Ataque blancas',41:'↑ Ataque negras',
  140:'△ Con la idea...',141:'▽ Amenaza...',142:'⌀ La mejor jugada',
};

// ── Utilities ────────────────────────────────────────────────────────────
function toast(msg,dur=2000){const e=$id('toast');e.textContent=msg;e.classList.add('show');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('show'),dur);}
function $id(id){return document.getElementById(id);}
function getMatchFen(f){return f.split(' ').slice(0,4).join(' ');}
function getPvLines(){const v=parseInt(($id('pvLines')||{}).value||'1',10);return Math.max(1,Math.min(3,isNaN(v)?1:v));}

function sanToSpanish(san){
  const el=$id('spanishNotationCheck');
  if(!el||!el.checked)return san;
  const m={K:'R',Q:'D',R:'T',B:'A',N:'C'};
  san=san.replace(/([=])([KQRBN])/,(_,eq,p)=>eq+m[p]);
  if(/^[KQRBN]/.test(san))return m[san[0]]+san.slice(1);
  return san;
}

// ── Dark Mode ────────────────────────────────────────────────────────────
function applyDarkMode(on){
  document.body.classList.toggle('dark',on);
  $id('darkModeBtn').textContent=on?'☀':'🌙';
  const meta=$id('themeColorMeta');if(meta)meta.content=on?'#1a1a2e':'#ffffff';
}
function toggleDarkMode(){const on=!document.body.classList.contains('dark');localStorage.setItem(KEYS.DARK_MODE,on?'1':'0');applyDarkMode(on);}

// ── Tabs ─────────────────────────────────────────────────────────────────
function switchTab(name){
  document.querySelectorAll('.tab-pane').forEach(p=>p.style.display='none');
  document.querySelectorAll('.tab-btn[data-tab]').forEach(b=>b.classList.remove('active'));
  const p=$id('tab-'+name);if(p)p.style.display='';
  const b=document.querySelector(`.tab-btn[data-tab="${name}"]`);if(b)b.classList.add('active');
}

// ── Arrow / Circle overlays ───────────────────────────────────────────────
function initArrowMarkers(){
  const svg=$id('arrowOverlay'),defs=svg.querySelector('defs');
  ['green','red','blue','yellow'].forEach(color=>{
    const mk=document.createElementNS('http://www.w3.org/2000/svg','marker');
    mk.setAttribute('id','ah_'+color);mk.setAttribute('markerWidth','4');
    mk.setAttribute('markerHeight','4');mk.setAttribute('refX','2.5');
    mk.setAttribute('refY','2');mk.setAttribute('orient','auto');
    const po=document.createElementNS('http://www.w3.org/2000/svg','polygon');
    po.setAttribute('points','0 0, 4 2, 0 4');po.setAttribute('fill',color);
    mk.appendChild(po);defs.appendChild(mk);
  });
}
function clearOverlays(){
  const svg=$id('arrowOverlay');
  Array.from(svg.children).forEach(c=>{if(c.tagName.toLowerCase()!=='defs')svg.removeChild(c);});
  document.querySelectorAll('.circle').forEach(e=>e.remove());
}
function squareCenter(sq,sz){
  const file=sq.charCodeAt(0)-97,rank=parseInt(sq[1],10)-1;
  const flip=board&&board.orientation()==='black';
  return{x:(flip?7-file:file)*sz+sz/2,y:(flip?rank:7-rank)*sz+sz/2};
}
function drawOverlays(md){
  clearOverlays();if(!md)return;
  const boardEl=$id('board'),sz=boardEl.offsetWidth/8;
  const svg=$id('arrowOverlay'),cont=$id('boardContainer');
  (md.arrows||[]).forEach(a=>{
    const fr=squareCenter(a.from,sz),to=squareCenter(a.to,sz);
    const dx=to.x-fr.x,dy=to.y-fr.y,len=Math.sqrt(dx*dx+dy*dy),sh=sz*.35;
    const ux=dx/len,uy=dy/len;
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',fr.x);line.setAttribute('y1',fr.y);
    line.setAttribute('x2',to.x-ux*sh);line.setAttribute('y2',to.y-uy*sh);
    line.setAttribute('stroke',a.color);line.setAttribute('stroke-width',sz*.14);
    line.setAttribute('stroke-opacity','0.75');
    line.setAttribute('marker-end','url(#ah_'+a.color+')');
    svg.appendChild(line);
  });
  (md.circles||[]).forEach(c=>{
    const center=squareCenter(c.square,sz);
    const el=document.createElement('div');el.className='circle';
    el.style.left=(center.x-sz/2)+'px';el.style.top=(center.y-sz/2)+'px';
    el.style.width=el.style.height=sz+'px';el.style.borderColor=c.color;
    cont.appendChild(el);
  });
}

// ── Drag & Drop ───────────────────────────────────────────────────────────
function onDragStart(source,piece){
  if(studyModeActive){
    if(chess.game_over())return false;
    const game=pgnData[currentVar];
    if(!game||currentMove>=game.moves.length)return false;
    // Only allow the colour that needs to move
    const tmp=new Chess(chess.fen());
    const expSan=game.moves[currentMove].san;
    const expMv=tmp.moves({verbose:true}).find(m=>m.san===expSan);
    const expColor=expMv?expMv.color:tmp.turn();
    if(expColor==='w'&&piece.search(/^b/)!==-1)return false;
    if(expColor==='b'&&piece.search(/^w/)!==-1)return false;
    return;
  }
  if(isFreeBoardActive){
    if(chess.game_over())return false;
    if(chess.turn()==='w'&&piece.search(/^b/)!==-1)return false;
    if(chess.turn()==='b'&&piece.search(/^w/)!==-1)return false;
    return;
  }
  return false;
}

function onDrop(source,target){
  if(studyModeActive) return handleStudyDrop(source,target);
  if(isFreeBoardActive){
    const prevFen=chess.fen();
    const mv=chess.move({from:source,to:target,promotion:'q'});
    if(mv===null)return'snapback';
    freeBoardHistory.push(prevFen);
    return;
  }
  return'snapback';
}

function onSnapEnd(){
  board.position(chess.fen());
  if(isFreeBoardActive){updateFreeBoardUI();updateCapturedPieces(chess,board.orientation());startAnalysis();}
}

// ── Study Mode ────────────────────────────────────────────────────────────
function handleStudyDrop(source,target){
  if(!studyModeActive||studyAnswered)return'snapback';
  const game=pgnData[currentVar];
  if(!game||currentMove>=game.moves.length)return'snapback';
  const expected=game.moves[currentMove].san;
  const tmp=new Chess(chess.fen());
  const mv=tmp.move({from:source,to:target,promotion:'q'});
  if(!mv)return'snapback';
  const overlay=$id('studyOverlay'),fb=$id('studyFeedback');
  if(mv.san===expected){
    chess.move(expected);
    fb.textContent='✓ ¡Correcto!';fb.style.color='#4caf50';
    overlay.classList.add('flash-correct');
    studyAnswered=true;
    board.position(chess.fen());
    setTimeout(()=>{overlay.classList.remove('flash-correct');currentMove++;gotoMove();},700);
    return;
  }else{
    fb.textContent='✗ Incorrecto — prueba de nuevo';fb.style.color='#f44336';
    overlay.classList.add('flash-wrong');
    setTimeout(()=>overlay.classList.remove('flash-wrong'),500);
    return'snapback';
  }
}

function updateStudyOverlay(){
  const overlay=$id('studyOverlay'),msg=$id('studyMsg'),fb=$id('studyFeedback');
  if(!studyModeActive){overlay.style.display='none';return;}
  const game=pgnData[currentVar];
  if(game&&currentMove<game.moves.length){
    overlay.style.display='';
    msg.textContent='¿Cuál es la siguiente jugada?';
    if(!studyAnswered)fb.textContent='';
    studyAnswered=false;
  }else{
    overlay.style.display='';
    msg.textContent='¡Línea completada!';
    fb.textContent='';
  }
}

function toggleStudyMode(){
  studyModeActive=!studyModeActive;studyAnswered=false;
  if(studyModeActive){
    currentMove=startMove();gotoMove();
    toast('Modo estudio: arrastra las piezas para adivinar ♟');
  }else{
    $id('studyOverlay').style.display='none';
    toast('Modo estudio desactivado');
    gotoMove();
  }
}

// ── Free Board (Analysis) ─────────────────────────────────────────────────
function toggleFreeBoard(){
  if(isFreeBoardActive){
    isFreeBoardActive=false;freeBoardHistory=[];
    const btn=$id('freeBoardBtn');if(btn)btn.classList.remove('active');
    gotoMove();
    toast('Modo análisis desactivado');
  }else{
    isFreeBoardActive=true;freeBoardHistory=[];
    const btn=$id('freeBoardBtn');if(btn)btn.classList.add('active');
    updateFreeBoardUI();startAnalysis();
    toast('Modo análisis activo — ← para deshacer, click en el botón para salir');
  }
}

function freeBoardUndo(){
  if(!isFreeBoardActive||!freeBoardHistory.length)return;
  const prevFen=freeBoardHistory.pop();
  chess.load(prevFen);
  board.position(chess.fen(),false);
  updateFreeBoardUI();
  updateCapturedPieces(chess,board.orientation());
  startAnalysis();
}

function updateFreeBoardUI(){
  const box=$id('movesBox');
  if(!isFreeBoardActive)return;
  const matches=fenToGamesMap.get(getMatchFen(chess.fen()))||[];
  let html=`<div style="background:var(--accent-light);border-left:3px solid var(--accent);padding:6px 10px;margin-bottom:8px;font-size:13px;border-radius:0 4px 4px 0;">
    <b>🛠 Modo Análisis</b> — ← deshacer · click 🛠 para salir</div>`;
  if(matches.length){
    html+=`<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;">📍 Posición en el PGN</div>`;
    matches.forEach(m=>{
      const isMain=$id('mainLineFirstCheck').checked&&m.gameIdx===0;
      const label=isMain?'★ Línea principal':`Variante ${m.gameIdx+1}`;
      const game=pgnData[m.gameIdx];
      // Build moves string, highlight the matched move
      let movStr='';let n=1;
      (game?.moves||[]).forEach((mv,i)=>{
        if(i%2===0)movStr+=`${n++}. `;
        const san=sanToSpanish(mv.san);
        if(i===m.moveIdx-1){movStr+=`<b style="color:var(--move-active);">${san}</b> `;}
        else{movStr+=`${san} `;}
      });
      html+=`<div style="margin-bottom:10px;">
        <a href="#" onclick="loadMatchedGame(${m.gameIdx},${m.moveIdx});return false;"
          style="display:block;font-size:13px;font-weight:700;color:var(--accent);text-decoration:none;margin-bottom:3px;">
          ${label} — jugada ${m.moveIdx}</a>
        <div style="font-size:11px;color:var(--text-muted);line-height:1.6;word-break:break-word;">${movStr.trim()}</div>
      </div>`;
    });
  }else{
    html+='<p style="font-size:13px;color:var(--text-muted);">Posición no encontrada en el PGN.</p>';
  }
  html+='<div id="pvBox" style="margin-top:8px;"></div>';
  box.innerHTML=html;
}

window.loadMatchedGame=(gIdx,mIdx)=>{
  isFreeBoardActive=false;freeBoardHistory=[];
  const btn=$id('freeBoardBtn');if(btn)btn.classList.remove('active');
  currentVar=gIdx;currentMove=mIdx;gotoMove();
};

// ── Stockfish — MultiPV ───────────────────────────────────────────────────
function onEngineMessage(event){
  const line=typeof event==='object'?event.data:event;
  if(typeof line!=='string'||!line.startsWith('info depth'))return;
  const depthM=line.match(/info depth (\d+)/);const depth=depthM?parseInt(depthM[1]):0;
  const scoreM=line.match(/score (cp|mate) (-?\d+)/);if(!scoreM)return;
  let type=scoreM[1],value=parseInt(scoreM[2]);
  if(chess.in_checkmate()){type='mate';value=chess.turn()==='b'?Infinity:-Infinity;}
  else if(chess.turn()==='b')value=-value;
  const mpM=line.match(/multipv (\d+)/);const mpIdx=mpM?parseInt(mpM[1]):1;
  if(mpIdx===1)updateEvalBar({type,value});
  const pvM=line.match(/ pv (.+)/);
  if(pvM){pvLineData[mpIdx]={depth,str:pvM[1],score:{type,value}};renderAllPvLines();}
}

function updateEvalBar(score){
  const wb=$id('evalBar-white');if(!wb)return;
  let pct=50;
  if(score.type==='mate'){pct=score.value>0?100:0;}
  else{const adv=2/(1+Math.exp(-0.0035*score.value))-1;pct=(1+adv)/2*100;}
  wb.style.width=pct+'%';
  lastEngineScore=score;
  if(chess&&board)updateCapturedPieces(chess,board.orientation());
}

function pvToString(pvString){
  const uci=pvString.split(' ').slice(0,14);
  const tmp=new Chess(chess.fen());const parts=tmp.fen().split(' ');
  let mn=parseInt(parts[5]),isW=parts[1]==='w',str='';
  uci.forEach((u,i)=>{
    const mv=tmp.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u.length>4?u[4]:undefined});
    if(!mv)return;
    const san=sanToSpanish(mv.san);
    if(isW){str+=`${mn}. ${san} `;isW=false;}
    else{str+=(i===0?`${mn}…${san} `:`${san} `);mn++;isW=true;}
  });
  return str.trim();
}

function renderAllPvLines(){
  const isAtEnd=pgnData[currentVar]&&currentMove===pgnData[currentVar].moves.length;
  if(!isFreeBoardActive&&!isAtEnd)return;
  const pvBox=$id('pvBox');if(!pvBox)return;
  const n=getPvLines();let html='';
  for(let i=1;i<=n;i++){
    const e=pvLineData[i];if(!e)continue;
    const scoreStr=e.score.type==='mate'?`M${Math.abs(e.score.value)}`:((e.score.value>=0?'+':'')+(e.score.value/100).toFixed(1));
    const mv=pvToString(e.str);if(!mv)continue;
    html+=`<div style="margin-bottom:3px;font-size:13px;"><span style="font-weight:700;color:var(--accent);margin-right:6px;">${scoreStr}</span>${mv}</div>`;
  }
  pvBox.innerHTML=html||'';
}

function startAnalysis(){
  const engineOn=$id('engineCheck')?$id('engineCheck').checked:true;
  if(!stockfish||!engineOn)return;
  pvLineData={};lastPvDepth=0;
  const n=getPvLines();
  stockfish.postMessage('stop');
  stockfish.postMessage(`setoption name MultiPV value ${n}`);
  stockfish.postMessage('position fen '+chess.fen());
  stockfish.postMessage('go movetime 2000');
  const pb=$id('pvBox');if(pb)pb.innerHTML='';
}

function initStockfish(){
  fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js')
    .then(r=>r.text()).then(t=>{
      stockfish=new Worker(URL.createObjectURL(new Blob([t],{type:'application/javascript'})));
      stockfish.onmessage=onEngineMessage;stockfish.postMessage('uci');startAnalysis();
    }).catch(()=>{const e=$id('evalBarWrap');if(e)e.style.display='none';});
}

// ── Moves Box ─────────────────────────────────────────────────────────────
function updateMovesBox(){
  if(!pgnData||!pgnData.length)return;
  const game=pgnData[currentVar],box=$id('movesBox');
  if(!box||isFreeBoardActive)return;
  // Counter styled as a pill badge, clearly separate from move text
  let html=`<span class="game-counter">${currentVar+1}<span style="opacity:.5;"> / ${pgnData.length}</span></span> `;
  let n=1;
  game.moves.forEach((m,i)=>{
    if(i%2===0)html+=`<span class="move-number">${n++}.</span>`;
    const san=sanToSpanish(m.san);
    html+=`<span class="${i===currentMove-1?'mv active':'mv'}" data-mi="${i}">${san}</span> `;
  });
  box.innerHTML=html;
  const active=box.querySelector('.mv.active');
  if(active)active.scrollIntoView({block:'nearest'});
  // NAG
  const cmd=currentMove>0?game.moves[currentMove-1]:null;
  const nags=(cmd?.nags||[]).map(n=>NAG_DESCRIPTIONS[n]).filter(Boolean);
  const nb=$id('nagBox');
  if(nags.length){nb.textContent=nags.join(' · ');nb.style.display='';}
  else{nb.textContent='';nb.style.display='none';}
  // Comment
  const cb=$id('commentBox');const comment=cmd?.comment||'';
  if(comment){cb.textContent=comment;cb.style.display='';}else{cb.style.display='none';}
  // Progress
  $id('progressBar').style.width=(game.moves.length>0?currentMove/game.moves.length*100:0)+'%';
}

// ── gotoMove ──────────────────────────────────────────────────────────────
function gotoMove(){
  if(!pgnData||!pgnData.length){resetBoardToInitialState();return;}
  chess.reset();
  const game=pgnData[currentVar];
  document.querySelectorAll('.square-55d63').forEach(el=>el.classList.remove('highlight-square'));
  let fromSq=null,toSq=null;
  for(let i=0;i<currentMove;i++){
    const mv=chess.move(game.moves[i].san);
    if(!mv){console.error('Illegal move',game.moves[i].san,'var',currentVar,'idx',i);break;}
    if(i===currentMove-1){fromSq=mv.from;toSq=mv.to;}
  }
  board.position(chess.fen(),false);
  applyChapterOrientation();
  if(fromSq&&toSq){
    document.querySelector('.square-'+fromSq)?.classList.add('highlight-square');
    document.querySelector('.square-'+toSq)?.classList.add('highlight-square');
  }
  localStorage.setItem(KEYS.CUR_VAR,currentVar);
  localStorage.setItem(KEYS.CUR_MOVE,currentMove);
  updateMovesBox();
  updateCapturedPieces(chess,board.orientation());
  drawOverlays(currentMove>0?game.moves[currentMove-1]:null);
  updateSaveButtonState();
  startAnalysis();
  highlightActiveGame();
  if(studyModeActive)updateStudyOverlay();
}

function applyChapterOrientation(){
  if(!pgnData[currentVar])return;
  const ci=pgnData[currentVar].chapterIndex;if(ci===undefined)return;
  const savedList=JSON.parse(localStorage.getItem(KEYS.SELECTED_LIST))||[];
  for(const item of savedList){
    if(!item.chapters_meta)continue;
    const ch=item.chapters_meta.find(c=>c.index===ci);
    if(ch&&ch.orientation){
      if(board.orientation()!==ch.orientation){
        board.orientation(ch.orientation);
        setTimeout(()=>{
          drawOverlays(currentMove>0&&pgnData[currentVar]?pgnData[currentVar].moves[currentMove-1]:null);
          updateCapturedPieces(chess,board.orientation());
        },30);
      }
      return;
    }
  }
}

function highlightActiveGame(){
  document.querySelectorAll('.game-entry').forEach((el,i)=>el.classList.toggle('active-game',i===currentVar));
}

// ── Captured pieces — single row ──────────────────────────────────────────
// lastEngineScore is updated by updateEvalBar so we can show it here
let lastEngineScore = null;

function updateCapturedPieces(chess,orientation='white'){
  const bar=$id('capturedPiecesBar');if(!bar)return;
  const history=chess.history({verbose:true});
  const counts={w:{p:0,n:0,b:0,r:0,q:0},b:{p:0,n:0,b:0,r:0,q:0}};
  for(const mv of history){if('captured'in mv)counts[mv.color==='w'?'b':'w'][mv.captured]++;}
  const pv={p:1,n:3,b:3,r:5,q:9},types=['q','r','b','n','p'];
  const wCap=[],bCap=[];let wMat=0,bMat=0;
  for(const t of types){
    const d=counts.w[t]-counts.b[t];
    if(d>0)for(let i=0;i<d;i++)wCap.push({type:t,color:'w'});
    else if(d<0)for(let i=0;i<-d;i++)bCap.push({type:t,color:'b'});
    wMat+=counts.w[t]*pv[t];bMat+=counts.b[t]*pv[t];
  }
  // Material difference: positive = white ahead (more black pieces captured)
  const matDiff=bMat-wMat;
  const matStr=matDiff>0?`+${matDiff}`:(matDiff<0?`${matDiff}`:'');
  // Engine score
  let engStr='';
  if(lastEngineScore!==null){
    const s=lastEngineScore;
    if(s.type==='mate'){engStr=s.value===Infinity?'M':(s.value===-Infinity?'-M':`M${Math.abs(s.value)}`);}
    else{engStr=(s.value>=0?'+':'')+(s.value/100).toFixed(1);}
  }
  // Combined label: "+3 / +2.5"  (mat / engine).  Show only non-empty parts.
  let centerStr='';
  if(matStr&&engStr) centerStr=`${matStr}<span style="color:var(--text-muted);margin:0 2px;">/</span>${engStr}`;
  else if(matStr)    centerStr=matStr;
  else if(engStr)    centerStr=engStr;

  const img=p=>`<img src="https://raw.githubusercontent.com/oakmac/chessboardjs/master/website/img/chesspieces/wikipedia/${p.color}${p.type.toUpperCase()}.png" style="width:16px;height:16px;">`;
  bar.innerHTML=`
    <div style="display:flex;align-items:center;gap:1px;flex:1;">${wCap.map(img).join('')}</div>
    <div style="font-size:12px;font-weight:700;color:var(--text-secondary);min-width:52px;text-align:center;white-space:nowrap;">${centerStr}</div>
    <div style="display:flex;align-items:center;gap:1px;flex:1;justify-content:flex-end;">${bCap.map(img).join('')}</div>`;
}

// ── PGN Loading ───────────────────────────────────────────────────────────
function extractPgnMetadata(games){
  const chapters=[],seen=new Set();
  for(const g of games){if(g.chapterIndex!==undefined&&!seen.has(g.chapterIndex)){seen.add(g.chapterIndex);chapters.push({index:g.chapterIndex,headers:g.headers||{}}); }}
  if(!chapters.length)return{name:'PGN',chapters:[]};
  const events=chapters.map(c=>c.headers['Event']||'').filter(e=>e&&e!=='?');
  let pgnName='',studyPrefix='';
  if(events.length){
    const first=events[0];const ci=first.indexOf(': ');
    if(ci>0){const prefix=first.slice(0,ci);if(events.every(e=>e.startsWith(prefix+': '))){pgnName=prefix;studyPrefix=prefix+': ';}}
    if(!pgnName)pgnName=first;
  }else{const h=chapters[0].headers;pgnName=(h.White&&h.Black)?`${h.White} vs ${h.Black}`:'Partida';}
  const chapterList=chapters.map(c=>{
    const h=c.headers;let name='';
    if(studyPrefix&&h.Event?.startsWith(studyPrefix))name=h.Event.slice(studyPrefix.length);
    else if(h.White&&h.Black&&h.White!=='?'&&h.Black!=='?')name=`${h.White} vs ${h.Black}`;
    else if(h.Event&&h.Event!=='?')name=h.Event;
    else name=`Capítulo ${c.index+1}`;
    return{index:c.index,name};
  });
  return{name:pgnName,chapters:chapterList};
}

async function fetchPgnText(url){
  const isLichess=url.includes('lichess.org');let token=localStorage.getItem(KEYS.LICHESS_TOKEN);
  const opts=t=>{const h={};if(isLichess){h['Accept']='application/x-chess-pgn';if(t)h['Authorization']=`Bearer ${t}`;}return{headers:h};};

  const askToken=(reason)=>{
    const t=prompt(
      `${reason}\n\nIntroduce tu Personal Access Token de Lichess\n(necesita permiso "study:read").\n\nPuedes crearlo en: lichess.org/account/oauth/token`,
      token||''
    );
    return t?.trim()||null;
  };

  // ── First attempt ──
  let res;
  try{ res=await fetch(url,opts(token)); }
  catch(netErr){
    // Network/CORS error — for Lichess this often means a private study blocked by CORS
    if(isLichess){
      const t=askToken('No se pudo acceder al estudio (posiblemente privado o error de red).');
      if(!t)throw new Error('Cancelado');
      localStorage.setItem(KEYS.LICHESS_TOKEN,t);
      try{const r2=await fetch(url,opts(t));if(r2.ok)return r2.text();throw new Error(`Error ${r2.status}`);}
      catch(e2){throw new Error('Lichess auth failed: '+e2.message);}
    }
    // Non-Lichess network error → try CORS proxy
    const pr=await fetch('https://api.allorigins.win/raw?url='+encodeURIComponent(url));
    if(!pr.ok)throw new Error(`Proxy falló: ${pr.status}`);
    return pr.text();
  }

  if(res.ok)return res.text();

  // ── Auth / not found for Lichess ──
  if(isLichess&&(res.status===401||res.status===403||res.status===404)){
    const reason=res.status===404
      ?'Estudio no encontrado (404). Si es privado necesitas un token.'
      :`Acceso denegado (${res.status}). El estudio es privado.`;
    const t=askToken(reason);
    if(!t)throw new Error('Cancelado');
    localStorage.setItem(KEYS.LICHESS_TOKEN,t);
    const r2=await fetch(url,opts(t));
    if(r2.ok)return r2.text();
    alert(`El token no funcionó (Error ${r2.status}).`);
    throw new Error('Lichess auth failed');
  }

  // ── Generic HTTP error → try CORS proxy ──
  if(!isLichess){
    const pr=await fetch('https://api.allorigins.win/raw?url='+encodeURIComponent(url));
    if(!pr.ok)throw new Error(`HTTP ${res.status} y proxy falló: ${pr.status}`);
    return pr.text();
  }

  throw new Error(`HTTP ${res.status}`);
}

async function loadMultiplePgns(selectionList,restorePosition=false){
  if(isLoading)return;isLoading=true;
  $id('gameList').innerHTML='Cargando PGNs...';$id('movesBox').innerHTML='Cargando...';
  localStorage.setItem(KEYS.SELECTED_LIST,JSON.stringify(selectionList));
  listModeActive=false;$id('listModeBtn').classList.remove('active');
  savedVariants=[];rawPgnGames=[];
  try{
    for(const item of selectionList){
      const url=item.type==='static'?`${PGN_BASE_URL}${item.value}.pgn`:item.value;
      try{
        const raw=await fetchPgnText(url);const games=parsePGN(raw);
        const filtered=item.chapters?.length?games.filter(g=>item.chapters.includes(g.chapterIndex)):games;
        rawPgnGames.push(...filtered);
      }catch(e){console.error(`Error cargando ${item.name}:`,e);}
    }
    const key=getSavedVariantsKey();savedVariants=key?(JSON.parse(localStorage.getItem(key))||[]):[];
    applyGameSorting();
    if(pgnData.length>0){
      if(restorePosition){
        const sv=parseInt(localStorage.getItem(KEYS.CUR_VAR),10);const sm=parseInt(localStorage.getItem(KEYS.CUR_MOVE),10);
        currentVar=(sv>=0&&sv<pgnData.length)?sv:0;currentMove=sm>=0?sm:startMove();
      }else{currentVar=0;currentMove=startMove();}
      gotoMove();switchTab('board');
    }else{$id('gameList').innerHTML='No se encontraron partidas.';resetBoardToInitialState();}
  }catch(e){$id('gameList').innerHTML=`Error: ${e.message}`;}
  finally{isLoading=false;}
}

function applyGameSorting(){
  if(!rawPgnGames.length){pgnData=[];buildGameList();return;}
  const mainFirst=$id('mainLineFirstCheck').checked,random=$id('randomOrderCheck').checked;
  const movStr=g=>g.moves.map(m=>m.san).join(' ');
  const shuffle=arr=>{for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;};
  if(mainFirst){const main=rawPgnGames[0],rest=rawPgnGames.slice(1);pgnData=[main,...(random?shuffle(rest):rest.sort((a,b)=>movStr(a).localeCompare(movStr(b))))];}
  else{const all=[...rawPgnGames];pgnData=random?shuffle(all):all.sort((a,b)=>movStr(a).localeCompare(movStr(b)));}
  buildGameList();buildFenMap();
}

function buildFenMap(){
  fenToGamesMap.clear();
  pgnData.forEach((game,gIdx)=>{
    const tmp=new Chess();
    const add=(fen,mi)=>{const k=getMatchFen(fen);if(!fenToGamesMap.has(k))fenToGamesMap.set(k,[]);fenToGamesMap.get(k).push({gameIdx:gIdx,moveIdx:mi});};
    add(tmp.fen(),0);
    for(let i=0;i<game.moves.length;i++){if(!tmp.move(game.moves[i].san))break;add(tmp.fen(),i+1);}
  });
}

// ── Sequence Search ────────────────────────────────────────────────────────
function findSequence(moves,tokens){
  if(!tokens.length)return 0;
  const ml=moves.map(m=>m.toLowerCase().replace(/[+#!?]/g,''));
  for(let s=0;s<=ml.length-tokens.length;s++){
    let ok=true;
    for(let t=0;t<tokens.length;t++){if(!ml[s+t].includes(tokens[t].replace(/[+#!?]/g,'')))  {ok=false;break;}}
    if(ok)return s;
  }
  return null;
}

function buildGameList(filter=''){
  const container=$id('gameList');container.innerHTML='';if(!pgnData.length)return;
  const rawFilter=filter.trim();
  const tokens=rawFilter?rawFilter.toLowerCase().split(/\s+/).filter(Boolean):[];
  pgnData.forEach((game,idx)=>{
    let matchStart=-1;
    if(tokens.length){
      matchStart=findSequence(game.moves.map(m=>m.san),tokens)??findSequence(game.moves.map(m=>sanToSpanish(m.san)),tokens);
      if(matchStart===null)return;
    }
    const matchEnd=matchStart>=0?matchStart+tokens.length:-1;
    const div=document.createElement('div');
    div.className='game-entry'+(savedVariants.includes(idx)?' saved-variant':'')+(idx===currentVar?' active-game':'');
    const isMain=$id('mainLineFirstCheck').checked&&idx===0;
    const label=isMain?'★ Línea principal':`Variante ${idx+1}`;
    let movesHtml='';let n=1;
    game.moves.forEach((m,i)=>{
      if(i%2===0)movesHtml+=`${n++}. `;
      let san=sanToSpanish(m.san);
      if(matchStart>=0&&i>=matchStart&&i<matchEnd)san=`<mark>${san}</mark>`;
      movesHtml+=san+' ';
    });
    div.innerHTML=`<span class="game-label" data-idx="${idx}">${label} (${game.moves.length} jug.)</span><span class="game-moves">${movesHtml.trim()}</span>`;
    container.appendChild(div);
  });
}

// ── PGN Selection List ─────────────────────────────────────────────────────
function buildPgnSelectionList(){
  const container=$id('pgnList');container.innerHTML='';
  const savedList=JSON.parse(localStorage.getItem(KEYS.SELECTED_LIST))||[];

  const isChapterSel=(url,chIdx)=>{
    const entry=savedList.find(i=>i.value===url);if(!entry)return false;
    if(!entry.chapters)return true;return entry.chapters.includes(chIdx);
  };
  const isAllSel=(url)=>{const entry=savedList.find(i=>i.value===url);return!!(entry&&!entry.chapters);};
  const getChOrient=(url,chIdx)=>{
    const entry=savedList.find(i=>i.value===url);if(!entry?.chapters_meta)return'';
    const ch=entry.chapters_meta.find(c=>c.index===chIdx);return ch?ch.orientation||'':'';
  };

  const handleChange=e=>{
    const cb=e.target;
    if(cb.dataset.role==='parent'){
      cb.closest('.pgn-parent-li')?.querySelectorAll('input[data-role="child"]').forEach(c=>c.checked=cb.checked);
    }else if(cb.dataset.role==='child'){
      const li=cb.closest('.pgn-parent-li');
      const parent=li?.querySelector('input[data-role="parent"]');
      const children=[...(li?.querySelectorAll('input[data-role="child"]')||[])];
      const checked=children.filter(c=>c.checked);
      if(!parent)return;
      if(!checked.length){parent.checked=false;parent.indeterminate=false;}
      else if(checked.length===children.length){parent.checked=true;parent.indeterminate=false;}
      else{parent.checked=false;parent.indeterminate=true;}
    }
  };

  const ctrl=document.createElement('div');ctrl.className='pgn-controls';
  const btnLoad=document.createElement('button');btnLoad.className='primary';
  btnLoad.textContent='✅ Cargar seleccionados';
  btnLoad.onclick=()=>{
    const sources=new Map();
    container.querySelectorAll('input[data-role]').forEach(cb=>{
      if(!cb.checked&&!cb.indeterminate)return;
      const val=cb.dataset.value;
      if(!sources.has(val))sources.set(val,{value:val,type:cb.dataset.type,name:cb.dataset.name,chapters:new Set(),chapters_meta:new Map(),loadAll:false});
      const entry=sources.get(val);
      if(cb.dataset.role==='parent'&&cb.checked&&!cb.indeterminate)entry.loadAll=true;
      else if(cb.dataset.role==='child'&&cb.checked){
        const chIdx=parseInt(cb.dataset.chapter,10);entry.chapters.add(chIdx);
        const orientSel=document.querySelector(`select[data-ch-orient="${val}_${chIdx}"]`);
        if(orientSel&&orientSel.value)entry.chapters_meta.set(chIdx,{index:chIdx,orientation:orientSel.value});
      }
    });
    const selected=[];
    sources.forEach(e=>{
      const fe={value:e.value,type:e.type,name:e.name};
      if(!e.loadAll&&e.chapters.size>0){fe.chapters=Array.from(e.chapters);fe.chapters_meta=Array.from(e.chapters_meta.values());}
      if(e.loadAll||fe.chapters?.length)selected.push(fe);
    });
    if(!selected.length){toast('Seleccione al menos un PGN');return;}
    loadMultiplePgns(selected);
  };
  const btnDesel=document.createElement('button');btnDesel.textContent='❌ Quitar';
  btnDesel.onclick=()=>container.querySelectorAll('input[type="checkbox"]').forEach(cb=>{cb.checked=false;cb.indeterminate=false;});
  ctrl.appendChild(btnLoad);ctrl.appendChild(btnDesel);container.appendChild(ctrl);

  const ul=document.createElement('ul');

  // Static PGNs
  Object.entries(PGN_SOURCES).forEach(([name,val])=>{
    const li=document.createElement('li');li.className='pgn-parent-li';
    li.innerHTML=`<div class="pgn-header-row"><label for="pgn_s_${val}">${name}</label>
      <input type="checkbox" id="pgn_s_${val}" data-value="${val}" data-type="static" data-name="${name}" data-role="parent" ${isAllSel(val)?'checked':''}></div>`;
    li.querySelector('input').onchange=handleChange;ul.appendChild(li);
  });

  // Custom PGNs
  const customPgns=JSON.parse(localStorage.getItem(KEYS.CUSTOM_PGNS))||[];
  customPgns.forEach((item,idx)=>{
    const li=document.createElement('li');li.className='pgn-parent-li';
    const hdr=document.createElement('div');hdr.className='pgn-header-row';
    const lbl=document.createElement('label');lbl.htmlFor=`pgn_c_${idx}`;lbl.textContent=item.name;
    const delBtn=document.createElement('button');delBtn.className='pgn-del-btn';delBtn.textContent='✕';delBtn.title='Eliminar';
    delBtn.onclick=()=>{if(!confirm(`¿Eliminar "${item.name}"?`))return;customPgns.splice(idx,1);localStorage.setItem(KEYS.CUSTOM_PGNS,JSON.stringify(customPgns));buildPgnSelectionList();};

    const savedEntry=savedList.find(i=>i.value===item.url);
    let parentChecked=false,parentIndeterminate=false;
    if(savedEntry){
      if(!savedEntry.chapters)parentChecked=true;
      else{const total=item.chapters?.length||0;const sel=savedEntry.chapters.length;
        if(sel>0&&sel<total)parentIndeterminate=true;else if(sel===total)parentChecked=true;}
    }
    const cb=document.createElement('input');cb.type='checkbox';cb.id=`pgn_c_${idx}`;
    cb.dataset.value=item.url;cb.dataset.type='custom';cb.dataset.name=item.name;cb.dataset.role='parent';
    cb.checked=parentChecked;cb.indeterminate=parentIndeterminate;cb.onchange=handleChange;

    hdr.appendChild(lbl);hdr.appendChild(delBtn);hdr.appendChild(cb);li.appendChild(hdr);

    if(item.chapters?.length){
      const chWrap=document.createElement('div');chWrap.className='pgn-chapters';
      item.chapters.forEach(ch=>{
        const row=document.createElement('div');row.className='pgn-chapter-row';
        // Orientation selector
        const orientKey=`${item.url}_${ch.index}`;
        const savedOrient=getChOrient(item.url,ch.index);
        const orientSel=document.createElement('select');
        orientSel.dataset.chOrient=orientKey;orientSel.title='Orientación preferida (↔ auto, ♙ blancas abajo, ♟ negras abajo)';
        orientSel.style.cssText='font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);padding:1px 3px;cursor:pointer;flex-shrink:0;margin-right:4px;';
        [['','↔'],['white','♙'],['black','♟']].forEach(([val,txt])=>{
          const opt=document.createElement('option');opt.value=val;opt.textContent=txt;
          if(val===savedOrient)opt.selected=true;orientSel.appendChild(opt);
        });
        const chCb=document.createElement('input');chCb.type='checkbox';chCb.id=`pgn_c_${idx}_ch_${ch.index}`;
        chCb.dataset.value=item.url;chCb.dataset.type='custom';chCb.dataset.role='child';chCb.dataset.chapter=ch.index;
        chCb.checked=isChapterSel(item.url,ch.index);chCb.onchange=handleChange;
        const chLbl=document.createElement('label');chLbl.htmlFor=chCb.id;chLbl.textContent=ch.name;
        chLbl.style.cssText='font-size:13px;color:var(--text-secondary);flex:1;cursor:pointer;';
        row.appendChild(orientSel);row.appendChild(chLbl);row.appendChild(chCb);
        chWrap.appendChild(row);
      });
      li.appendChild(chWrap);
    }
    ul.appendChild(li);
  });

  // Add URL button
  const addLi=document.createElement('li');
  const addBtn=document.createElement('button');addBtn.textContent='➕ Añadir PGN URL';
  addBtn.style.cssText='width:100%;padding:12px;margin-top:4px;font-size:14px;border:1px dashed var(--border);border-radius:8px;background:none;color:var(--accent);cursor:pointer;';
  addBtn.onclick=async()=>{
    const url=prompt('URL del archivo .pgn:');if(!url)return;
    addBtn.textContent='⏳ Leyendo...';addBtn.disabled=true;
    try{const raw=await fetchPgnText(url);const games=parsePGN(raw);const meta=extractPgnMetadata(games);
      const list=JSON.parse(localStorage.getItem(KEYS.CUSTOM_PGNS))||[];
      list.push({name:meta.name,url,chapters:meta.chapters});
      localStorage.setItem(KEYS.CUSTOM_PGNS,JSON.stringify(list));buildPgnSelectionList();toast(`Añadido: ${meta.name}`);
    }catch(e){alert('Error: '+e.message);}
    finally{addBtn.textContent='➕ Añadir PGN URL';addBtn.disabled=false;}
  };
  addLi.appendChild(addBtn);ul.appendChild(addLi);container.appendChild(ul);
}

// ── Saved Variants ─────────────────────────────────────────────────────────
function getSavedVariantsKey(){
  const ls=localStorage.getItem(KEYS.SELECTED_LIST);
  if(ls){const list=JSON.parse(ls);const str=list.map(i=>i.value).sort().join('|');let h=0;for(let i=0;i<str.length;i++)h=((h<<5)-h)+str.charCodeAt(i)|0;return`pgn_savedVariants_multi_${h}`;}
  const p=localStorage.getItem('selected_pgn');return p?`pgn_savedVariants_${p}`:null;
}
function updateSaveButtonState(){
  const btn=$id('saveVariantBtn');if(!pgnData.length){btn.innerHTML='💾';btn.style.opacity=.5;return;}
  btn.style.opacity=1;const saved=savedVariants.includes(currentVar);
  btn.innerHTML=saved?'🗑️':'💾';btn.title=saved?'Quitar variante guardada':'Guardar esta variante';
}
function handleSaveVariant(){
  if(!pgnData.length)return;const saved=savedVariants.includes(currentVar);
  if(saved){if(!confirm('¿Eliminar de guardadas?'))return;savedVariants=savedVariants.filter(v=>v!==currentVar);if(listModeActive&&!savedVariants.length)toggleListMode();toast('Variante eliminada');}
  else{savedVariants.push(currentVar);savedVariants.sort((a,b)=>a-b);toast('Variante guardada ⭐');}
  const key=getSavedVariantsKey();if(key)localStorage.setItem(key,JSON.stringify(savedVariants));
  updateSaveButtonState();buildGameList($id('searchInput')?.value||'');
}
function toggleListMode(){
  if(!savedVariants.length&&!listModeActive){toast('No hay variantes guardadas');return;}
  listModeActive=!listModeActive;$id('listModeBtn').classList.toggle('active',listModeActive);
  toast(listModeActive?'Modo lista ⭐':'Modo lista desactivado');
}

// ── Navigation ─────────────────────────────────────────────────────────────
function getIgnoreMoves(){const v=parseInt(($id('ignoreMoves')||{}).value||'0',10);return isNaN(v)?0:Math.max(0,v);}
function startMove(){return getIgnoreMoves();}
function getTargetMove(oldVar,newVar){
  if($id('skipIdenticalCheck')?.checked&&oldVar!==null&&oldVar!==newVar&&pgnData[oldVar]&&pgnData[newVar]){
    const A=pgnData[oldVar].moves,B=pgnData[newVar].moves;let common=0;
    for(let i=0;i<Math.min(A.length,B.length);i++){if(A[i].san===B[i].san)common++;else break;}
    return Math.max(0,common-1);
  }
  return startMove();
}
function nextGame(){
  const oldVar=currentVar;
  if(listModeActive){if(!savedVariants.length)return;const ci=savedVariants.indexOf(currentVar);currentVar=savedVariants[(ci===-1||ci===savedVariants.length-1)?0:ci+1];}
  else{if(currentVar>=pgnData.length-1)return;currentVar++;}
  currentMove=getTargetMove(oldVar,currentVar);gotoMove();
}
function prevGame(){
  const oldVar=currentVar;
  if(listModeActive){if(!savedVariants.length)return;const ci=savedVariants.indexOf(currentVar);currentVar=savedVariants[ci<=0?savedVariants.length-1:ci-1];}
  else{if(currentVar<=0)return;currentVar--;}
  currentMove=getTargetMove(oldVar,currentVar);gotoMove();
}
function startAutomove(){stopAutomove();const ms=Math.max(100,parseInt($id('automoveMs').value)||2000);automoveTimer=setInterval(()=>{const game=pgnData[currentVar];if(game&&currentMove<game.moves.length){currentMove++;gotoMove();}else nextGame();},ms);}
function stopAutomove(){if(automoveTimer){clearInterval(automoveTimer);automoveTimer=null;}}
function resetBoardToInitialState(){
  chess.reset();board.position(chess.fen());
  $id('movesBox').innerHTML='Seleccione un PGN desde la pestaña 📜 para empezar.';
  $id('commentBox').style.display='none';$id('nagBox').style.display='none';
  $id('pvBox')&&($id('pvBox').innerHTML='');$id('progressBar').style.width='0';
  clearOverlays();updateCapturedPieces(chess,board.orientation());
  updateEvalBar({type:'cp',value:0});updateSaveButtonState();
}

// ── Keyboard & Swipe ───────────────────────────────────────────────────────
function setupKeyboard(){
  document.addEventListener('keydown',e=>{
    if(e.target.matches('input,textarea,select'))return;
    switch(e.key){
      case'ArrowRight':case'd':case'D':
        stopAutomove();if(isFreeBoardActive)return;
        if(pgnData[currentVar]&&currentMove<pgnData[currentVar].moves.length){currentMove++;gotoMove();}else nextGame();break;
      case'ArrowLeft':case'a':case'A':
        stopAutomove();if(isFreeBoardActive){freeBoardUndo();return;}
        if(currentMove>startMove()){currentMove--;gotoMove();}else prevGame();break;
      case'ArrowUp':case'w':case'W':stopAutomove();if(!isFreeBoardActive)prevGame();break;
      case'ArrowDown':case's':case'S':stopAutomove();if(!isFreeBoardActive)nextGame();break;
      case'Home':stopAutomove();if(!isFreeBoardActive){currentMove=startMove();gotoMove();}break;
      case'End':if(!isFreeBoardActive&&pgnData[currentVar]){currentMove=pgnData[currentVar].moves.length;gotoMove();}break;
      case'f':case'F':if(board){board.flip();setTimeout(()=>{const g=pgnData[currentVar];drawOverlays(g&&currentMove>0?g.moves[currentMove-1]:null);updateCapturedPieces(chess,board.orientation());},50);}break;
      case'z':case'Z':if(isFreeBoardActive)freeBoardUndo();break;
      case'Escape':if(studyModeActive)toggleStudyMode();else if(isFreeBoardActive)toggleFreeBoard();break;
    }
  });
}
function setupSwipe(){
  const boardEl=$id('board');if(!boardEl)return;
  let sx=0,sy=0;
  boardEl.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;sy=e.touches[0].clientY;},{passive:true});
  boardEl.addEventListener('touchend',e=>{
    if(!e.changedTouches.length)return;
    const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;
    if(Math.abs(dx)<40||Math.abs(dy)>Math.abs(dx)*1.5)return;
    if(isFreeBoardActive){if(dx>0)freeBoardUndo();return;}
    if(dx<0){if(pgnData[currentVar]&&currentMove<pgnData[currentVar].moves.length){currentMove++;gotoMove();}else nextGame();}
    else{if(currentMove>startMove()){currentMove--;gotoMove();}else prevGame();}
  },{passive:true});
}

// ── Service Worker ─────────────────────────────────────────────────────────
function registerServiceWorker(){
  const isLocal=location.hostname==='localhost'||location.protocol==='file:';
  if('serviceWorker'in navigator&&!isLocal)window.addEventListener('load',()=>navigator.serviceWorker.register('service-worker.js').catch(()=>{}));
}

// ── Event Listeners ────────────────────────────────────────────────────────
function setupEventListeners(){
  $id('nextBtn').onclick=()=>{stopAutomove();if(isFreeBoardActive)return;if(pgnData[currentVar]&&currentMove<pgnData[currentVar].moves.length){currentMove++;gotoMove();}else nextGame();};
  $id('prevBtn').onclick=()=>{stopAutomove();if(isFreeBoardActive){freeBoardUndo();return;}if(currentMove>startMove()){currentMove--;gotoMove();}else prevGame();};
  $id('nextGameBtn').onclick=()=>{stopAutomove();if(!isFreeBoardActive)nextGame();};
  $id('prevGameBtn').onclick=()=>{stopAutomove();if(!isFreeBoardActive)prevGame();};

  $id('movesBox').addEventListener('click',e=>{
    const mi=e.target.dataset.mi;if(mi===undefined)return;
    if(isFreeBoardActive)return;
    currentMove=parseInt(mi)+1;gotoMove();
  });

  $id('gameList').addEventListener('click',e=>{
    const t=e.target.closest('.game-label');if(!t)return;
    stopAutomove();const oldVar=currentVar;currentVar=parseInt(t.dataset.idx,10);
    currentMove=getTargetMove(oldVar,currentVar);gotoMove();switchTab('board');window.scrollTo(0,0);
  });

  $id('tabBar').addEventListener('click',e=>{const n=e.target.dataset.tab;if(n)switchTab(n);});
  $id('saveVariantBtn').addEventListener('click',handleSaveVariant);
  $id('listModeBtn').addEventListener('click',toggleListMode);
  $id('darkModeBtn').addEventListener('click',toggleDarkMode);

  $id('orientationBtn').addEventListener('click',()=>{
    if(!board)return;board.flip();
    setTimeout(()=>{const g=pgnData[currentVar];drawOverlays(g&&currentMove>0?g.moves[currentMove-1]:null);updateCapturedPieces(chess,board.orientation());},50);
  });

  // Free board toggle button (always visible in top bar)
  $id('freeBoardBtn')?.addEventListener('click',toggleFreeBoard);

  $id('menuBtn').addEventListener('click',e=>{e.stopPropagation();const m=$id('topMenu');m.style.display=m.style.display==='block'?'none':'block';});
  document.addEventListener('click',()=>{const m=$id('topMenu');if(m)m.style.display='none';});

  $id('menuLichess').onclick=()=>window.open(pgnData[currentVar]?'https://lichess.org/analysis/pgn/'+encodeURIComponent(gameToString(pgnData[currentVar]))+'#'+currentMove:'https://lichess.org/analysis/'+chess.fen().replace(/ /g,'_'),'_blank');
  $id('menuCopyFen').onclick=()=>navigator.clipboard?.writeText(chess.fen()).then(()=>toast('FEN copiado'));
  $id('menuCopyPgn').onclick=()=>{if(!pgnData[currentVar])return;navigator.clipboard?.writeText(gameToString(pgnData[currentVar])).then(()=>toast('PGN copiado'));};
  $id('menuStudyMode').onclick=()=>{ $id('topMenu').style.display='none'; toggleStudyMode(); };
  $id('menuGameList').onclick=()=>switchTab('games');

  $id('searchInput').addEventListener('input',e=>buildGameList(e.target.value));

  // Config booleans
  const loadBool=(id,key,def=true)=>{
    const el=$id(id);if(!el)return;
    const saved=localStorage.getItem(key);el.checked=saved===null?def:(saved==='1'||saved==='true');
    el.addEventListener('change',function(){
      localStorage.setItem(key,this.checked?'1':'0');
      if(id==='mainLineFirstCheck'||id==='randomOrderCheck'){applyGameSorting();currentVar=0;currentMove=startMove();gotoMove();}
      if(id==='fullScreenCheck')document.body.classList.toggle('full-screen-mode',this.checked);
      if(id==='automoveCheck'){this.checked?startAutomove():stopAutomove();}
      if(id==='skipIdenticalCheck'){const im=$id('ignoreMoves');im.disabled=this.checked;im.style.opacity=this.checked?.5:1;}
      if(id==='spanishNotationCheck'){updateMovesBox();buildGameList($id('searchInput')?.value||'');}
      if(id==='engineCheck'){if(this.checked)startAnalysis();else{stockfish?.postMessage('stop');if($id('pvBox'))$id('pvBox').innerHTML='';}}
    });
  };
  loadBool('mainLineFirstCheck',KEYS.MAIN_LINE_FIRST,true);
  loadBool('randomOrderCheck',KEYS.RANDOM_ORDER,false);
  loadBool('skipIdenticalCheck',KEYS.SKIP_IDENTICAL,false);
  loadBool('fullScreenCheck',KEYS.FULL_SCREEN,false);
  loadBool('automoveCheck','pgn_automove',false);
  loadBool('engineCheck',KEYS.ENGINE_ON,true);
  loadBool('spanishNotationCheck',KEYS.SPANISH,true);
  if(localStorage.getItem(KEYS.FULL_SCREEN)==='1')document.body.classList.add('full-screen-mode');

  const imEl=$id('ignoreMoves');imEl.value=localStorage.getItem(KEYS.IGNORE_MOVES)||'0';
  imEl.addEventListener('change',()=>localStorage.setItem(KEYS.IGNORE_MOVES,imEl.value));
  if($id('skipIdenticalCheck')?.checked){imEl.disabled=true;imEl.style.opacity=.5;}

  const amMs=$id('automoveMs');amMs.value=localStorage.getItem(KEYS.AUTOMOVE_MS)||'2000';
  amMs.addEventListener('change',()=>localStorage.setItem(KEYS.AUTOMOVE_MS,amMs.value));

  const pvLinesEl=$id('pvLines');
  if(pvLinesEl){pvLinesEl.value=localStorage.getItem(KEYS.PV_LINES)||'1';pvLinesEl.addEventListener('change',()=>{localStorage.setItem(KEYS.PV_LINES,pvLinesEl.value);startAnalysis();});}
}

// ── Init ───────────────────────────────────────────────────────────────────
window.onload=async function(){
  applyDarkMode(localStorage.getItem(KEYS.DARK_MODE)==='1');
  if(localStorage.getItem(KEYS.FULL_SCREEN)==='1')document.body.classList.add('full-screen-mode');
  chess=new Chess();
  board=Chessboard('board',{draggable:true,position:'start',onDragStart,onDrop,onSnapEnd,
    pieceTheme:'https://raw.githubusercontent.com/oakmac/chessboardjs/master/website/img/chesspieces/wikipedia/{piece}.png'});
  const boardEl=$id('board');if(boardEl)boardEl.style.touchAction='none';
  initArrowMarkers();initStockfish();setupEventListeners();setupKeyboard();setupSwipe();registerServiceWorker();
  if(window.ResizeObserver)new ResizeObserver(()=>board?.resize()).observe($id('boardContainer'));
  const initKey=getSavedVariantsKey();savedVariants=initKey?(JSON.parse(localStorage.getItem(initKey))||[]):[];
  buildPgnSelectionList();
  const sl=localStorage.getItem(KEYS.SELECTED_LIST);
  if(sl){try{const list=JSON.parse(sl);if(list?.length){await loadMultiplePgns(list,true);return;}}catch(e){}}
  const lp=localStorage.getItem('selected_pgn'),lc=localStorage.getItem('selected_pgn_is_custom')==='true';
  if(lp&&(lc||Object.values(PGN_SOURCES).includes(lp))){const name=lc?lp:(Object.entries(PGN_SOURCES).find(([,v])=>v===lp)?.[0]||lp);await loadMultiplePgns([{value:lp,type:lc?'custom':'static',name}],true);return;}
  resetBoardToInitialState();switchTab('board');
};
