import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),A=require('./astronotes-align.js'),B=require('./astronotes-bodies.js'),F=JSON.parse(fs.readFileSync(new URL('./fixtures/fuji-soya-ridge.json',import.meta.url),'utf8')),day=Date.parse('2027-04-21T00:00:00+09:00');
test('曽谷/月/4月21日は山頂点では外れるがDEM稜線全体には重なる',()=>{const before=A.dailyView(F.obs,F.target,'moon',day,{eyeM:1.5}),view=A.prepareDailyView(F.obs,F.target,'moon',{eyeM:1.5,ridge:F.ridge}),rows=view(day);assert(before.every(x=>!x.intersects));assert(rows.some(x=>x.intersects&&x.sunAltitude<0));assert(rows.some(x=>x.at>=day+4*3600000&&x.at<day+5*3600000));});
test('独立した1秒走査で月の上下縁が同じ方位のDEM稜線を跨ぐことを確認',()=>{
 const obs={...F.obs,elevation:20.5},at=az=>{for(let i=1;i<F.ridge.length;i++){const a=F.ridge[i-1],b=F.ridge[i];if(az>=a[0]&&az<=b[0])return a[1]+(b[1]-a[1])*(az-a[0])/(b[0]-a[0]);}return null;};
 let contact=0;for(let t=day+4.4*3600000;t<day+4.7*3600000;t+=1000){const moon=B.state('moon',t,obs),ridge=at(moon.azimuth);if(ridge!==null&&(moon.lowerAltitude??moon.lowerLimbAltitude)<=ridge&&(moon.upperAltitude??moon.upperLimbAltitude)>=ridge)contact++;}assert(contact>30,`contact seconds=${contact}`);
});
test('欠測を含む稜線を重なりなしの成功結果にせず拒否する',()=>{assert.throws(()=>A.prepareDailyView(F.obs,F.target,'moon',{ridge:[[250,null],[251,1]],eyeM:1.5}),/稜線/);});

test('恒星/惑星の山全体指定なしも稜線との交差を採用し山頂gapへ戻さない',()=>{const Q=require('./astronotes-shooting.js');for(const body of ['sirius','venus'])assert.equal(Q.matches({intersects:true,gap:10,radius:0},{target:F.target,body,matchMode:'overlap',limb:'center'},()=>true),true);});

test('山頂方位から離れた稜線接触も全日走査の最接近から拾う',()=>{const at=day+4*3600000,m=B.state('moon',at,{...F.obs,elevation:20.5});const ridge=[[m.azimuth-.3,0],[m.azimuth,m.apparentAltitude],[m.azimuth+.3,0]];const rows=A.dailyView(F.obs,F.target,'moon',day,{ridge,eyeM:1.5});assert(rows.some(e=>e.intersects&&Math.abs(e.at-at)<3*60000));});

test('線/範囲の各位置も共通の稜線viewを使い山頂点で上書きしない',async()=>{
 const Q=require('./astronotes-shooting.js'),point={latitude:35.7477,longitude:139.93038},entry={place:{id:'path',name:'path',...point,shape:{type:'line',vertices:[point,{latitude:point.latitude,longitude:point.longitude+.00001}]}},record:{}};let views=0;
 const result=await Q.candidates({observer:point,target:F.target,body:'moon',at:day,matchMode:'overlap'},[entry],{align:{dailyView:()=>{throw Error('wrong summit fallback')}},isMountain:()=>true,observerAt:(p,g)=>({...p,elevation:g,eyeM:1.5}),elevationAt:async()=>19,ensure:async()=>{},viewFor:async()=>{views++;return()=>[{at:day+4.5*3600000,intersects:true,gap:3,altitude:1,sunAltitude:-6,side:'set'}];}});
 assert(views>0);assert(result.rows.length>0);assert.equal(result.failed,0);
});
