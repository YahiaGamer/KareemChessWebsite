/***********************
 * Chess Puzzle Trainer
 * index.js — fixed board aspect + clean init
 ***********************/

/* ====== State ====== */
let puzzles = [];
let currentPuzzleIndex = 0;
let game = null;
let board = null;
let promotionMove = null;
let activeLines = [];   // الخطوط المحتملة (بعد التصفية)
let lineStep    = 0;    // مؤشر الخطوة داخل الخط

function orientationFromFEN(fen){
  try { return (fen.split(' ')[1] === 'b') ? 'black' : 'white'; }
  catch { return 'white'; }
}

/* ====== Keys ====== */
const PUZZLES_KEY = 'puzzlesV1';
const STATS_KEY   = 'statsV1';
const PLAYERS_KEY = 'playersV1';

/* ====== Sounds (safe) ====== */
function safeAudio(src){ try{ return new Audio(src); }catch(e){ return {play(){}, currentTime:0}; } }
const moveSound    = safeAudio('sounds/move.mp3');
const captureSound = safeAudio('sounds/capture.mp3');
const successSound = safeAudio('sounds/correct.mp3');
const wrongSound   = safeAudio('sounds/wrong.mp3');
var alldoneSound = safeAudio('sounds/alldone.mp3');

/* ====== Helpers: Storage ====== */
function loadPuzzlesFromStorage(){ try{ const s = localStorage.getItem(PUZZLES_KEY); return s? JSON.parse(s):null; }catch(e){ return null; } }
function savePuzzlesToStorage(list){ localStorage.setItem(PUZZLES_KEY, JSON.stringify(list)); }
function _readAllStats(){ try{ return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; }catch(e){ return {}; } }
function _writeAllStats(obj){ localStorage.setItem(STATS_KEY, JSON.stringify(obj)); }

/* ====== Players ====== */
function loadPlayers(){ try{ const s = localStorage.getItem(PLAYERS_KEY); return s? JSON.parse(s):null; }catch(e){ return null; } }
function savePlayers(list){ localStorage.setItem(PLAYERS_KEY, JSON.stringify(list)); }

let players = loadPlayers();
if(!players || !players.length){ players = ['Kareem']; savePlayers(players); }
function renderPlayersDropdown(){
  const sel = document.getElementById('playerSelect');
  if(!sel) return;
  sel.innerHTML = players.map(n=>`<option value="${n}">${n}</option>`).join('');
}
function getPlayer(){ const sel = document.getElementById('playerSelect'); return (sel?.value || 'Kareem'); }
function addPlayer(){
  const name = (document.getElementById('newPlayerName').value || '').trim();
  if(!name) return;
  if(!players.includes(name)){ players.push(name); savePlayers(players); renderPlayersDropdown(); }
  document.getElementById('playerSelect').value = name;
  document.getElementById('newPlayerName').value = '';
}
function resetCurrentPlayerStats(){
  const player = getPlayer(); const all = _readAllStats();
  if(all[player]){
    if(!confirm(`هل تريد مسح إحصائيات اللاعب ${player}؟`)) return;
    delete all[player]; _writeAllStats(all); alert('تمت إعادة ضبط الإحصائيات لهذا اللاعب.');
  }
}
renderPlayersDropdown();

/* ====== Upload JSON ====== */
const uploadEl = document.getElementById('uploadJson');
if (uploadEl){
  uploadEl.addEventListener('change', (ev)=>{
    const f = ev.target.files[0]; if(!f) return;
    const reader = new FileReader();
    reader.onload = (e)=>{
      try{
        const list = validateAndNormalizePuzzles(e.target.result || '');
        applyUploadedPuzzles(list);
      }catch(err){ console.error(err); alert(`❌ الملف مش صالح JSON:\n${err.message}`); }
    };
    reader.readAsText(f, 'UTF-8');
  });
}

function validateAndNormalizePuzzles(text){
  if (!text) throw new Error('ملف فاضي');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  let data;
  try{ data = JSON.parse(text.trim()); }
  catch(e){ throw new Error(`SyntaxError في JSON (${e.message})`); }
  if(!Array.isArray(data)) throw new Error('الملف لازم يكون Array من العناصر [{id, fen, solution}].');

  const out = [];
  for (let i=0;i<data.length;i++){
    const it = data[i];
    if(!it || typeof it!=='object') throw new Error(`العنصر #${i+1} مش Object.`);
    if(typeof it.fen!=='string' || !it.fen.trim()) throw new Error(`العنصر #${i+1}: fen مفقود.`);
    let sol = it.solution;
    if(typeof sol==='string') sol = [sol];
    if(!Array.isArray(sol) || !sol.length) throw new Error(`العنصر #${i+1}: solution لازم Array/String.`);
    sol = sol.map(s=>String(s).trim()).filter(Boolean);
    if(!sol.length) throw new Error(`العنصر #${i+1}: solution فاضي بعد التنظيف.`);
    out.push({ id: it.id ?? (out.length+1), fen: it.fen.trim(), solution: sol });
  }
  return out;
}

function applyUploadedPuzzles(list){
  puzzles = list; savePuzzlesToStorage(puzzles); loadPuzzle(0);
}

/* ====== Init from storage ====== */
/* ====== Init from storage or JSON file ====== */
(async function init(){
  const stored = loadPuzzlesFromStorage();
  if(stored && stored.length){
    puzzles = stored;
    loadPuzzle(0);
  } else {
    try {
      const res = await fetch('puzzles.json');   // ← الملف المحلي
      if (!res.ok) throw new Error('فشل تحميل puzzles.json');
      const list = await res.json();
      puzzles = list;
      savePuzzlesToStorage(puzzles); // optional: يخزنها عشان تفضل موجودة
      loadPuzzle(0);
    } catch (err) {
      console.error(err);
      document.getElementById('status').innerText = 'فشل تحميل puzzles.json';
    }
  }
})();


/* ====== Chess.js ctor ====== */
function getChessCtor(){ return window.Chess || (window.chess && window.chess.Chess) || null; }

/* ====== Keep board square (THE FIX) ====== */
function ensureSquare(){
  const el = document.getElementById('myBoard'); if(!el) return;
  // اجعل ارتفاع البورد مساوي لعرضه
  const w = el.clientWidth || el.offsetWidth || 600;
  el.style.height = w + 'px';
  if (board && typeof board.resize === 'function') board.resize();
}
window.addEventListener('load', ensureSquare);
window.addEventListener('resize', ensureSquare);

/* ====== Load puzzle & board ====== */
function loadPuzzle(index){
  if(!puzzles.length) return;
  currentPuzzleIndex = index;
  const fen = puzzles[index].fen;

  const ChessCtor = getChessCtor();
  if(!ChessCtor){ alert('chess.js لم يتم تحميله.'); throw new Error('Chess ctor missing'); }

  game = new ChessCtor(fen);

  // بعد إنشاء البورد وتعيين الوضع:
const current = puzzles[currentPuzzleIndex];
if (Array.isArray(current.lines) && current.lines.length) {
  // انسخ الخطوط (OR بين الخطوط)
  activeLines = current.lines.map(line => line.slice());
  lineStep = 0;
} else {
  activeLines = [];
  lineStep = 0;
}

  var config = {
    draggable: true,
    pieceTheme: 'img/chesspieces/staunty/{piece}.png',
    position: fen,
    orientation: orientationFromFEN(fen), // ← المنظور يتحدد من الـFEN
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd
  };

  board = Chessboard('myBoard', config);
  ensureSquare();            // ← يضمن المربعية فورًا
  updateStatus();
}

/* ====== Drag & drop / Promotion ====== */
function onDragStart(source, piece){
  if (game.game_over()) return false;
  if ((game.turn()==='w' && piece.startsWith('b')) || (game.turn()==='b' && piece.startsWith('w'))) return false;
}

function setPromotionImages(color){ // 'w' or 'b'
  const base = 'img/chesspieces/staunty/';
  document.getElementById('promoQ').src = base + (color==='w'?'wQ.png':'bQ.png');
  document.getElementById('promoR').src = base + (color==='w'?'wR.png':'bR.png');
  document.getElementById('promoB').src = base + (color==='w'?'wB.png':'bB.png');
  document.getElementById('promoN').src = base + (color==='w'?'wN.png':'bN.png');
}

function onDrop(source, target){
  const mv = game.move({ from: source, to: target, promotion: 'q' });
  if (mv === null) return 'snapback';

  // ترقية؟
  if (mv.flags.includes('p')) {
    game.undo();
    promotionMove = { from: source, to: target, color: mv.color };
    setPromotionImages(mv.color);
    document.getElementById('promotionDialog').style.display = 'block';
    return;
  }
  handleMove(mv);
}

function promote(piece){
  const mv = game.move({ from: promotionMove.from, to: promotionMove.to, promotion: piece });
  promotionMove = null;
  document.getElementById('promotionDialog').style.display = 'none';
  if (mv){ handleMove(mv); board.position(game.fen(), true); }
}

function handleMove(move){
  // أصوات الحركة/الأخذ
  if (move.captured) { captureSound.currentTime=0; captureSound.play(); }
  else { moveSound.currentTime=0; moveSound.play(); }

  const current = puzzles[currentPuzzleIndex];
  const hasLines = Array.isArray(current?.lines) && current.lines.length;

  // ===== وضع "الخطوط" (نقلة عليه رد، وأكتر من خط ممكن) =====
  if (hasLines) {
    // صفّي الخطوط على اللي يتطابق مع النقلة الحالية في الموضع lineStep
    const nextVariants = activeLines.filter(line => line[lineStep] === move.san);

    if (!nextVariants.length) {
      // نقلة غير صحيحة بالنسبة لكل الخطوط
      wrongSound.currentTime=0; wrongSound.play();
      game.undo();
      board.position(game.fen(), true);
      updateStatus();
      return;
    }

    // نقلة اللاعب صحيحة → ثبّت الخطوط المحتملة
    activeLines = nextVariants;
    lineStep++; // تقدمنا خطوة

    // لو أي خط انتهى بالظبط عند هذه النقلة → حل البازل
    const solvedNow = activeLines.some(line => lineStep >= line.length);
    if (solvedNow) {
      markAttempt(current.id, true);
      successSound.currentTime=0; successSound.play();
      setTimeout(()=>{
        if (currentPuzzleIndex + 1 < puzzles.length) loadPuzzle(currentPuzzleIndex + 1);
        else { finishSound?.play?.(); alert('🎉 خلصت كل البازلز!'); }
      }, 800);
      return;
    }

    // ردّ الخصم التلقائي: العب النقلة التالية من أول خط (كل الخطوط الحالية متطابقة في هذه النقطة عادةً)
    // ملاحظة: نفترض الترتيب Player, Opponent, Player ... بما إن الدور في الـ FEN هو دور اللاعب
    const replySAN = activeLines[0][lineStep];
    const reply = game.move(replySAN);
    if (!reply) {
      console.warn('Reply SAN not legal for this position:', replySAN);
      // لو حصل تعارض، نرجّع خطوة ونعتبره خطأ
      wrongSound.currentTime=0; wrongSound.play();
      game.undo(); // Undo محاولة الرد الفاشلة (لو اتعملت)
      game.undo(); // Undo نقلة اللاعب
      board.position(game.fen(), true);
      updateStatus();
      return;
    }
    board.position(game.fen(), true);
    lineStep++; // تقدّمنا بنقلة الخصم

    // بعد الرد، لو أي خط خلّص → حل
    const solvedAfterReply = activeLines.some(line => lineStep >= line.length);
    if (solvedAfterReply) {
      markAttempt(current.id, true);
      successSound.currentTime=0; successSound.play();
      setTimeout(()=>{
        if (currentPuzzleIndex + 1 < puzzles.length) loadPuzzle(currentPuzzleIndex + 1);
        else { alldoneSound?.play?.(); alert('🎉 خلصت كل البازلز!'); }
      }, 800);
      return;
    }

    updateStatus();
    return;
  }

  // ===== الوضع القديم (نقلة واحدة، مع قبول أكتر من إجابة في solution) =====
  const solution = current?.solution || [];
  if (solution.includes(move.san)) {
    markAttempt(current.id, true);
    successSound.currentTime=0; successSound.play();
    setTimeout(()=>{
      if (currentPuzzleIndex + 1 < puzzles.length) loadPuzzle(currentPuzzleIndex + 1);
      else { finishSound?.play?.(); alert('🎉 خلصت كل البازلز!'); }
    }, 800);
  } else if (solution.length){
    markAttempt(current.id, false);
    wrongSound.currentTime=0; wrongSound.play();
    game.undo();
    board.position(game.fen(), true);
  }

  updateStatus();
}

function onSnapEnd(){ board.position(game.fen(), true);
; }

/* ====== Status ====== */
function updateStatus(){
  if(!game) return;
  let moveColor = game.turn() === 'b' ? 'Black' : 'White';
  let status = `Puzzle #${puzzles[currentPuzzleIndex].id} | ${moveColor} to move`;
  if (game.in_checkmate()) status = 'Game over, ' + moveColor + ' is in checkmate.';
  else if (game.in_draw()) status = 'Game over, drawn position';
  else if (game.in_check()) status += ', ' + moveColor + ' is in check';

  $('#status').html(status);
  $('#fen').html(game.fen());
  $('#pgn').html(game.pgn());
}

/* ====== Navigation ====== */
function nextPuzzle(){ if (currentPuzzleIndex + 1 < puzzles.length) loadPuzzle(currentPuzzleIndex + 1); else alert('🚀 آخر بازل وصلت له!'); }
function prevPuzzle(){ if (currentPuzzleIndex > 0) loadPuzzle(currentPuzzleIndex - 1); else alert('📌 إنت في أول بازل!'); }
window.nextPuzzle = nextPuzzle;
window.prevPuzzle = prevPuzzle;

/* ====== Stats ====== */
function markAttempt(puzzleId, correct){
  const player = getPlayer();
  const all = _readAllStats();
  if(!all[player]) all[player] = { overall:{attempts:0,correct:0,wrong:0}, puzzles:{} };
  const o = all[player];
  o.overall.attempts++; correct ? o.overall.correct++ : o.overall.wrong++;
  if(!o.puzzles[puzzleId]) o.puzzles[puzzleId] = { attempts:0,correct:0,wrong:0 };
  const p = o.puzzles[puzzleId];
  p.attempts++; correct ? p.correct++ : p.wrong++;
  _writeAllStats(all);
}

/* ====== Manager ====== */
function openManager(){ renderManagerList(); document.getElementById('managerModal').style.display='flex'; }
function closeManager(){ document.getElementById('managerModal').style.display='none'; }
function renderManagerList(){
  const box = document.getElementById('managerList'); if(!box) return;
  if(!puzzles || !puzzles.length){ box.innerHTML = `<p>لا توجد بازلز بعد.</p>`; return; }
  box.innerHTML = puzzles.map(p=>`
    <div class="row">
      <div style="width:60px"><b>#${p.id}</b></div>
      <div style="flex:1"><code>${p.fen}</code></div>
      <div style="width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        حل: <code>${(p.solution||[]).join(', ')}</code>
      </div>
      <button onclick="managerLoadToForm(${p.id})">تعديل</button>
      <button onclick="managerDelete(${p.id})">حذف</button>
    </div>
  `).join('');
}
function managerLoadToForm(id){
  const p = puzzles.find(x=>x.id===id); if(!p) return;
  document.getElementById('m_id').value = p.id;
  document.getElementById('m_fen').value = p.fen;
  document.getElementById('m_solution').value = (p.solution||[]).join(',');
}
function managerAdd(){
  const fen = document.getElementById('m_fen').value.trim();
  const sol = document.getElementById('m_solution').value.trim();
  if(!fen || !sol) return alert('اكتب FEN والحل');
  const id = (puzzles.length? Math.max(...puzzles.map(p=>p.id||0)) : 0) + 1;
  puzzles.push({ id, fen, solution: sol.split(',').map(s=>s.trim()).filter(Boolean) });
  savePuzzlesToStorage(puzzles); renderManagerList();
  if(puzzles.length===1) loadPuzzle(0);
  alert('تمت الإضافة');
}
function managerUpdate(){
  const id = parseInt(document.getElementById('m_id').value,10);
  const fen = document.getElementById('m_fen').value.trim();
  const sol = document.getElementById('m_solution').value.trim();
  if(!id || !fen || !sol) return alert('اكتب ID و FEN والحل');
  const idx = puzzles.findIndex(p=>p.id===id);
  if(idx<0) return alert('ID غير موجود');
  puzzles[idx].fen = fen;
  puzzles[idx].solution = sol.split(',').map(s=>s.trim()).filter(Boolean);
  savePuzzlesToStorage(puzzles); renderManagerList();
  if (puzzles[currentPuzzleIndex]?.id === id) loadPuzzle(currentPuzzleIndex);
  alert('تم الحفظ');
}
function managerDelete(id){
  if(!confirm('حذف هذا البازل؟')) return;
  puzzles = puzzles.filter(p=>p.id!==id);
  savePuzzlesToStorage(puzzles); renderManagerList();
  if(!puzzles.length){ $('#status').text('لا توجد بازلز'); return; }
  if(currentPuzzleIndex >= puzzles.length) currentPuzzleIndex = Math.max(0, puzzles.length-1);
  loadPuzzle(currentPuzzleIndex);
}
function exportPuzzles(){
  const blob = new Blob([JSON.stringify(puzzles,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'puzzles.json'; a.click();
  URL.revokeObjectURL(a.href);
}

/* ====== Stats Modal ====== */
function openStats(){ renderStats(); document.getElementById('statsModal').style.display='flex'; }
function closeStats(){ document.getElementById('statsModal').style.display='none'; }
function renderStats(){
  const player = getPlayer();
  const all = _readAllStats();
  const s = all[player]; const el = document.getElementById('statsContent');
  if(!s){ el.innerHTML = `<p>لا توجد بيانات للاعب <b>${player}</b> بعد.</p>`; return; }
  const rows = (puzzles||[]).map(p=>{
    const ps = s.puzzles[p.id] || {attempts:0,correct:0,wrong:0};
    return `<tr>
      <td>#${p.id}</td>
      <td>${p.fen}</td>
      <td style="text-align:center">${ps.attempts}</td>
      <td style="color:#2ecc71;text-align:center">${ps.correct}</td>
      <td style="color:#e74c3c;text-align:center">${ps.wrong}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `
    <div style="margin-bottom:10px">
      اللاعب: <b>${player}</b> — إجمالي المحاولات: <b>${s.overall.attempts}</b> |
      الصح: <b style="color:#2ecc71">${s.overall.correct}</b> |
      الغلط: <b style="color:#e74c3c">${s.overall.wrong}</b>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#30304a">
          <th style="text-align:left;padding:6px">Puzzle</th>
          <th style="text-align:left;padding:6px">FEN</th>
          <th style="padding:6px">Attempts</th>
          <th style="padding:6px">Correct</th>
          <th style="padding:6px">Wrong</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/* ====== expose needed fns for buttons ====== */
window.addPlayer = addPlayer;
window.resetCurrentPlayerStats = resetCurrentPlayerStats;
window.openManager = openManager;
window.closeManager = closeManager;
window.managerAdd = managerAdd;
window.managerLoadToForm = managerLoadToForm;
window.managerUpdate = managerUpdate;
window.managerDelete = managerDelete;
window.exportPuzzles = exportPuzzles;
window.openStats = openStats;
window.closeStats = closeStats;
window.promote = promote;
