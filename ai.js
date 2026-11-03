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
function positionScore(board,owner='ai') {
  let score=0;
  for(const cells of LINES){
    const tops=cells.map(cell=>board[cell].at(-1));
    for(let chain=0;chain<4;chain++){
      const matching=tops.filter(piece=>piece&&SPECIES[piece.animal]?.chain===chain);
      const matches=matching.length,levels=matching.map(piece=>SPECIES[piece.animal].level);
      const distinct=new Set(levels).size;
      const own=matching.filter(piece=>piece.owner===owner).length;
      if(matches===1)score+=own?0.8:0.1;
      if(matches===2)score+=distinct===2?(own===2?10:-6):(own===2?2:-1);
      if(matches===3&&distinct===3)score+=own===3?20:1;
    }
    const chameleonPieces=tops.filter(piece=>piece?.animal==='chameleon'),chameleons=chameleonPieces.length;
    const ownChameleons=chameleonPieces.filter(piece=>piece.owner===owner).length;
    if(chameleons===1)score+=ownChameleons?0.8:0.1;if(chameleons===2)score+=ownChameleons===2?10:-6;if(chameleons===3)score+=ownChameleons===3?20:1;

    // Pieces directly beneath each top animal are the next likely animals to
    // become visible. Give them a smaller, separate value so the AI considers
    // stack depth without treating buried pieces as an already completed line.
    for(let depth=2;depth<=3;depth++){
      const layer=cells.map(cell=>board[cell].at(-depth));
      for(let chain=0;chain<4;chain++){
        const levels=layer.filter(piece=>piece&&SPECIES[piece.animal]?.chain===chain).map(piece=>SPECIES[piece.animal].level);
        const distinct=new Set(levels).size;
        const knownLayer=cells.map(cell=>board[cell].at(-depth)).filter(piece=>piece&&SPECIES[piece.animal]?.chain===chain);
        const ownLayer=knownLayer.filter(piece=>piece.owner===owner).length;
        if(levels.length===1)score+=(ownLayer?0.18:0.02)/(depth-1);
        if(levels.length===2)score+=(distinct===2?(ownLayer===2?1.8:-0.9):(ownLayer===2?0.55:-0.2))/(depth-1);
      }
      const buriedChameleons=layer.filter(piece=>piece?.animal==='chameleon'),ownBuriedChameleons=buriedChameleons.filter(piece=>piece.owner===owner).length;
      if(buriedChameleons.length===1)score+=(ownBuriedChameleons?0.18:0.02)/(depth-1);
      if(buriedChameleons.length===2)score+=(ownBuriedChameleons===2?1.8:-0.9)/(depth-1);
    }
  }
  return score;
}
function defenseRisk(board,owner) {
  let risk=0;const chainAnimals=Array.from({length:4},()=>new Set()),chainHasOpponent=Array(4).fill(false);
  for(const stack of board){const piece=stack.at(-1),species=piece&&SPECIES[piece.animal];if(!species||species.chain>=4)continue;chainAnimals[species.chain].add(piece.animal);if(piece.owner!==owner)chainHasOpponent[species.chain]=true;}
  for(let chain=0;chain<4;chain++)if(chainHasOpponent[chain]&&chainAnimals[chain].size>=2)risk+=18*(chainAnimals[chain].size-1);
  for(const cells of LINES){
    const tops=cells.map(cell=>board[cell].at(-1));
    for(let chain=0;chain<4;chain++){
      const matching=tops.filter(piece=>piece&&SPECIES[piece.animal]?.chain===chain);
      const different=new Set(matching.map(piece=>piece.animal)).size;
      if(different>=2&&matching.some(piece=>piece.owner!==owner))risk+=different===3?80:55;
    }
    const chameleons=tops.filter(piece=>piece?.animal==='chameleon');
    if(chameleons.length>=2&&chameleons.some(piece=>piece.owner!==owner))risk+=60;
  }
  return risk;
}
function boardKey(board) { return board.map(stack=>stack.map(piece=>`${piece.animal}:${piece.owner||''}:${piece.simOrcaGains||0}`).join('.')).join('/'); }

function generateTurns(board,allowed,owner,limit=Infinity,reserveKrillMoves=false) {
  const results=[],seen=new Set(),animals=[...new Set(allowed.filter(animal=>SPECIES[animal]))];
  const save=(next,createAction,moveAction,order)=>{
    const key=boardKey(next);if(seen.has(key))return;seen.add(key);
    results.push({board:next,create:createAction,move:moveAction,order,wins:completedLines(next).length,position:positionScore(next,owner)});
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
function revealRabbitOutcomes(board,cell,depth=0,hand=[],owner='ai'){
  if(depth>=4)return[board];
  const exposed=board[cell]?.at(-1);if(!exposed)return[board];
  const outcomes=[];
  if(exposed.animal==='rabbit'){
    for(const to of adjacent(cell)){const next=cloneBoard(board);move(next,{from:cell,to});outcomes.push(...revealRabbitOutcomes(next,cell,depth+1,hand,owner));}
  }else if(exposed.animal==='treefrog'){
    for(const to of adjacent(cell)){if(!board[to]?.length)continue;const next=cloneBoard(board),[frog]=next[cell].splice(-1),[other]=next[to].splice(-1);next[cell].push(other);next[to].push(frog);outcomes.push(next);}
  }else if(exposed.animal==='python'){
    for(const from of adjacent(cell)){if(!board[from]?.length)continue;const next=cloneBoard(board),[taken]=next[from].splice(-1);next[cell].splice(next[cell].length-1,0,taken);outcomes.push(...revealRabbitOutcomes(next,from,depth+1,hand,owner));}
  }else if(exposed.animal==='orca'){
    for(let from=0;from<board.length;from++){if(from===cell||!board[from]?.length)continue;const next=cloneBoard(board);next[from].pop();const current=next[cell].at(-1);current.simOrcaGains=(current.simOrcaGains||0)+1;outcomes.push(...revealRabbitOutcomes(next,from,depth+1,hand,owner));}
  }else if(exposed.animal==='seal'){
    for(const animal of [...new Set(hand)]){const next=cloneBoard(board),seal=next[cell].at(-1);next[cell].splice(next[cell].length-1,0,{uid:`known-seal-${seal.uid}-${animal}`,animal,level:SPECIES[animal]?.level||undefined,owner,known:true});outcomes.push(next);}
  }
  // Fox's hand exchange does not change the board; unknown abilities stay
  // hidden behind an unknown-piece marker rather than being guessed.
  return outcomes.length?dedupeOutcomes(outcomes):[board];
}
function eagleFlightOutcomes(board,eagleUid,hand=[],owner='ai'){
  const eagle=locate(board,eagleUid);
  if(!eagle||board[eagle.cell].at(-1)?.uid!==eagleUid)return[board];
  const outcomes=[];
  for(let target=0;target<board.length;target++){
    if(target===eagle.cell||!board[target].length)continue;
    const next=cloneBoard(board),bird=locate(next,eagleUid);
    const [piece]=next[bird.cell].splice(bird.index,1);next[target].push(piece);
    outcomes.push(...revealRabbitOutcomes(next,bird.cell,0,hand,owner));
  }
  // If there is no legal perch, the server resolves the move without a flight.
  return outcomes.length?outcomes:[board];
}
function dedupeOutcomes(boards,limit=48){
  const seen=new Set(),out=[];
  for(const candidate of boards){const key=boardKey(candidate);if(seen.has(key))continue;seen.add(key);out.push(candidate);if(out.length>=limit)break;}
  return out;
}
function afterMoveOutcomes(board,pieceUid,target,hand,owner,depth=0){
  if(depth>=3)return[board];
  const found=locate(board,pieceUid);if(!found||found.cell!==target||board[target].at(-1)?.uid!==pieceUid)return[board];
  const animal=found.piece.animal,outcomes=[];
  if(animal==='mole'){
    const next=cloneBoard(board),moleAt=locate(next,pieceUid),[mole]=next[target].splice(moleAt.index,1);next[target].unshift(mole);
    return revealRabbitOutcomes(next,target,0,hand,owner);
  }
  if(animal==='krill'&&hand.includes('krill')){
    for(let cell=0;cell<board.length;cell++)if(!board[cell].length){const next=cloneBoard(board);put(next,'krill',cell,owner,'krill-effect');outcomes.push(next);}
    return outcomes.length?dedupeOutcomes(outcomes):[board];
  }
  if(animal==='eagle')return eagleFlightOutcomes(board,pieceUid,hand,owner);
  if(animal==='weasel'){
    for(let from=0;from<board.length;from++){
      const top=board[from].at(-1);if(!top||top.uid===pieceUid)continue;
      for(const to of adjacent(from)){
        const next=cloneBoard(board);move(next,{from,to});
        for(const afterReveal of revealRabbitOutcomes(next,from,0,hand,owner)){
          const follow=locate(afterReveal,top.uid);
          if(follow&&follow.cell===to&&afterReveal[to].at(-1)?.uid===top.uid)
            outcomes.push(...afterMoveOutcomes(afterReveal,top.uid,to,hand,owner,depth+1));
          else outcomes.push(afterReveal);
        }
      }
    }
    return outcomes.length?dedupeOutcomes(outcomes):[board];
  }
  if(animal==='crocodile'){
    for(const line of LINES.filter(cells=>cells.includes(target))){
      const next=cloneBoard(board),removed=[];
      for(const cell of line)if(cell!==target&&next[cell].length){next[cell].pop();removed.push(cell);}
      let variants=[next];
      for(const cell of removed){
        const exposed=variants.flatMap(candidate=>revealRabbitOutcomes(candidate,cell,0,hand,owner));
        if(exposed.length>variants.length)variants=dedupeOutcomes(exposed);
      }
      outcomes.push(...variants);
    }
    return outcomes.length?dedupeOutcomes(outcomes):[board];
  }
  if(animal==='grasshopper'){
    for(const replacement of hand){const next=cloneBoard(board),piece=locate(next,pieceUid);if(!piece)continue;
      next[piece.cell][piece.index].animal=replacement;next[piece.cell][piece.index].level=SPECIES[replacement]?.level||undefined;outcomes.push(next);}
    return outcomes.length?dedupeOutcomes(outcomes):[board];
  }
  return[board];
}
function turnBoardOutcomes(board,option,hand=[],owner='ai'){
  let base=cloneBoard(board);
  if(option.order==='create-first'){
    put(base,option.create.animal,option.create.cell,owner);
    const effectHand=hand.slice();if(option.order==='create-first'){const used=effectHand.indexOf(option.create.animal);if(used>=0)effectHand.splice(used,1);}
    let starts=revealRabbitOutcomes(base,option.create.cell,0,effectHand,owner);
    const results=[];
    for(const created of starts){
      if(!created[option.move.from]?.length||created[option.move.from].at(-1).animal!==option.move.animal)continue;
      const movedUid=created[option.move.from].at(-1).uid,next=cloneBoard(created);move(next,option.move);
      for(const revealed of revealRabbitOutcomes(next,option.move.from,0,effectHand,owner))results.push(...afterMoveOutcomes(revealed,movedUid,option.move.to,effectHand,owner));
    }
    return dedupeOutcomes(results);
  }else{
    move(base,option.move);
    const movedPiece=base[option.move.to]?.at(-1);
    // The reveal at the vacated square resolves before the moved animal's
    // after-move ability (notably the eagle flight).
    const revealOutcomes=revealRabbitOutcomes(base,option.move.from,0,hand,owner);
    const settled=[];
    for(const revealed of revealOutcomes){
      let after=afterMoveOutcomes(revealed,movedPiece?.uid,option.move.to,hand,owner);
      for(const result of after){
        if(!canCreate(result,option.create.animal,option.create.cell))continue;
        put(result,option.create.animal,option.create.cell,owner);settled.push(result);
      }
    }
    return settled;
  }
}
function krillCanReduceHand(board,option,hand,outcome){
  if(option.move.animal!=='krill')return false;
  const krillInHand=hand.filter(animal=>animal==='krill').length-(option.order==='create-first'&&option.create.animal==='krill'?1:0);
  if(krillInHand<1)return false;
  const stage=cloneBoard(board);
  if(option.order==='create-first')put(stage,option.create.animal,option.create.cell,stage[option.create.cell].at(-1)?.owner||'ai');
  move(stage,option.move);
  const moved=stage[option.move.to].at(-1),settledStack=outcome[option.move.to]||[];
  if(!moved)return false;
  const movedIndex=settledStack.findIndex(piece=>piece.uid===moved.uid);
  const plannedCreateUid=`sim-${option.create.animal}-${option.create.cell}`;
  const remainsTop=settledStack.at(-1)?.uid===moved.uid;
  const coveredOnlyByPlannedBirth=option.order==='move-first'&&settledStack.at(-1)?.uid===plannedCreateUid&&settledStack.at(-2)?.uid===moved.uid;
  if(movedIndex<0||(!remainsTop&&!coveredOnlyByPlannedBirth))return false;
  return stage.some(stack=>stack.length===0)||outcome.some(stack=>stack.length===0);
}
function expectedHandAfterTurn(board,option,hand,outcome){
  let count=hand.length-1; // The planned birth uses one soul from hand.
  if(krillCanReduceHand(board,option,hand,outcome))count--;
  count+=newlyTriggeredOrcaCount(board,outcome);
  return count;
}
function newlyTriggeredOrcaCount(before,after){
  return after.flat().reduce((sum,piece)=>sum+(piece.simOrcaGains||0),0);
}
function bestResponseScore(board,attacker='human') {
  const replies=generateTurns(board,ANIMAL_IDS,attacker,12);
  if(!replies.length)return 0;
  let best=0;
  for(const reply of replies){
    for(const outcome of turnBoardOutcomes(board,reply,ANIMAL_IDS,attacker)){
      if(completedLines(outcome).length)return 10000;
      best=Math.max(best,defenseRisk(outcome,attacker)+positionScore(outcome,attacker));
    }
  }
  // Direct next-turn connections rank far above exposed two-animal patterns.
  return best;
}
function chooseTurnPlan(board,hand,owner) {
  // The survival score below accounts for Orca's possible extra soul and may
  // still choose it when a krill move safely offsets that gain.
  const available=hand;
  const options=generateTurns(board,available,owner,36,hand.length>=5&&hand.includes('krill'));if(!options.length)return null;
  let best=null,bestScore=-Infinity;const responseCache=new Map();
  for(const option of options){
    const seenOutcomes=new Set();
    for(const outcome of turnBoardOutcomes(board,option,hand,owner)){
      const key=boardKey(outcome);if(seenOutcomes.has(key))continue;seenOutcomes.add(key);
      const wins=completedLines(outcome).length?1:0,after=cloneBoard(outcome);clearLines(after);
      const replyKey=boardKey(after),threat=responseCache.has(replyKey)?responseCache.get(replyKey):bestResponseScore(after,'opponent');
      responseCache.set(replyKey,threat);
      const finalHand=expectedHandAfterTurn(board,option,hand,outcome);
      // Score the settled board after mandatory effects. In particular, an
      // eagle's first move is not its final location: its flight and any rabbit
      // revealed by that flight must be resolved before judging the turn.
      // Staying below the elimination limit has absolute priority over every
      // board objective; a krill move is credited only when it can actually
      // spend a krill from hand on an empty cell.
      const survival=finalHand<6?0:-1e12-(finalHand-5)*1e9;
      const score=survival+wins*1000000000-threat*10000-defenseRisk(outcome,owner)*500+positionScore(outcome,owner)*10+positionScore(after,owner);
      if(score>bestScore){bestScore=score;best={create:option.create,move:option.move,order:option.order,score};}
    }
  }
  return best;
}
function chooseCreate(board,hand,owner) {
  let best=null,bestScore=-Infinity;const responseCache=new Map();
  const available=hand;
  for(const animal of [...new Set(available)]){
    for(let cell=0;cell<board.length;cell++){
      if(!canCreate(board,animal,cell))continue;
      const next=cloneBoard(board);put(next,animal,cell,owner);
      for(const outcome of revealRabbitOutcomes(next,cell,0,hand,owner)){
        const wins=completedLines(outcome).length?1:0,after=cloneBoard(outcome);clearLines(after);
        const finalHand=hand.length-1+newlyTriggeredOrcaCount(board,outcome),survival=finalHand<6?0:-1e12-(finalHand-5)*1e9;
        const key=boardKey(after),threat=responseCache.has(key)?responseCache.get(key):bestResponseScore(after,'opponent');responseCache.set(key,threat);
        const score=survival+wins*1000000000-threat*10000-defenseRisk(outcome,owner)*500+positionScore(outcome,owner)*10+positionScore(after,owner);
        if(score>bestScore){bestScore=score;best={animal,cell};}
      }
    }
  }
  return best;
}
function chooseMove(board,owner,hand=[]) {
  let best=null,bestScore=-Infinity;const responseCache=new Map();
  for(const action of moves(board)){
    const next=cloneBoard(board);move(next,action);const movedPiece=next[action.to].at(-1);
    let outcomes=revealRabbitOutcomes(next,action.from,0,hand,owner);
    outcomes=outcomes.flatMap(state=>afterMoveOutcomes(state,movedPiece.uid,action.to,hand,owner));
    const seen=new Set();
    for(const outcome of outcomes){
      const key=boardKey(outcome);if(seen.has(key))continue;seen.add(key);
      const wins=completedLines(outcome).length?1:0,cleared=cloneBoard(outcome);clearLines(cleared);
      const replyKey=boardKey(cleared),threat=responseCache.has(replyKey)?responseCache.get(replyKey):bestResponseScore(cleared,'opponent');
      responseCache.set(replyKey,threat);
      const finalHand=hand.length+newlyTriggeredOrcaCount(board,outcome),survival=finalHand<6?0:-1e12-(finalHand-5)*1e9;
      const score=survival+wins*1000000000-threat*10000-defenseRisk(outcome,owner)*500+positionScore(outcome,owner)*10;
      if(score>bestScore){bestScore=score;best=action;}
    }
  }
  return best;
}
function locate(board,uid) {
  for(let cell=0;cell<board.length;cell++){const index=board[cell].findIndex(piece=>piece.uid===uid);if(index>=0)return{cell,index,piece:board[cell][index]};}
  return null;
}
function strategicValue(board,owner='ai') {
  const wins=completedLines(board).length?1:0,cleared=cloneBoard(board);clearLines(cleared);
  return wins*1000000000-bestResponseScore(cleared,'opponent')*10000-defenseRisk(board,owner)*500+positionScore(board,owner)*10;
}
function chooseTarget(board,targets,simulate,owner='ai') {
  let best=null,bestScore=-Infinity;
  for(const to of targets){const next=cloneBoard(board);if(!simulate(next,to))continue;const score=strategicValue(next,owner);if(score>bestScore){bestScore=score;best=to;}}
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
  if(pending.type==='line-choice'){
    // Resolve a winning line first when possible; otherwise remove the line
    // that best improves the board after its top pieces are cleared.
    let bestIndex=null,bestScore=-Infinity;
    for(const [lineIndex,line] of (pending.lines||[]).entries()){
      const next=cloneBoard(board);for(const cell of line.cells||[])next[cell]?.pop();
      const score=strategicValue(next,botId);if(score>bestScore){bestScore=score;bestIndex=lineIndex;}
    }
    return bestIndex===null?null:{type:'lineChoice',lineIndex:bestIndex};
  }
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
      score+=strategicValue(board,botId)*0.01;
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
      const score=strategicValue(next,botId)-cardValue(animal,board,hand)*0.12;
      if(score>bestScore){bestScore=score;best=handIndex;}
    });
    return{type:'grasshopperSwap',handIndex:best};
  }
  if(pending.type==='treefrog-swap'){
    const frog=locate(board,pending.pieceId);if(!frog)return null;
    let best=null,bestScore=-Infinity;
    for(const to of pending.targets||[]){const next=cloneBoard(board),current=locate(next,pending.pieceId),other=next[to]?.at(-1);if(!current||!other)continue;
      const [frogTop]=next[current.cell].splice(-1),[otherTop]=next[to].splice(-1);next[current.cell].push(otherTop);next[to].push(frogTop);
      const score=strategicValue(next,botId);if(score>bestScore){bestScore=score;best=to;}
    }
    return best===null?null:{type:'effectMove',to:best};
  }
  if(pending.type==='crocodile-line'){
    const crocodile=locate(board,pending.pieceId);if(!crocodile)return null;
    let bestIndex=null,bestScore=-Infinity;
    for(const [lineIndex,line] of (pending.lines||[]).entries()){
      const next=cloneBoard(board);for(const cell of line)if(cell!==crocodile.cell)next[cell].pop();
      const score=strategicValue(next,botId);if(score>bestScore){bestScore=score;bestIndex=lineIndex;}
    }
    return bestIndex===null?null:{type:'crocodileLine',lineIndex:bestIndex};
  }
  let targets=pending.targets||[];
  if(pending.type==='weasel-select'){
    let best=null,bestScore=-Infinity;
    for(const from of targets){const stack=board[from],piece=stack?.at(-1);if(!piece||piece.uid===pending.pieceId)continue;
      let local=-1;
      for(const to of adjacent(from)){const next=cloneBoard(board);move(next,{from,to});local=Math.max(local,strategicValue(next,botId));}
      const score=local+(SPECIES[piece.animal]?.level||0)*0.05;
      if(score>bestScore){bestScore=score;best=from;}
    }
    return best===null?null:{type:'effectMove',to:best};
  }
  if(pending.type==='rabbit-move'||pending.type==='weasel-target'){
    const from=pending.from,piece=board[from]?.at(-1);if(!piece)return null;
    const to=chooseTarget(board,targets,(next,dest)=>{move(next,{from,to:dest});return true;},botId);
    return to===null?null:{type:'effectMove',to};
  }
  if(pending.type==='krill-place'){
    const remainingHand=hand.slice(),krillIndex=remainingHand.indexOf('krill');if(krillIndex>=0)remainingHand.splice(krillIndex,1);
    const safeTargets=targets.filter(dest=>{const next=cloneBoard(board);put(next,'krill',dest,botId,'effect');return remainingHand.some(animal=>next.some((_,cell)=>canCreate(next,animal,cell)));});
    const to=chooseTarget(board,safeTargets.length?safeTargets:targets,(next,dest)=>{put(next,'krill',dest,botId,'effect');return true;},botId);
    return to===null?null:{type:'effectMove',to};
  }
  if(pending.type==='eagle-flight'){
    const eagle=locate(board,pending.pieceId);if(!eagle)return null;
    const to=chooseTarget(board,targets,(next,dest)=>{
      const bird=locate(next,pending.pieceId);if(!bird||!next[dest]?.length||next[dest].at(-1).uid===pending.pieceId)return false;
      const [piece]=next[bird.cell].splice(bird.index,1);next[dest].push(piece);return true;
    },botId);
    return to===null?null:{type:'effectMove',to};
  }
  if(pending.type==='orca-take'){
    const to=chooseTarget(board,targets,(next,dest)=>{if(!next[dest]?.length)return false;next[dest].pop();return true;},botId);
    return to===null?null:{type:'effectMove',to};
  }
  if(pending.type==='python-collect'){
    const python=locate(board,pending.pieceId);if(!python)return null;
    const to=chooseTarget(board,targets,(next,source)=>{if(!next[source]?.length)return false;const [piece]=next[source].splice(-1);const current=locate(next,pending.pieceId);if(!current)return false;next[current.cell].splice(current.index,0,piece);return true;},botId);
    return to===null?null:{type:'effectMove',to};
  }
  return null;
}

module.exports = { chooseTurnPlan, chooseCreate, chooseMove, choosePendingAction };
