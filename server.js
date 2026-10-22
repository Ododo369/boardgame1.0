const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const animals = [
  { id: 'mole', name: '地鼠', chain: 0, level: 1, trigger: '移動', effect: '移至該格堆疊最底部' },
  { id: 'weasel', name: '黃鼬', chain: 0, level: 2, trigger: '移動', effect: '移動自己以外的一枚棋子' },
  { id: 'python', name: '蟒蛇', chain: 0, level: 3, trigger: '揭露', effect: '將所有相鄰格最上方棋子依玩家選擇順序收至自身下方' },
  { id: 'rabbit', name: '兔子', chain: 1, level: 1, trigger: '揭露', effect: '自身移動一次' },
  { id: 'fox', name: '赤狐', chain: 1, level: 2, trigger: '揭露', effect: '抽2枚棋子，再放回2枚' },
  { id: 'eagle', name: '老鷹', chain: 1, level: 3, trigger: '移動', effect: '移動後將自身與下方棋子一起放到任意格最上方，堆疊順序不變' },
  { id: 'krill', name: '磷蝦', chain: 2, level: 1, trigger: '移動', effect: '將手中的磷蝦放到空格' },
  { id: 'seal', name: '海豹', chain: 2, level: 2, trigger: '揭露', effect: '抽2枚，選1枚放在自身下方' },
  { id: 'orca', name: '虎鯨', chain: 2, level: 3, trigger: '揭露', effect: '將場上1枚棋子拿到手中' },
  { id: 'chameleon', name: '變色龍', chain: 3, level: 0, trigger: '無', effect: '可視為任意等級；沒有移動或揭露觸發效果' },
];
const colors = ['#eb785d', '#4c9b8a', '#6384d8', '#d69a3d'];
const code = () => Math.random().toString(36).slice(2, 6).toUpperCase();
const shuffle = a => { for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
function broadcast(room) { for (const p of room.players) if (p.socket?.readyState === 1) p.socket.send(JSON.stringify({ type:'state', state: publicState(room,p.id) })); }
function publicState(room, viewerId) {
  return { code:room.code, started:room.started, hostId:room.hostId, turn:room.turn, active:room.active,
    players:room.players.map(({id,name,hand,color,connected})=>({id,name,hand:id===viewerId?hand:[],handCount:hand.length,color,connected})),
    board:room.board, bagCount:room.bag.length, log:room.log.slice(-8), winner:room.winner,
    pendingEffect:room.pendingEffect?{type:room.pendingEffect.type,playerId:room.pendingEffect.playerId,from:room.pendingEffect.from,targets:room.pendingEffect.targets,...(room.pendingEffect.type==='fox-return'&&room.pendingEffect.playerId===viewerId?{count:room.pendingEffect.count}:{}),...(room.pendingEffect.type==='seal-select'&&room.pendingEffect.playerId===viewerId?{drawn:room.pendingEffect.drawn}:{})}:null };
}
function note(room, text) { room.log.push(text); }
function draw(room, player, n=1) { for(let i=0;i<n && room.bag.length;i++) player.hand.push(room.bag.pop()); }
function drawOpeningHand(room, player) {
  const levelOne = room.bag.map((id,i)=>animals.find(a=>a.id===id)?.level===1?i:-1).filter(i=>i>=0);
  if (!levelOne.length) { draw(room,player,3); return; }
  player.hand.push(room.bag.splice(levelOne[Math.floor(Math.random()*levelOne.length)],1)[0]); draw(room,player,2);
}
function start(room) {
  const countsByLevel={1:7,2:4,3:2};
  const animalTiles=animals.filter(a=>a.chain<3).flatMap(a=>Array(countsByLevel[a.level]).fill(a.id));
  room.started=true; room.bag=shuffle([...animalTiles,'chameleon','chameleon','chameleon']);
  room.players.forEach(p=>drawOpeningHand(room,p)); room.turn=Math.floor(Math.random()*room.players.length); room.active=null; draw(room,room.players[room.turn]); note(room,`遊戲開始！每位玩家的起手牌至少有一枚等級一棋子。${room.players[room.turn].name}的回合開始。`);
}
function pieceLevel(piece) {
  return piece.level ?? animals.find(x=>x.id===piece.animal)?.level ?? 0;
}
function canCreate(room, animalId, cell) {
  const a=animals.find(x=>x.id===animalId); if(!a || !Number.isInteger(cell) || cell<0 || cell>=room.board.length) return false;
  const stack=room.board[cell]; if(a.level===1) return stack.length===0;
  if(!stack.length) return animalId==='chameleon';
  const top=stack.at(-1);
  if(top.animal==='chameleon') return true;
  if(animalId==='chameleon') return pieceLevel(top)<3;
  return pieceLevel(top)===a.level-1;
}
function adjacentCells(cell) {
  const x=cell%3,y=Math.floor(cell/3),result=[];
  if(x>0)result.push(cell-1);if(x<2)result.push(cell+1);if(y>0)result.push(cell-3);if(y<2)result.push(cell+3);
  return result;
}
function queueReveal(room, cell, front=false) {
  const piece=room.board[cell].at(-1);
  if(!piece)return;
  const species=animals.find(a=>a.id===piece.animal);
  if(species?.trigger==='揭露'){
    const task={type:'reveal',cell,pieceId:piece.uid};
    if(front)room.effectQueue.unshift(task);else room.effectQueue.push(task);
  }
}
function findPiece(room, uid) {
  for(let cell=0;cell<room.board.length;cell++){
    const index=room.board[cell].findIndex(piece=>piece.uid===uid);
    if(index>=0)return {cell,index,piece:room.board[cell][index]};
  }
  return null;
}
function placeMovedPiece(room, piece, targetCell) {
  room.board[targetCell].push(piece);
}
function resolvePendingEffects(room, actor) {
  while(room.effectQueue.length){
    const task=room.effectQueue.shift();
    if(task.type==='reveal'){
      const exposed=room.board[task.cell].at(-1);
      if(!exposed||exposed.uid!==task.pieceId||room.effectSeen.has(task.pieceId))continue;
      room.effectSeen.add(task.pieceId);
      if(exposed.animal==='rabbit'){
        room.pendingEffect={type:'rabbit-move',playerId:actor.id,pieceId:exposed.uid,from:task.cell,targets:adjacentCells(task.cell)};
        return;
      }
      if(exposed.animal==='fox'){
        const count=Math.min(2,room.bag.length);
        if(count){draw(room,actor,count);room.pendingEffect={type:'fox-return',playerId:actor.id,count};note(room,'赤狐觸發揭露效果，抽取棋子並選擇放回抽袋。');return;}
      }
      if(exposed.animal==='seal'){
        const drawn=[];
        for(let i=0;i<2&&room.bag.length;i++)drawn.push(room.bag.pop());
        if(drawn.length){room.pendingEffect={type:'seal-select',playerId:actor.id,pieceId:exposed.uid,drawn};note(room,'海豹觸發揭露效果，抽取棋子並選擇一枚放到海豹下方。');return;}
      }
      if(exposed.animal==='python'){
        const targets=adjacentCells(task.cell).filter(cell=>room.board[cell].length);
        if(targets.length){room.pendingEffect={type:'python-collect',playerId:actor.id,pieceId:exposed.uid,sources:targets,targets:targets.slice()};note(room,'蟒蛇觸發揭露效果，選擇相鄰棋子的收取順序。');return;}
      }
      // Other reveal effects are handled by their effect-specific resolvers as they are implemented.
      continue;
    }
    if(task.type==='reveal-group'){
      const candidates=task.candidates.filter(({cell,pieceId})=>{
        const top=room.board[cell].at(-1);
        return top?.uid===pieceId&&!room.effectSeen.has(pieceId)&&animals.find(a=>a.id===top.animal)?.trigger==='揭露';
      });
      if(candidates.length>1){
        room.pendingEffect={type:'reveal-choice',playerId:actor.id,candidates,targets:candidates.map(c=>c.cell)};
        note(room,'多枚棋子同時觸發揭露效果，請選擇一個效果。');return;
      }
      if(candidates.length===1)room.effectQueue.unshift({type:'reveal',...candidates[0]});
      continue;
    }
    if(task.type==='after-move'){
      const found=findPiece(room,task.pieceId);
      if(found&&found.piece.animal==='mole'&&found.cell===task.target){
        const [mole]=room.board[found.cell].splice(found.index,1);
        room.board[found.cell].unshift(mole);
        note(room,'地鼠移動後觸發效果，移至目標格最下方。');
        queueReveal(room,task.target,true);
      } else if(found&&found.piece.animal==='krill'&&found.cell===task.target){
        const player=room.players.find(q=>q.id===actor.id);
        const targets=room.board.map((stack,i)=>stack.length===0?i:-1).filter(i=>i>=0);
        if(player?.hand.includes('krill')&&targets.length){
          room.pendingEffect={type:'krill-place',playerId:actor.id,pieceId:found.piece.uid,targets};
          return;
        }
      } else if(found&&found.piece.animal==='weasel'&&found.cell===task.target){
        const targets=room.board.map((stack,i)=>stack.length&&stack.at(-1).uid!==found.piece.uid&&adjacentCells(i).length?i:-1).filter(i=>i>=0);
        if(targets.length){
          room.pendingEffect={type:'weasel-select',playerId:actor.id,pieceId:found.piece.uid,targets};
          return;
        }
      } else if(found&&found.piece.animal==='eagle'&&found.cell===task.target){
        room.pendingEffect={type:'eagle-flight',playerId:actor.id,pieceId:found.piece.uid,cargoId:task.cargoId??null,from:found.cell,targets:room.board.map((_,i)=>i)};
        return;
      }
    }
  }
  finishAction(room,actor);
}
function finishAction(room, p) {
  if(room.active?.created && room.active?.moved){
    room.active=null;
    resolveLines(room,p);
    room.turn=(room.turn+1)%room.players.length;
    room.players.forEach(q=>{ if(q.hand.length>=8){note(room,`${q.name}手牌達8枚，遭淘汰。`);q.eliminated=true;room.bag.push(...q.hand);q.hand=[];} });
    room.players=room.players.filter(q=>!q.eliminated);
    if(room.players.length===1){room.winner=room.players[0].name;note(room,`${room.winner}獲勝！`);}
    if(room.players.length){room.turn=room.turn%room.players.length;if(!room.winner){draw(room,room.players[room.turn]);note(room,`${room.players[room.turn].name}的回合開始。`);}}
  }
}
function resolveLines(room, actor) {
  const lines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for(const cells of lines){
    const tops=cells.map(c=>room.board[c].at(-1)); if(!tops.every(Boolean)) continue;
    const isChameleonLine=tops.every(t=>t.animal==='chameleon');
    let chain=-1;
    if(!isChameleonLine){
      const species=tops.map(t=>animals.find(a=>a.id===t.animal));
      if(species.some(a=>!a||a.chain>=3)||!species.every(a=>a.chain===species[0].chain)) continue;
      const levels=species.map(a=>a.level).sort((a,b)=>a-b);
      if(levels.join(',')!=='1,2,3') continue;
      chain=species[0].chain;
    }
    const returned=cells.map(c=>room.board[c].pop().animal);
    room.bag.push(...returned);
    room.players.forEach(q=>{if(q!==actor)draw(room,q,1);});
    note(room,isChameleonLine?'三枚變色龍連成一線，棋子回到抽袋。':`食物鏈${chain+1}以一、二、三級棋子連成一線，棋子回到抽袋。`);
  }
}
function handle(room,p,msg){
  if(msg.type==='effectMove'){
    const pending=room.pendingEffect;
    if(!pending||pending.playerId!==p.id||!pending.targets.includes(msg.to))return;
    if(pending.type==='krill-place'){
      const handIndex=p.hand.indexOf('krill');
      if(handIndex<0||room.board[msg.to].length){room.pendingEffect=null;resolvePendingEffects(room,p);broadcast(room);return;}
      p.hand.splice(handIndex,1);
      const piece={uid:room.nextPieceId++,animal:'krill',level:1,owner:p.id};
      room.board[msg.to].push(piece);room.pendingEffect=null;
      room.active??={created:false,moved:true};room.active.moved=true;
      note(room,`${p.name}觸發磷蝦效果，將一枚磷蝦放到空格。`);
      resolvePendingEffects(room,p);broadcast(room);return;
    }
    if(pending.type==='reveal-choice'){
      const chosen=pending.candidates.find(candidate=>candidate.cell===msg.to);
      const top=chosen&&room.board[chosen.cell].at(-1);
      if(!chosen||top?.uid!==chosen.pieceId)return;
      room.pendingEffect=null;room.effectQueue.unshift({type:'reveal',...chosen});
      note(room,`${p.name}選擇觸發一個揭露效果。`);
      resolvePendingEffects(room,p);broadcast(room);return;
    }
    if(pending.type==='eagle-flight'){
      const eagle=findPiece(room,pending.pieceId),source=eagle&&room.board[eagle.cell];
      if(!eagle||eagle.piece.animal!=='eagle'||!source)return;
      const previousTop=source.at(-1)?.uid;
      let cargo=null;
      if(pending.cargoId){
        if(source[eagle.index-1]?.uid!==pending.cargoId)return;
        [cargo]=source.splice(eagle.index-1,1);
      }
      const refreshed=findPiece(room,pending.pieceId),[bird]=room.board[refreshed.cell].splice(refreshed.index,1);
      room.board[msg.to].push(...(cargo?[cargo]:[]),bird);
      room.pendingEffect=null;
      note(room,`${p.name}觸發老鷹效果，飛到第${msg.to+1}格。`);
      if(room.board[refreshed.cell].at(-1)?.uid!==previousTop)queueReveal(room,refreshed.cell);
      resolvePendingEffects(room,p);broadcast(room);return;
    }
    if(pending.type==='python-collect'){
      if(!pending.targets.includes(msg.to))return;
      const source=room.board[msg.to],moved=source.at(-1),python=findPiece(room,pending.pieceId);
      if(!moved||!python)return;
      source.pop();const stack=room.board[python.cell],currentPython=stack.findIndex(piece=>piece.uid===pending.pieceId);
      stack.splice(currentPython,0,moved);
      pending.targets=pending.targets.filter(cell=>cell!==msg.to);
      note(room,'蟒蛇將一枚相鄰棋子的最上方棋子收至自身下方。');
      if(pending.targets.length){broadcast(room);return;}
      const candidates=pending.sources.map(cell=>({cell,pieceId:room.board[cell].at(-1)?.uid})).filter(c=>c.pieceId);
      room.pendingEffect=null;room.effectQueue.unshift({type:'reveal-group',candidates});
      resolvePendingEffects(room,p);broadcast(room);return;
    }
    if(pending.type==='weasel-select'){
      const weasel=findPiece(room,pending.pieceId),stack=room.board[msg.to];
      if(!weasel||stack.at(-1)?.uid===weasel.piece.uid||!stack.length)return;
      const moved=stack.at(-1);
      room.pendingEffect={type:'weasel-target',playerId:p.id,pieceId:moved.uid,from:msg.to,targets:adjacentCells(msg.to),weaselId:pending.pieceId};
      broadcast(room);return;
    }
    if(pending.type==='weasel-target'){
      const source=room.board[pending.from],piece=source.at(-1);
      if(!piece||piece.uid!==pending.pieceId||!pending.targets.includes(msg.to))return;
      source.pop();room.board[msg.to].push(piece);room.pendingEffect=null;
      note(room,`${p.name}觸發黃鼬效果，移動了一枚其他棋子。`);
      queueReveal(room,pending.from);
      const species=animals.find(a=>a.id===piece.animal);
      if(species?.trigger==='移動')room.effectQueue.push({type:'after-move',pieceId:piece.uid,target:msg.to});
      resolvePendingEffects(room,p);broadcast(room);return;
    }
    if(pending.type!=='rabbit-move')return;
    const piece=room.board[pending.from].at(-1);
    if(!piece||piece.uid!==pending.pieceId){room.pendingEffect=null;resolvePendingEffects(room,p);broadcast(room);return;}
    room.board[pending.from].pop();room.board[msg.to].push(piece);room.pendingEffect=null;
    note(room,`${animals.find(a=>a.id===piece.animal).name}揭露後移動到相鄰格。`);
    queueReveal(room,pending.from,true);
    resolvePendingEffects(room,p);broadcast(room);return;
  }
  if(msg.type==='foxReturn'){
    const pending=room.pendingEffect;
    if(!pending||pending.type!=='fox-return'||pending.playerId!==p.id||!Array.isArray(msg.animals)||msg.animals.length!==pending.count)return;
    const available=new Map();for(const animal of p.hand)available.set(animal,(available.get(animal)||0)+1);
    for(const animal of msg.animals){const count=available.get(animal)||0;if(!count)return;available.set(animal,count-1);}
    const returned=[];
    for(const animal of msg.animals){const index=p.hand.indexOf(animal);returned.push(animal);p.hand.splice(index,1);}
    room.bag.push(...returned);shuffle(room.bag);room.pendingEffect=null;
    note(room,`${p.name}完成赤狐效果。`);
    resolvePendingEffects(room,p);broadcast(room);return;
  }
  if(msg.type==='sealChoose'){
    const pending=room.pendingEffect;
    if(!pending||pending.type!=='seal-select'||pending.playerId!==p.id||!Number.isInteger(msg.choice)||msg.choice<0||msg.choice>=pending.drawn.length)return;
    const seal=findPiece(room,pending.pieceId);if(!seal){room.bag.push(...pending.drawn);shuffle(room.bag);room.pendingEffect=null;resolvePendingEffects(room,p);broadcast(room);return;}
    const chosen=pending.drawn[msg.choice],returned=pending.drawn.filter((_,i)=>i!==msg.choice);
    const species=animals.find(a=>a.id===chosen),piece={uid:room.nextPieceId++,animal:chosen,...(species.level===0?{}:{level:species.level}),owner:p.id};
    room.board[seal.cell].splice(seal.index,0,piece);room.bag.push(...returned);shuffle(room.bag);room.pendingEffect=null;
    note(room,`${p.name}完成海豹效果。`);
    resolvePendingEffects(room,p);broadcast(room);return;
  }
  if(msg.type==='start'){
    if(p.id===room.hostId && room.players.length>=2 && !room.started){start(room);broadcast(room);}
    return;
  }
  if(room.pendingEffect)return;
  if(!room.started || room.players[room.turn]?.id!==p.id) return;
  if(msg.type==='create') {
    if(room.active?.created){note(room,'本回合已創造動物，不能再創造。');}
    else if(!p.hand.includes(msg.animal)){note(room,'無法創造：該棋子不在你的手牌中。');}
    else if(!canCreate(room,msg.animal,msg.cell)){note(room,'無法創造：所選格不符合放置規則。');}
    else {
      p.hand.splice(p.hand.indexOf(msg.animal),1); const piece={uid:room.nextPieceId++,animal:msg.animal,...(msg.animal==='chameleon'?{}:{level:animals.find(a=>a.id===msg.animal).level}),owner:p.id}; room.board[msg.cell].push(piece); room.active??={created:false,moved:false};room.active.created=true;
      room.effectQueue=[];room.effectSeen=new Set();queueReveal(room,msg.cell);note(room,`${p.name}創造了${animals.find(a=>a.id===msg.animal).name}。`);resolvePendingEffects(room,p);
    }
  }
  if(msg.type==='move' && !room.active?.moved && Number.isInteger(msg.from) && Number.isInteger(msg.to) && msg.from>=0 && msg.from<9 && msg.to>=0 && msg.to<9 && Math.abs(msg.from%3-msg.to%3)+Math.abs(Math.floor(msg.from/3)-Math.floor(msg.to/3))===1 && room.board[msg.from].length){
    const piece=room.board[msg.from].pop(); const species=animals.find(a=>a.id===piece.animal);let carried=null;
    if(species.id==='chameleon'||species.level>0){
      if(species.id==='eagle'&&room.board[msg.from].length)carried=room.board[msg.from].pop();
      if(carried)placeMovedPiece(room,carried,msg.to);
      placeMovedPiece(room,piece,msg.to);
      room.active??={created:false,moved:false};room.active.moved=true;
      room.effectQueue=[];room.effectSeen=new Set();queueReveal(room,msg.from);if(species.trigger==='移動')room.effectQueue.push({type:'after-move',pieceId:piece.uid,target:msg.to,...(carried?{cargoId:carried.uid}:{})});
      note(room,`${p.name}移動了${species.name}。`);resolvePendingEffects(room,p);
    } else room.board[msg.from].push(piece);
  }
  if(msg.type==='skip' && !room.active){draw(room,p,1);room.turn=(room.turn+1)%room.players.length;note(room,`${p.name}無法完成行動，抽取1枚棋子並跳過。`);}
  broadcast(room);
}
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');let file=u.pathname==='/'?'index.html':u.pathname.slice(1);if(file.includes('..')){res.writeHead(400).end();return;}const target=path.join(__dirname,file);fs.readFile(target,(err,data)=>{if(err){res.writeHead(404).end('Not found');return;}res.setHeader('Content-Type',target.endsWith('.js')?'text/javascript; charset=utf-8':target.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(data);});});
const wss=new WebSocketServer({server});
wss.on('connection',socket=>{let player=null,room=null;socket.on('message',raw=>{let m;try{m=JSON.parse(raw);}catch{return;}
  if(m.type==='createRoom'||m.type==='joinRoom'){const name=String(m.name||'玩家').trim().slice(0,16)||'玩家';let r;
    if(m.type==='createRoom'){let c;do{c=code();}while(rooms.has(c));r={code:c,players:[],board:Array.from({length:9},()=>[]),bag:[],started:false,turn:0,active:null,hostId:null,log:[],winner:null,pendingEffect:null,effectQueue:[],effectSeen:new Set(),nextPieceId:1};rooms.set(c,r);}
    else r=rooms.get(String(m.code||'').toUpperCase());
    if(!r){socket.send(JSON.stringify({type:'error',message:'找不到這個房間代碼。'}));return;}
    if(r.started||r.players.length>=4){socket.send(JSON.stringify({type:'error',message:'房間已開始或人數已滿。'}));return;}
    player={id:Math.random().toString(36).slice(2),name,color:colors[r.players.length],hand:[],connected:true,socket};room=r;r.players.push(player);if(!r.hostId)r.hostId=player.id;note(r,`${name}加入房間。`);socket.send(JSON.stringify({type:'joined',id:player.id}));broadcast(r);return;
  }
  if(room&&player)handle(room,player,m);
 });socket.on('close',()=>{if(room&&player){player.connected=false;note(room,`${player.name}離線。`);broadcast(room);}});});
server.listen(PORT,'0.0.0.0',()=>console.log(`Abstract Tabletop is listening on ${PORT}`));
