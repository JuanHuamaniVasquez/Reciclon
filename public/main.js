// main.js — orquesta UI + sockets + store
import { socket, on, emit } from './socket.js';
import { store } from './store.js';

// Helpers DOM
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
let lastTurnIndex = null;
let lastHandSize  = 0;

function playerNameByIndex(idx){
  return store.state?.game?.players?.[idx]?.name ?? `Jugador ${idx+1}`;
}
function slotLabel(i){ return `espacio ${ (i??0) + 1 }`; }

function announceTurnChange(snap){
  if (lastTurnIndex === snap.turn) return;
  lastTurnIndex = snap.turn;
  const name = playerNameByIndex(snap.turn);
  toast(`🕐 Turno de ${name}. Juega una carta o descarta 1–3.`, 2400);
}

function announceHandChange(newHand){
  const n = newHand?.length ?? 0;
  if (lastHandSize === 0 && n > 0) {
    toast(`🃏 Tu mano lista: ${n} carta(s).`);
  } else if (n > lastHandSize) {
    toast(`➕ Robaste ${n - lastHandSize} carta(s). Ahora tienes ${n}.`);
  } else if (n < lastHandSize) {
    toast(`➖ Jugaste/descartaste. Te quedan ${n} carta(s).`);
  }
  lastHandSize = n;
}

function describeTarget(t){
  if (t == null) return 'objetivo';
  const who = (typeof t.playerIndex === 'number') ? playerNameByIndex(t.playerIndex) : 'jugador';
  const where = (typeof t.slotIndex === 'number') ? `, ${slotLabel(t.slotIndex)}` : '';
  return `${who}${where}`;
}

// Nodos
const screenLobby = $('#screen-lobby');
const screenGame  = $('#screen-game');
const createBtn   = $('#createBtn');
const joinBtn     = $('#joinBtn');
const startBtn    = $('#startBtn');
const roomInfo    = $('#roomInfo');
const roomCodeEl  = $('#roomCode');
const playersList = $('#playersList');
const deckCount   = $('#deckCount');
const boards      = $('#boards');
const handDiv     = $('#hand');
const turnInfo    = $('#turnInfo');
const badgeCode   = $('#badgeCode');
const discardDiv  = $('#discard');
const toastEl     = $('#toast');
const logEl       = $('#log');
const discardSel  = $('#discardSel');
const fullBtn     = $('#fullscreenBtn');
const rotateHint  = $('#rotateHint');

// ====== FONDO ======
function setBodyBg(mode, accent = store.state.accent) {
  const base = '#12381a';
  if (mode === 'lobby') {
    document.body.style.background =
      'radial-gradient(1200px 800px at 20% -10%, #1d6e2e 0%, #12381a 60%) no-repeat center/cover fixed';
  } else {
    document.body.style.background =
      `radial-gradient(1200px 800px at 20% -10%, ${hex2rgba(accent,0.25)} 0%, ${base} 60%) no-repeat center/cover fixed`;
  }
}
function hex2rgba(hex, a=1){
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#22c55e');
  const r = parseInt(m?.[1] ?? '22',16), g = parseInt(m?.[2] ?? 'c5',16), b = parseInt(m?.[3] ?? '5e',16);
  return `rgba(${r},${g},${b},${a})`;
}

// ====== TOAST ======
function toast(msg, ms = 1800){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl.__t);
  toastEl.__t = setTimeout(()=> toastEl.classList.remove('show'), ms);
}

// ====== PANTALLAS ======
function showScreen(id){
  screenLobby.classList.toggle('shown', id==='lobby');
  screenGame .classList.toggle('shown', id==='game');
  setBodyBg(id === 'lobby' ? 'lobby' : 'game');
  if(id==='game'){ emit('requestState'); }
}

// ====== SOCKET EVENTS ======
on('connect', ()=> store.set({ myId: socket.id }));

on('errorMsg', m => toast(m));

on('lobby', data => {
  // UI simple de lobby
  roomInfo.classList.remove('hidden');
  roomCodeEl.textContent = data.code;
  playersList.replaceChildren(...data.players.map(p=>{
    const chip = document.createElement('div');
    chip.className='player-chip';
    chip.textContent = p.name + (p.id===data.hostId ? ' (anfitrión)' : '');
    return chip;
  }));
  startBtn.style.display = (data.hostId===store.state.myId && !data.started) ? 'inline-block' : 'none';
  badgeCode.textContent = `Sala ${data.code}`;

  // guarda color propio como acento (si existe)
  const me = data.players.find(p => p.id === store.state.myId);
  if (me?.color) store.set({ accent: me.color });

  store.set({ lobby: data });
  showScreen('lobby');
  setBodyBg('lobby', store.state.accent);

  const yo = store.state.myId;
  const soyHost = yo && data.hostId === yo;
  const nJug = data.players.length;
  toast(`${soyHost ? '✅ Sala creada' : '✅ Te uniste'}: ${data.code} — Jugadores ${nJug}/5. ${soyHost ? 'Cuando quieras, inicia la partida.' : 'Espera a que el anfitrión inicie.'}`, 2800);


});

on('gameStarted', ()=>{
  showScreen('game');
  logEl.innerHTML='';
  toast(`🎮 ¡La partida comenzó! ${nJug} jugador(es). Se repartieron 3 cartas por jugador.`, 2600);
  emit('requestState');
});

on('state', snap => {
  store.set({ game: snap });
  deckCount.textContent = snap.deckCount;
  turnInfo.textContent = `Turno: ${snap.players[snap.turn]?.name || '—'}`;
  badgeCode.textContent = `Sala ${snap.code}`;
  renderBoards(snap);
  renderDiscard(snap);
  announceTurnChange(snap);
});

on('yourHand', hand => {
  store.set({ hand });
  renderHand(hand);
  announceHandChange(hand);
});

on('gameOver', ({winnerIndex, winnerName})=>{
  toast(`🏆 Ganó ${winnerName}. Volviendo al lobby…`, 2600);
  setTimeout(()=>showScreen('lobby'), 2000);
});

// ====== ACCIONES UI BÁSICAS ======
createBtn.addEventListener('click', ()=>{
  const name  = $('#hostName').value || 'Jugador';
  const color = $('#hostColor').value || '#22c55e';
  emit('createRoom', {name, color});
});
joinBtn.addEventListener('click', ()=>{
  const code  = ($('#joinCode').value||'').toUpperCase();
  const name  = $('#joinName').value || 'Jugador';
  const color = $('#joinColor').value || '#0ea5e9';
  emit('joinRoom', {code, name, color});
});
startBtn.addEventListener('click', ()=> emit('startGame'));

// ====== DESCARTAR (modo) ======
let discardMode = false;
const picks = new Set();

discardSel.addEventListener('click', () => {
  if (!discardMode) {
    if (store.state.hand.length === 0) return;
    discardMode = true;
    picks.clear();
    handDiv.classList.add('discard-mode');
    toast('🗑️ Modo descarte: toca 1–3 cartas para marcarlas. Vuelve a tocar “Descartar” para confirmar.', 3200);
  } else {
    discardMode = false;
    handDiv.classList.remove('discard-mode');
    if (picks.size > 0) {
      emit('discardCards', { indices: [...picks] });
    } else {
      toast('Descartar cancelado.');
    }
    picks.clear();
  }
});

handDiv.addEventListener('click', (e) => {
  const face = e.target.closest('.face');
  if (!face) return;

  if (discardMode) {
    const idx = [...handDiv.children].indexOf(face);
    if (idx < 0) return;
    if (picks.has(idx)) picks.delete(idx); else if (picks.size < 3) picks.add(idx);
    face.classList.toggle('selecting', picks.has(idx));
    toast(`Marcadas ${picks.size}/3 carta(s) para descartar.`);
    return;
  }

  // Selección normal para jugar carta
  const idx = [...handDiv.children].indexOf(face);
  if (idx >= 0) onHandPick(idx);
});

// ====== MÁQUINA DE ESTADOS DE OBJETIVOS ======
const TargetSpec = {
  'Trasplante': 2,
  'Ladrón de órganos': 2, // 1 ajeno + 1 propio vacío
  'Error médico': 1,
  default: 1
};

let action = { handIndex:null, name:null, targets:[] };

function onHandPick(i){
  const hand = store.state.hand;
  action = { handIndex:i, name: hand[i]?.name, targets:[] };
  const need = TargetSpec[action.name] ?? TargetSpec.default;
  toast(`Has seleccionado “${carta}”. Ahora elige ${need} objetivo(s).`, 2400);
}

function onTargetClick(t){
  if (action.handIndex == null){
    toast('Primero elige una carta de tu mano.');
    return;
  }
  const need = TargetSpec[action.name] ?? 1;
  action.targets.push(t);
  const idx = action.targets.length;
  toast(`Objetivo ${idx}/${need} seleccionado: ${describeTarget(t)}.`);

  if (idx < need) return;

  // listo para enviar
  const payload = buildPayload(action);
  const cardName = action.name || 'carta';
  toast(`Usando “${cardName}” sobre ${need===1 ? describeTarget(action.targets[0]) : 'los objetivos elegidos'}…`);
  emit('playCard', { handIndex: action.handIndex, target: payload });
  action = { handIndex:null, name:null, targets:[] };
}

// Traducción de objetivos a payload por carta
function buildPayload(a){
  const hand = store.state.hand;
  const card = hand[a.handIndex];
  if (!card) return {};

  if (card.type==='treatment' && card.name==='Trasplante') {
    const [from,to] = a.targets;
    return { fromPlayer: from.playerIndex, fromSlot: from.slotIndex, toPlayer: to.playerIndex, toSlot: to.slotIndex };
  }
  if (card.type==='treatment' && card.name==='Ladrón de órganos') {
    const [from,to] = a.targets;
    return { fromPlayer: from.playerIndex, fromSlot: from.slotIndex, toSlot: to.slotIndex };
  }
  if (card.type==='treatment' && card.name==='Error médico') {
    const [who] = a.targets;
    return { playerIndex: who.playerIndex };
  }
  // default: un solo objetivo directo
  return a.targets[0] ?? {};
}

// ====== RENDER ======
function renderBoards(snap){
  boards.innerHTML = '';
  const frag = document.createDocumentFragment();

  snap.players.forEach((pl, idx)=>{
    const bd = document.createElement('div'); bd.className='board';
    const title = document.createElement('h4');
    const span = document.createElement('span'); span.textContent = pl.name;
    const small = document.createElement('small'); small.textContent = (idx===snap.turn ? ' • jugando' : '');
    title.append(span, small);

    const grid = document.createElement('div'); grid.className='slots';
    for(let s=0;s<4;s++){
      const slot = document.createElement('div'); slot.className='slot'; slot.tabIndex = 0;

      const content = pl.body?.[s];
      if(content?.organ){
        const card = renderFace(faceForOrgan(content.organ));
        slot.appendChild(card);
        const b = document.createElement('div'); b.className='badge';
        const o = content.organ;
        if(o.immune) { b.textContent='Inmunizado'; slot.classList.add('healthy'); }
        else if(o.infected>0) { b.textContent=`Infectado x${o.infected}`; slot.classList.add('infected'); }
        else if(o.vaccines>0) { b.textContent=`Vacunado x${o.vaccines}`; slot.classList.add('healthy'); }
        else { b.textContent='Sano'; slot.classList.add('healthy'); }
        slot.appendChild(b);
      } else {
        slot.textContent = 'Vacío';
      }

      slot.addEventListener('click', ()=> onTargetClick({playerIndex: idx, slotIndex: s}));
      slot.addEventListener('keydown', (e)=> { if(e.key==='Enter' || e.key===' ') onTargetClick({playerIndex: idx, slotIndex: s}); });

      grid.appendChild(slot);
    }

    bd.append(title, grid);
    frag.appendChild(bd);
  });

  boards.appendChild(frag);
}

function renderDiscard(snap){
  discardDiv.innerHTML='';
  const top = snap.discardTop;
  if(!top) return;
  const card = renderFace(top);
  discardDiv.appendChild(card);
}

function renderHand(hand){
  handDiv.innerHTML='';
  const frag = document.createDocumentFragment();
  hand.forEach((c, i)=>{
    const face = renderFace(c);
    face.dataset.index = i;
    face.tabIndex = 0;
    face.addEventListener('keydown', (e)=> { if(e.key==='Enter' || e.key===' ') onHandPick(i); });
    frag.appendChild(face);
  });
  handDiv.appendChild(frag);
}

// ====== CARAS ======
function renderFace(c) {
  const el = document.createElement('div');
  el.classList.add('card','face',c.type);

  let src = 'images/fallback.jpeg';

  const IMG = {
    organ:   { red:'organos/peligrosos.jpeg', green:'organos/aprovechables.jpeg', blue:'organos/organicos.jpeg', yellow:'organos/no_aprovechables.jpeg' },
    virus:   { red:'virus/peligrosos.jpeg',   green:'virus/aprovechables.jpeg',   blue:'virus/organicos.jpeg',  yellow:'virus/no_aprovechables.jpeg' },
    medicine:{ red:'medicinas/peligrosos.jpeg',green:'medicinas/aprovechables.jpeg',blue:'medicinas/organicos.jpeg',yellow:'medicinas/no_aprovechables.jpeg' },
    treatment:{
      trasplante:'tratamientos/trasplante.jpeg',
      ladron_de_organos:'tratamientos/ladron.jpeg',
      contagio:'tratamientos/contagio.jpeg',
      guante:'tratamientos/guante.jpeg',
      error_medico:'tratamientos/error_medico.jpeg'
    }
  };

  if (c.type === 'organ' || c.type === 'virus' || c.type === 'medicine') {
    const color = (c.color||'').toLowerCase();
    const path = IMG[c.type]?.[color];
    if (path) src = `images/${path}`;
  } else if (c.type === 'treatment') {
    const key = (c.name||'')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/\s+/g,'_');
    const path = IMG.treatment?.[key];
    if (path) src = `images/${path}`;
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

// ====== FULLSCREEN + ORIENTACIÓN ======
fullBtn.addEventListener('click', async () => {
  const el = document.documentElement;
  try{
    if (!document.fullscreenElement) {
      await el.requestFullscreen();
      fullBtn.textContent = "🡑 Salir";
      if (screen.orientation?.lock) {
        try { await screen.orientation.lock('landscape'); } catch(e){ /* ignore */ }
      }
      toast('Pantalla completa activada. Usa Esc o el botón para salir.', 2200);
    } else {
      await document.exitFullscreen();
      fullBtn.textContent = "⛶ Pantalla completa";
      toast('Saliste de pantalla completa.');
    }
  }catch(e){
    toast('No se pudo activar pantalla completa. Prueba con F11 o los ajustes del navegador.', 2600);
  }
});

function checkOrientation(){
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  rotateHint.classList.toggle('hidden', !portrait);
  if (portrait) {
    // aviso breve para no ser molesto
    toast('Para una mejor experiencia, gira tu dispositivo a horizontal.', 1800);
  }
}
window.addEventListener('orientationchange', checkOrientation);
window.addEventListener('resize', checkOrientation);
checkOrientation();

// ====== ACCESOS RÁPIDOS ======
$('#deck')?.addEventListener('click', () => emit('draw')); // si tu server soporta 'draw'
