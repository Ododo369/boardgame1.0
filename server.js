const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const animals = [
  { id: 'mole', name: '地鼠', chain: 0, level: 1, trigger: '移動', effect: '移至該格堆疊最底部' },
  { id: 'weasel', name: '黃鼬', chain: 0, level: 2, trigger: '移動', effect: '移動自己以外的一枚棋子' },
  { id: 'python', name: '蟒蛇', chain: 0, level: 3, trigger: '揭露', effect: '將相鄰格最上方棋子收至自身下方' },
  { id: 'rabbit', name: '兔子', chain: 1, level: 1, trigger: '揭露', effect: '自身移動一次' },
  { id: 'fox', name: '赤狐', chain: 1, level: 2, trigger: '揭露', effect: '抽2枚棋子，再放回2枚' },
  { id: 'eagle', name: '老鷹', chain: 1, level: 3, trigger: '移動', effect: '帶著下方1枚棋子移動' },
  { id: 'krill', name: '磷蝦', chain: 2, level: 1, trigger: '移動', effect: '將手中的磷蝦放到空格' },
  { id: 'seal', name: '海豹', chain: 2, level: 2, trigger: '揭露', effect: '抽2枚，選1枚放在自身下方' },
  { id: 'orca', name: '虎鯨', chain: 2, level: 3, trigger: '揭露', effect: '將場上1枚棋子拿到手中' },
  { id: 'chameleon', name: '變色龍', chain: 3, level: 0, trigger: '特殊', effect: '可當作任一動物（原型：不能創造）' },
];
const colors = ['#eb785d', '#4c9b8a', '#6384d8', '#d69a3d'];
const code = () => Math.random().toString(36).slice(2, 6).toUpperCase();
const shuffle = a => { for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
function broadcast(room) { const data = JSON.stringify({ type:'state', state: publicState(room) }); for (const p of room.players) if (p.socket?.readyState === 1) p.socket.send(data); }
function publicState(room) {
  return { code:room.code, started:room.started, hostId:room.hostId, turn:room.turn, active:room.active,
    players:room.players.map(({id,name,hand,color,connected})=>({id,name,hand,color,connected})),
    board:room.board, bagCount:room.bag.length, log:room.log.slice(-8), winner:room.winner };
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
  room.started=true; room.bag=shuffle([...animalTiles,'chameleon','chameleon']);
  room.players.forEach(p=>drawOpeningHand(room,p)); room.turn=Math.floor(Math.random()*room.players.length); room.active=null; draw(room,room.players[room.turn]); note(room,`遊戲開始！每位玩家的起手牌至少有一枚等級一棋子。${room.players[room.turn].name}的回合開始。`);
}
function canCreate(room, animalId, cell) {
  const a=animals.find(x=>x.id===animalId); if(!a || a.id==='chameleon') return false;
  const stack=room.board[cell]; if(a.level===1) return stack.length===0;
  return stack.length>0 && animals.find(x=>x.id===stack.at(-1).animal)?.level===a.level-1;
}
function finishAction(room, p) {
  if(room.active?.created && room.active?.moved){
    room.active=null; room.turn=(room.turn+1)%room.players.length;
    resolveLines(room,p);
    room.players.forEach(q=>{ if(q.hand.length>=8){note(room,`${q.name}手牌達8枚，遭淘汰。`);q.eliminated=true;room.bag.push(...q.hand);q.hand=[];} });
    room.players=room.players.filter(q=>!q.eliminated);
    if(room.players.length===1){room.winner=room.players[0].name;note(room,`${room.winner}獲勝！`);}
    if(room.players.length){room.turn=room.turn%room.players.length;if(!room.winner){draw(room,room.players[room.turn]);note(room,`${room.players[room.turn].name}的回合開始。`);}}
  }
}
function resolveLines(room, actor) {
  // On the 3x3 board, a line or a three-piece same-chain stack completes a chain.
  let done=new Set();
  for(const stack of room.board) if(stack.length===3){const ch=animals.find(a=>a.id===stack[0].animal).chain;if(ch<3&&stack.every(t=>animals.find(a=>a.id===t.animal).chain===ch))done.add(ch);}
  for(let y=0;y<3;y++) for(let x=0;x<3;x++) for(const [dx,dy] of [[1,0],[0,1],[1,1],[-1,1]]) {
    let cells=[]; for(let k=0;k<3;k++){let xx=x+dx*k,yy=y+dy*k;if(xx<0||xx>2||yy<0||yy>2){cells=[];break;}cells.push(yy*3+xx);}
    if(cells.length!==3)continue; const tops=cells.map(c=>room.board[c].at(-1)); if(tops.every(Boolean)){const ch=animals.find(a=>a.id===tops[0].animal).chain;if(ch<3&&tops.every(t=>animals.find(a=>a.id===t.animal).chain===ch)) done.add(ch);}
  }
  for(const ch of done){const returned=[];for(let i=0;i<9;i++){const keep=[];for(const t of room.board[i]){if(animals.find(a=>a.id===t.animal).chain===ch)returned.push(t.animal);else keep.push(t);}room.board[i]=keep;}room.bag.push(...returned);room.players.forEach(q=>{if(q!==actor)draw(room,q,1);});note(room,`食物鏈${ch+1}連成一線或堆疊，棋子回到抽袋。`);}
}
function handle(room,p,msg){
  if(msg.type==='start'){
    if(p.id===room.hostId && room.players.length>=2 && !room.started){start(room);broadcast(room);}
    return;
  }
  if(!room.started || room.players[room.turn]?.id!==p.id) return;
  if(msg.type==='create' && !room.active?.created && p.hand.includes(msg.animal) && canCreate(room,msg.animal,msg.cell)) {
    p.hand.splice(p.hand.indexOf(msg.animal),1); room.board[msg.cell].push({animal:msg.animal,owner:p.id}); room.active??={created:false,moved:false};room.active.created=true;
    note(room,`${p.name}創造了${animals.find(a=>a.id===msg.animal).name}。`); finishAction(room,p);
  }
  if(msg.type==='move' && !room.active?.moved && Number.isInteger(msg.from) && Number.isInteger(msg.to) && msg.from>=0 && msg.from<9 && msg.to>=0 && msg.to<9 && Math.abs(msg.from%3-msg.to%3)+Math.abs(Math.floor(msg.from/3)-Math.floor(msg.to/3))===1 && room.board[msg.from].length){
    const piece=room.board[msg.from].pop(); const species=animals.find(a=>a.id===piece.animal);
    if(species.level>0){
      room.board[msg.to].push(piece); room.active??={created:false,moved:false};room.active.moved=true;
      if(species.id==='mole'){room.board[msg.to].pop();room.board[msg.to].unshift(piece);}
      if(species.id==='eagle'&&room.board[msg.from].length){room.board[msg.to].push(room.board[msg.from].pop());}
      note(room,`${p.name}移動了${species.name}。`); finishAction(room,p);
    } else room.board[msg.from].push(piece);
  }
  if(msg.type==='skip' && !room.active){draw(room,p,1);room.turn=(room.turn+1)%room.players.length;note(room,`${p.name}無法完成行動，抽取1枚棋子並跳過。`);}
  broadcast(room);
}
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');let file=u.pathname==='/'?'index.html':u.pathname.slice(1);if(file.includes('..')){res.writeHead(400).end();return;}const target=path.join(__dirname,file);fs.readFile(target,(err,data)=>{if(err){res.writeHead(404).end('Not found');return;}res.setHeader('Content-Type',target.endsWith('.js')?'text/javascript; charset=utf-8':target.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(data);});});
const wss=new WebSocketServer({server});
wss.on('connection',socket=>{let player=null,room=null;socket.on('message',raw=>{let m;try{m=JSON.parse(raw);}catch{return;}
  if(m.type==='createRoom'||m.type==='joinRoom'){const name=String(m.name||'玩家').trim().slice(0,16)||'玩家';let r;
    if(m.type==='createRoom'){let c;do{c=code();}while(rooms.has(c));r={code:c,players:[],board:Array.from({length:9},()=>[]),bag:[],started:false,turn:0,active:null,hostId:null,log:[],winner:null};rooms.set(c,r);}
    else r=rooms.get(String(m.code||'').toUpperCase());
    if(!r){socket.send(JSON.stringify({type:'error',message:'找不到這個房間代碼。'}));return;}
    if(r.started||r.players.length>=4){socket.send(JSON.stringify({type:'error',message:'房間已開始或人數已滿。'}));return;}
    player={id:Math.random().toString(36).slice(2),name,color:colors[r.players.length],hand:[],connected:true,socket};room=r;r.players.push(player);if(!r.hostId)r.hostId=player.id;note(r,`${name}加入房間。`);socket.send(JSON.stringify({type:'joined',id:player.id}));broadcast(r);return;
  }
  if(room&&player)handle(room,player,m);
 });socket.on('close',()=>{if(room&&player){player.connected=false;note(room,`${player.name}離線。`);broadcast(room);}});});
server.listen(PORT,'0.0.0.0',()=>console.log(`Abstract Tabletop is listening on ${PORT}`));
