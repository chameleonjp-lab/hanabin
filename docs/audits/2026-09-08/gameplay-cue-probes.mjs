import fs from 'node:fs';
import {DEFAULT_RULES as rules} from '../../../src/config/rules.js';
import {runSimulation} from '../../../src/core/simulation.js';
import {strategyFiveThenDetonate,strategyForecast} from '../../../src/core/strategies.js';
import {selectionBlastCueFor,forecastReadinessFor} from '../../../src/ui/hud.js';
import {detonate,advanceGame} from '../../../src/core/engine.js';
import {practiceTargetsAt,practiceTargetBoardPoint} from '../../../src/ui/tutorial.js';
let misleading=null,lateReadiness=null;
runSimulation(1,{strategy:(s,c)=>{if(!misleading&&s.selectedIds.length>=3&&s.selectedIds.length<5){const ids=new Set(s.selectedIds);const src=s.fireworks.filter(t=>ids.has(t.id));const cue=selectionBlastCueFor(s);if(cue&&src.every(t=>t.layout==='choice-reserve'))misleading={tick:s.tick,cue,state:structuredClone(s)};}return strategyFiveThenDetonate(s,c);},summaryOnly:true});
if(misleading){const {state,...meta}=misleading;const before=state.stats.chainTargets;detonate(state,rules,state.actionCount);advanceGame(state,state.tick+40);misleading={...meta,selectedIds:meta.selectedIds,chainTargetsAdded:state.stats.chainTargets-before,sourceLayouts:state.scoreEvents.filter(e=>e.fireTick===meta.tick).map(e=>({targetId:e.targetId,kind:e.kind}))};}
runSimulation(1,{strategy:(s,c)=>{if(!lateReadiness&&s.tick>3540&&forecastReadinessFor(s).ready)lateReadiness={tick:s.tick,readiness:forecastReadinessFor(s)};return strategyForecast(s,c);},summaryOnly:true});
let minDist=Infinity,maxDist=0,maxMovingStep=0;for(let tick=0;tick<3600;tick++){const t=practiceTargetsAt(2,tick).map(t=>practiceTargetBoardPoint(t));const next=practiceTargetsAt(2,tick+1).map(t=>practiceTargetBoardPoint(t));const d=Math.hypot(t[2].x-t[3].x,t[2].y-t[3].y);minDist=Math.min(minDist,d);maxDist=Math.max(maxDist,d);for(let i=0;i<3;i++)maxMovingStep=Math.max(maxMovingStep,Math.hypot(next[i].x-t[i].x,next[i].y-t[i].y));}
const out={misleading,lateReadiness,practiceChainGeometry:{minDist,maxDist,radius:rules.baseExplosionRadius,maxMovingStep,pressureStep:Math.hypot(290,73)}};
fs.writeFileSync(new URL('./gameplay-cue-probes.json', import.meta.url),JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
