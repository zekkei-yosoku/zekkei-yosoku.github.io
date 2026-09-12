// 固定日時・人工気象による仕様の回帰。実景の的中率検証とは区別する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('./sorami-core.js');
const H = 3600000;

test('期間量は直前1時間、瞬時値は従来どおり。境界を二重計上しない', () => {
  const s = new S.Series([0, H, 2*H, 3*H], { precipitation:[1,2,4,8], showers:[1,2,4,8], direct_radiation:[10,20,40,80], cloud_cover:[1,2,4,8] });
  assert.deepEqual(s.values('precipitation',0,H), [2]);
  assert.deepEqual(s.values('showers',0,H), [2]);
  assert.equal(s.mean('direct_radiation',0,H),20);
  assert.deepEqual(s.values('cloud_cover',0,H),[1]);
  assert.equal(s.sum('precipitation',0,2*H),6);
  assert.deepEqual(s.values('precipitation',H,H),[]);
  assert.deepEqual(s.values('precipitation',H,0),[]);
  // 重なったサンプルを等しく集計する既存式を保持。部分按分の導入ではない。
  assert.equal(s.sum('precipitation',H/2,1.5*H),6);
  assert.equal(s.mean('direct_radiation',H/2,1.5*H),30);
});
test('時刻列に穴があっても期間量の長さは1時間。欠測を乾燥とみなさない', () => {
  const s = new S.Series([0,2*H,3*H], {precipitation:[1,4,null]});
  assert.deepEqual(s.intervalAt('precipitation',1),[H,2*H]);
  assert.equal(s.sum('precipitation',0,H),null);
  assert.equal(s.covers('precipitation',0,2*H),false);
  assert.equal(s.covers('precipitation',H,2*H),true);
  assert.equal(s.covers('precipitation',2*H,3*H),false);
});
test('虹は09時の雨と日射を08–09時・08:30の太陽で評価する', () => {
  const day = Date.UTC(2026,8,9)-9*H;
  const input={lat:35.6812,lon:139.7671,home:new S.Series(Array.from({length:25},(_,h)=>day+h*H),{precipitation:Array.from({length:25},(_,h)=>h===9?1.5:0),showers:Array(25).fill(0.2),direct_radiation:Array(25).fill(400)})};
  assert.ok(S.Sun.position(day+8.5*H,input.lat,input.lon).elevation < 42);
  assert.ok(S.Sun.position(day+9.5*H,input.lat,input.lon).elevation > 42);
  const r=S.SCORERS.rainbow.score(S.SCORERS.rainbow.window(day,input),input);
  assert.equal(r.unavailable,null);
  assert.ok(r.score>0);
  assert.deepEqual(r.refinedWindow,[day+8*H,day+9*H]);
});
const night = () => {
  const day=Date.UTC(2026,8,9)-9*H;
  const times=Array.from({length:49},(_,i)=>day+i*H);
  const input={lat:43.4689,lon:143.7472,elevation:300,lightPollution:{mpsas:21.8},home:new S.Series(times,{
    cloud_cover:times.map((_,i)=>i<22?20:35),
    precipitation:times.map((_,i)=>i<=22?2:0),
    relative_humidity_2m:times.map(()=>70),visibility:times.map(()=>30000)
  })};
  return {input,window:S.SCORERS.starrySky.window(day,input)};
};
test('星空は雲が少なくても雨の時間帯を避け、最終得点で最良の3時間を選ぶ', () => {
  const {input,window}=night(), scorer=S.SCORERS.starrySky;
  const r=scorer.score(window,input);
  assert.ok(r.refinedWindow);
  assert.equal(r.refinedWindow[1]-r.refinedWindow[0],3*H);
  assert.equal(input.home.max('precipitation',...r.refinedWindow),0);
  assert.ok(r.score>70);
  const candidates=[];
  for(let t=window[0];t+3*H<=window[1];t+=H) candidates.push(scorer.scoreFixedWindow([t,t+3*H],input,window));
  assert.equal(r.score,Math.max(...candidates.filter(x=>!x.unavailable).map(x=>x.score)));
  assert.deepEqual(r,scorer.scoreFixedWindow(r.refinedWindow,input,window));
  assert.ok(Math.abs(r.base+r.factors.reduce((n,f)=>n+f.c,0)-r.score)<1e-9);
});
test('星空の固定窓採点は再探索せず、雨・湿度・視程の欠測を高評価に変えない', () => {
  const {input,window}=night(), scorer=S.SCORERS.starrySky;
  const selected=[window[0],window[0]+3*H];
  for(const v of ['cloud_cover','precipitation','relative_humidity_2m','visibility']) {
    const cols=structuredClone(input.home.columns);
    const indices=input.home.indices(...selected,v);
    cols[v][indices[1]]=null;
    const broken={...input,home:new S.Series(input.home.times,cols)};
    assert.equal(scorer.scoreFixedWindow(selected,broken,window).unavailable?.kind,'missingData',v);
    const r=scorer.score(window,broken);
    assert.equal(r.unavailable,null);
    assert.ok(r.refinedWindow);
    assert.ok(broken.home.covers(v,...r.refinedWindow));
  }
  const r=scorer.scoreFixedWindow(selected,input,window);
  assert.deepEqual(r.refinedWindow,selected);
  assert.ok(r.score<50); // この固定窓には雨がある。勝手に後半へ移動しない。
});
test('全雲量欠測や予報の途中切れは利用不能。モデル非対応の視程は要求しない', () => {
  const {input,window}=night(), scorer=S.SCORERS.starrySky;
  const missing={...input,home:new S.Series(input.home.times,{cloud_cover:input.home.times.map(()=>null)})};
  assert.equal(scorer.score(window,missing).unavailable?.kind,'missingData');
  const edge={...input,home:new S.Series([window[0]],{cloud_cover:[0],precipitation:[0]})};
  assert.equal(scorer.score(window,edge).unavailable?.kind,'missingData');
  const cols=structuredClone(input.home.columns);delete cols.visibility;
  assert.equal(scorer.score(window,{...input,home:new S.Series(input.home.times,cols)}).unavailable,null);
});

test('星空は降水全null・列なしを晴天と扱わず評価不能にする', () => {
  const {input,window}=night();
  for (const precipitation of [undefined,input.home.times.map(()=>null)]) {
    const cols={cloud_cover:input.home.times.map(()=>0)};
    if(precipitation) cols.precipitation=precipitation;
    const r=S.SCORERS.starrySky.score(window,{...input,home:new S.Series(input.home.times,cols)});
    assert.equal(r.unavailable?.kind,'missingData');
    assert.equal(r.refinedWindow,null);
  }
});
