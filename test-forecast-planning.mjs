import {sourceHtml} from './tools/test-source.mjs';
import './tools/test-owner-adapter.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const html=sourceHtml();
const start=html.indexOf('for (const el of $("toolsMenu").querySelectorAll("[data-tool]")) {',html.indexOf('$("toolsScrim").onclick')),end=html.indexOf('document.addEventListener("keydown"',start),source=html.slice(start,end);
function fixture(){const buttons=['#/aim/tower','#/skymap'].map(tool=>({dataset:{tool}})),calls=[],aim={from:{name:'曽谷'},dayMs:123};const c={atAim:false,atSkyMap:false,SkyMapUI:{enter:v=>calls.push(['enter',v]),prepareFraming:()=>{calls.push(['prepare']);return true;}},$:()=>({querySelectorAll:()=>buttons}),closeTools:()=>calls.push(['close']),pushRoute:r=>calls.push(['route',r]),aim};vm.createContext(c);vm.runInContext(source,c);return {c,calls,aim,buttons};}
test('補助的な画面移動ボタンを予測・地図・記録へ出さない',()=>{assert.doesNotMatch(html,/id="forecastPlanning"|forecastPlanningActions|id="skyMapUse(?:Below|Dates)?"|この地点を使う/);const record=fs.readFileSync(new URL('./astronotes-myplaces.js',import.meta.url),'utf8');assert.doesNotMatch(record,/id="myPlaceUse"|id="myPlaceMap"/);});
test('予測からメニューで構図へ移っても作業中の撮影地点と日付を上書きしない',()=>{const f=fixture();f.buttons[0].onclick();assert.equal(f.aim.from.name,'曽谷');assert.equal(f.aim.dayMs,123);assert.deepEqual(f.calls,[['route','#/aim/tower']]);});
test('メニューの地図入口は既存の選択状態を使い、構図からは現在条件を渡す',()=>{for(const fromAim of [false,true]){const f=fixture();f.c.atAim=fromAim;f.buttons[1].onclick();assert.deepEqual(f.calls,[['close'],['enter',fromAim]]);assert.equal(f.aim.from.name,'曽谷');}});
test('地図からメニューで構図へ移ると現在条件を引き継ぐ',()=>{const f=fixture();f.c.atSkyMap=true;f.buttons[0].onclick();assert.deepEqual(f.calls,[['prepare'],['route','#/aim']]);});
test('構図を表示中に同じメニューを選んでも条件を初期化しない',()=>{const f=fixture();f.c.atAim=true;f.buttons[0].onclick();assert.deepEqual(f.calls,[['close']]);assert.equal(f.aim.dayMs,123);});
