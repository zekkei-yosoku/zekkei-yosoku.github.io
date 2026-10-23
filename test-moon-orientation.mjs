// 月面の向き（秤動と自転軸の位置角）と、写真の月面を球に貼り直す処理（2026-10-20 ユーザー「月の満ち欠けってこれ模様正確か?」）
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),A=require('./astronotes-astro.js'),M=require('./astronotes-moon-portrait.js');
// NASA SVS Dial-a-Moon（地心、2026-10-20 取得）の subearth_lon / subearth_lat / posangle
const NASA=[['2026-10-20T12:00:00Z',-4.735,1.237,343.88],['2026-10-26T12:00:00Z',-3.711,-6.171,340.986]];
test('秤動と自転軸の位置角が NASA と0.2°以内',()=>{
 for(const[t,l,b,p]of NASA){const m=A.moon(Date.parse(t),{latitude:0,longitude:0,elevation:0});
  assert.ok(Math.abs(m.librationLongitude-l)<0.2,`${t} lon ${m.librationLongitude}`);assert.ok(Math.abs(m.librationLatitude-b)<0.2,`${t} lat ${m.librationLatitude}`);
  assert.ok(Math.abs(((m.axisPositionAngle-p+540)%360)-180)<0.2,`${t} P ${m.axisPositionAngle}`);}
});
test('写真を撮った瞬間の秤動を定数に持ち、球に貼り直した絵は円盤の中だけ塗る',()=>{
 const m=A.moon(Date.parse('2024-10-17T09:16:38Z'),{latitude:35.7,longitude:139.8,elevation:0});
 assert.ok(Math.abs(m.librationLongitude-M.PHOTO.l)<0.01&&Math.abs(m.librationLatitude-M.PHOTO.b)<0.01);
 const N=512,src=new Uint8ClampedArray(N*N*4);for(let i=0;i<N*N;i++){src[i*4]=(i%N)/2;src[i*4+1]=Math.floor(i/N)/2;src[i*4+2]=100;src[i*4+3]=255;}
 const a=M.globe(src,M.PHOTO.l,M.PHOTO.b,0),b=M.globe(src,M.PHOTO.l,M.PHOTO.b,20);
 assert.equal(a[3],0,'円盤の外は透明');assert.equal(a[(256*N+256)*4+3],255,'中心は不透明');
 assert.notDeepEqual([...a.slice((100*N+256)*4,(100*N+256)*4+3)],[...b.slice((100*N+256)*4,(100*N+256)*4+3)],'自転軸の向きで絵が回る');
});
test('ホームの説明は向きの合わせ方を書き、古い「秤動は再現していません」を消す',()=>{
 const d=fs.readFileSync(new URL('./astronotes-almanac-dashboard.js',import.meta.url),'utf8');
 assert.match(d,/自転軸の向きと秤動（首振り）に合わせて球に貼り直して/);assert.doesNotMatch(d,/月面地形の正確な向きや秤動/);
});
