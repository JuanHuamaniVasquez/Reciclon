const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

function uid(n=7){ return Math.random().toString(36).slice(2,2+n); }
function roomCode(){ const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c=''; for(let i=0;i<5;i++) c+=chars[(Math.random()*chars.length)|0]; return c; }

const rooms = {};

io.on('connection', (socket)=>{
  socket.on('createRoom', ({name, color})=>{
    const code = roomCode();
    rooms[code] = { code, hostId: socket.id, started:false, players: [], deck:[], discard:[], turn:0 };
    const player = { id: socket.id, name: name||'Jugador', color: color||'#22c55e', hand:[], body:[null,null,null,null], immune:false };
    rooms[code].players.push(player);
    socket.join(code); socket.data.room = code;
    emitLobby(code);
  });

  socket.on('joinRoom', ({code, name, color})=>{
    code = (code||'').toUpperCase().trim();
    const room = rooms[code];
    if(!room) return socket.emit('errorMsg', 'No existe la sala');
    if(room.started) return socket.emit('errorMsg', 'La partida ya empezó');
    if(room.players.length >= 5) return socket.emit('errorMsg', 'Sala llena (máximo 5)');
    const player = { id: socket.id, name: name||'Jugador', color: color||'#0ea5e9', hand:[], body:[null,null,null,null], immune:false };
    room.players.push(player);
    socket.join(code); socket.data.room = code;
    emitLobby(code);
  });

  socket.on('startGame', ()=>{
    const code = socket.data.room; const room = rooms[code]; if(!room) return;
    if(room.hostId !== socket.id) return socket.emit('errorMsg','Solo el anfitrión puede iniciar');
    if(room.players.length < 2) return socket.emit('errorMsg','Mínimo 2 jugadores');
    setupGame(room);
    io.in(code).emit('gameStarted');
    emitState(code);
  });

  socket.on('playCard', ({handIndex, target})=>{
    const code = socket.data.room; const room = rooms[code]; if(!room || !room.started) return;
    const pIndex = room.players.findIndex(p=>p.id===socket.id);
    if(pIndex !== room.turn) return socket.emit('errorMsg','No es tu turno');
    if(!handlePlay(room, pIndex, handIndex, target)) return socket.emit('errorMsg','Jugada no permitida');
    drawToThree(room, pIndex);
    const winner = checkWinner(room);
    if(winner != null){
      io.in(code).emit('gameOver', { winnerIndex: winner, winnerName: room.players[winner].name });
      room.started = false; emitState(code); return;
    }
    room.turn = (room.turn + 1) % room.players.length;
    emitState(code);
  });

  socket.on('discardCards', ({indices})=>{
    const code = socket.data.room; const room = rooms[code]; if(!room || !room.started) return;
    const pIndex = room.players.findIndex(p=>p.id===socket.id);
    if(pIndex !== room.turn) return socket.emit('errorMsg','No es tu turno');
    const player = room.players[pIndex];
    if(!Array.isArray(indices) || indices.length<1 || indices.length>3) return socket.emit('errorMsg','Puedes descartar 1 a 3 cartas');
    indices = Array.from(new Set(indices)).sort((a,b)=>b-a);
    for(const i of indices){ if(player.hand[i]){ room.discard.push(player.hand[i]); player.hand.splice(i,1); } }
    for(let i=0;i<indices.length;i++){ draw(room, pIndex); }
    room.turn = (room.turn + 1) % room.players.length;
    emitState(code);
  });

  socket.on('requestState', ()=>{ const code = socket.data.room; if(code) emitState(code); });

  socket.on('disconnect', ()=>{
    const code = socket.data.room; if(!code) return;
    const room = rooms[code]; if(!room) return;
    const idx = room.players.findIndex(p=>p.id===socket.id);
    if(idx>=0){
      room.players.splice(idx,1);
      if(room.players.length===0){ delete rooms[code]; return; }
      if(room.turn >= room.players.length) room.turn = 0;
      if(room.hostId === socket.id) room.hostId = room.players[0].id;
    }
    emitLobby(code); emitState(code);
  });
});

function emitLobby(code){
  const room = rooms[code]; if(!room) return;
  io.in(code).emit('lobby', {
    code: room.code,
    hostId: room.hostId,
    players: room.players.map(p=>({id:p.id, name:p.name, color:p.color})),
    started: room.started
  });
}

function emitState(code){
  const room = rooms[code]; if(!room) return;
  const snapshot = {
    code: room.code, started: room.started, turn: room.turn, deckCount: room.deck.length, discardTop: room.discard[room.discard.length-1]||null,
    players: room.players.map(p=>({ name:p.name, color:p.color, handCount:p.hand.length, body:p.body, immune:p.immune }))
  };
  io.in(code).emit('state', snapshot);
  room.players.forEach(p=> io.to(p.id).emit('yourHand', p.hand));
}

// ---- Game rules ----
function setupGame(room){
  room.deck = buildDeck(); shuffle(room.deck);
  room.discard = []; room.turn = 0; room.started = true;
  room.players.forEach((p,i)=>{ p.hand=[]; p.body=[null,null,null,null]; p.immune=false; for(let k=0;k<3;k++) draw(room,i); });
}

function buildDeck(){
  const deck=[];
  for(let i=0;i<5;i++) deck.push(card('organ','red','Corazón'));
  for(let i=0;i<5;i++) deck.push(card('organ','green','Estómago'));
  for(let i=0;i<5;i++) deck.push(card('organ','blue','Cerebro'));
  for(let i=0;i<5;i++) deck.push(card('organ','yellow','Hueso'));
  deck.push(card('organ','wild','Órgano comodín'));
  for(let i=0;i<4;i++) deck.push(card('virus','red','Virus rojo'));
  for(let i=0;i<4;i++) deck.push(card('virus','green','Virus verde'));
  for(let i=0;i<4;i++) deck.push(card('virus','blue','Virus azul'));
  for(let i=0;i<4;i++) deck.push(card('virus','yellow','Virus amarillo'));
  deck.push(card('virus','wild','Virus comodín'));
  for(let i=0;i<4;i++) deck.push(card('medicine','red','Medicina roja'));
  for(let i=0;i<4;i++) deck.push(card('medicine','green','Medicina verde'));
  for(let i=0;i<4;i++) deck.push(card('medicine','blue','Medicina azul'));
  for(let i=0;i<4;i++) deck.push(card('medicine','yellow','Medicina amarilla'));
  for(let i=0;i<4;i++) deck.push(card('medicine','wild','Medicina comodín'));
  const treatments = ['Trasplante','Ladrón de órganos','Contagio','Guante de látex','Error médico'];
  treatments.forEach(t=>{ deck.push(card('treatment',null,t)); deck.push(card('treatment',null,t)); });
  return deck.map(c=>({...c, id: uid()}));
}
function card(type, color, name){ return { type, color: color||null, name }; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [a[i],a[j]]=[a[j],a[i]]; } }

function draw(room, pIndex){
  if(room.deck.length===0){
    if(room.discard.length===0) return null;
    room.deck = room.discard.splice(0, room.discard.length-1);
    shuffle(room.deck);
  }
  const card = room.deck.pop();
  room.players[pIndex].hand.push(card);
  return card;
}
function drawToThree(room, pIndex){ while(room.players[pIndex].hand.length<3){ if(!draw(room, pIndex)) break; } }

function getBodyColors(body){
  const colors = []; for(const slot of body){ if(slot && slot.organ){ const c=slot.organ.color; if(c!=='wild' && !colors.includes(c)) colors.push(c);} } return colors;
}
function canPlaceOrgan(body, color){ return color==='wild' ? true : !getBodyColors(body).includes(color); }

function handlePlay(room, pIndex, handIndex, target){
  const player = room.players[pIndex];
  const card = player.hand[handIndex]; if(!card) return false;

  if(card.type === 'organ'){
    if(!target || target.playerIndex !== pIndex) return false;
    const s = target.slotIndex; if(s==null || s<0 || s>3) return false;
    if(player.body[s] !== null) return false;
    if(!canPlaceOrgan(player.body, card.color)) return false;
    player.body[s] = { organ: { color: card.color, infected:0, vaccines:0, immune:false } };
    room.discard.push(card); player.hand.splice(handIndex,1); return true;
  }

  if(card.type === 'virus'){
    if(!target) return false;
    const tp = room.players[target.playerIndex]; if(!tp) return false;
    const s = target.slotIndex; if(s==null || !tp.body[s] || !tp.body[s].organ) return false;
    const org = tp.body[s].organ;
    if(org.immune) return false;
    if(card.color !== 'wild' && org.color !== 'wild' && card.color !== org.color) return false;
    if(org.vaccines > 0){ org.vaccines -= 1; }
    else { org.infected += 1; if(org.infected >= 2){ room.discard.push({type:'organ-destroyed', color: org.color, name:'Órgano destruido', id: uid()}); tp.body[s] = null; } }
    room.discard.push(card); player.hand.splice(handIndex,1); return true;
  }

  if(card.type === 'medicine'){
    if(!target) return false;
    const tp = room.players[target.playerIndex]; if(!tp) return false;
    const s = target.slotIndex; if(s==null || !tp.body[s] || !tp.body[s].organ) return false;
    const org = tp.body[s].organ;
    const match = card.color==='wild' || org.color==='wild' || card.color===org.color;
    if(!match) return false;
    if(org.infected > 0) org.infected -= 1;
    else { org.vaccines += 1; if(org.vaccines >= 2) org.immune = true; }
    room.discard.push(card); player.hand.splice(handIndex,1); return true;
  }

  if(card.type === 'treatment'){
    const ok = applyTreatment(room, pIndex, card.name, target); if(!ok) return false;
    room.discard.push(card); player.hand.splice(handIndex,1); return true;
  }

  return false;
}

function applyTreatment(room, pIndex, name, target){
  const me = room.players[pIndex];
  if(name === 'Trasplante'){
    if(!target) return false;
    const A = room.players[target.fromPlayer], B = room.players[target.toPlayer];
    if(!A || !B) return false;
    const sA = target.fromSlot, sB = target.toSlot;
    if(sA==null || sB==null) return false;
    if(!A.body[sA] || !A.body[sA].organ) return false;
    if(!B.body[sB] || !B.body[sB].organ) return false;
    if(A.body[sA].organ.immune || B.body[sB].organ.immune) return false;
    const tmp = A.body[sA]; A.body[sA] = B.body[sB]; B.body[sB] = tmp; return true;
  }
  if(name === 'Ladrón de órganos'){
    if(!target) return false;
    const from = room.players[target.fromPlayer]; if(!from) return false;
    const sFrom = target.fromSlot; const sTo = target.toSlot;
    if(sFrom==null || sTo==null) return false;
    if(!from.body[sFrom] || !from.body[sFrom].organ) return false;
    const organ = from.body[sFrom].organ;
    if(organ.color!=='wild' && !canPlaceOrgan(me.body, organ.color)) return false;
    if(me.body[sTo] !== null) return false;
    me.body[sTo] = { organ: {...organ} }; from.body[sFrom] = null; return true;
  }
  if(name === 'Contagio'){
    let moved = 0;
    for(let s=0;s<4;s++){
      const slot = me.body[s];
      if(slot && slot.organ && slot.organ.infected>0){
        outer: for(let pi=0; pi<room.players.length; pi++){
          if(pi===pIndex) continue;
          const pl = room.players[pi];
          for(let sj=0; sj<4; sj++){
            const t = pl.body[sj];
            if(!t || !t.organ) continue;
            if(t.organ.immune || t.organ.infected>0 || t.organ.vaccines>0) continue;
            const match = t.organ.color==='wild' || slot.organ.color==='wild' || t.organ.color===slot.organ.color;
            if(match){ slot.organ.infected -= 1; t.organ.infected += 1; moved++; break outer; }
          }
        }
      }
    }
    return moved>0;
  }
  if(name === 'Guante de látex'){
    for(let i=0;i<room.players.length;i++){
      if(i===pIndex) continue;
      const pl = room.players[i];
      room.discard.push(...pl.hand); pl.hand = [];
      for(let k=0;k<3;k++) draw(room, i);
    }
    return true;
  }
  if(name === 'Error médico'){
    if(!target) return false;
    const other = room.players[target.playerIndex]; if(!other) return false;
    const tmp = me.body; me.body = other.body; other.body = tmp; return true;
  }
  return false;
}

function checkWinner(room){
  for(let i=0;i<room.players.length;i++){
    const pl = room.players[i];
    let colors = new Set();
    for(const slot of pl.body){
      if(slot && slot.organ){
        const o = slot.organ;
        const healthy = (o.infected===0) || o.vaccines>0 || o.immune;
        if(healthy){
          const c = o.color==='wild' ? uid(1) : o.color;
          colors.add(c);
        }
      }
    }
    if(colors.size >= 4) return i;
  }
  return null;
}

http.listen(PORT, ()=> console.log('Servidor escuchando en puerto', PORT));
