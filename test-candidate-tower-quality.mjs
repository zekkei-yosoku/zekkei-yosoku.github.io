import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Q=require('./src/features/candidates/tower-quality.js'),G=require('./astronotes-terrain.js');
const R=6371008.8,RAD=Math.PI/180;
const target={id:'skytree',latitude:35.71,longitude:139.81,groundM:2,parts:[{id:'tip',m:636},{id:'gallery',m:452},{id:'deck',m:352}]};
const observer={...G.destination(target.latitude,target.longitude,180,1),elevation:5,eyeM:1.5};
const model={vertices:[[-30,-30,0],[30,30,634]]};
const ports=()=>({align:{outlineModel:()=>model},terrain:{sample:async()=>({height:5,z:15})},heights:{upperPatch:async()=>({status:'clear',cells:1})},trees:{upperPatch:async()=>({status:'clear',cells:1})}});
function spherical(p,az,d){const a=p.latitude*RAD,t=az*RAD,s=d/R,b=Math.asin(Math.sin(a)*Math.cos(s)+Math.cos(a)*Math.sin(s)*Math.cos(t));return {latitude:b/RAD,longitude:p.longitude+Math.atan2(Math.sin(t)*Math.sin(s)*Math.cos(a),Math.cos(s)-Math.sin(a)*Math.sin(b))/RAD};}

test('lower main deck uses existing model datum; mountain remains outside the policy',()=>{
 assert.deepEqual(Q.requiredPart(target),{id:'deck',m:352});
 assert.deepEqual(Q.requiredPart({id:'tokyotower',parts:[{id:'top',m:247.55},{id:'main',m:148.389}]}),{id:'main',m:148.389});
 assert.equal(Q.requiredPart({id:'fuji',rim:{}}),null);
 assert.equal(Q.requiredPart({id:'skytree',rim:{}}),null);
 assert.equal(Q.requiredPart({...target,parts:[]}).m,undefined);
 assert.deepEqual(Q.requiredPart({id:'another-tower',parts:[{id:'deck',m:200},{id:'main',m:100},{id:'tip',m:300}]}),{id:'main',m:100});
});
test('lower envelope is below every higher endpoint, including observers above the deck',()=>{
 for(const eye of [1.5,150,400,800])for(const height of [148.389,352])for(const near of [80,1000,30000]){
  const obs={elevation:eye-1.5,eyeM:1.5},far=near+70,k=7/6,lower=Q.lowerProfile(obs,height,near,far,k),r=R*k;
  for(let i=0;i<=10;i++)for(let j=0;j<=10;j++){
   const d=near+(far-near)*i/10,s=near*j/10,H=height+200*i/10;
   const alpha=Math.atan2((r+H)*Math.cos(d/r)-(r+eye),(r+H)*Math.sin(d/r));
   const h=(r+eye)/(Math.cos(s/r)-Math.tan(alpha)*Math.sin(s/r))-r;
   assert(lower.h(s)<=h+1e-7);
   assert(lower.min(0,s)<=lower.h(s)+1e-7);
  }
 }
});
test('upper model radius includes crossing edges and excludes the wider lower legs',()=>{
 const t={...target,id:'test-tower',groundM:0,parts:[{id:'tip',m:100},{id:'main',m:50}]};
 const m={heightM:100,vertices:[[-100,0,0],[100,0,0],[-1,0,100],[1,0,100]],faces:[[0,1,2,3]]};
 const shape=Q.corridor(observer,t,m,7/6);assert(shape);assert(shape.radius>50&&shape.radius<60);
});
test('interval patch bounds contain interior spherical rays near all cardinal bearings',()=>{
 for(const latitude of [-60,-35,0,35,60])for(const az of [-180,-90,-1,0,89,179])for(const lo of [0,10,1000,49900]){
  const p={latitude,longitude:139},half=12,hi=lo+25,b=Q.patchBounds(p,az,half,lo,hi);
  assert(b);
  for(let i=0;i<=8;i++)for(let j=0;j<=8;j++){
   const q=spherical(p,az-half+2*half*i/8,lo+(hi-lo)*j/8);
   assert(q.latitude>=b.south&&q.latitude<=b.north&&q.longitude>=b.west&&q.longitude<=b.east);
  }
 }
});
test('the first patch rejects an off-fan native canopy cell instead of hiding the upper tower',async()=>{
 const point={latitude:35.6554008,longitude:139.748965,elevation:4.519999980926514,eyeM:1.5};
 const tower={id:'tokyotower',latitude:35.65859131567304,longitude:139.74544420093412,groundM:18,parts:[{id:'tip',m:351},{id:'main',m:148.389}]};
 const actual=require('./astronotes-tower-models.js').tokyotower;
 const cell={west:139.74881887435913,east:139.74884033203125,north:35.655413272930545,south:35.65539583776788};
 const patch=Q.corridor(point,tower,actual,7/6).patches().next().value;
 assert(cell.east>patch.west&&cell.west<patch.east&&cell.north>patch.south&&cell.south<patch.north,'the broad patch really touches the failing cell');
 assert.equal(patch.lowAt(cell),Infinity,'the cell is over 40 degrees off a 2.5-degree fan');
 const p=ports();p.align.outlineModel=()=>actual;p.trees.upperPatch=async b=>({status:b.lowAt(cell)===Infinity?'clear':'unknown',cells:1});
 assert.equal((await Q.check(point,tower,p)).status,'model-clear');
});
test('fan interval pruning retains every boundary ray, angle wrap and observer-containing cell',()=>{
 for(const latitude of [-59,0,35,59])for(const az of [-180,-179.99,-90,0,90,179.99]){
  const eye={latitude,longitude:179.99,elevation:5,eyeM:1.5},t={...target,...spherical(eye,az,600)};
  const shape=Q.corridor(eye,t,model,7/6),patches=[...shape.patches()];assert(shape);
  assert(Number.isFinite(patches[0].lowAt({west:eye.longitude-.00001,east:eye.longitude+.00001,south:eye.latitude-.00001,north:eye.latitude+.00001})));
  for(const index of [0,1,Math.floor(patches.length/2),patches.length-1]){
   const patch=patches[index],d=(patch.fromM+patch.toM)/2;
   for(const fraction of [-1,-.5,0,.5,1]){
    const point=spherical(eye,shape.az+shape.half*fraction,d),box={west:point.longitude-1e-7,east:point.longitude+1e-7,south:point.latitude-1e-7,north:point.latitude+1e-7};
    assert(Number.isFinite(patch.lowAt(box)),`${latitude}/${az}/${index}/${fraction}`);
   }
  }
 }
});
test('off-fan DEM cells are not read and cannot introduce zero ground beneath a crown',async()=>{
 const N=256*2**15,x=7450000,y=3350000,lon=u=>u/N*360-180,lat=v=>Math.atan(Math.sinh(Math.PI*(1-2*v/N)))/RAD;
 const patch={west:lon(x+.1),east:lon(x+3.9),south:lat(y+3.9),north:lat(y+.1),lowAt:b=>b.east<=lon(x+2)?Infinity:1000};let reads=0;
 const land=await Q.terrainPatch({sample:async p=>{reads++;assert(p.longitude>=lon(x+2));return {height:-5};}},patch,{check(){}});
 assert.equal(land.status,'clear');assert.equal(reads,8);assert.equal(land.cells,8);assert.equal(land.topM,-5);
 assert.equal(land.groundMax({west:lon(x+.2),east:lon(x+1.8),south:lat(y+3.8),north:lat(y+.2)}),null);
 assert.equal(land.groundMax({west:lon(x+2.2),east:lon(x+3.8),south:lat(y+3.8),north:lat(y+.2)}),-5);
});
test('complete flat raster corridor passes; a partial height or missing layer cannot pass',async()=>{
 const good=await Q.check(observer,target,ports());assert.equal(good.status,'model-clear');assert.equal(good.fromM,352);assert(good.terrainCells>100);assert.equal(good.actualVisibilityGuaranteed,false);
 for(const name of ['heights','trees']){
  const p=ports();p[name].upperPatch=async()=>({status:'unknown',reason:'missing'});
  assert.equal((await Q.check(observer,target,p)).status,'unknown');
 }
 const p=ports();p.terrain.sample=async()=>({height:null,reason:'terrain-budget'});
 assert.equal((await Q.check(observer,target,p)).reason,'terrain-budget');
 assert.equal((await Q.check(observer,target,{...ports(),trees:null})).status,'unknown');
 assert.equal((await Q.check(observer,{...target,parts:[]},ports())).status,'unknown');
});
test('a high obstacle on an interior width cell is read, even when three rays miss it',async()=>{
 const patches=[...Q.corridor(observer,target,model,7/6).patches()],p=patches[Math.floor(patches.length/2)];
 // Interior location, away from the centre and both exterior edges.
 const lat=(p.north+p.south)/2,lon=p.west+(p.east-p.west)*.7,ports0=ports();
 let hit=false;
 ports0.terrain.sample=async q=>{const high=Math.abs(q.latitude-lat)<.000025&&Math.abs(q.longitude-lon)<.000025;hit||=high;return {height:high?600:5};};
 const result=await Q.check(observer,target,ports0);assert(hit);assert.equal(result.status,'unknown');assert.equal(result.layer,'terrain');
});
test('time budget returns deferred without converting cancellation into a visible result',async()=>{
 const p=ports();let release;p.heights.upperPatch=()=>new Promise(r=>{release=r;});
 const result=await Q.check(observer,target,{...p,deadline:Date.now()+10});assert.equal(result.status,'deferred');
 release({status:'clear',cells:1});await new Promise(r=>setTimeout(r,0));
 await assert.rejects(Q.check(observer,target,{...ports(),isCurrent:()=>false}),/candidate-cancelled/);
 assert.equal((await Q.check(observer,target,{...ports(),deadline:Date.now()-1,isCurrent:()=>false})).status,'deferred');
 const aborter=new AbortController(),pending=Q.check(observer,target,{...p,signal:aborter.signal});
 aborter.abort();await assert.rejects(pending,/candidate-cancelled/);release({status:'clear',cells:1});
});

test('complete per-evaluation memo validates exact geometry/providers and returns independent evidence',async()=>{
 const p=ports(),memo=new Map();let reads=0;
 p.heights.upperPatch=async()=>{reads++;return {status:'clear',cells:1};};
 const first=await Q.check(observer,target,{...p,upperReads:memo}),n=reads;
 assert.equal(first.status,'model-clear');first.patches=-1;
 const hit=await Q.check(observer,target,{...p,upperReads:memo});assert.equal(reads,n);assert(hit.patches>0);
 await Q.check({...observer,eyeM:1.6},target,{...p,upperReads:memo});assert(reads>n);
 p.heights.upperPatch=async()=>({status:'unknown',reason:'changed'});
 assert.equal((await Q.check(observer,target,{...p,upperReads:memo})).reason,'changed');
 const old=model.vertices[0][0];try{
  model.vertices[0][0]=-100;
  const changed=ports();changed.heights.upperPatch=async()=>({status:'unknown',reason:'expanded'});
  assert.equal((await Q.check(observer,target,{...changed,upperReads:memo})).reason,'expanded');
 }finally{model.vertices[0][0]=old;}
 await assert.rejects(Q.check(observer,target,{...p,upperReads:memo,isCurrent:()=>false}),/candidate-cancelled/);
});

test('model edits arriving during a read invalidate the completed envelope',async()=>{
 const p=ports(),copy={vertices:model.vertices.map(v=>v.slice())};p.align.outlineModel=()=>copy;let once=false;
 p.heights.upperPatch=async()=>{if(!once){once=true;copy.vertices[0][0]=-100;}return {status:'clear',cells:1};};
 assert.equal((await Q.check(observer,target,p)).reason,'upper-model-changed');
});

test('a moving solve checks its resolved position even with a finite seed floor; survey does not bypass the gate',async()=>{
 const {createGeneric}=require('./src/features/candidates/generic-evaluator.js'),C=require('./src/features/candidates/composition.js');
 const oldSolve=C.opportunities,oldCheck=Q.check,seen=[];
 const point={...observer,groundM:5,surfaceElevationM:5,surfaceAglM:0,standingSurfaceKnown:true,surfaceGeometry:{lines:[[[observer.longitude,observer.latitude],[observer.longitude,observer.latitude+.001]]]},surveyedTargets:['skytree']};
 const geometry={azimuth:0,angle:10,topM:636,distanceKm:1},solved={...point,latitude:point.latitude+.001,elevation:5};
 const align={geometryFrom:()=>geometry,viewProjector:(az,alt)=>(a,h)=>[a-az,h-alt],viewUnprojector:(az,alt)=>(x,y)=>[az+x,alt+y],towerOutline:()=>({known:true,polygons:[[[-.001,0],[.001,0],[.001,10],[-.001,10]]]})};
 const bodies={state:()=>({azimuth:0,apparentAltitude:10,angularRadius:.25})},terrain={trace:async()=>({status:'model-clear',checked:1,missing:0})};
 try{
  C.opportunities=async()=>({solutions:[{observer:solved,event:{at:0},geometry}],partial:false});
  Q.check=async o=>{seen.push(o.latitude);return {status:o.latitude===point.latitude?'unknown':'model-clear',scope:'synthetic-position-gate'};};
  const model=createGeneric({align,bodies,geo:G,terrain,yieldTask:async()=>{}}),plan={target,body:'moon',strict:true,at:0,timeSpec:{kind:'instant',at:0},partId:'tip'};
  const result=await model.evaluate(plan,point,{});assert.equal(result.recommend,true);assert.deepEqual(seen,[solved.latitude]);assert.equal(result.assumedObserver.latitude,solved.latitude);
  seen.length=0;
  const fixed=await model.evaluate({...plan,strict:false},point,{});assert.equal(fixed.recommend,false);assert.equal(fixed.upperQuality.status,'unknown');assert.deepEqual(seen,[point.latitude]);
  Q.check=async()=>({status:'unknown'});assert.equal((await model.evaluate(plan,point,{})).recommend,false,'surveyed final observer is checked too');
  const extra={...target,id:'tokyotower',parts:[{id:'tip',m:351},{id:'main',m:148.389}]},targets=[];
  Q.check=async(o,t)=>{targets.push(t.id);return {status:t.id==='tokyotower'?'unknown':'model-clear'};};
  const required=await model.evaluate({...plan,extraTargets:[extra],requireAllTargets:true},point,{});
  assert.equal(required.recommend,false);assert.deepEqual(targets,['skytree','tokyotower']);
  targets.length=0;
  await model.evaluate({...plan,extraTargets:[extra],requireAllTargets:false},point,{});assert.deepEqual(targets,['skytree'],'optional extras retain their existing acceptance contract');
 }finally{C.opportunities=oldSolve;Q.check=oldCheck;}
});
