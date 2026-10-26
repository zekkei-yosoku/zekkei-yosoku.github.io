import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';const require=createRequire(import.meta.url),C=require('./trial/astronotes-camera-ui.js');
test('実撮影番号で開始/終了を必ず含み、10000枚でも61点へ制限する',()=>{for(const n of [2,3,60,61,62,240,10000]){const a=C.indices(n);assert.equal(a[0],0);assert.equal(a.at(-1),n-1);assert.equal(new Set(a).size,a.length);assert.equal(a.length,Math.min(n,61));assert(a.every(Number.isInteger));}for(const n of [0,1,2.5,10001])assert.throws(()=>C.indices(n));});
test('trialの時刻進行プレビューと計算ボタンを撤去し、実レンダーの建物より背面へ静的範囲を描く',()=>{const ui=fs.readFileSync(new URL('./trial/astronotes-camera-ui.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('./trial/index.html',import.meta.url),'utf8');assert.doesNotMatch(ui,/requestAnimationFrame|画角内の時間を計算|▶ プレビュー/);assert.match(ui,/role','switch'/);assert.match(ui,/at\+i\*v.interval\*1000/);assert.match(html,/drawRange\?\.\(host,ctx/);assert(html.indexOf('drawRange?.(host,ctx')<html.indexOf('ctx.drawImage(buildingLayer.canvas'));assert.match(html,/aria-label','画角設定'/);});
import vm from 'node:vm';
test('通常予定のnull復元は前の撮影位置列と設定を残さない',()=>{
 const source=fs.readFileSync(new URL('./trial/astronotes-camera-ui.js',import.meta.url),'utf8').replace('const api={mount,','root.__seed=(host,state)=>states.set(host,state);const api={mount,');
 const c=vm.createContext({AstroNotesTimelapse:require('./astronotes-timelapse.js'),localStorage:{getItem:()=>null}});vm.runInContext(source,c);
 let redraws=0;const fields={'[name=interval]':{},'[name=count]':{},select:{}},host={_timelapseConfig:null,_lookAt:123,dataset:{},querySelector:sel=>sel==='.aim-look-figure'?null:{},_redrawLook(){redraws++;}},state={host,token:'a',owner:'a',on:true,config:{interval:5,count:360,fps:24},box:{querySelector:key=>fields[key]},summary:{},buttons:[{setAttribute(){}}],bar:{dataset:{}},output:{hidden:false},cache:{}};
 c.__seed(host,state);c.AstroNotesCameraUI.mount(host,{owner:'a',token:'a'});
 assert.equal(state.on,false);assert.equal(state.config,null);assert.equal(fields['[name=count]'].value,240);assert.equal(redraws,1);c.AstroNotesCameraUI.drawRange(host,{},{});assert.equal(host.dataset.timelapseDrawn,'0');
});
test('アカウント変更では別ユーザーの記憶タブとTL状態を混ぜない',()=>{
 const source=fs.readFileSync(new URL('./trial/astronotes-camera-ui.js',import.meta.url),'utf8').replace('const api={mount,','root.__seed=(host,state)=>states.set(host,state);const api={mount,');
 const prefs=new Map([['astronotes.captureTab:first','timelapse'],['astronotes.captureTab:second','angle']]);
 const c=vm.createContext({AstroNotesTimelapse:require('./astronotes-timelapse.js'),localStorage:{getItem:k=>prefs.get(k),setItem:(k,v)=>prefs.set(k,v)}});vm.runInContext(source,c);
 const button=()=>({attrs:{},setAttribute(k,v){this.attrs[k]=v}}),fields={'[name=interval]':{},'[name=count]':{},select:{}},tabs={angle:{button:button(),panel:{}},timelapse:{button:button(),panel:{}}};
 const host={_timelapseConfig:null,_lookAt:123,querySelector:sel=>sel==='.aim-look-figure'?null:{},_redrawLook(){}},state={host,owner:'first',token:'one',tabs,on:true,config:{interval:10,count:120,fps:30},box:{querySelector:k=>fields[k]},summary:{},buttons:[]};c.__seed(host,state);
 c.AstroNotesCameraUI.mount(host,{owner:'second',token:'two'});assert.equal(tabs.angle.button.attrs['aria-selected'],'true');assert.equal(tabs.timelapse.panel.hidden,true);assert.equal(state.on,false);assert.equal(state.config,null);
 c.AstroNotesCameraUI.mount(host,{owner:'first',token:'three'});assert.equal(tabs.timelapse.button.attrs['aria-selected'],'true');assert.equal(tabs.angle.panel.hidden,true);assert.equal(prefs.get('astronotes.captureTab:first'),'timelapse');
});
