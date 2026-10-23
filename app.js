const $=s=>document.querySelector(s);
let ws,me=null,state=null,selectedHand=null,selectedCell=null,mode='',selectedFoxReturns=[];
const emoji={mole:'🐭',weasel:'🟡',python:'🐍',rabbit:'🐇',fox:'🦊',eagle:'🦅',krill:'🦐',seal:'🦭',orca:'🐋',chameleon:'🦎'};
const names={mole:'地鼠',weasel:'黃鼬',python:'蟒蛇',rabbit:'兔子',fox:'赤狐',eagle:'老鷹',krill:'磷蝦',seal:'海豹',orca:'虎鯨',chameleon:'變色龍'};
const levels={mole:1,weasel:2,python:3,rabbit:1,fox:2,eagle:3,krill:1,seal:2,orca:3,chameleon:0};
const effects={mole:['移動','移動後移至該格堆疊最下方'],weasel:['移動','移動後可移動自己以外的一枚棋子一次'],python:['揭露','被創造或揭露時，將所有相鄰格最上方棋子依序放到自身下方'],rabbit:['揭露','被創造或揭露時，自身移動一次'],fox:['揭露','被創造或揭露時，抽2枚棋子到手中，再將2枚放回抽袋'],eagle:['移動','先移動到相鄰格；移動後將自身與落腳格中位於自身下方的一枚棋子一起放到任意格最上方，順序不變；被帶棋子不觸發移動或揭露效果'],krill:['移動','移動後可將手中的1枚磷蝦放到空格'],seal:['揭露','被創造或揭露時，抽2枚，選1枚放到自身下方，另一枚放回抽袋'],orca:['揭露','被創造或揭露時，將自身以外場上1枚棋子的最上方棋子拿到手中；因此露出的棋子可觸發揭露效果'],chameleon:['無','可視為任意等級；沒有移動或揭露觸發效果']};
function tooltip(animal){const [trigger,effect]=effects[animal]||['未定','尚無效果資料'];return `${names[animal]}｜觸發時機：${trigger}｜效果：${effect}`;}
function send(o){if(ws?.readyState===1)ws.send(JSON.stringify(o))}
function connect(type){const name=$('#name').value.trim()||'玩家';localStorage.setItem('abstractName',name);ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}`);ws.onopen=()=>send(type==='create'?{type:'createRoom',name}:{type:'joinRoom',name,code:$('#room-code').value.trim()});ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='error'){$('#lobby-message').textContent=m.message;return}if(m.type==='joined')me=m.id;if(m.type==='state'){state=m.state;render()}};ws.onclose=()=>{if(state)$('#turn-pill').textContent='連線中斷，請重新整理並重新加入'};}
$('#name').value=localStorage.getItem('abstractName')||'';$('#create').onclick=()=>connect('create');$('#join').onclick=()=>connect('join');$('#room-code').oninput=e=>e.target.value=e.target.value.toUpperCase();$('#copy').onclick=()=>navigator.clipboard.writeText(state.code);$('#start').onclick=()=>send({type:'start'});
function canPlaceLevel(level,cell){const stack=state.board[cell];if(level===1)return stack.length===0;if(!stack.length)return false;if(stack.at(-1).animal==='chameleon')return true;return (stack.at(-1).level??levels[stack.at(-1).animal])===level-1;}
function canPlace(animal,cell){const stack=state.board[cell];if(animal!=='chameleon')return canPlaceLevel(levels[animal],cell);if(!stack.length||stack.at(-1).animal==='chameleon')return true;return (stack.at(-1).level??levels[stack.at(-1).animal])<3;}
function anyPlace(animal){return state.board.some((_,i)=>canPlace(animal,i));}
function render(){
 const self=state.players.find(p=>p.id===me),turn=state.players[state.turn],myTurn=turn?.id===me;
 $('#action-help').textContent=actionHelpText(self,turn,myTurn);
 $('#lobby').classList.add('hidden');$('#game').classList.remove('hidden');$('#room-display').textContent=state.code;$('#bag-count').textContent=state.bagCount;$('#player-count').textContent=`(${state.players.length}/4)`;
 $('#turn-pill').textContent=state.winner?`${state.winner}獲勝！`:state.started?`${turn?.name||'—'}的回合開始${myTurn?' · 輪到你':''}`:'等待玩家加入';
 $('#turn-corner').classList.toggle('hidden',!state.started||!!state.winner);$('#turn-corner').innerHTML=state.started&&!state.winner?`<i class="dot" style="--c:${turn?.color}"></i> ${esc(turn?.name||'')} 的回合`:'';
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
 $('#board').innerHTML=state.board.map((stack,i)=>{const isTarget=mode==='create'&&selectedHand!==null&&canPlace(self.hand[selectedHand],i),isEffectTarget=state.pendingEffect?.playerId===me&&state.pendingEffect.targets.includes(i),top=stack.at(-1),isRevealChoice=['rabbit-move','fox-return','seal-select','python-collect','orca-take'].includes(state.pendingEffect?.type)&&top?.uid===state.pendingEffect?.pieceId,isRevealGroup=state.pendingEffect?.type==='reveal-choice'&&state.pendingEffect.targets.includes(i),tip=top?tooltip(top.animal):'';return `<button class="cell ${selectedCell===i?'selected':''} ${isTarget?'target':''} ${isEffectTarget?'effect-target':''} ${isRevealChoice||isRevealGroup?'revealed':''}" data-cell="${i}"><span class="stack">${top?`<i class="piece top piece-tip" data-tooltip="${esc(tip)}" style="--c:${ownerColor(top.owner)}" title="${esc(tip)}">${emoji[top.animal]}</i><span class="stack-count" title="此格共有 ${stack.length} 枚棋子">×${stack.length}</span>`:''}</span><span class="cell-number">${i+1}</span></button>`}).join('');
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
function colorFor(a){return ['#a98260','#d4a542','#586452','#8ab68d','#de7957','#586fa7','#b8a66e','#75999a','#3f6877','#8772a8'][['mole','weasel','python','rabbit','fox','eagle','krill','seal','orca','chameleon'].indexOf(a)]}
function ownerColor(id){return state.players.find(p=>p.id===id)?.color||'#aaa'}
function cellClick(i){if(state?.pendingEffect){if(state.pendingEffect.playerId===me&&state.pendingEffect.targets.includes(i))send({type:'effectMove',to:i});return;}if(!state?.started||state.players[state.turn]?.id!==me)return;const self=state.players.find(p=>p.id===me),s=state.board[i];if(mode==='create'&&selectedHand!==null){const animal=self.hand[selectedHand];if(canPlace(animal,i)){send({type:'create',animal,cell:i});selectedHand=null;mode='';}return;}if(mode==='move'&&selectedCell!==null){send({type:'move',from:selectedCell,to:i});selectedCell=null;mode='';return;}if(s.length){selectedCell=i;mode='move';render();}}
function cancelSelection(){selectedHand=null;selectedCell=null;mode='';render();}
document.addEventListener('click',e=>{if(!state||!$('#game').contains(e.target)||!mode)return;if(e.target.closest('.cell,[data-hand]'))return;cancelSelection();});
document.addEventListener('contextmenu',e=>{if(!state||!$('#game').contains(e.target)||(!mode&&!selectedHand&&!Number.isInteger(selectedCell)))return;e.preventDefault();cancelSelection();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mode)cancelSelection();});
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
