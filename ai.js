const SPECIES = {
  mole: { chain: 0, level: 1 }, weasel: { chain: 0, level: 2 }, python: { chain: 0, level: 3 },
  rabbit: { chain: 1, level: 1 }, fox: { chain: 1, level: 2 }, eagle: { chain: 1, level: 3 },
  krill: { chain: 2, level: 1 }, seal: { chain: 2, level: 2 }, orca: { chain: 2, level: 3 },
  grasshopper: { chain: 3, level: 1 }, treefrog: { chain: 3, level: 2 }, crocodile: { chain: 3, level: 3 }, chameleon: { chain: 4, level: 0 },
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
    if(species.some(item=>!item||item.chain>=4)||!species.every(item=>item.chain===species[0].chain))continue;
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
  return !species.some(item=>!item||item.chain>=4)&&species.every(item=>item.chain===species[0].chain)&&species.map(item=>item.level).sort((a,b)=>a-b).join(',')==='1,2,3';
}
function positionScore(board) {
  let score=0;
  for(const cells of LINES){
    const tops=cells.map(cell=>board[cell].at(-1));
    for(let chain=0;chain<4;chain++){
      const matches=tops.reduce((sum,piece)=>sum+(piece&&SPECIES[piece.animal]?.chain===chain?1:0),0);
      const levels=tops.filter(piece=>piece&&SPECIES[piece.animal]?.chain===chain).map(piece=>SPECIES[piece.animal].level);
      const distinct=new Set(levels).size;
      if(matches===1)score+=0.8;
      if(matches===2)score+=distinct===2?8:3;
      if(matches===3&&distinct===3)score+=16;
    }
    const chameleons=tops.filter(piece=>piece?.animal==='chameleon').length;
    if(chameleons===1)score+=0.8;if(chameleons===2)score+=9;if(chameleons===3)score+=18;

    // Pieces directly beneath each top animal are the next likely animals to
    // become visible. Give them a smaller, separate value so the AI considers
    // stack depth without treating buried pieces as an already completed line.
    for(let depth=2;depth<=3;depth++){
      const layer=cells.map(cell=>board[cell].at(-depth));
      for(let chain=0;chain<4;chain++){
        const levels=layer.filter(piece=>piece&&SPECIES[piece.animal]?.chain===chain).map(piece=>SPECIES[piece.animal].level);
        const distinct=new Set(levels).size;
        if(levels.length===1)score+=0.18/(depth-1);
        if(levels.length===2)score+=(distinct===2?1.8:0.55)/(depth-1);
      }
      const buriedChameleons=layer.filter(piece=>piece?.animal==='chameleon').length;
      if(buriedChameleons===1)score+=0.18/(depth-1);
      if(buriedChameleons===2)score+=1.8/(depth-1);
    }
  }
  return score;
}
function boardKey(board) { return board.map(stack=>stack.map(piece=>piece.animal).join('.')).join('/'); }

function generateTurns(board,allowed,owner,limit=Infinity,reserveKrillMoves=false) {
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
  const selected=results.slice(0,limit);
  if(reserveKrillMoves){
    const rescueCandidates=results.filter(option=>option.move.animal==='krill').slice(0,16);
    for(const option of rescueCandidates)if(!selected.includes(option))selected.push(option);
  }
  return selected;
}
function revealRabbitOutcomes(board,cell,depth=0){
  if(depth>=5)return[board];
  const rabbit=board[cell]?.at(-1);
  if(!rabbit)return[board];
  if(rabbit.animal==='fox')return[board]; // Drawing and returning souls does not change the board.
  if(rabbit.animal!=='rabbit')return[board];
  const outcomes=[];
  for(const to of adjacent(cell)){
    const next=cloneBoard(board);move(next,{from:cell,to});
    // A rabbit moving away can reveal another rabbit or fox, which resolves
    // before the original action's remaining after-move effects.
    outcomes.push(...revealRabbitOutcomes(next,cell,depth+1));
  }
  return outcomes.length?outcomes:[board];
}
function eagleFlightOutcomes(board,eagleUid){
  const eagle=locate(board,eagleUid);
  if(!eagle||board[eagle.cell].at(-1)?.uid!==eagleUid)return[board];
  const outcomes=[];
  for(let target=0;target<board.length;target++){
    if(target===eagle.cell||!board[target].length)continue;
    const next=cloneBoard(board),bird=locate(next,eagleUid);
    const [piece]=next[bird.cell].splice(bird.index,1);next[target].push(piece);
    outcomes.push(...revealRabbitOutcomes(next,bird.cell));
  }
  // If there is no legal perch, the server resolves the move without a flight.
  return outcomes.length?outcomes:[board];
}
function turnBoardOutcomes(board,option){
  let base=cloneBoard(board);
  if(option.order==='create-first'){
    put(base,option.create.animal,option.create.cell,'ai');
    move(base,option.move);
  }else{
    move(base,option.move);
    const movedPiece=base[option.move.to]?.at(-1);
    // The reveal at the vacated square resolves before the moved animal's
    // after-move ability (notably the eagle flight).
    const revealOutcomes=revealRabbitOutcomes(base,option.move.from);
    const settled=[];
    for(const revealed of revealOutcomes){
      let after=option.move.animal==='eagle'
        ? eagleFlightOutcomes(revealed,movedPiece?.uid)
        : [revealed];
      for(const result of after){
        if(!canCreate(result,option.create.animal,option.create.cell))continue;
        put(result,option.create.animal,option.create.cell,'ai');settled.push(result);
      }
    }
    return settled;
  }
  const movedPiece=base[option.move.to]?.at(-1);
  let outcomes=revealRabbitOutcomes(base,option.move.from);
  if(option.move.animal==='eagle'){
    outcomes=outcomes.flatMap(state=>eagleFlightOutcomes(state,movedPiece?.uid));
  }
  return outcomes;
}
function krillCanReduceHand(board,option,hand,outcome){
  if(option.move.animal!=='krill')return false;
  const krillInHand=hand.filter(animal=>animal==='krill').length-(option.order==='create-first'&&option.create.animal==='krill'?1:0);
  if(krillInHand<1)return false;
  const stage=cloneBoard(board);
  if(option.order==='create-first')put(stage,option.create.animal,option.create.cell,'ai');
  move(stage,option.move);
  const moved=stage[option.move.to].at(-1),settledStack=outcome[option.move.to]||[];
  if(!moved)return false;
  const movedIndex=settledStack.findIndex(piece=>piece.uid===moved.uid);
  const plannedCreateUid=`sim-${option.create.animal}-${option.create.cell}`;
  const remainsTop=settledStack.at(-1)?.uid===moved.uid;
  const coveredOnlyByPlannedBirth=option.order==='move-first'&&settledStack.at(-1)?.uid===plannedCreateUid&&settledStack.at(-2)?.uid===moved.uid;
  if(movedIndex<0||(!remainsTop&&!coveredOnlyByPlannedBirth))return false;
  return stage.some(stack=>stack.length===0);
}
function expectedHandAfterTurn(board,option,hand,outcome){
  let count=hand.length-1; // The planned birth uses one soul from hand.
  if(krillCanReduceHand(board,option,hand,outcome))count--;
  const revealedOrcas=new Set();
  if(option.create.animal==='orca'){
    const created=outcome[option.create.cell]?.at(-1);
    if(created?.animal==='orca'&&outcome.some((stack,cell)=>stack.length&&cell!==option.create.cell))revealedOrcas.add(created.uid);
  }
  const exposedCells=new Set([option.move.from]);
  if(option.move.animal==='eagle')exposedCells.add(option.move.to);
  for(const cell of exposedCells){
    const exposed=outcome[cell]?.at(-1),before=board[cell]?.at(-1);
    if(exposed?.animal==='orca'&&exposed.uid!==before?.uid&&outcome.some((stack,target)=>stack.length&&target!==cell))revealedOrcas.add(exposed.uid);
  }
  count+=revealedOrcas.size;
  return count;
}
function bestResponseScore(board) {
  const replies=generateTurns(board,ANIMAL_IDS,'human',1);
  if(!replies.length)return 0;
  // A direct winning reply matters far more than any positional advantage.
  return replies[0].wins?100000+replies[0].wins*1000:replies[0].position;
}
function chooseTurnPlan(board,hand,owner) {
  // The survival score below accounts for Orca's possible extra soul and may
  // still choose it when a krill move safely offsets that gain.
  const available=hand;
  const options=generateTurns(board,available,owner,36,hand.length>=5&&hand.includes('krill'));if(!options.length)return null;
  let best=null,bestScore=-Infinity;const responseCache=new Map();
  for(const option of options){
    const seenOutcomes=new Set();
    for(const outcome of turnBoardOutcomes(board,option)){
      const key=boardKey(outcome);if(seenOutcomes.has(key))continue;seenOutcomes.add(key);
      const wins=completedLines(outcome).length,after=cloneBoard(outcome);clearLines(after);
      const replyKey=boardKey(after),threat=responseCache.has(replyKey)?responseCache.get(replyKey):bestResponseScore(after);
      responseCache.set(replyKey,threat);
      const finalHand=expectedHandAfterTurn(board,option,hand,outcome);
      // Score the settled board after mandatory effects. In particular, an
      // eagle's first move is not its final location: its flight and any rabbit
      // revealed by that flight must be resolved before judging the turn.
      // Staying below the elimination limit has absolute priority over every
      // board objective; a krill move is credited only when it can actually
      // spend a krill from hand on an empty cell.
      const survival=finalHand<6?0:-1e12-(finalHand-5)*1e9;
      const score=survival+wins*1000000-threat*10+positionScore(outcome)*4+positionScore(after);
      if(score>bestScore){bestScore=score;best={create:option.create,move:option.move,order:option.order,score};}
    }
  }
  return best;
}
function chooseCreate(board,hand,owner) {
  let best=null,bestScore=-Infinity;
  const available=hand.length>=6?hand.filter(animal=>animal!=='orca'):hand;
  for(const animal of [...new Set(available)]){
    for(let cell=0;cell<board.length;cell++){
      if(!canCreate(board,animal,cell))continue;
      const next=cloneBoard(board);put(next,animal,cell,owner);
      const wins=completedLines(next).length,after=cloneBoard(next);clearLines(after);
      const score=wins*1000000+positionScore(next)*4+positionScore(after);
      if(score>bestScore){bestScore=score;best={animal,cell};}
    }
  }
  return best;
}
function chooseMove(board,owner) {
  let best=null,bestScore=-Infinity;const responseCache=new Map();
  for(const action of moves(board)){
    const next=cloneBoard(board);move(next,action);const movedPiece=next[action.to].at(-1);
    let outcomes=revealRabbitOutcomes(next,action.from);
    if(action.animal==='eagle')outcomes=outcomes.flatMap(state=>eagleFlightOutcomes(state,movedPiece.uid));
    const seen=new Set();
    for(const outcome of outcomes){
      const key=boardKey(outcome);if(seen.has(key))continue;seen.add(key);
      const wins=completedLines(outcome).length,cleared=cloneBoard(outcome);clearLines(cleared);
      const replyKey=boardKey(cleared),threat=responseCache.has(replyKey)?responseCache.get(replyKey):bestResponseScore(cleared);
      responseCache.set(replyKey,threat);
      const score=wins*1000000-threat*10+positionScore(outcome)*4;
      if(score>bestScore){bestScore=score;best=action;}
    }
  }
  return best;
}
function locate(board,uid) {
  for(let cell=0;cell<board.length;cell++){const index=board[cell].findIndex(piece=>piece.uid===uid);if(index>=0)return{cell,index,piece:board[cell][index]};}
  return null;
}
function strategicValue(board) {
  const wins=completedLines(board).length,cleared=cloneBoard(board);clearLines(cleared);
  return wins*1000000-bestResponseScore(cleared)*10+positionScore(board)*4;
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
    const seal=locate(board,pending.pieceId);if(!seal)return{type:'sealChoose',handIndex:0};
    const scored=hand.map((animal,handIndex)=>({animal,handIndex,value:cardValue(animal,board,hand)})).sort((a,b)=>a.value-b.value);
    return{type:'sealChoose',handIndex:scored[0]?.handIndex??0};
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
  if(pending.type==='grasshopper-swap'){
    const grasshopper=locate(board,pending.pieceId);if(!grasshopper)return{type:'grasshopperSwap',handIndex:0};
    let best=0,bestScore=-Infinity;
    hand.forEach((animal,handIndex)=>{
      const next=cloneBoard(board),piece=locate(next,pending.pieceId),species=SPECIES[animal];
      if(!piece||!species)return;
      next[piece.cell][piece.index].animal=animal;next[piece.cell][piece.index].level=species.level||undefined;
      const score=strategicValue(next)-cardValue(animal,board,hand)*0.12;
      if(score>bestScore){bestScore=score;best=handIndex;}
    });
    return{type:'grasshopperSwap',handIndex:best};
  }
  if(pending.type==='treefrog-swap'){
    const frog=locate(board,pending.pieceId);if(!frog)return null;
    let best=null,bestScore=-Infinity;
    for(const to of pending.targets||[]){const next=cloneBoard(board),current=locate(next,pending.pieceId),other=next[to]?.at(-1);if(!current||!other)continue;
      const [frogTop]=next[current.cell].splice(-1),[otherTop]=next[to].splice(-1);next[current.cell].push(otherTop);next[to].push(frogTop);
      const score=strategicValue(next);if(score>bestScore){bestScore=score;best=to;}
    }
    return best===null?null:{type:'effectMove',to:best};
  }
  if(pending.type==='crocodile-line'){
    const crocodile=locate(board,pending.pieceId);if(!crocodile)return null;
    let bestIndex=null,bestScore=-Infinity;
    for(const [lineIndex,line] of (pending.lines||[]).entries()){
      const next=cloneBoard(board);for(const cell of line)if(cell!==crocodile.cell)next[cell].pop();
      const score=strategicValue(next);if(score>bestScore){bestScore=score;bestIndex=lineIndex;}
    }
    return bestIndex===null?null:{type:'crocodileLine',lineIndex:bestIndex};
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
    const remainingHand=hand.slice(),krillIndex=remainingHand.indexOf('krill');if(krillIndex>=0)remainingHand.splice(krillIndex,1);
    const safeTargets=targets.filter(dest=>{const next=cloneBoard(board);put(next,'krill',dest,botId,'effect');return remainingHand.some(animal=>next.some((_,cell)=>canCreate(next,animal,cell)));});
    const to=chooseTarget(board,safeTargets.length?safeTargets:targets,(next,dest)=>{put(next,'krill',dest,botId,'effect');return true;});
    return to===null?null:{type:'effectMove',to};
  }
  if(pending.type==='eagle-flight'){
    const eagle=locate(board,pending.pieceId);if(!eagle)return null;
    const to=chooseTarget(board,targets,(next,dest)=>{
      const bird=locate(next,pending.pieceId);if(!bird||!next[dest]?.length||next[dest].at(-1).uid===pending.pieceId)return false;
      const [piece]=next[bird.cell].splice(bird.index,1);next[dest].push(piece);return true;
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

module.exports = { chooseTurnPlan, chooseCreate, chooseMove, choosePendingAction };
