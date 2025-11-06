const socket = io();
const $ = sel => document.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const screenLobby = $('#screen-lobby');
const screenGame = $('#screen-game');
const createBtn = $('#createBtn');
const joinBtn   = $('#joinBtn');
const startBtn  = $('#startBtn');
const roomInfo  = $('#roomInfo');
const roomCodeEl= $('#roomCode');
const playersList = $('#playersList');
const deckCount = $('#deckCount');
const boards = $('#boards');
const handDiv = $('#hand');
const turnInfo = $('#turnInfo');
const badgeCode = $('#badgeCode');
const discardDiv = $('#discard');
const toastEl = $('#toast');
const logEl = $('#log');
const discardSel = $('#discardSel');
const fullBtn = $('#fullscreenBtn');
const rotateHint = $('#rotateHint');

let myId = null;
let lobby = null;
let state = null;
let myHand = [];
let selected = { handIndex:null, action:null };

createBtn.onclick = ()=>{
  const name = $('#hostName').value || 'Jugador';
  const color = $('#hostColor').value || '#22c55e';
  socket.emit('createRoom', {name, color});
};
joinBtn.onclick = ()=>{
  const code = ($('#joinCode').value||'').toUpperCase();
  const name = $('#joinName').value || 'Jugador';
  const color = $('#joinColor').value || '#0ea5e9';
  socket.emit('joinRoom', {code, name, color});
};
startBtn.onclick = ()=> socket.emit('startGame');

socket.on('connect', ()=>{ myId = socket.id; });
socket.on('errorMsg', m => toast(m));
socket.on('lobby', data => {
  lobby = data;
  roomInfo.classList.remove('hidden');
  roomCodeEl.textContent = data.code;
  playersList.innerHTML = '';
  data.players.forEach(p=>{
    const chip = document.createElement('div');
    chip.className='player-chip';
    chip.textContent = p.name + (p.id===data.hostId ? ' (anfitrión)' : '');
    playersList.appendChild(chip);
  });
  startBtn.style.display = (data.hostId===myId && !data.started) ? 'inline-block' : 'none';
  badgeCode.textContent = `Sala ${data.code}`;
  showScreen('lobby');
});
socket.on('gameStarted', ()=>{
  showScreen('game');
  logEl.innerHTML='';
  toast('¡La partida comenzó!');
  socket.emit('requestState');
});
socket.on('state', snap => {
  state = snap;
  deckCount.textContent = snap.deckCount;
  turnInfo.textContent = `Turno: ${snap.players[snap.turn]?.name || '—'}`;
  badgeCode.textContent = `Sala ${snap.code}`;
  renderBoards();
  renderDiscard();
});
socket.on('yourHand', hand => { myHand = hand; renderHand(); });
socket.on('gameOver', ({winnerIndex, winnerName})=>{
  toast(`Ganó ${winnerName} 🎉`);
  setTimeout(()=>showScreen('lobby'), 2000);
});

function showScreen(id){
  screenLobby.classList.toggle('shown', id==='lobby');
  screenGame.classList.toggle('shown', id==='game');
  if(id==='game'){ socket.emit('requestState'); }
}

function renderBoards(){
  boards.innerHTML = '';
  state.players.forEach((pl, idx)=>{
    const bd = document.createElement('div'); bd.className='board';
    const title = document.createElement('h4'); title.innerHTML = `<span>${pl.name}</span><small>${idx===state.turn?' • jugando':''}</small>`;
    const grid = document.createElement('div'); grid.className='slots';
    for(let s=0;s<4;s++){
      const slot = document.createElement('div'); slot.className='slot';
      const content = pl.body[s];
      if(content && content.organ){
        const card = renderFace(faceForOrgan(content.organ));
        slot.appendChild(card);
        const b = document.createElement('div'); b.className='badge';
        const o = content.organ;
        if(o.immune) { b.textContent='Inmunizado'; slot.classList.add('healthy'); }
        else if(o.infected>0) { b.textContent=`Infectado x${o.infected}`; slot.classList.add('infected'); }
        else if(o.vaccines>0) { b.textContent=`Vacunado x${o.vaccines}`; slot.classList.add('healthy'); }
        else { b.textContent='Sano'; slot.classList.add('healthy'); }
        slot.appendChild(b);
        slot.onclick = ()=>onTargetClick({playerIndex: idx, slotIndex: s});
      } else {
        slot.textContent = 'Vacío';
        slot.onclick = ()=>onTargetClick({playerIndex: idx, slotIndex: s});
      }
      grid.appendChild(slot);
    }
    bd.appendChild(title); bd.appendChild(grid);
    boards.appendChild(bd);
  });
}

function renderDiscard(){
  discardDiv.innerHTML='';
  const top = state.discardTop;
  if(!top) return;
  const card = renderFace(top);
  discardDiv.appendChild(card);
}

function renderHand(){
  handDiv.innerHTML='';
  myHand.forEach((c, i)=>{
    const face = renderFace(c);
    face.classList.toggle('selecting', selected.handIndex===i);
    face.onclick = ()=>{
      if(selected.handIndex===i){ selected.handIndex=null; return renderHand(); }
      selected.handIndex = i;
      renderHand();
      toast('Selecciona un objetivo en un tablero…');
    };
    handDiv.appendChild(face);
  });
}

discardSel.onclick = ()=>{
  let picks = [];
  const nodes = Array.from(handDiv.children);
  nodes.forEach((node, idx)=>{
    node.onclick = ()=>{
      if(picks.includes(idx)) { picks = picks.filter(x=>x!==idx); node.classList.remove('selecting'); }
      else if(picks.length<3) { picks.push(idx); node.classList.add('selecting'); }
      if(picks.length>0){
        toast(`Descartar ${picks.length} carta(s). Toca de nuevo el botón para confirmar.`);
        discardSel.onclick = ()=>{
          socket.emit('discardCards', {indices: picks});
          picks = [];
          discardSel.onclick = ()=>{};
        };
      }
    };
  });
  toast('Toca 1–3 cartas para descartar, luego vuelve a tocar el botón');
};

function onTargetClick(target){
  if(selected.handIndex==null){ toast('Primero elige una carta de tu mano'); return; }
  const handIndex = selected.handIndex;
  const card = myHand[handIndex];
  if(card.type==='treatment' && card.name==='Trasplante'){
    if(!selected.action){ selected.action = {name:'Trasplante', from: target}; toast('Selecciona el segundo órgano para intercambiar'); return; }
    else {
      const payload = { fromPlayer: selected.action.from.playerIndex, fromSlot: selected.action.from.slotIndex, toPlayer: target.playerIndex, toSlot: target.slotIndex };
      socket.emit('playCard', {handIndex, target: payload});
      selected = { handIndex:null, action:null };
      return;
    }
  }
  if(card.type==='treatment' && card.name==='Ladrón de órganos'){
    if(!selected.action){ selected.action = {name:'Ladrón', from: target}; toast('Selecciona tu espacio vacío para colocarlo'); return; }
    else {
      const payload = { fromPlayer: selected.action.from.playerIndex, fromSlot: selected.action.from.slotIndex, toSlot: target.slotIndex };
      socket.emit('playCard', {handIndex, target: payload});
      selected = { handIndex:null, action:null };
      return;
    }
  }
  if(card.type==='treatment' && card.name==='Error médico'){
    const payload = { playerIndex: target.playerIndex };
    socket.emit('playCard', {handIndex, target: payload});
    selected = { handIndex:null, action:null };
    return;
  }
  socket.emit('playCard', { handIndex, target });
  selected = { handIndex:null, action:null };
}

// 🔄 Cada carta tiene su propia imagen personalizada
function renderFace(c) {
  const el = document.createElement('div');
  el.classList.add('card','face',c.type);

  function normTreat(name){
    return (name||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/\\s+/g,'_');
  }

  // 🩺 Órganos
  if (c.type === 'organ') {
    const color = (c.color).toLowerCase();
    if (color === 'red') src = "images/organos/peligrosos.jpeg";
    else if (color === 'green') src = "images/organos/aprovechables.jpeg";
    else if (color === 'blue') src = "images/organos/organicos.jpeg";
    else if (color === 'yellow') src = "images/organos/no_aprovechables.jpeg";
  }

  // 🦠 Virus
  else if (c.type === 'virus') {
    const color = (c.color).toLowerCase();
    if (color === 'red') src = "images/virus/peligrosos.jpeg";
    else if (color === 'green') src = "images/virus/aprovechables.jpeg";
    else if (color === 'blue') src = "images/virus/organicos.jpeg";
    else if (color === 'yellow') src = "images/virus/no_aprovechables.jpeg";
  }

  // 💊 Medicinas
  else if (c.type === 'medicine') {
    const color = (c.color).toLowerCase();
    if (color === 'red') src = "images/medicinas/peligrosos.jpeg";
    else if (color === 'green') src = "images/medicinas/aprovechables.jpeg";
    else if (color === 'blue') src = "images/medicinas/organicos.jpeg";
    else if (color === 'yellow') src = "images/medicinas/no_aprovechables.jpeg";
  }

  // ⚗️ Tratamientos
  else if (c.type === 'treatment') {
    const key = normTreat(c.name);
    if (key.includes('trasplante')) src = "images/tratamientos/trasplante.jpeg";
    else if (key.includes('ladron')) src = "images/tratamientos/ladron.jpeg";
    else if (key.includes('contagio')) src = "images/tratamientos/contagio.jpeg";
    else if (key.includes('guante')) src = "images/tratamientos/guante.jpeg";
    else if (key.includes('error')) src = "images/tratamientos/error_medico.jpeg";
  }

  const img = document.createElement('img');
  img.src = src;
  img.alt = c.name || c.type;
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'contain';
  img.style.borderRadius = '10px';
  el.appendChild(img);

  return el;
}

function faceForOrgan(o){
  const nameMap = {red:'Corazón', green:'Estómago', blue:'Cerebro', yellow:'Hueso'};
  return {type:'organ', color:o.color, name:nameMap[o.color]||'Órgano'};
}

function toast(t){ toastEl.textContent = t; toastEl.classList.add('show'); setTimeout(()=>toastEl.classList.remove('show'), 1400); }

// Pantalla completa y orientación
fullBtn.onclick = async () => {
  const el = document.documentElement;
  try{
    if (!document.fullscreenElement) {
      await el.requestFullscreen();
      fullBtn.textContent = "🡑 Salir";
      if (screen.orientation && screen.orientation.lock) {
        try { await screen.orientation.lock('landscape'); } catch(e){ }
      }
    } else {
      await document.exitFullscreen();
      fullBtn.textContent = "⛶ Pantalla completa";
    }
  }catch(e){ toast('No se pudo activar pantalla completa'); }
};

function checkOrientation(){
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  rotateHint.classList.toggle('hidden', !portrait);
}
window.addEventListener('orientationchange', checkOrientation);
window.addEventListener('resize', checkOrientation);
checkOrientation();
