const $=s=>document.querySelector(s);
let ws,me=null,state=null,selectedHand=null,selectedCell=null,mode='';
const emoji={mole:'🐭',weasel:'🟡',python:'🐍',rabbit:'🐇',fox:'🦊',eagle:'🦅',krill:'🦐',seal:'🦭',orca:'🐋',chameleon:'🦎'};
const names={mole:'地鼠',weasel:'黃鼬',python:'蟒蛇',rabbit:'兔子',fox:'赤狐',eagle:'老鷹',krill:'磷蝦',seal:'海豹',orca:'虎鯨',chameleon:'變色龍'};
const levels={mole:1,weasel:2,python:3,rabbit:1,fox:2,eagle:3,krill:1,seal:2,orca:3,chameleon:0};
const effects={mole:['移動','移動後移至該格堆疊最下方'],weasel:['移動','移動後可移動自己以外的一枚棋子一次'],python:['揭露','被創造或揭露時，將相鄰格最上方棋子放到自身下方'],rabbit:['揭露','被創造或揭露時，自身移動一次'],fox:['揭露','被創造或揭露時，抽2枚棋子到手中，再將2枚放回抽袋'],eagle:['移動','移動時帶著下方1枚棋子一起移動'],krill:['移動','移動後可將手中的1枚磷蝦放到空格'],seal:['揭露','被創造或揭露時，抽2枚，選1枚放到自身下方，另一枚放回抽袋'],orca:['揭露','被創造或揭露時，將場上1枚棋子拿到手中'],chameleon:['未定','文件尚未說明變色龍的觸發時機與效果']};
function tooltip(animal){const [trigger,effect]=effects[animal]||['未定','尚無效果資料'];return `${names[animal]}｜觸發時機：${trigger}｜效果：${effect}`;}
function send(o){if(ws?.readyState===1)ws.send(JSON.stringify(o))}
function connect(type){const name=$('#name').value.trim()||'玩家';localStorage.setItem('abstractName',name);ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}`);ws.onopen=()=>send(type==='create'?{type:'createRoom',name}:{type:'joinRoom',name,code:$('#room-code').value.trim()});ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='error'){$('#lobby-message').textContent=m.message;return}if(m.type==='joined')me=m.id;if(m.type==='state'){state=m.state;render()}};ws.onclose=()=>{if(state)$('#turn-pill').textContent='連線中斷，請重新整理並重新加入'};}
$('#name').value=localStorage.getItem('abstractName')||'';$('#create').onclick=()=>connect('create');$('#join').onclick=()=>connect('join');$('#room-code').oninput=e=>e.target.value=e.target.value.toUpperCase();$('#copy').onclick=()=>navigator.clipboard.writeText(state.code);$('#start').onclick=()=>send({type:'start'});
function canPlace(animal,cell){const a=levels[animal],stack=state.board[cell];if(!a)return false;if(a===1)return stack.length===0;return stack.length>0&&levels[stack.at(-1).animal]===a-1;}
function anyPlace(animal){return state.board.some((_,i)=>canPlace(animal,i));}
function render(){
 const self=state.players.find(p=>p.id===me),turn=state.players[state.turn],myTurn=turn?.id===me;
 $('#lobby').classList.add('hidden');$('#game').classList.remove('hidden');$('#room-display').textContent=state.code;$('#bag-count').textContent=state.bagCount;$('#player-count').textContent=`(${state.players.length}/4)`;
 $('#turn-pill').textContent=state.winner?`${state.winner}獲勝！`:state.started?`${turn?.name||'—'}的回合開始${myTurn?' · 輪到你':''}`:'等待玩家加入';
 $('#turn-corner').classList.toggle('hidden',!state.started||!!state.winner);$('#turn-corner').innerHTML=state.started&&!state.winner?`<i class="dot" style="--c:${turn?.color}"></i> ${esc(turn?.name||'')} 的回合`:'';
 $('#start').classList.toggle('hidden',me!==state.hostId||state.started);$('#waiting-hint').textContent=state.started?'':state.players.length<2?'至少需要2位玩家才能開始':'人數到齊後由房主開始';
 $('#players').innerHTML=state.players.map(p=>`<div class="player ${p.id===turn?.id&&state.started?'current':''}"><i class="dot" style="--c:${p.color}"></i>${esc(p.name)}${p.id===state.hostId?' <span>房主</span>':''}<small>${p.hand.length}枚</small></div>`).join('');
 $('#hand-count').textContent=`${self?.hand.length||0} 枚`;
 const mayCreate=state.started&&myTurn&&!state.active?.created;
 $('#hand').innerHTML=(self?.hand||[]).map((a,i)=>{const placeable=mayCreate&&anyPlace(a);return `<div class="hand-piece ${selectedHand===i?'selected':''} ${placeable?'placeable':''} ${mayCreate&&!placeable?'unavailable':''}"><span class="piece" title="${esc(tooltip(a))}" style="--c:${colorFor(a)}">${emoji[a]}</span><button title="${esc(tooltip(a))}" data-hand="${i}" ${!mayCreate||!anyPlace(a)?'disabled':''}>${names[a]}</button></div>`}).join('')||'<div class="empty">遊戲開始後，手牌會顯示在這裡</div>';
 $('#hand').querySelectorAll('[data-hand]').forEach(b=>b.onclick=()=>{selectedHand=+b.dataset.hand;selectedCell=null;mode='create';render()});
 $('#board').innerHTML=state.board.map((stack,i)=>{const isTarget=mode==='create'&&selectedHand!==null&&canPlace(self.hand[selectedHand],i);return `<button class="cell ${selectedCell===i?'selected':''} ${isTarget?'target':''}" data-cell="${i}"><span class="stack">${stack.map((p,j)=>`<i class="piece ${j===stack.length-1?'top':''}" style="--c:${ownerColor(p.owner)}" title="${esc(tooltip(p.animal))}">${emoji[p.animal]}</i>`).join('')}</span><span class="cell-number">${i+1}</span></button>`}).join('');
 $('#board').querySelectorAll('[data-cell]').forEach(b=>b.onclick=()=>cellClick(+b.dataset.cell));
 $('#action-help').textContent=!state.started?'房主開始遊戲後即可行動':!myTurn?'等待 '+(turn?.name||'玩家')+' 行動':state.active?.created&&!state.active?.moved?'已創造動物，請移動一枚棋子':state.active?.moved&&!state.active?.created?'已移動棋子，請創造一隻動物':mode==='create'?'選擇一個亮起的格子放置棋子':mode==='move'?'點選棋子堆，再點相鄰格':'選擇一枚發亮的手牌創造動物，或點棋盤棋子移動';
 $('#log').innerHTML=state.log.slice().reverse().map(t=>`<div class="log-line">${esc(t)}</div>`).join('');
}
function colorFor(a){return ['#a98260','#d4a542','#586452','#8ab68d','#de7957','#586fa7','#b8a66e','#75999a','#3f6877','#8772a8'][['mole','weasel','python','rabbit','fox','eagle','krill','seal','orca','chameleon'].indexOf(a)]}
function ownerColor(id){return state.players.find(p=>p.id===id)?.color||'#aaa'}
function cellClick(i){if(!state?.started||state.players[state.turn]?.id!==me)return;const self=state.players.find(p=>p.id===me),s=state.board[i];if(mode==='create'&&selectedHand!==null){const animal=self.hand[selectedHand];if(canPlace(animal,i)){send({type:'create',animal,cell:i});selectedHand=null;mode='';}return;}if(mode==='move'&&selectedCell!==null){send({type:'move',from:selectedCell,to:i});selectedCell=null;mode='';return;}if(s.length){selectedCell=i;mode='move';render();}}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
