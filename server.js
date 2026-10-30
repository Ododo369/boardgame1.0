const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { chooseTurnPlan, chooseMove, choosePendingAction } = require('./ai');

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const boardLines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const animals = [
  { id: 'mole', name: '地鼠', chain: 0, level: 1, trigger: '移動', effect: '放至該格堆疊最底部' },
  { id: 'weasel', name: '黃鼬', chain: 0, level: 2, trigger: '移動', effect: '移動自己以外的一枚棋子' },
  { id: 'python', name: '蟒蛇', chain: 0, level: 3, trigger: '揭露', effect: '選擇一個相鄰格，將該格最上方棋子放至自身下方' },
  { id: 'rabbit', name: '兔子', chain: 1, level: 1, trigger: '揭露', effect: '自身移動一次' },
  { id: 'fox', name: '赤狐', chain: 1, level: 2, trigger: '揭露', effect: '抽2枚棋子，再選2枚放回靈魂庫' },
  { id: 'eagle', name: '老鷹', chain: 1, level: 3, trigger: '移動後', effect: '將老鷹放到任意一隻動物上方' },
  { id: 'krill', name: '磷蝦', chain: 2, level: 1, trigger: '移動', effect: '將手中的1隻磷蝦放到空格' },
  { id: 'seal', name: '海豹', chain: 2, level: 2, trigger: '揭露', effect: '抽1個靈魂加入手中，再從手中選1個放到自身下方' },
  { id: 'orca', name: '虎鯨', chain: 2, level: 3, trigger: '揭露', effect: '將自身以外1枚動物拿到手中' },
  { id: 'grasshopper', name: '蚱蜢', chain: 3, level: 1, trigger: '移動後', effect: '將自身與手中1個靈魂交換；手中沒有靈魂時不觸發' },
  { id: 'treefrog', name: '樹蛙', chain: 3, level: 2, trigger: '揭露', effect: '將自身與相鄰格1隻動物交換' },
  { id: 'crocodile', name: '鱷魚', chain: 3, level: 3, trigger: '移動後', effect: '選擇經過自身的橫、直或斜線，將線上自身以外的動物放回靈魂庫' },
  { id: 'chameleon', name: '變色龍', chain: 4, level: 0, trigger: '無', effect: '可視為任意等級' },
];
const chainNames = { 0:'食物鏈 A', 1:'食物鏈 B', 2:'食物鏈 C', 3:'食物鏈 D' };
const colors = ['#eb785d', '#4c9b8a', '#6384d8', '#d69a3d'];
const code = () => Math.random().toString(36).slice(2, 6).toUpperCase();
const shuffle = a => { for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
function broadcast(room) { for (const p of room.players) if (p.socket?.readyState === 1) p.socket.send(JSON.stringify({ type:'state', state: publicState(room,p.id) })); scheduleBot(room); }
function publicState(room, viewerId) {
  return { code:room.code, started:room.started, hostId:room.hostId, turn:room.turn, active:room.active,
    players:room.players.map(({id,name,hand,color,connected,isBot})=>({id,name,hand:id===viewerId?hand:[],handCount:hand.length,color,connected,isBot:!!isBot})),
    board:room.board, bagCount:room.bag.length, log:room.log.slice(-8), winner:room.winner,
    pendingEffect:room.pendingEffect?{type:room.pendingEffect.type,playerId:room.pendingEffect.playerId,pieceId:room.pendingEffect.pieceId,from:room.pendingEffect.from,targets:room.pendingEffect.targets,lines:room.pendingEffect.lines,...(room.pendingEffect.type==='fox-return'&&room.pendingEffect.playerId===viewerId?{count:room.pendingEffect.count}:{})}:null,
    lineEvents:room.lineEvents||[], eliminationEvent:room.eliminationEvent||null,
    chainOptions:Object.entries(chainNames).map(([id,name])=>({id:Number(id),name,animals:animals.filter(a=>a.chain===Number(id)).map(a=>({id:a.id,name:a.name,level:a.level,count:a.level===1?7:a.level===2?4:2}))})),
    selectedChains:room.selectedChains||null };
}
function note(room, text) { room.log.push(text); }
function draw(room, player, n=1) {
  if(n>0&&room.bag.length<n){
    let returned=0;const candidates=[];
    for(let cell=0;cell<room.board.length;cell++){
      const stack=room.board[cell];if(!stack.length)continue;
      room.bag.push(stack.pop().animal);returned++;
      const exposed=stack.at(-1);
      if(exposed&&animals.find(a=>a.id===exposed.animal)?.trigger==='揭露')candidates.push({cell,pieceId:exposed.uid});
    }
    if(candidates.length)room.effectQueue.unshift({type:'reveal-group',candidates});
    if(returned){shuffle(room.bag);note(room,`靈魂庫不足以分派${n}個靈魂，已將棋盤各格動物的靈魂收回並重新洗勻。`);}
  }
  for(let i=0;i<n&&room.bag.length;i++)player.hand.push(room.bag.pop());
}
function drawOpeningHand(room, player) {
  const levelOne = room.bag.map((id,i)=>animals.find(a=>a.id===id)?.level===1?i:-1).filter(i=>i>=0);
  if (!levelOne.length) { draw(room,player,3); return; }
  player.hand.push(room.bag.splice(levelOne[Math.floor(Math.random()*levelOne.length)],1)[0]); draw(room,player,2);
}
function start(room) {
  const countsByLevel={1:7,2:4,3:2};
  if(!room.selectedChains){room.selectedChains=shuffle(Object.keys(chainNames).map(Number)).slice(0,3);}
  const animalTiles=animals.filter(a=>room.selectedChains.includes(a.chain)).flatMap(a=>Array(countsByLevel[a.level]).fill(a.id));
  room.started=true; room.bag=shuffle([...animalTiles,'chameleon','chameleon','chameleon']);
  room.players.forEach(p=>drawOpeningHand(room,p)); room.turn=Math.floor(Math.random()*room.players.length); room.active=null; draw(room,room.players[room.turn]); note(room,`轉生工作開始！每位職員起始至少負責一個一級靈魂。${room.players[room.turn].name}開始值勤。`);
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
function queueReveal(room, cell, front=false, reason='reveal') {
  const piece=room.board[cell].at(-1);
  if(!piece)return;
  const species=animals.find(a=>a.id===piece.animal);
  if(species?.trigger==='揭露'){
    const task={type:'reveal',cell,pieceId:piece.uid,reason};
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
      const revealedSpecies=animals.find(a=>a.id===exposed.animal);
      note(room,task.reason==='create'?`第${task.cell+1}格安排出生的${revealedSpecies?.name||'動物'}觸發揭露效果。`:`第${task.cell+1}格的${revealedSpecies?.name||'棋子'}被揭露。`);
      if(exposed.animal==='rabbit'){
        room.pendingEffect={type:'rabbit-move',playerId:actor.id,pieceId:exposed.uid,from:task.cell,targets:adjacentCells(task.cell)};
        return;
      }
      if(exposed.animal==='fox'){
        const count=Math.min(2,room.bag.length);
        if(count){draw(room,actor,count);room.pendingEffect={type:'fox-return',playerId:actor.id,pieceId:exposed.uid,count};note(room,'赤狐觸發揭露效果，接收靈魂並選擇交回冥界。');return;}
      }
      if(exposed.animal==='seal'){
        const handSize=actor.hand.length;
        draw(room,actor,1);
        if(actor.hand.length>handSize){room.pendingEffect={type:'seal-select',playerId:actor.id,pieceId:exposed.uid,targets:[]};note(room,`${actor.name}觸發海豹揭露效果，抽取1個靈魂後，正在從手中選擇要放到海豹下方的動物。`);return;}
        note(room,'海豹觸發揭露效果，但靈魂庫無法抽取靈魂，能力未執行。');
      }
      if(exposed.animal==='treefrog'){
        const targets=adjacentCells(task.cell).filter(cell=>room.board[cell].length);
        if(targets.length){room.pendingEffect={type:'treefrog-swap',playerId:actor.id,pieceId:exposed.uid,from:task.cell,targets};note(room,'樹蛙觸發揭露效果，選擇相鄰動物交換位置。');return;}
      }
      if(exposed.animal==='orca'){
        const targets=room.board.map((stack,i)=>stack.length&&stack.at(-1).uid!==exposed.uid?i:-1).filter(i=>i>=0);
        if(targets.length){room.pendingEffect={type:'orca-take',playerId:actor.id,pieceId:exposed.uid,targets};note(room,'虎鯨觸發揭露效果，選擇一格拿走動物。');return;}
      }
      if(exposed.animal==='python'){
        const targets=adjacentCells(task.cell).filter(cell=>room.board[cell].length);
        if(targets.length){room.pendingEffect={type:'python-collect',playerId:actor.id,pieceId:exposed.uid,targets};note(room,'蟒蛇觸發揭露效果，選擇一個相鄰格的動物綁走。');return;}
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
      if(!found||found.cell!==task.target)continue;
      if(room.board[found.cell].at(-1)?.uid!==task.pieceId){
        const animal=animals.find(a=>a.id===found.piece.animal)?.name||'棋子';
        note(room,`${animal}移動後效果結算前已被其他棋子覆蓋，因此不觸發效果。`);
        continue;
      }
      if(found&&found.piece.animal==='mole'&&found.cell===task.target){
        const [mole]=room.board[found.cell].splice(found.index,1);
        room.board[found.cell].unshift(mole);
        note(room,'地鼠移動後觸發效果，放至目標格最下方。');
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
        const targets=room.board.map((stack,i)=>stack.length&&stack.at(-1).uid!==found.piece.uid?i:-1).filter(i=>i>=0);
        if(targets.length){room.pendingEffect={type:'eagle-flight',playerId:actor.id,pieceId:found.piece.uid,from:found.cell,targets};return;}
      } else if(found&&found.piece.animal==='grasshopper'&&found.cell===task.target){
        const player=room.players.find(q=>q.id===actor.id);
        if(player?.hand.length){room.pendingEffect={type:'grasshopper-swap',playerId:actor.id,pieceId:found.piece.uid,targets:[]};note(room,'蚱蜢觸發移動後能力，正在選擇要交換的手中靈魂。');return;}
      } else if(found&&found.piece.animal==='crocodile'&&found.cell===task.target){
        // Crocodile may choose any of the four lines passing through its cell,
        // including a line with no other animals on it.
        const lines=boardLines.filter(line=>line.includes(found.cell));
        if(lines.length){room.pendingEffect={type:'crocodile-line',playerId:actor.id,pieceId:found.piece.uid,targets:[],lines};note(room,'鱷魚觸發移動後能力，正在選擇要清理的路線。');return;}
      }
    }
  }
  finishAction(room,actor);
}
function advanceTurn(room, p) {
  const currentIndex=room.players.findIndex(q=>q.id===p.id);
  const eliminated=p.hand.length>=6;
  if(eliminated){
    note(room,`${p.name}回合結束時負責的靈魂達${p.hand.length}個（至少6個），向上司提出辭職；靈魂交回冥界，由下一任職員接手。`);
    room.eliminationEvent={id:room.nextEliminationEventId++,playerName:p.name,handCount:p.hand.length};
    if(p.socket?.readyState===1)p.socket.send(JSON.stringify({type:'eliminated',event:room.eliminationEvent}));
    room.bag.push(...p.hand);p.hand=[];shuffle(room.bag);
    room.players.splice(currentIndex,1);
  }
  if(room.players.length===1){room.winner=room.players[0].name;note(room,`${room.winner}成為本月最佳員工，獲得勝利！`);return;}
  if(room.players.length){
    room.turn=eliminated?currentIndex%room.players.length:(currentIndex+1)%room.players.length;
    draw(room,room.players[room.turn]);
    note(room,`${room.players[room.turn].name}開始本日行程。`);
    if(room.effectQueue.length)resolvePendingEffects(room,room.players[room.turn]);
  }
}
function finishAction(room, p) {
  if(room.advanceAfterEffects){
    if(!room.pendingEffect&&!room.effectQueue.length){
      const actor=room.players.find(player=>player.id===room.advanceAfterEffects)||p;room.advanceAfterEffects=null;
      resolveLines(room,actor);
      if(room.pendingEffect||room.effectQueue.length){room.advanceAfterEffects=actor.id;if(!room.pendingEffect)resolvePendingEffects(room,actor);return;}
      advanceTurn(room,actor);
    }
    return;
  }
  if(room.active?.created && room.active?.moved){
    room.active=null;room.botPlan=null;
    resolveLines(room,p);
    if(room.pendingEffect||room.effectQueue.length){room.advanceAfterEffects=p.id;if(!room.pendingEffect)resolvePendingEffects(room,p);return;}
    advanceTurn(room,p);
  }
}
function resolveLines(room, actor) {
  const lines=boardLines;
  let reward=false;
  while(true){
    const found=[];
    for(const cells of lines){
      const tops=cells.map(c=>room.board[c].at(-1));if(!tops.every(Boolean))continue;
      const isChameleonLine=tops.every(t=>t.animal==='chameleon');let chain=-1;
      if(!isChameleonLine){
        const species=tops.map(t=>animals.find(a=>a.id===t.animal));
        if(species.some(a=>!a||a.chain>=4)||!species.every(a=>a.chain===species[0].chain))continue;
        if(species.map(a=>a.level).sort((a,b)=>a-b).join(',')!=='1,2,3')continue;
        chain=species[0].chain;
      }
      found.push({cells,kind:isChameleonLine?'chameleon':'chain',chain});
    }
    if(!found.length)break;
    const clearedCells=new Set(found.flatMap(line=>line.cells));
    for(const cell of clearedCells){const piece=room.board[cell].pop();if(piece)room.bag.push(piece.animal);}
    shuffle(room.bag);
    for(const line of found){
      const event={id:room.nextLineEventId++,cells:line.cells.slice(),kind:line.kind};room.lineEvents.push(event);
      setTimeout(()=>{room.lineEvents=room.lineEvents.filter(e=>e.id!==event.id);broadcast(room);},1500);
      note(room,line.kind==='chameleon'?'完成平衡，動物靈魂自然回歸冥界。':`${chainNames[line.chain]}完成平衡，動物靈魂自然回歸冥界。`);
    }
    reward=true;
  }
  if(reward){note(room,`${actor.name}完成生態平衡，獲得一天假期；其他職員各接收一個新靈魂。`);room.players.forEach(q=>{if(q!==actor)draw(room,q,1);});}
}
function handle(room,p,msg){
  if(msg.type==='grasshopperSwap'){
    const pending=room.pendingEffect;
    if(!pending||pending.type!=='grasshopper-swap'||pending.playerId!==p.id||!Number.isInteger(msg.handIndex)||msg.handIndex<0||msg.handIndex>=p.hand.length)return;
    const grasshopper=findPiece(room,pending.pieceId);
    if(!grasshopper||grasshopper.piece.animal!=='grasshopper'||room.board[grasshopper.cell].at(-1)?.uid!==grasshopper.piece.uid){room.pendingEffect=null;resolvePendingEffects(room,p);broadcast(room);return;}
    const [chosen]=p.hand.splice(msg.handIndex,1),species=animals.find(a=>a.id===chosen);
    grasshopper.piece.animal=chosen;
    if(species.level===0)delete grasshopper.piece.level;else grasshopper.piece.level=species.level;
    p.hand.push('grasshopper');room.pendingEffect=null;
    note(room,`${p.name}觸發蚱蜢效果，將蚱蜢與手中一個靈魂交換。`);
    queueReveal(room,grasshopper.cell,true);
    resolvePendingEffects(room,p);broadcast(room);return;
  }
  if(msg.type==='crocodileLine'){
    const pending=room.pendingEffect,line=pending?.lines?.[msg.lineIndex],crocodile=pending&&findPiece(room,pending.pieceId);
    if(!pending||pending.type!=='crocodile-line'||pending.playerId!==p.id||!Array.isArray(line)||!crocodile||!line.includes(crocodile.cell))return;
    let removed=0;const candidates=[];
    for(const cell of line){
      if(cell===crocodile.cell)continue;
      const stack=room.board[cell],piece=stack.at(-1);if(!piece)continue;
      stack.pop();room.bag.push(piece.animal);removed++;
      const exposed=stack.at(-1),species=exposed&&animals.find(a=>a.id===exposed.animal);
      if(species?.trigger==='揭露')candidates.push({cell,pieceId:exposed.uid});
    }
    shuffle(room.bag);room.pendingEffect=null;
    note(room,`${p.name}觸發鱷魚效果，將所選直線上${removed}隻其他動物送回靈魂庫。`);
    if(candidates.length)room.effectQueue.unshift({type:'reveal-group',candidates});
    resolvePendingEffects(room,p);broadcast(room);return;
  }
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
      note(room,`${p.name}觸發磷蝦效果，安排一隻磷蝦在空格出生。`);
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
    if(pending.type==='treefrog-swap'){
      const frog=findPiece(room,pending.pieceId),source=frog&&room.board[frog.cell],destination=room.board[msg.to];
      if(!frog||frog.piece.animal!=='treefrog'||source.at(-1)?.uid!==frog.piece.uid||!pending.targets.includes(msg.to)||!destination?.length)return;
      const [frogTop]=source.splice(-1),[otherTop]=destination.splice(-1);
      source.push(otherTop);destination.push(frogTop);room.pendingEffect=null;
      note(room,`${p.name}觸發樹蛙效果，與第${msg.to+1}格的動物交換位置。`);
      resolvePendingEffects(room,p);broadcast(room);return;
    }
    if(pending.type==='eagle-flight'){
      const eagle=findPiece(room,pending.pieceId),source=eagle&&room.board[eagle.cell];
      if(!eagle||eagle.piece.animal!=='eagle'||!source)return;
      const destination=room.board[msg.to];
      if(!destination?.length||destination.at(-1)?.uid===pending.pieceId)return;
      const previousTop=source.at(-1)?.uid;
      const refreshed=findPiece(room,pending.pieceId),[bird]=room.board[refreshed.cell].splice(refreshed.index,1);
      destination.push(bird);
      room.pendingEffect=null;
      note(room,`${p.name}觸發老鷹效果，將老鷹放到第${msg.to+1}格動物之上。`);
      const top=room.board[refreshed.cell].at(-1);
      if(top&&top.uid!==previousTop)queueReveal(room,refreshed.cell,true);
      resolvePendingEffects(room,p);broadcast(room);return;
    }
    if(pending.type==='orca-take'){
      const stack=room.board[msg.to],taken=stack.at(-1);
      if(!taken)return;
      stack.pop();p.hand.push(taken.animal);room.pendingEffect=null;
      note(room,`${p.name}觸發虎鯨效果，將一隻動物的靈魂收回拿到手中。`);
      queueReveal(room,msg.to,true);
      resolvePendingEffects(room,p);broadcast(room);return;
    }
    if(pending.type==='python-collect'){
      if(!pending.targets.includes(msg.to))return;
      const source=room.board[msg.to],moved=source.at(-1),python=findPiece(room,pending.pieceId);
      if(!moved||!python)return;
      source.pop();const stack=room.board[python.cell],currentPython=stack.findIndex(piece=>piece.uid===pending.pieceId);
      stack.splice(currentPython,0,moved);
      room.pendingEffect=null;
      note(room,'蟒蛇將所選相鄰格一隻動物放至自身下方。');
      queueReveal(room,msg.to,true);
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
      if(species?.trigger==='移動'||species?.trigger==='移動後')room.effectQueue.push({type:'after-move',pieceId:piece.uid,target:msg.to});
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
    if(!pending||pending.type!=='seal-select'||pending.playerId!==p.id||!Number.isInteger(msg.handIndex)||msg.handIndex<0||msg.handIndex>=p.hand.length)return;
    const seal=findPiece(room,pending.pieceId);if(!seal){room.pendingEffect=null;resolvePendingEffects(room,p);broadcast(room);return;}
    const [chosen]=p.hand.splice(msg.handIndex,1);
    const species=animals.find(a=>a.id===chosen),piece={uid:room.nextPieceId++,animal:chosen,...(species.level===0?{}:{level:species.level}),owner:p.id};
    room.board[seal.cell].splice(seal.index,0,piece);room.pendingEffect=null;
    note(room,`${p.name}完成海豹效果。`);
    resolvePendingEffects(room,p);broadcast(room);return;
  }
  if(msg.type==='start'){
    if(p.id===room.hostId && room.players.length>=2 && !room.started){start(room);broadcast(room);}
    return;
  }
  if(msg.type==='selectChains'){
    if(p.id!==room.hostId||room.started||!Array.isArray(msg.chainIds))return;
    const valid=Object.keys(chainNames).map(Number),chosen=[...new Set(msg.chainIds)].filter(id=>valid.includes(id)).slice(0,3);
    const remainder=shuffle(valid.filter(id=>!chosen.includes(id))).slice(0,3-chosen.length);
    room.selectedChains=[...chosen,...remainder];
    note(room,`本局食物鏈已選定：${room.selectedChains.map(id=>chainNames[id]).join('、')}。`);
    broadcast(room);return;
  }
  if(room.pendingEffect)return;
  if(!room.started || room.players[room.turn]?.id!==p.id) return;
  if(msg.type==='create') {
    if(room.active?.created){note(room,'本回合已安排動物出生，不能再安排。');}
    else if(!p.hand.includes(msg.animal)){note(room,'無法安排出生：你目前沒有這個動物的靈魂。');}
    else if(!canCreate(room,msg.animal,msg.cell)){note(room,'無法安排出生：所選格不符合等級規則。');}
    else {
      p.hand.splice(p.hand.indexOf(msg.animal),1); const piece={uid:room.nextPieceId++,animal:msg.animal,...(msg.animal==='chameleon'?{}:{level:animals.find(a=>a.id===msg.animal).level}),owner:p.id}; room.board[msg.cell].push(piece); room.active??={created:false,moved:false};room.active.created=true;
      room.effectQueue=[];room.effectSeen=new Set();queueReveal(room,msg.cell,false,'create');note(room,`${p.name}安排${animals.find(a=>a.id===msg.animal).name}誕生。`);resolvePendingEffects(room,p);
    }
  }
  if(msg.type==='move' && !room.active?.moved && Number.isInteger(msg.from) && Number.isInteger(msg.to) && msg.from>=0 && msg.from<9 && msg.to>=0 && msg.to<9 && Math.abs(msg.from%3-msg.to%3)+Math.abs(Math.floor(msg.from/3)-Math.floor(msg.to/3))===1 && room.board[msg.from].length){
    const piece=room.board[msg.from].pop(); const species=animals.find(a=>a.id===piece.animal);
    if(species.id==='chameleon'||species.level>0){
      placeMovedPiece(room,piece,msg.to);
      room.active??={created:false,moved:false};room.active.moved=true;
      room.effectQueue=[];room.effectSeen=new Set();
      queueReveal(room,msg.from);
      if(species.trigger==='移動'||species.trigger==='移動後')room.effectQueue.push({type:'after-move',pieceId:piece.uid,target:msg.to});
      note(room,species.id==='eagle'?`${p.name}將老鷹移到相鄰格；移動後可將老鷹放到場上任意一隻動物上方。`:`${p.name}移動了${species.name}。`);resolvePendingEffects(room,p);
    } else room.board[msg.from].push(piece);
  }
  if(msg.type==='skip' && !room.active){draw(room,p,1);note(room,`${p.name}無法完成本回合行動，接收1個靈魂並跳過。`);if(room.effectQueue.length){room.advanceAfterEffects=p.id;resolvePendingEffects(room,p);}else advanceTurn(room,p);}
  broadcast(room);
}
function scheduleBot(room,delay=520){
  if(!room.started||room.winner||room.botScheduled||room.botThinking)return;
  const bot=room.players.find(player=>player.isBot);if(!bot)return;
  const botActs=room.pendingEffect?room.pendingEffect.playerId===bot.id:room.players[room.turn]?.id===bot.id;
  if(!botActs)return;
  room.botScheduled=true;
  setTimeout(()=>{room.botScheduled=false;runBotStep(room,bot);},delay);
}
function runBotStep(room,bot){
  if(room.winner||!room.players.includes(bot))return;
  const isPending=room.pendingEffect?.playerId===bot.id;
  if(!isPending&&room.players[room.turn]?.id!==bot.id)return;
  room.botThinking=true;
  try{
    if(isPending){
      let action=choosePendingAction(room.board,bot.hand,room.pendingEffect,bot.id);
      if(!action){
        const pending=room.pendingEffect;
        if(pending.type==='fox-return')action={type:'foxReturn',animals:bot.hand.slice(0,pending.count)};
        else if(pending.type==='seal-select')action={type:'sealChoose',handIndex:0};
        else if(pending.targets?.length)action={type:'effectMove',to:pending.targets[0]};
      }
      if(action)handle(room,bot,action);
      return;
    }
    if(!room.active?.created){
      let plan=room.botPlan?.playerId===bot.id?room.botPlan:chooseTurnPlan(room.board,bot.hand,bot.id);
      if(!plan){handle(room,bot,{type:'skip'});return;}
      room.botPlan={playerId:bot.id,create:plan.create,move:plan.move,order:plan.order};
      const plannedMove=plan.move&&room.board[plan.move.from]?.at(-1)?.animal===plan.move.animal&&adjacentCells(plan.move.from).includes(plan.move.to);
      if(plan.order==='move-first'&&!room.active?.moved){
        const action=plannedMove?plan.move:chooseMove(room.board,bot.id);
        if(action){handle(room,bot,{type:'move',from:action.from,to:action.to});return;}
      }
      if(!plan.create||!bot.hand.includes(plan.create.animal)||!canCreate(room,plan.create.animal,plan.create.cell)){
        plan=chooseTurnPlan(room.board,bot.hand,bot.id);
        if(!plan){handle(room,bot,{type:'skip'});return;}
        room.botPlan={playerId:bot.id,create:plan.create,move:plan.move,order:'create-first'};
      }
      handle(room,bot,{type:'create',animal:room.botPlan.create.animal,cell:room.botPlan.create.cell});
      return;
    }
    if(!room.active?.moved){
      let action=room.botPlan?.playerId===bot.id?room.botPlan.move:null;
      if(!action||!room.board[action.from]?.length||room.board[action.from].at(-1)?.animal!==action.animal||!adjacentCells(action.from).includes(action.to))action=chooseMove(room.board,bot.id);
      room.botPlan=null;
      if(action)handle(room,bot,{type:'move',from:action.from,to:action.to});
      else if(!room.active?.created)handle(room,bot,{type:'skip'});
    }
  }catch(error){
    console.error('AI turn failed:',error);
  }finally{
    room.botThinking=false;
    scheduleBot(room,520);
  }
}
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');let file=u.pathname==='/'?'index.html':u.pathname.slice(1);if(file.includes('..')){res.writeHead(400).end();return;}const target=path.join(__dirname,file);fs.readFile(target,(err,data)=>{if(err){res.writeHead(404).end('Not found');return;}res.setHeader('Content-Type',target.endsWith('.js')?'text/javascript; charset=utf-8':target.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(data);});});
const wss=new WebSocketServer({server});
wss.on('connection',socket=>{let player=null,room=null;socket.on('message',raw=>{let m;try{m=JSON.parse(raw);}catch{return;}
  if(m.type==='createRoom'||m.type==='createSoloRoom'||m.type==='joinRoom'){const name=String(m.name||'職員').trim().slice(0,16)||'職員';const solo=m.type==='createSoloRoom';let r;
    if(m.type==='createRoom'||solo){let c;do{c=code();}while(rooms.has(c));r={code:c,players:[],board:Array.from({length:9},()=>[]),bag:[],started:false,turn:0,active:null,hostId:null,log:[],winner:null,pendingEffect:null,effectQueue:[],effectSeen:new Set(),nextPieceId:1,lineEvents:[],nextLineEventId:1,eliminationEvent:null,nextEliminationEventId:1,selectedChains:null,advanceAfterEffects:null,botScheduled:false,botThinking:false,botPlan:null};rooms.set(c,r);}
    else r=rooms.get(String(m.code||'').toUpperCase());
    if(!r){socket.send(JSON.stringify({type:'error',message:'找不到這個房間代碼。'}));return;}
    if(r.started||r.players.length>=4){socket.send(JSON.stringify({type:'error',message:'房間已開始或人數已滿。'}));return;}
    player={id:Math.random().toString(36).slice(2),name,color:colors[r.players.length],hand:[],connected:true,socket,isBot:false};room=r;r.players.push(player);if(!r.hostId)r.hostId=player.id;
    if(solo)r.players.push({id:`bot-${r.code}`,name:'AI 員工',color:'#7047a3',hand:[],connected:true,socket:null,isBot:true});
    note(r,`${name}加入轉生部門值勤。`);socket.send(JSON.stringify({type:'joined',id:player.id}));
    broadcast(r);return;
  }
  if(room&&player)handle(room,player,m);
 });socket.on('close',()=>{if(room&&player){player.connected=false;note(room,`${player.name}暫時離開遊戲。`);broadcast(room);}});});
server.listen(PORT,'0.0.0.0',()=>console.log(`Abstract Tabletop is listening on ${PORT}`));
