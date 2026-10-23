const $=s=>document.querySelector(s);
let ws,me=null,state=null,selectedHand=null,selectedCell=null,mode='',selectedFoxReturns=[],seenLineEventIds=new Set(),boardEffects=[],nextBoardEffectId=1,turnNoticeTimer=null;
const emoji={mole:'🐭',weasel:'<svg class="animal-icon weasel-icon" viewBox="0 0 64 64" role="img" aria-label="黃鼬"><path d="M17 37C10 34 7 28 9 24c1-2 4-1 3 2-1 4 3 7 9 8" fill="none" stroke="#633b27" stroke-width="4" stroke-linecap="round"/><path d="M16 38c6-9 18-11 29-7 5 2 8 5 12 7-4 2-6 5-11 7-11 5-23 3-30-3z" fill="#b97842" stroke="#633b27" stroke-width="2" stroke-linejoin="round"/><path d="M22 42c8 3 17 3 25-1-5 6-16 8-24 4z" fill="#f0dfbf"/><path d="M39 33c4-7 10-9 15-5 3 2 4 5 5 8l-6 4c-5 1-10-1-14-7z" fill="#c88449" stroke="#633b27" stroke-width="2" stroke-linejoin="round"/><path d="M46 29c-1-5 5-6 7-2" fill="#c88449" stroke="#633b27" stroke-width="2"/><path d="M49 29c0-2 2-3 3-1" fill="#e9a3a0"/><path d="M18 44l-2 5m11-4-1 5m16-6 1 5" fill="none" stroke="#633b27" stroke-width="2.5" stroke-linecap="round"/><circle cx="53" cy="32" r="1.7" fill="#211b17"/><path d="M58 35l3 1-3 2" fill="#633b27" stroke="#633b27" stroke-linejoin="round"/></svg>',python:'🐍',rabbit:'🐇',fox:'🦊',eagle:'🦅',krill:'🦐',seal:'🦭',orca:'🐋',chameleon:'🦎'};
const names={mole:'地鼠',weasel:'黃鼬',python:'蟒蛇',rabbit:'兔子',fox:'赤狐',eagle:'老鷹',krill:'磷蝦',seal:'海豹',orca:'虎鯨',chameleon:'變色龍'};
const levels={mole:1,weasel:2,python:3,rabbit:1,fox:2,eagle:3,krill:1,seal:2,orca:3,chameleon:0};
const effects={mole:['移動','放置到該格堆疊最下方'],weasel:['移動','可移動自身以外的一枚棋子一次'],python:['揭露','將所有相鄰格最上方棋子依任意順序放置到自身下方'],rabbit:['揭露','自身移動一次'],fox:['揭露','抽2枚棋子到手中，再選擇2枚放回抽袋'],eagle:['移動','將自身與位於自身下方的一枚棋子一起放置到任意格最上方，順序不變'],krill:['移動','可將手中的1枚磷蝦放置到空格'],seal:['揭露','抽取2枚棋子，選擇1枚放置到自身下方，另一枚放回抽袋'],orca:['揭露','將場上除自身以外的1枚棋子拿到手中'],chameleon:['任意時間','可視為任意等級']};
function tooltip(animal){const [trigger,effect]=effects[animal]||['未定','尚無效果資料'];return `${names[animal]}｜觸發時機：${trigger}｜效果：${effect}`;}
function send(o){if(ws?.readyState===1)ws.send(JSON.stringify(o))}
function connect(type){const name=$('#name').value.trim()||'玩家';localStorage.setItem('abstractName',name);ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}`);ws.onopen=()=>send(type==='create'?{type:'createRoom',name}:{type:'joinRoom',name,code:$('#room-code').value.trim()});ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='error'){$('#lobby-message').textContent=m.message;return}if(m.type==='joined')me=m.id;if(m.type==='state'){const oldState=state,oldBoard=state?.board,oldTurn=state?.started?state.players[state.turn]?.id:null;state=m.state;if(oldBoard)recordBoardChanges(oldBoard,state.board);const current=state.players[state.turn];if(state.started&&!state.winner&&current?.id&&current.id!==oldTurn)showTurnNotice(current);render();if(oldState)animateDraws(oldState,state)}};ws.onclose=()=>{if(state)$('#action-help').textContent='連線中斷，請重新整理並重新加入'};}
function animateDraws(before,after){
 const oldPlayer=before.players?.find(p=>p.id===me),newPlayer=after.players?.find(p=>p.id===me);
 if(!oldPlayer||!newPlayer||!Number.isFinite(before.bagCount)||!Number.isFinite(after.bagCount))return;
 const openingDeal=!before.started&&after.started;
 const foxDraw=after.pendingEffect?.type==='fox-return'&&after.pendingEffect.playerId===me;
 const remaining=[...oldPlayer.hand],added=[];
 for(const animal of newPlayer.hand){const index=remaining.indexOf(animal);if(index>=0)remaining.splice(index,1);else added.push(animal);}
 let destinations=added.map((animal,index)=>({animal,selector:`#hand [data-hand="${oldPlayer.hand.length+index}"]`,hide:true}));
 if(!destinations.length&&after.pendingEffect?.type==='seal-select'&&after.pendingEffect.playerId===me){
  const oldDrawn=before.pendingEffect?.type==='seal-select'&&before.pendingEffect.playerId===me?before.pendingEffect.drawn||[]:[];
  const waiting=[...oldDrawn];
  (after.pendingEffect.drawn||[]).forEach((animal,index)=>{const found=waiting.indexOf(animal);if(found>=0)waiting.splice(found,1);else destinations.push({animal,selector:`#hand [data-seal-choice="${index}"]`,hide:false});});
 }
 if(!destinations.length||(!openingDeal&&!foxDraw&&after.bagCount>=before.bagCount))return;
 const bag=$('#bag-count'),bagRect=bag?.getBoundingClientRect();if(!bagRect)return;
 const fromX=bagRect.left+bagRect.width/2,fromY=bagRect.top+bagRect.height/2;
 destinations.forEach(({animal,selector,hide},index)=>{const target=$(selector);if(!target)return;const rect=target.getBoundingClientRect(),fly=document.createElement('span');if(hide)target.closest('.hand-piece')?.classList.add('hand-arriving');fly.className='draw-fly piece';fly.innerHTML=emoji[animal];fly.style.setProperty('--c',colorFor(animal));fly.style.left=`${fromX-22}px`;fly.style.top=`${fromY-22}px`;document.body.append(fly);const dx=rect.left+rect.width/2-fromX,dy=rect.top+rect.height/2-fromY;fly.animate([{transform:'translate(0,0) scale(.8)',opacity:1},{transform:`translate(${dx*.55}px,${dy*.55-48}px) scale(1.2)`,opacity:1,offset:.62},{transform:`translate(${dx}px,${dy}px) scale(.65)`,opacity:0}],{duration:1320,delay:index*240,easing:'cubic-bezier(.2,.75,.25,1)'}).onfinish=()=>{fly.remove();if(hide)target.closest('.hand-piece')?.classList.remove('hand-arriving');};});
}
function showTurnNotice(player){const notice=$('#turn-notice');clearTimeout(turnNoticeTimer);notice.innerHTML=`<span class="turn-notice-label">回合開始</span><strong><i class="dot" style="--c:${player.color}"></i>${esc(player.name)}</strong><span>請開始行動</span>`;notice.classList.remove('show');void notice.offsetWidth;notice.classList.add('show');turnNoticeTimer=setTimeout(()=>notice.classList.remove('show'),2400);}
$('#name').value=localStorage.getItem('abstractName')||'';$('#create').onclick=()=>connect('create');$('#join').onclick=()=>connect('join');$('#room-code').oninput=e=>e.target.value=e.target.value.toUpperCase();$('#copy').onclick=()=>navigator.clipboard.writeText(state.code);$('#start').onclick=()=>send({type:'start'});
function canPlaceLevel(level,cell){const stack=state.board[cell];if(level===1)return stack.length===0;if(!stack.length)return false;if(stack.at(-1).animal==='chameleon')return true;return (stack.at(-1).level??levels[stack.at(-1).animal])===level-1;}
function canPlace(animal,cell){const stack=state.board[cell];if(animal!=='chameleon')return canPlaceLevel(levels[animal],cell);if(!stack.length||stack.at(-1).animal==='chameleon')return true;return (stack.at(-1).level??levels[stack.at(-1).animal])<3;}
function anyPlace(animal){return state.board.some((_,i)=>canPlace(animal,i));}
function render(){
 const self=state.players.find(p=>p.id===me),turn=state.players[state.turn],myTurn=turn?.id===me;
 $('#action-help').textContent=actionHelpText(self,turn,myTurn);
 $('#lobby').classList.add('hidden');$('#game').classList.remove('hidden');$('#room-display').textContent=state.code;$('#bag-count').textContent=state.bagCount;$('#player-count').textContent=`(${state.players.length}/4)`;
 $('#start').classList.toggle('hidden',me!==state.hostId||state.started);$('#waiting-hint').textContent=state.started?'':state.players.length<2?'至少需要2位玩家才能開始':'人數到齊後由房主開始';
 $('#players').innerHTML=state.players.map(p=>`<div class="player ${p.id===turn?.id&&state.started?'current':''}"><i class="dot" style="--c:${p.color}"></i>${esc(p.name)}${p.id===state.hostId?' <span>房主</span>':''}<small>${p.handCount??p.hand.length}枚</small></div>`).join('');
 $('#hand-count').textContent=`${self?.hand.length||0} 枚`;
 const mayCreate=state.started&&myTurn&&!state.active?.created&&!state.pendingEffect;
 const choosingFox=state.pendingEffect?.type==='fox-return'&&state.pendingEffect.playerId===me;
 const choosingSeal=state.pendingEffect?.type==='seal-select'&&state.pendingEffect.playerId===me;
 const sealChoices=choosingSeal?`<div class="effect-choice"><span>海豹抽到的棋子（只有你可見）</span>${state.pendingEffect.drawn.map((a,i)=>`<button data-seal-choice="${i}">${emoji[a]} ${names[a]}</button>`).join('')}</div>`:'';
 const handPieces=self?.hand||[],slotCount=Math.max(6,handPieces.length);
 const handSlots=Array.from({length:slotCount},(_,i)=>{const skull=i===5?`<span class="hand-skull" title="回合結束時手牌達6枚即淘汰">💀</span>`:'';if(i>=handPieces.length)return `<div class="hand-piece hand-slot empty-slot">${skull}</div>`;const a=handPieces[i],placeable=mayCreate&&anyPlace(a),foxSelected=selectedFoxReturns.includes(i);return `<div class="hand-piece hand-slot ${selectedHand===i||foxSelected?'selected':''} ${placeable?'placeable':''} ${mayCreate&&!placeable?'unavailable':''}">${skull}<span class="piece" title="${esc(tooltip(a))}" style="--c:${colorFor(a)}">${emoji[a]}</span><button title="${esc(tooltip(a))}" data-hand="${i}" ${choosingFox?'':!mayCreate||!anyPlace(a)?'disabled':''}>${names[a]}</button></div>`}).join('');
 $('#hand').innerHTML=sealChoices+handSlots;
 $('#hand').querySelectorAll('[data-seal-choice]').forEach(b=>b.onclick=()=>send({type:'sealChoose',choice:+b.dataset.sealChoice}));
 $('#hand').querySelectorAll('[data-hand]').forEach(b=>b.onclick=()=>{const i=+b.dataset.hand;if(choosingFox){selectedFoxReturns=selectedFoxReturns.includes(i)?selectedFoxReturns.filter(x=>x!==i):[...selectedFoxReturns,i];if(selectedFoxReturns.length===state.pendingEffect.count){send({type:'foxReturn',animals:selectedFoxReturns.map(index=>self.hand[index])});selectedFoxReturns=[];}render();return;}selectedHand=i;selectedCell=null;mode='create';render()});
 const freshLineEvents=(state.lineEvents||[]).filter(event=>!seenLineEventIds.has(event.id));freshLineEvents.forEach(event=>seenLineEventIds.add(event.id));
 const lineOverlay=freshLineEvents.map(event=>{const start=event.cells[0],end=event.cells.at(-1),x=cell=>cell%3*100+50,y=cell=>Math.floor(cell/3)*100+50;return `<line class="line-sweep ${event.kind}" x1="${x(start)}" y1="${y(start)}" x2="${x(end)}" y2="${y(end)}"/>`;}).join('');
 const visibleBoardEffects=boardEffects.filter(effect=>effect.expiresAt>Date.now());
 const moveOverlay=visibleBoardEffects.filter(effect=>Number.isInteger(effect.from)).map(effect=>{const x=cell=>cell%3*100+50,y=cell=>Math.floor(cell/3)*100+50;return `<line class="move-trace" x1="${x(effect.from)}" y1="${y(effect.from)}" x2="${x(effect.to)}" y2="${y(effect.to)}"/>`;}).join('');
 $('#board').innerHTML=state.board.map((stack,i)=>{const isTarget=mode==='create'&&selectedHand!==null&&canPlace(self.hand[selectedHand],i),isEffectTarget=state.pendingEffect?.playerId===me&&state.pendingEffect.targets.includes(i),top=stack.at(-1),isRevealChoice=['rabbit-move','fox-return','seal-select','python-collect','orca-take'].includes(state.pendingEffect?.type)&&top?.uid===state.pendingEffect?.pieceId,isRevealGroup=state.pendingEffect?.type==='reveal-choice'&&state.pendingEffect.targets.includes(i),lineKinds=freshLineEvents.filter(event=>event.cells.includes(i)).map(event=>event.kind),lineClass=lineKinds.length?`line-clearing ${lineKinds.includes('chameleon')?'line-chameleon':'line-chain'}`:'',moveOrigin=visibleBoardEffects.some(effect=>effect.from===i),moveDestination=visibleBoardEffects.some(effect=>effect.to===i),cellChanged=visibleBoardEffects.some(effect=>effect.cell===i),moveClass=`${moveOrigin?'move-origin ':''}${moveDestination?'move-destination ':''}${cellChanged?'board-changed':''}`,tip=top?tooltip(top.animal):'';return `<button class="cell ${selectedCell===i?'selected':''} ${isTarget?'target':''} ${isEffectTarget?'effect-target':''} ${isRevealChoice||isRevealGroup?'revealed':''} ${lineClass} ${moveClass}" data-cell="${i}"><span class="stack">${top?`<i class="piece top piece-tip" data-tooltip="${esc(tip)}" style="--c:${ownerColor(top.owner)}" title="${esc(tip)}">${emoji[top.animal]}</i><span class="stack-count" title="此格共有 ${stack.length} 枚棋子">×${stack.length}</span>`:''}</span><span class="cell-number">${i+1}</span></button>`}).join('')+`<svg class="line-effects" viewBox="0 0 300 300" preserveAspectRatio="none" aria-hidden="true">${lineOverlay}</svg><svg class="move-effects" viewBox="0 0 300 300" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="move-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0L8 4L0 8z"/></marker></defs>${moveOverlay}</svg>`;
 $('#board').querySelectorAll('[data-cell]').forEach(b=>b.onclick=()=>cellClick(+b.dataset.cell));
 $('#log').innerHTML=state.log.slice().reverse().map(t=>`<div class="log-line">${esc(t)}</div>`).join('');
}
function actionHelpText(self,turn,myTurn){
 const pending=state.pendingEffect;
 if(pending){
  const player=state.players.find(p=>p.id===pending.playerId),isActor=player?.id===me;
  const status={'seal-select':'海豹在思考要私藏的動物','rabbit-move':'兔子正在想要逃去哪裡','weasel-select':'黃鼬在思考要嚇跑誰','weasel-target':'黃鼬在思考要嚇跑誰','python-collect':'蟒蛇在考慮用餐順序','fox-return':'赤狐在想誰不適合當同伴','eagle-flight':'老鷹在思考要帶著食物飛到哪個山頂','krill-place':'磷蝦在找尋完美的產卵地點','orca-take':'虎鯨在尋找明天的晚餐','reveal-choice':'正在決定要先觸發哪個揭露效果'}[pending.type]||'正在處理棋子效果';
  const instruction={'rabbit-move':'選擇一個亮起的相鄰格移動兔子','krill-place':'選擇一個亮起的空格放置手中的磷蝦','weasel-select':'選擇一枚自己以外的最上方棋子','weasel-target':'選擇亮起的相鄰格移動該棋子','eagle-flight':'選擇任意格，把老鷹與目前在它正下方的棋子疊好放到最上方','orca-take':'選擇自身以外一格，將該格最上方棋子拿到手中','fox-return':`選擇手中${pending.count}枚棋子放回抽袋（已選 ${selectedFoxReturns.length} 枚）`,'seal-select':'從剛抽到的棋子中選一枚放在海豹下方（抽到的棋子只有你可見）','python-collect':'依序選擇相鄰格最上方的棋子收取','reveal-choice':'選擇一枚棋子觸發其揭露效果'}[pending.type];
  return `${player?.name||'玩家'}：${status}${isActor&&instruction?'。'+instruction:''}`;
 }
 return !state.started?'房主開始遊戲後即可行動':!myTurn?'等待 '+(turn?.name||'玩家')+' 行動':state.active?.created&&!state.active?.moved?'已創造動物，請移動一枚棋子':state.active?.moved&&!state.active?.created?'已移動棋子，請創造一隻動物':mode==='create'?'選擇一個亮起的格子放置棋子':mode==='move'?'點選棋子堆，再點相鄰格':'選擇一枚發亮的手牌創造動物，或點棋盤棋子移動';
}
function recordBoardChanges(before,after){
 const oldLocations=new Map(),newLocations=new Map(),changedCells=new Set(),groups=new Map(),coveredCells=new Set();
 before.forEach((stack,cell)=>stack.forEach(piece=>oldLocations.set(piece.uid,cell)));
 after.forEach((stack,cell)=>stack.forEach(piece=>newLocations.set(piece.uid,cell)));
 for(let cell=0;cell<Math.max(before.length,after.length);cell++){
  const oldStack=before[cell]||[],newStack=after[cell]||[];
  if(oldStack.map(piece=>piece.uid).join(',')!==newStack.map(piece=>piece.uid).join(','))changedCells.add(cell);
 }
 for(const [uid,to] of newLocations){const from=oldLocations.get(uid);if(from===undefined||from===to)continue;const key=`${from}:${to}`;if(!groups.has(key))groups.set(key,{from,to});}
 const now=Date.now(),newEffects=[];
 for(const move of groups.values()){newEffects.push({...move,id:nextBoardEffectId++,expiresAt:now+1000});coveredCells.add(move.from);coveredCells.add(move.to);}
 for(const cell of changedCells)if(!coveredCells.has(cell))newEffects.push({cell,id:nextBoardEffectId++,expiresAt:now+1000});
 if(!newEffects.length)return;
 boardEffects=boardEffects.filter(effect=>effect.expiresAt>now).concat(newEffects);
 setTimeout(()=>{boardEffects=boardEffects.filter(effect=>effect.expiresAt>Date.now());if(state)render();},1020);
}
function colorFor(a){return ['#a98260','#d4a542','#586452','#8ab68d','#de7957','#586fa7','#b8a66e','#75999a','#3f6877','#8772a8'][['mole','weasel','python','rabbit','fox','eagle','krill','seal','orca','chameleon'].indexOf(a)]}
function ownerColor(id){return state.players.find(p=>p.id===id)?.color||'#aaa'}
function cellClick(i){if(state?.pendingEffect){if(state.pendingEffect.playerId===me&&state.pendingEffect.targets.includes(i))send({type:'effectMove',to:i});return;}if(!state?.started||state.players[state.turn]?.id!==me)return;const self=state.players.find(p=>p.id===me),s=state.board[i];if(mode==='create'&&selectedHand!==null){const animal=self.hand[selectedHand];if(canPlace(animal,i)){send({type:'create',animal,cell:i});selectedHand=null;mode='';}return;}if(mode==='move'&&selectedCell!==null){send({type:'move',from:selectedCell,to:i});selectedCell=null;mode='';return;}if(s.length){selectedCell=i;mode='move';render();}}
function cancelSelection(){selectedHand=null;selectedCell=null;mode='';render();}
document.addEventListener('click',e=>{if(!state||!$('#game').contains(e.target)||!mode)return;if(e.target.closest('.cell,[data-hand]'))return;cancelSelection();});
document.addEventListener('contextmenu',e=>{if(!state||!$('#game').contains(e.target)||(!mode&&!selectedHand&&!Number.isInteger(selectedCell)))return;e.preventDefault();cancelSelection();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mode)cancelSelection();});
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
