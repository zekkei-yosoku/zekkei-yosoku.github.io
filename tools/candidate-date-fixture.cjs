// Shared synthetic IO fixture for real trial UI journeys.
function fixture(tools){
 sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-date-test',loginId:'date-test',tools}));
 window.dateFixture={loads:[],aborted:[],holds:[],holdNext:false,failNext:false,nextCursor:null,holdCursor:null,repeatCursor:false,autoPages:false,startDuringRestore:false,windowOffsetHours:1};let discovery;
 Object.defineProperty(window,'AstroNotesCandidateDiscovery',{configurable:true,get:()=>discovery,set:api=>{
  discovery=api;let factory;Object.defineProperty(api,'createGenericSearch',{configurable:true,get:()=>factory,set:original=>{factory=options=>{
   AstroNotesCandidateComposition.inverseSeeds=async plan=>({seeds:[{latitude:35.69,longitude:139.73,at:plan.at,radiusM:500}],partial:true});
   AstroNotesCandidateComposition.windowEvents=plan=>[{at:AstroNotesCandidateDiscovery.day(plan.at)+12*3600000,kind:'rise'}];
   // 2026-11-10 New places are parks, squares, viewpoints and riverbanks only (no plain sidewalks).
   const points=[{id:'park',placeKind:'park',latitude:35.6903,longitude:139.7304},{id:'river',placeKind:'riverbank',latitude:35.6900,longitude:139.7300}].map(p=>({...p,surfaceId:p.id,standingSurfaceKnown:true}));
   // The synthetic places stand anywhere; the real visibility map (2026-11-13) would drop them, so it is left out here.
   const engine=original({...options,loadStatic:null,prefilter:null,provider:{load:async(plan,options)=>{
    const day=new Date(plan.at+32400000).toISOString().slice(0,10),nextCursor=!dateFixture.autoPages||options.cursor===0||dateFixture.repeatCursor?dateFixture.nextCursor:null;dateFixture.lastPlan=structuredClone(plan);dateFixture.loads.push({day,at:plan.at,cursor:options.cursor,timeSpec:structuredClone(plan.timeSpec)});options.signal?.addEventListener('abort',()=>dateFixture.aborted.push(day),{once:true});
    // failAlways: every load fails (a search now retries a failed region within the same run).
    if(dateFixture.failNext||dateFixture.failAlways){dateFixture.failNext=false;throw Error('synthetic provider failure');}
    // Intentionally non-abortable IO proves that a late result cannot revive an old day.
    if(dateFixture.holdNext||dateFixture.holdCursor!==null&&dateFixture.holdCursor===options.cursor){dateFixture.holdNext=false;dateFixture.holdCursor=null;await new Promise(release=>dateFixture.holds.push({day,release}));}
    return {points,coverage:{nextCursor}};
   }},evaluate:async(plan,point)=>{
    const range=AstroNotesCandidateComposition.timeRange(plan),at=range.start===range.end?range.start:Math.min(range.end,range.start+(plan.timeSpec?.kind==='window'?dateFixture.windowOffsetHours:12)*3600000),day=new Date(at+32400000).toISOString().slice(0,10);
    return {id:day+'-'+point.id,requestKey:plan.requestKey,recommend:true,placeKind:point.placeKind,rank:point.id==='park'?1:0,quality:{photographyClass:'normal',visibility:'model-clear'},place:{name:day+(point.id==='park'?' 公園':' 河川敷'),latitude:point.latitude,longitude:point.longitude,elevation:25,groundManualM:25,standAglM:4,decks:[]},assumedObserver:{latitude:point.latitude,longitude:point.longitude,elevation:25,eyeM:4},event:{at,partId:plan.partId,side:'rise',relation:point.id==='park'?'near':'exact'}};
   }});
   const cached=engine.cached.bind(engine);engine.cached=plan=>{const result=cached(plan);if(result&&dateFixture.startDuringRestore){dateFixture.startDuringRestore=false;queueMicrotask(()=>document.getElementById('candidateSearchAction')?.click());}return result;};
   return engine;
  };}});
 }});
}
module.exports={fixture};
