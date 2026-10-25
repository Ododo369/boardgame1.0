const SPECIES = {
  mole: { chain: 0, level: 1 }, weasel: { chain: 0, level: 2 }, python: { chain: 0, level: 3 },
  rabbit: { chain: 1, level: 1 }, fox: { chain: 1, level: 2 }, eagle: { chain: 1, level: 3 },
  krill: { chain: 2, level: 1 }, seal: { chain: 2, level: 2 }, orca: { chain: 2, level: 3 }, chameleon: { chain: 3, level: 0 },
};
const ANIMAL_IDS = Object.keys(SPECIES);
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function cloneBoard(board) { return board.map(stack => stack.map(piece => ({ ...piece }))); }
function adjacent(cell) {
  const x=cell%3,y=Math.floor(cell/3),out=[];
  if(x>0)out.push(cell-1);if(x<2)out.push(cell+1);if(y>0)out.push(cell-3);if(y<2)out.push(cell+3);
  return out;
}
function canCreate(board,animal,cell) {
  const species=SPECIES[animal],stack=board[cell];if(!species||!stack)return false;
  if(species.level===1)return stack.length===0;
  if(!stack.length)return animal==='chameleon';
  const top=stack.at(-1),topLevel=SPECIES[top.animal]?.level??top.level??0;
  if(top.animal==='chameleon')return true;
  if(animal==='chameleon')return topLevel<3;
  return topLevel===species.level-1;
}
function put(board,animal,cell,owner,uid='sim') {
  const species=SPECIES[animal];board[cell].push({uid:`${uid}-${animal}-${cell}`,animal,level:species.level||undefined,owner});
}
function moves(board) {
  const out=[];
  board.forEach((stack,from)=>{if(!stack.length)return;for(const to of adjacent(from))out.push({from,to,animal:stack.at(-1).animal});});
  return out;
}
function move(board,action) { const [piece]=board[action.from].splice(-1);if(piece)board[action.to].push(piece); }
function completedLines(board) {
  const found=[];
  for(const cells of LINES){
    const tops=cells.map(cell=>board[cell].at(-1));if(!tops.every(Boolean))continue;
    if(tops.every(piece=>piece.animal==='chameleon')){found.push(cells);continue;}
    const species=tops.map(piece=>SPECIES[piece.animal]);
    if(species.some(item=>!item||item.chain>=3)||!species.every(item=>item.chain===species[0].chain))continue;
    if(species.map(item=>item.level).sort((a,b)=>a-b).join(',')==='1,2,3')found.push(cells);
  }
  return found;
}
function clearLines(board) {
  let count=0;
  for(const cells of LINES){
    const test=completedLinesForCells(board,cells);if(!test)continue;
    for(const cell of cells)board[cell].pop();count++;
  }
  return count;
}
function completedLinesForCells(board,cells) {
  const tops=cells.map(cell=>board[cell].at(-1));if(!tops.every(Boolean))return false;
  if(tops.every(piece=>piece.animal==='chameleon'))return true;
  const species=tops.map(piece=>SPECIES[piece.animal]);
  return !species.some(item=>!item||item.chain>=3)&&species.every(item=>item.chain===species[0].chain)&&species.map(item=>item.level).sort((a,b)=>a-b).join(',')==='1,2,3';
}
function positionScore(board) {
  let score=0;
  for(const cells of LINES){
    const tops=cells.map(cell=>board[cell].at(-1));
    for(let chain=0;chain<3;chain++){
      const matches=tops.reduce((sum,piece)=>sum+(piece&&SPECIES[piece.animal]?.chain===chain?1:0),0);
      const levels=tops.filter(piece=>piece&&SPECIES[piece.animal]?.chain===chain).map(piece=>SPECIES[piece.animal].level);
      const distinct=new Set(levels).size;
      if(matches===1)score+=0.8;
      if(matches===2)score+=distinct===2?8:3;
      if(matches===3&&distinct===3)score+=16;
    }
    const chameleons=tops.filter(piece=>piece?.animal==='chameleon').length;
    if(chameleons===1)score+=0.8;if(chameleons===2)score+=9;if(chameleons===3)score+=18;
  }
  return score;
}
function boardKey(board) { return board.map(stack=>stack.map(piece=>piece.animal).join('.')).join('/'); }

function generateTurns(board,allowed,owner,limit=Infinity) {
  const results=[],seen=new Set(),animals=[...new Set(allowed.filter(animal=>SPECIES[animal]))];
  const save=(next,createAction,moveAction,order)=>{
    const key=boardKey(next);if(seen.has(key))return;seen.add(key);
    results.push({board:next,create:createAction,move:moveAction,order,wins:completedLines(next).length,position:positionScore(next)});
  };
  for(const animal of animals)for(let cell=0;cell<9;cell++)if(canCreate(board,animal,cell)){
    const afterCreate=cloneBoard(board);put(afterCreate,animal,cell,owner);
    for(const action of moves(afterCreate)){const next=cloneBoard(afterCreate);move(next,action);save(next,{animal,cell},action,'create-first');}
  }
  for(const action of moves(board)){
    const afterMove=cloneBoard(board);move(afterMove,action);
    for(const animal of animals)for(let cell=0;cell<9;cell++)if(canCreate(afterMove,animal,cell)){
      const next=cloneBoard(afterMove);put(next,animal,cell,owner);save(next,{animal,cell},action,'move-first');
    }
  }
  results.sort((a,b)=>(b.wins*170+b.position)-(a.wins*170+a.position));
  return results.slice(0,limit);
}
function bestResponseScore(board) {
  const replies=generateTurns(board,ANIMAL_IDS,'human',1);
  return replies.length?replies[0].wins*170+replies[0].position:0;
}
function chooseTurnPlan(board,hand,owner) {
  // Orca's reveal effect takes one additional piece into the AI's hand.
  // When the hand is already at the elimination limit, creating an orca
  // consumes one piece and then immediately takes one back, leaving the AI
  // at six when its turn ends. Avoid that plan whenever another plan exists.
  const available=hand.length>=6?hand.filter(animal=>animal!=='orca'):hand;
  const options=generateTurns(board,available,owner,18);if(!options.length)return null;
  let best=null,bestScore=-Infinity;
  for(const option of options){
    const after=cloneBoard(option.board);clearLines(after);
    const threat=bestResponseScore(after);
    const score=option.wins*220+option.position*0.55-threat*0.72+positionScore(after)*0.18;
    if(score>bestScore){bestScore=score;best={create:option.create,move:option.move,order:option.order,score};}
  }
  return best;
}
function chooseMove(board,owner) {
  let best=null,bestScore=-Infinity;
  for(const action of moves(board)){
    const next=cloneBoard(board);move(next,action);const wins=completedLines(next).length;
    const cleared=cloneBoard(next);clearLines(cleared);
    const score=wins*220+positionScore(next)*0.55-bestResponseScore(cleared)*0.72;
    if(score>bestScore){bestScore=score;best=action;}
  }
  return best;
}
function locate(board,uid) {
  for(let cell=0;cell<board.length;cell++){const index=board[cell].findIndex(piece=>piece.uid===uid);if(index>=0)return{cell,index,piece:board[cell][index]};}
  return null;
}
function strategicValue(board) {
  const wins=completedLines(board).length,cleared=cloneBoard(board);clearLines(cleared);
  return wins*180+positionScore(board)*0.45-bestResponseScore(cleared)*0.55;
}
function chooseTarget(board,targets,simulate) {
  let best=null,bestScore=-Infinity;
  for(const to of targets){const next=cloneBoard(board);if(!simulate(next,to))continue;const score=strategicValue(next);if(score>bestScore){bestScore=score;best=to;}}
  return best;
}
function cardValue(animal,board,hand) {
  const species=SPECIES[animal];if(!species)return -10;
  const duplicates=hand.filter(item=>item===animal).length-1;
  let value=species.level===1?3.5:species.level===2?2.8:species.level===3?2.1:2.5;
  if(duplicates>0)value-=duplicates*1.7;
  const available=board.reduce((sum,_,cell)=>sum+(canCreate(board,animal,cell)?1:0),0);
  if(available===0)value-=1.1;
  return value;
}
function choosePendingAction(board,hand,pending,botId) {
  if(pending.type==='fox-return'){
    const count=pending.count||2;
    return{type:'foxReturn',animals:hand.map((animal,index)=>({animal,index,value:cardValue(animal,board,hand)})).sort((a,b)=>a.value-b.value).slice(0,count).map(item=>item.animal)};
  }
  if(pending.type==='seal-select'){
    const seal=locate(board,pending.pieceId);if(!seal)return{type:'sealChoose',choice:0};
    const scored=(pending.drawn||[]).map((animal,choice)=>{
      const next=cloneBoard(board),species=SPECIES[animal];next[seal.cell].splice(seal.index,0,{uid:`seal-sim-${choice}`,animal,level:species?.level||undefined,owner:botId});
      return{choice,score:strategicValue(next)};
    }).sort((a,b)=>b.score-a.score);
    return{type:'sealChoose',choice:scored[0]?.choice??0};
  }
  if(pending.type==='reveal-choice'){
    const candidates=pending.candidates||[];let best=null,bestScore=-Infinity;
    for(const candidate of candidates){const piece=board[candidate.cell]?.at(-1);if(!piece||piece.uid!==candidate.pieceId)continue;
      let score=({python:5,orca:4,rabbit:3,fox:2,seal:2})[piece.animal]||0;
      if(piece.animal==='python')score+=adjacent(candidate.cell).filter(cell=>board[cell].length).length*2;
      if(piece.animal==='orca')score+=board.filter((stack,cell)=>stack.length&&cell!==candidate.cell).length;
      score+=strategicValue(board)*0.01;
      if(score>bestScore){bestScore=score;best=candidate.cell;}
    }
    return best===null?null:{type:'effectMove',to:best};
  }
  let targets=pending.targets||[];
  if(pending.type==='weasel-select'){
    let best=null,bestScore=-Infinity;
    for(const from of targets){const stack=board[from],piece=stack?.at(-1);if(!piece||piece.uid===pending.pieceId)continue;
      let local=-1;
      for(const to of adjacent(from)){const next=cloneBoard(board);move(next,{from,to});local=Math.max(local,strategicValue(next));}
      const score=local+(SPECIES[piece.animal]?.level||0)*0.05;
      if(score>bestScore){bestScore=score;best=from;}
    }
    return best===null?null:{type:'effectMove',to:best};
  }
  if(pending.type==='rabbit-move'||pending.type==='weasel-target'){
    const from=pending.from,piece=board[from]?.at(-1);if(!piece)return null;
    const to=chooseTarget(board,targets,(next,dest)=>{move(next,{from,to:dest});return true;});
    return to===null?null:{type:'effectMove',to};
  }
  if(pending.type==='krill-place'){
    const to=chooseTarget(board,targets,(next,dest)=>{put(next,'krill',dest,botId,'effect');return true;});
    return to===null?null:{type:'effectMove',to};
  }
  if(pending.type==='eagle-flight'){
    const eagle=locate(board,pending.pieceId);if(!eagle)return null;
    const to=chooseTarget(board,targets,(next,dest)=>{
      const bird=locate(next,pending.pieceId);if(!bird)return false;
      let cargo=null;if(pending.cargoId){const carried=locate(next,pending.cargoId);if(carried){cargo=next[carried.cell].splice(carried.index,1)[0];}}
      const refreshed=locate(next,pending.pieceId);if(!refreshed)return false;
      const [piece]=next[refreshed.cell].splice(refreshed.index,1);next[dest].push(...(cargo?[cargo]:[]),piece);return true;
    });
    return to===null?null:{type:'effectMove',to};
  }
  if(pending.type==='orca-take'){
    const to=chooseTarget(board,targets,(next,dest)=>{if(!next[dest]?.length)return false;next[dest].pop();return true;});
    return to===null?null:{type:'effectMove',to};
  }
  if(pending.type==='python-collect'){
    const python=locate(board,pending.pieceId);if(!python)return null;
    const to=chooseTarget(board,targets,(next,source)=>{if(!next[source]?.length)return false;const [piece]=next[source].splice(-1);const current=locate(next,pending.pieceId);if(!current)return false;next[current.cell].splice(current.index,0,piece);return true;});
    return to===null?null:{type:'effectMove',to};
  }
  return null;
}

module.exports = { chooseTurnPlan, chooseMove, choosePendingAction };
