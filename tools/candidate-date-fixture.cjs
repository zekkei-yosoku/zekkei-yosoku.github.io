// Shared synthetic IO fixture for real trial UI journeys.
function fixture(tools){
 sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-date-test',loginId:'date-test',tools}));
 window.dateFixture={loads:[],aborted:[],holds:[],holdNext:false,failNext:false,nextCursor:null,holdCursor:null,repeatCursor:false,autoPages:false,startDuringRestore:false,windowOffsetHours:1};let discovery;
 Object.defineProperty(window,'AstroNotesCandidateDiscovery',{configurable:true,get:()=>discovery,set:api=>{
  discovery=api;let factory;Object.defineProperty(api,'createGenericSearch',{configurable:true,get:()=>factory,set:original=>{factory=options=>{
   AstroNotesCandidateComposition.inverseSeeds=async plan=>({seeds:[{latitude:35.69,longitude:139.73,at:plan.at,radiusM:500}],partial:true});
   AstroNotesCandidateComposition.windowEvents=plan=>[{at:AstroNotesCandidateDiscovery.day(plan.at)+12*3600000,kind:'rise'}];
   // Date and UI journeys use two standard places. Road opt-in has its own scope regression.
   const points=[{id:'park',placeKind:'park',latitude:35.6903,longitude:139.7304},{id:'river',placeKind:'plaza',latitude:35.6900,longitude:139.7300}].map(p=>({...p,surfaceId:p.id,standingSurfaceKnown:true}));
   // The synthetic places stand anywhere; the real visibility map (2026-11-13) would drop them, so it is left out here.
   const engine=original({...options,prefilter:null,provider:{load:async(plan,options)=>{
    const day=new Date(plan.at+32400000).toISOString().slice(0,10),nextCursor=!dateFixture.autoPages||options.cursor===0||dateFixture.repeatCursor?dateFixture.nextCursor:null;dateFixture.lastPlan=structuredClone(plan);dateFixture.loads.push({day,at:plan.at,cursor:options.cursor,timeSpec:structuredClone(plan.timeSpec)});options.signal?.addEventListener('abort',()=>dateFixture.aborted.push(day),{once:true});
    // failAlways: every load fails (a search now retries a failed region within the same run).
    if(dateFixture.failNext||dateFixture.failAlways){dateFixture.failNext=false;throw Error('synthetic provider failure');}
    // Intentionally non-abortable IO proves that a late result cannot revive an old day.
    if(dateFixture.holdNext||dateFixture.holdCursor!==null&&dateFixture.holdCursor===options.cursor){dateFixture.holdNext=false;dateFixture.holdCursor=null;await new Promise(release=>dateFixture.holds.push({day,release}));}
    const rows=dateFixture.positionDemo?['tip','gallery','deck'].map((id,i)=>({...points[0],id,surfaceId:id,latitude:35.6903+i*.0001})):dateFixture.extraOnCursor===options.cursor?
     [...points,{...points[0],id:'extra',surfaceId:'extra',latitude:35.7062,longitude:139.7463}]:points;
    return {points:rows,coverage:{nextCursor}};
   }},evaluate:async(plan,point)=>{
    const range=AstroNotesCandidateComposition.timeRange(plan),at=range.start===range.end?range.start:Math.min(range.end,range.start+(plan.timeSpec?.kind==='window'?dateFixture.windowOffsetHours:12)*3600000),day=new Date(at+32400000).toISOString().slice(0,10);
    const targetAngleDeg=dateFixture.demoAngles?({park:5.8,river:-2.1,extra:-.2})[point.id]:undefined;
    const obs={latitude:point.latitude,longitude:point.longitude,elevation:25,eyeM:4},g=dateFixture.positionDemo?AstroNotesAlign.geometryFrom(obs,plan.target,{partId:point.id,eyeM:4}):null;
    // Whole-object solver events use the target's reference part, not the body
    // position's nearest named part, as targetAltitude.
    const reference=dateFixture.positionDemo?AstroNotesAlign.geometryFrom(obs,plan.target,{partId:plan.partId,eyeM:4}):null;
    return {id:day+'-'+point.id,requestKey:plan.requestKey,recommend:true,placeKind:point.placeKind,rank:point.id==='park'?1:0,quality:{photographyClass:'normal',visibility:'model-clear',...(targetAngleDeg===undefined?{}:{targetAngleDeg})},place:{name:day+(point.placeKind==='park'?' 公園':' 河川沿いの広場'),latitude:point.latitude,longitude:point.longitude,elevation:25,groundManualM:25,standAglM:4,decks:[]},assumedObserver:obs,event:{at:at+(dateFixture.positionDemo?['tip','gallery','deck'].indexOf(point.id)*600000:0),targetPosition:{x:.5,y:point.id==='park'?.8:.2},radius:.25,azimuth:g?.azimuth??180+(point.id==='park'?-.18:.18),targetAzimuth:reference?.azimuth??180,targetAltitude:reference?.angle??10,altitude:g?.angle??10+(point.id==='park'?.18:-.18),partId:plan.partId,side:'rise',relation:point.id==='park'?'near':'exact'}};
   }});
   const cached=engine.cached.bind(engine);engine.cached=plan=>{const result=cached(plan);if(result&&dateFixture.startDuringRestore){dateFixture.startDuringRestore=false;queueMicrotask(()=>document.getElementById('candidateSearchAction')?.click());}return result;};
   return engine;
  };}});
 }});
}
module.exports={fixture};
