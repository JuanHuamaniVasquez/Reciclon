const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// ---- Game constants ----
const COLORS = ['red','green','blue','yellow'];
function uid(n=7){ return Math.random().toString(36).slice(2,2+n); }
function roomCode(){ const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c=''; for(let i=0;i<5;i++) c+=chars[(Math.random()*chars.length)|0]; return c; }

// ---- In-memory rooms ----
const rooms = {}; // code -> {players:[], hostId, state,...}
/*
 room = {
   code, hostId, players: [{id, name, color, hand:[], body:[slot,slot,slot,slot], immune:false}], started:false,
   deck:[], discard:[], turn:0
 }
 slot = { organ: {color:'red'|'green'|'blue'|'yellow'|'wild', infected:0, vaccines:0, immune:false } | null }
 card = { id, type:'organ'|'virus'|'medicine'|'treatment', color:'red'|'green'|'blue'|'yellow'|'wild'|null, name? }
*/

io.on('connection', (socket)=>{
  socket.on('createRoom', ({name, color})=>{
    const code = roomCode();
    rooms[code] = {
      code, hostId: socket.id, started:false,
      players: [], deck:[], discard:[], turn:0, createdAt: Date.now()
    };
    const player = { id: socket.id, name: name||'Jugador', color: color||'#22c55e', hand:[], body:[null,null,null,null], immune:false };
    rooms[code].players.push(player);
    socket.join(code);
    socket.data.room = code;
    emitLobby(code);
  });

  socket.on('joinRoom', ({code, name, color})=>{
    code = (code||'').toUpperCase().trim();
    const room = rooms[code];
    if(!room){ socket.emit('errorMsg', 'No existe la sala'); return; }
    if(room.started){ socket.emit('errorMsg', 'La partida ya empezó'); return; }
    if(room.players.length >= 5){ socket.emit('errorMsg', 'Sala llena (máximo 5)'); return; }
    const player = { id: socket.id, name: name||'Jugador', color: color||'#0ea5e9', hand:[], body:[null,null,null,null], immune:false };
    room.players.push(player);
    socket.join(code);
    socket.data.room = code;
    emitLobby(code);
  });

  socket.on('startGame', ()=>{
    const code = socket.data.room;
    const room = rooms[code]; if(!room) return;
    if(room.hostId !== socket.id){ socket.emit('errorMsg', 'Solo el anfitrión puede iniciar'); return; }
    if(room.players.length < 2){ socket.emit('errorMsg', 'Mínimo 2 jugadores'); return; }
    setupGame(room);
    io.in(code).emit('gameStarted');
    emitState(code);
  });

  socket.on('playCard', (payload)=>{
    const code = socket.data.room; const room = rooms[code]; if(!room || !room.started) return;
    const pIndex = room.players.findIndex(p=>p.id===socket.id);
    if(pIndex !== room.turn){ socket.emit('errorMsg','No es tu turno'); return; }
    const player = room.players[pIndex];
    const {handIndex, target} = payload; // target: {playerIndex, slotIndex, extra?}
    const card = player.hand[handIndex];
    if(!card){ socket.emit('errorMsg','Carta inválida'); return; }
    const ok = handlePlay(room, pIndex, handIndex, target);
    if(!ok){ socket.emit('errorMsg','Jugada no permitida'); return; }
    // auto draw to always keep 3
    drawToThree(room, pIndex);
    // check victory
    const winner = checkWinner(room);
    if(winner != null){
      io.in(code).emit('gameOver', { winnerIndex: winner, winnerName: room.players[winner].name });
      room.started = false;
      emitState(code);
      return;
    }
    // next turn
    room.turn = (room.turn + 1) % room.players.length;
    emitState(code);
  });

  socket.on('discardCards', ({indices})=>{
    const code = socket.data.room; const room = rooms[code]; if(!room || !room.started) return;
    const pIndex = room.players.findIndex(p=>p.id===socket.id);
    if(pIndex !== room.turn){ socket.emit('errorMsg','No es tu turno'); return; }
    const player = room.players[pIndex];
    if(!Array.isArray(indices) || indices.length<1 || indices.length>3){ socket.emit('errorMsg','Puedes descartar 1 a 3 cartas'); return; }
    // unique and sorted desc
    indices = Array.from(new Set(indices)).sort((a,b)=>b-a);
    for(const i of indices){
      if(player.hand[i]){
        room.discard.push(player.hand[i]);
        player.hand.splice(i,1);
      }
    }
    // draw same amount
    for(let i=0;i<indices.length;i++){ draw(room, pIndex); }
    // turn ends
    room.turn = (room.turn + 1) % room.players.length;
    emitState(code);
  });

  socket.on('requestState', ()=>{
    const code = socket.data.room; if(code) emitState(code);
  });

  socket.on('disconnect', ()=>{
    const code = socket.data.room;
    if(!code) return;
    const room = rooms[code];
    if(!room) return;
    // remove player
    const idx = room.players.findIndex(p=>p.id===socket.id);
    if(idx>=0){
      room.players.splice(idx,1);
      if(room.players.length===0){ delete rooms[code]; return; }
      // adjust turn
      if(room.turn >= room.players.length) room.turn = 0;
      if(room.hostId === socket.id) room.hostId = room.players[0].id;
    }
    emitLobby(code);
    emitState(code);
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
  // also send each player their own hand privately
  room.players.forEach(p=>{
    io.to(p.id).emit('yourHand', p.hand);
  });
}

// ---- Game setup and rules ----
function setupGame(room){
  room.deck = buildDeck();
  shuffle(room.deck);
  room.discard = [];
  room.turn = 0;
  room.started = true;
  room.players.forEach(p=>{
    p.hand = [];
    p.body = [null,null,null,null];
    p.immune = false;
    for(let i=0;i<3;i++) draw(room, room.players.indexOf(p));
  });
}

function buildDeck(){
  const deck=[];
  // Organs: 5 hearts(red), 5 stomach(green), 5 brains(blue), 5 bones(yellow), 1 wild
  for(let i=0;i<5;i++) deck.push(card('organ','red','Corazón'));
  for(let i=0;i<5;i++) deck.push(card('organ','green','Estómago'));
  for(let i=0;i<5;i++) deck.push(card('organ','blue','Cerebro'));
  for(let i=0;i<5;i++) deck.push(card('organ','yellow','Hueso'));
  deck.push(card('organ','wild','Órgano comodín'));
  // Virus: 4 each color + 1 wild
  for(let i=0;i<4;i++) deck.push(card('virus','red','Virus rojo'));
  for(let i=0;i<4;i++) deck.push(card('virus','green','Virus verde'));
  for(let i=0;i<4;i++) deck.push(card('virus','blue','Virus azul'));
  for(let i=0;i<4;i++) deck.push(card('virus','yellow','Virus amarillo'));
  deck.push(card('virus','wild','Virus comodín'));
  // Medicines: 4 each color + 4 wild
  for(let i=0;i<4;i++) deck.push(card('medicine','red','Medicina roja'));
  for(let i=0;i<4;i++) deck.push(card('medicine','green','Medicina verde'));
  for(let i=0;i<4;i++) deck.push(card('medicine','blue','Medicina azul'));
  for(let i=0;i<4;i++) deck.push(card('medicine','yellow','Medicina amarilla'));
  for(let i=0;i<4;i++) deck.push(card('medicine','wild','Medicina comodín'));
  // Treatments (10 total) -> 2 of each
  const treatments = ['Trasplante','Ladrón de órganos','Contagio','Guante de látex','Error médico'];
  treatments.forEach(t=>{ deck.push(card('treatment',null,t)); deck.push(card('treatment',null,t)); });
  return deck.map(c=>({...c, id: uid()}));
}
function card(type, color, name){ return { type, color: color||null, name }; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [a[i],a[j]]=[a[j],a[i]]; } }

function draw(room, pIndex){
  if(room.deck.length===0){
    // reshuffle from discard
    if(room.discard.length===0) return null;
    room.deck = room.discard.splice(0, room.discard.length-1); // leave top discard
    shuffle(room.deck);
  }
  const card = room.deck.pop();
  room.players[pIndex].hand.push(card);
  return card;
}
function drawToThree(room, pIndex){
  const player = room.players[pIndex];
  while(player.hand.length < 3){
    if(!draw(room, pIndex)) break;
  }
}

function getBodyColors(body){
  const colors = [];
  for(const slot of body){
    if(slot && slot.organ){
      const c = slot.organ.color;
      if(c === 'wild') continue; // comodín no bloquea otro color
      if(!colors.includes(c)) colors.push(c);
    }
  }
  return colors;
}

function canPlaceOrgan(body, color){
  if(color === 'wild') return true;
  const colors = getBodyColors(body);
  return !colors.includes(color); // no duplicado
}

function handlePlay(room, pIndex, handIndex, target){
  const player = room.players[pIndex];
  const card = player.hand[handIndex];
  if(!card) return false;

  if(card.type === 'organ'){
    // place in own slot if empty and not duplicate color
    if(!target || target.playerIndex !== pIndex) return false;
    const s = target.slotIndex;
    if(s==null || s<0 || s>3) return false;
    if(player.body[s] !== null) return false;
    if(!canPlaceOrgan(player.body, card.color)) return false;
    player.body[s] = { organ: { color: card.color, infected:0, vaccines:0, immune:false } };
    room.discard.push(card);
    player.hand.splice(handIndex,1);
    return true;
  }

  if(card.type === 'virus'){
    // infect organ of same color (or wild matches any) on target player
    if(!target) return false;
    const tp = room.players[target.playerIndex]; if(!tp) return false;
    const s = target.slotIndex; if(s==null || !tp.body[s] || !tp.body[s].organ) return false;
    const org = tp.body[s].organ;
    if(org.immune) return false; // inmunizado no puede infectarse
    // color match
    if(card.color !== 'wild' && org.color !== 'wild' && card.color !== org.color) return false;
    // a virus removes one vaccine if present
    if(org.vaccines > 0){
      org.vaccines -= 1;
    } else {
      org.infected += 1;
      if(org.infected >= 2){
        // destroy organ to discard
        room.discard.push({type:'organ-destroyed', color: org.color, name:'Órgano destruido', id: uid()});
        tp.body[s] = null;
      }
    }
    room.discard.push(card);
    player.hand.splice(handIndex,1);
    return true;
  }

  if(card.type === 'medicine'){
    if(!target) return false;
    const tp = room.players[target.playerIndex]; if(!tp) return false;
    const s = target.slotIndex; if(s==null || !tp.body[s] || !tp.body[s].organ) return false;
    const org = tp.body[s].organ;
    // color match: wild matches any, otherwise same color or organ wild
    const colorMatch = card.color==='wild' || org.color==='wild' || card.color===org.color;
    if(!colorMatch) return false;
    // if infected > 0 -> remove one infection
    if(org.infected > 0){
      org.infected -= 1;
    } else {
      // apply vaccine; two vaccines -> immune
      org.vaccines += 1;
      if(org.vaccines >= 2){
        org.immune = true;
      }
    }
    room.discard.push(card);
    player.hand.splice(handIndex,1);
    return true;
  }

  if(card.type === 'treatment'){
    const name = card.name;
    const ok = applyTreatment(room, pIndex, name, target);
    if(!ok) return false;
    room.discard.push(card);
    player.hand.splice(handIndex,1);
    return true;
  }

  return false;
}

function applyTreatment(room, pIndex, name, target){
  const me = room.players[pIndex];
  if(name === 'Trasplante'){
    // target: {fromPlayer, fromSlot, toPlayer, toSlot}; cannot involve immune organs
    if(!target) return false;
    const A = room.players[target.fromPlayer], B = room.players[target.toPlayer];
    if(!A || !B) return false;
    const sA = target.fromSlot, sB = target.toSlot;
    if(sA==null || sB==null) return false;
    if(!A.body[sA] || !A.body[sA].organ) return false;
    if(!B.body[sB] || !B.body[sB].organ) return false;
    if(A.body[sA].organ.immune || B.body[sB].organ.immune) return false;
    // swap
    const tmp = A.body[sA];
    A.body[sA] = B.body[sB];
    B.body[sB] = tmp;
    return true;
  }
  if(name === 'Ladrón de órganos'){
    // target: {fromPlayer, fromSlot, toSlot}
    if(!target) return false;
    const from = room.players[target.fromPlayer]; if(!from) return false;
    const sFrom = target.fromSlot; const sTo = target.toSlot;
    if(sFrom==null || sTo==null) return false;
    if(!from.body[sFrom] || !from.body[sFrom].organ) return false;
    const organ = from.body[sFrom].organ;
    // cannot steal if you already have same color (except wild)
    if(organ.color!=='wild' && !canPlaceOrgan(me.body, organ.color)) return false;
    // must place into empty slot
    if(me.body[sTo] !== null) return false;
    me.body[sTo] = { organ: {...organ} };
    from.body[sFrom] = null;
    return true;
  }
  if(name === 'Contagio'){
    // move all possible of my viruses to others' free (non-infected and non-vaccinated) organs
    // Search my body for virus states (infected>0) and try to move 1 per organ to others matching color
    let moved = 0;
    for(let s=0;s<4;s++){
      const slot = me.body[s];
      if(slot && slot.organ && slot.organ.infected>0){
        // find target organ in others where organ exists, infected==0, vaccines==0, immune==false, color match
        outer: for(let pi=0; pi<room.players.length; pi++){
          if(pi===pIndex) continue;
          const pl = room.players[pi];
          for(let sj=0; sj<4; sj++){
            const t = pl.body[sj];
            if(!t || !t.organ) continue;
            if(t.organ.immune) continue;
            if(t.organ.infected>0) continue;
            if(t.organ.vaccines>0) continue;
            const match = t.organ.color==='wild' || slot.organ.color==='wild' || t.organ.color===slot.organ.color;
            if(match){
              // move one infection
              slot.organ.infected -= 1;
              t.organ.infected += 1;
              moved++;
              break outer;
            }
          }
        }
      }
    }
    return moved>0;
  }
  if(name === 'Guante de látex'){
    // everyone except me discards entire hand and draws to 3
    for(let i=0;i<room.players.length;i++){
      if(i===pIndex) continue;
      const pl = room.players[i];
      room.discard.push(...pl.hand);
      pl.hand = [];
      for(let k=0;k<3;k++) draw(room, i);
    }
    return true;
  }
  if(name === 'Error médico'){
    // swap entire body with target player
    if(!target) return false;
    const other = room.players[target.playerIndex]; if(!other) return false;
    const tmp = me.body; me.body = other.body; other.body = tmp;
    return true;
  }
  return false;
}

function checkWinner(room){
  for(let i=0;i<room.players.length;i++){
    const pl = room.players[i];
    // count distinct organ colors of HEALTHY organs (no infection OR vaccinated OR immune)
    let colors = new Set();
    for(const slot of pl.body){
      if(slot && slot.organ){
        const o = slot.organ;
        const healthy = (o.infected===0) || o.vaccines>0 || o.immune;
        if(healthy){
          const c = o.color==='wild' ? uid(1) : o.color; // wild counts as unique
          colors.add(c);
        }
      }
    }
    if(colors.size >= 4) return i;
  }
  return null;
}

http.listen(PORT, ()=> console.log('Servidor escuchando en puerto', PORT));
