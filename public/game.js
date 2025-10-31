// Client for Virus LAN with rooms
const socket = io();

// UI refs
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

let myId = null;
let lobby = null; // {code, hostId, players, started}
let state = null; // server snapshot
let myHand = [];  // personal hand array
let selected = { handIndex:null, action:null }; // action needs target

// Join events
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
  $('#roomInfo').classList.remove('hidden');
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

socket.on('yourHand', hand => {
  myHand = hand;
  renderHand();
});

socket.on('gameOver', ({winnerIndex, winnerName})=>{
  toast(`Ganó ${winnerName} 🎉`);
  // Return to lobby screen after short delay
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
        // badge state
        const b = document.createElement('div'); b.className='badge';
        const o = content.organ;
        if(o.immune) { b.textContent='Inmunizado'; slot.classList.add('healthy'); }
        else if(o.infected>0) { b.textContent=`Infectado x${o.infected}`; slot.classList.add('infected'); }
        else if(o.vaccines>0) { b.textContent=`Vacunado x${o.vaccines}`; slot.classList.add('healthy'); }
        else { b.textContent='Sano'; slot.classList.add('healthy'); }
        slot.appendChild(b);
        // allow as target
        slot.onclick = ()=>onTargetClick({playerIndex: idx, slotIndex: s});
      } else {
        slot.textContent = 'Vacío';
        // still clickable for organ placement or steal target
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
  // simple UI: click up to 3 cards to mark, then discard
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
          discardSel.onclick = ()=>{}; // reset, will reattach later
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
  // For treatments requiring more params, we could open a small UI; keep single target for now
  if(card.type==='treatment' && card.name==='Trasplante'){
    // we need two organs to swap: pick first (from) then second (to)
    // quick 2-step: store in selected.action
    if(!selected.action){ selected.action = {name:'Trasplante', from: target}; toast('Selecciona el segundo órgano para intercambiar'); return; }
    else {
      const payload = { fromPlayer: selected.action.from.playerIndex, fromSlot: selected.action.from.slotIndex, toPlayer: target.playerIndex, toSlot: target.slotIndex };
      socket.emit('playCard', {handIndex, target: payload});
      selected = { handIndex:null, action:null };
      return;
    }
  }
  if(card.type==='treatment' && card.name==='Ladrón de órganos'){
    // need from (other organ) and to (my empty slot)
    if(!selected.action){ selected.action = {name:'Ladrón', from: target}; toast('Selecciona tu espacio vacío para colocarlo'); return; }
    else {
      const payload = { fromPlayer: selected.action.from.playerIndex, fromSlot: selected.action.from.slotIndex, toSlot: target.slotIndex };
      socket.emit('playCard', {handIndex, target: payload});
      selected = { handIndex:null, action:null };
      return;
    }
  }
  if(card.type==='treatment' && card.name==='Error médico'){
    // swap entire body with selected player
    const payload = { playerIndex: target.playerIndex };
    socket.emit('playCard', {handIndex, target: payload});
    selected = { handIndex:null, action:null };
    return;
  }
  // For other cards or treatments (Contagio, Guante de látex) target may be optional; send what we have
  socket.emit('playCard', { handIndex, target });
  selected = { handIndex:null, action:null };
}

function renderFace(c){
  const tpl = document.querySelector('#cardTpl');
  const el = tpl.content.firstElementChild.cloneNode(true);
  el.classList.add(c.type);
  const icon = el.querySelector('.icon');
  const title = el.querySelector('.title');
  const tag = el.querySelector('.tag');
  const iconMap = {
    organ: {red:'❤️',green:'🫀',blue:'🧠',yellow:'🦴',wild:'🌈'},
    virus: {red:'🧫',green:'🧫',blue:'🧫',yellow:'🧫',wild:'🧫'},
    medicine: {red:'💊',green:'💊',blue:'💊',yellow:'💊',wild:'💊'},
    treatment: {_: '🧬'}
  };
  const ico = c.type==='treatment' ? iconMap.treatment._ : iconMap[c.type][c.color||'wild'];
  icon.textContent = ico || '🧪';
  title.textContent = c.name || (c.type.toUpperCase());
  tag.textContent = c.type.toUpperCase();
  return el;
}

function faceForOrgan(o){
  const nameMap = {red:'Corazón', green:'Estómago', blue:'Cerebro', yellow:'Hueso', wild:'Órgano comodín'};
  return {type:'organ', color:o.color, name:nameMap[o.color]||'Órgano'};
}

function toast(t){
  toastEl.textContent = t;
  toastEl.classList.add('show');
  setTimeout(()=>toastEl.classList.remove('show'), 1400);
}
