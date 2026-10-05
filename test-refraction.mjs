import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),RF=require('./sorami-refraction.js'),A=require('./sorami-astro.js'),M=require('./sorami-atmosphere.js');

// Python版 zekkei の Atmosphere(temperature_c=12, pressure_hpa=1015, observer_height_m=5, relative_humidity=0) と同じ柱
const pyTemp=(T0,h0)=>{const off=T0+273.15-RF.us76(h0);return h=>RF.us76(h)+off*(h<=h0?1:Math.max(0,1-(h-h0)/Math.max(11000-h0,1000)))-273.15;};
function pyColumn(T0,P,h0){
 const t=pyTemp(T0,h0),zs=[];for(let z=0;z<300;z+=10)zs.push(z);for(let z=300;z<11000;z+=100)zs.push(z);zs.push(11000);
 return {groundM:0,pressureHPa:Math.exp(Math.log(P)+0.034163*h0/(t(h0)+273.15)),points:zs.map(z=>({z,t:t(z)}))};
}
const sea5=RF.field([{s:0,...pyColumn(12,1015,5)}]);
const bennett=(a,p,c)=>1/Math.tan((a+7.31/(a+4.4))*Math.PI/180)*(p/1010)*(283/(273+c));

test('Python版と同じ大気で同じ大気差・同じ見上げ角になる',()=>{
 // 参照値は Python版（okayu0321/AI-Workspace claude/zekkei-refraction）で同条件を計算したもの
 for(const [a,ref] of [[0.5,28.254],[1,24.010],[2,18.092],[5,9.800],[10,5.290]])assert.ok(Math.abs(RF.trace(sea5,5,a).refraction*60-ref)<0.02,`${a}°`);
 assert.ok(Math.abs(RF.targetElevation(sea5,5,68759,3776)-2.87858)*60<0.01,'江の島→富士山頂');
 assert.ok(Math.abs(RF.targetElevation(sea5,5,20000,636)-1.73260)*60<0.01,'20km先の636m');
});

test('標準大気では Bennett 式と3%以内。45°は屈折率から決まる値（57.3″）に合う',()=>{
 // Bennett・Sæmundsson は高い所で2〜3%大きめに出る（1.02倍の係数）。光線追跡の45°は (n−1)·tan z に一致する
 const F=RF.field([{s:0,groundM:0,pressureHPa:1013.25,points:[0,1000,3000,6000,11000].map(z=>({z,t:RF.us76(z)-273.15}))}]);
 for(const a of [0,0.5,1,2,5,10,20]){const r=RF.trace(F,0.01,a).refraction*60,b=bennett(a,1013.25,15);assert.ok(Math.abs(r/b-1)<0.03,`${a}°: ${r} vs ${b}`);}
 assert.ok(Math.abs(RF.trace(F,0.01,45).refraction*3600-57.3)<0.5);
});

test('刻みを4倍にしても0.01′以内（画面では4倍で引く）',()=>{
 for(const a of [0.2,0.5,1,3,10,20])assert.ok(Math.abs(RF.trace(sea5,5,a,{stepScale:4}).refraction-RF.trace(sea5,5,a).refraction)*60<0.01,`${a}°`);
 assert.ok(Math.abs(RF.targetElevation(sea5,5,68759,3776,{stepScale:4})-RF.targetElevation(sea5,5,68759,3776))*60<0.01);
});

test('粗い表（約25本）でも、その場で解いた見かけの高さと0.06′以内',()=>{
 const tb=RF.bodyTable(sea5,5,{stepScale:4});
 assert.ok(tb.apparent.length<=26);
 for(const t of [0.1,0.3,0.7,1.2,2.5,4,6,9,13,18]){
  let lo=t,hi=t+1;for(let i=0;i<40;i++){const m=(lo+hi)/2;if(RF.trace(sea5,5,m,{stepScale:4}).trueAltitude<t)lo=m;else hi=m;}
  assert.ok(Math.abs(tb.apparentFromTrue(t)-(lo+hi)/2)*60<0.06,`${t}°`);
 }
});

test('同じ柱を並べた場は1本の柱と同じ。山の柱の地面より下は手前の柱へ混ぜない',()=>{
 const c=pyColumn(12,1015,5),one=RF.field([{s:0,...c}]),many=RF.field([0,20000,60000,150000].map(s=>({s,...c})));
 assert.equal(RF.trace(many,5,0.7).trueAltitude,RF.trace(one,5,0.7).trueAltitude);
 const plain={groundM:0,pressureHPa:1013,points:[{z:2,t:15},{z:1000,t:20},{z:3000,t:2}]},peak={groundM:3000,pressureHPa:700,points:[{z:3002,t:-30},{z:5000,t:-40}]};
 const F=RF.field([{s:0,...plain},{s:40000,...peak}]),alone=RF.field([{s:0,...plain}]);
 const x=[...F.at(1000,20000)],y=[...alone.at(1000,0)];assert.deepEqual(x,y);
 assert.notDeepEqual([...F.at(4000,20000)],[...alone.at(4000,0)]);
});

test('観測点の近くの逆転は天体と目標を同じだけ持ち上げ、重なる高さはほとんど動かない',()=>{
 const std={groundM:0,pressureHPa:1013,points:[{z:2,t:15},{z:1000,t:8.5},{z:3000,t:-4.5},{z:6000,t:-24}]};
 const inv={groundM:0,pressureHPa:1013,points:[{z:2,t:5},{z:150,t:13},{z:1000,t:8.5},{z:3000,t:-4.5},{z:6000,t:-24}]};
 const base=RF.field([{s:0,...std},{s:8000,...std},{s:300000,...std}]),near=RF.field([{s:0,...inv},{s:4000,...inv},{s:8000,...std},{s:300000,...std}]);
 const q=F=>{const e=RF.targetElevation(F,1.5,30000,600);return {e,t:RF.trace(F,1.5,e).trueAltitude};},a=q(base),b=q(near);
 const shift=Math.abs(b.e-a.e)*60,overlap=Math.abs(b.t-a.t)*60;
 assert.ok(shift>0.1,`目標の見かけは動く ${shift}`);assert.ok(overlap<shift*0.35,`重なる高さ ${overlap} / 目標 ${shift}`);
});

test('高い場所から見下ろす天体（標高2000m・−1°）も地平線まで追える。式の打ち切りでは大きく外れる',()=>{
 const t=pyTemp(0,2000),F=RF.field([{s:0,groundM:0,pressureHPa:795*Math.exp(0.034163*2000/273.15),points:[0,500,1000,2000,4000,8000,11000].map(z=>({z,t:t(z)}))}]);
 const tb=RF.bodyTable(F,2000,{stepScale:4});assert.ok(tb.dip>1.2&&tb.dip<1.45,`伏角 ${tb.dip}`);
 const r=RF.trace(F,2000,-1).refraction*60;assert.ok(r>38&&r<46,`見かけ−1°の大気差 ${r}′`);
 const trueAlt=-1-r/60;assert.ok(M.correction(trueAlt,{pressureHPa:795,temperatureC:0})*60<r-25,'従来の式（−1°未満は打ち切り）');
});
