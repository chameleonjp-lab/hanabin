import fs from 'node:fs';
import { DEFAULT_RULES as rules, waveTickAt } from '../../../src/config/rules.js';
import { createGame, startGame, findCandidates } from '../../../src/core/engine.js';
import { clientToBoard } from '../../../src/input/pointer-controller.js';
import { TutorialController, practiceTargetBoardPoint, practiceTargetsAt } from '../../../src/ui/tutorial.js';
import { runSimulation } from '../../../src/core/simulation.js';
const out={};
const s=createGame(1);startGame(s);
out.mouse=s.fireworks.slice(0,3).map(t=>{const p=clientToBoard(t.x/16000*960,t.y/9000*540,{left:0,top:0,width:960,height:540});return {targetId:t.id,deltaY:p.y-t.y,candidates:findCandidates(s,p.x,p.y).map(x=>x.id)};});
const p=Object.create(TutorialController.prototype);Object.assign(p,{rules,stage:1,state:'running',inputTick:0,gesturePressed:false,selectedIds:[],selectedRecords:[],selectionSinceTick:null,hoverCandidateId:null,hoverTicks:0,sound:null});
const pts=practiceTargetsAt().map(t=>practiceTargetBoardPoint(t));
function input(tick,i,pressed=true){p.consumeInputFrame({tick,pressed,x:pts[i].x,y:pts[i].y});}
for(let i=0;i<3;i++)input(i,0);input(3,0,false);
out.practiceAfterFailedRelease={ids:[...p.selectedIds],records:p.selectedRecords.map(t=>t.id),since:p.selectionSinceTick};
for(let i=4;i<7;i++)input(i,1);for(let i=7;i<10;i++)input(i,2);
out.practiceAfterRetry={ids:[...p.selectedIds],records:p.selectedRecords.map(t=>t.id)};
input(10,2,false);input(200,0);
out.practiceNewPressAfterIdle={hover:p.hoverTicks,failure:p.lastFailureReason,ids:[...p.selectedIds]};
const shortestN=n=>(state)=>{
 if(state.selectedIds.length>=n)return {type:'pointer',pressed:false,x:0,y:0};
 const last=state.fireworks.find(t=>String(t.id)===String(state.selectedIds.at(-1)));
 const ox=last?.x??8000,oy=last?.y??4500;
 const opts=state.fireworks.filter(t=>t.status==='active'&&t.visible&&!state.selectedIds.includes(t.id)&&(state.selectedColor===null||t.color===state.selectedColor)&&(!last||(t.x-ox)**2+(t.y-oy)**2<=rules.selectionLinkDistance**2)).sort((a,b)=>((a.x-ox)**2+(a.y-oy)**2)-((b.x-ox)**2+(b.y-oy)**2)||b.depth-a.depth||a.id-b.id);
 return opts.length?{type:'pointer',pressed:true,x:opts[0].x,y:opts[0].y}:{type:'pointer',pressed:state.selectedIds.length<3,x:0,y:0};
};
out.runs=[];
for(let seed=1;seed<=20;seed++)for(const [name,strategy] of [['four',shortestN(4)],['five','shortest-five'],['forecast','forecast']]){
 const r=runSimulation(seed,{strategy,strategyName:name,collectPlayCurve:seed===1});
 const reserveIds=new Set(r.state.fireworks.filter(t=>t.layout==='choice-reserve').map(t=>t.id));
 const reserveScore=r.state.scoreEvents.filter(e=>reserveIds.has(e.targetId)).reduce((a,e)=>a+e.amount,0);
 out.runs.push({seed,name,score:r.score,reserveScore,reserveSpawned:r.state.stats.choiceGuaranteeEntities,detonations:r.state.stats.detonationCount,forecast:r.forecastPlanCount,fault:r.simulationFault,errors:r.invariantErrors,curve:r.playCurve,lateBonuses:r.state.bonusEvents.filter(e=>e.fireTick>=3540&&e.forecastPlanAmount>0)});
}
out.schedule=Array.from({length:22},(_,i)=>({wave:i,tick:waveTickAt(i)}));
fs.writeFileSync(new URL('./gameplay-probes.json', import.meta.url),JSON.stringify(out,null,2));
console.log(JSON.stringify({mouse:out.mouse,practiceAfterFailedRelease:out.practiceAfterFailedRelease,practiceAfterRetry:out.practiceAfterRetry,practiceNewPressAfterIdle:out.practiceNewPressAfterIdle,summaries:['four','five','forecast'].map(name=>{const a=out.runs.filter(r=>r.name===name);return {name,avgScore:a.reduce((s,r)=>s+r.score,0)/a.length,avgReserveScore:a.reduce((s,r)=>s+r.reserveScore,0)/a.length,avgReserveSpawned:a.reduce((s,r)=>s+r.reserveSpawned,0)/a.length,lateBonusRuns:a.filter(r=>r.lateBonuses.length).length,faults:a.filter(r=>r.fault).length,errors:a.filter(r=>r.errors.length).length};}),schedule:out.schedule},null,2));
