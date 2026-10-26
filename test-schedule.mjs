// NOTEBOOK の予定（2026-10-20 ユーザー「超未来のこーゆー予定を保存しておくページが欲しい」「NOTEBOOK、タブは撮影地点と予定」）
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Sch=require('./astronotes-schedule.js');
const mem=()=>{const m=new Map();return{read:(k,f)=>m.has(k)?JSON.parse(m.get(k)):f,write:(k,v)=>{m.set(k,JSON.stringify(v));return true;},m};};
const plan=(at,o='曽谷')=>({v:1,kind:'aim',t:{id:'skytree',name:'東京スカイツリー'},o:[o,35.74,139.93],body:'moon',part:'top',limb:'center',matchMode:'overlap',at});
const validate=p=>p?.kind==='aim'&&Number.isFinite(p.at)?p:null;
test('保存・同じ条件は更新・近い順・消す・アカウントごと',()=>{
 const s=mem();let who='a';const st=Sch.create({...s,validate,scope:()=>who,now:()=>1000});
 const a=st.add({value:plan(2e12),title:'満月とスカイツリー',start:2e12,end:2e12+1800000});assert.ok(a.ok&&!a.updated);
 assert.ok(st.add({value:plan(1.9e12),title:'早い方',start:1.9e12,end:1.9e12}).ok);
 const again=st.add({value:plan(2e12),title:'件名を変えた',start:2e12,end:2e12});assert.ok(again.updated);
 const rows=st.list();assert.deepEqual(rows.map(r=>r.title),['早い方','件名を変えた']);
 assert.ok(st.remove(rows[0].id));assert.equal(st.list().length,1);
 who='b';assert.equal(st.list().length,0,'別アカウントの予定は見えない');
});
test('壊れた行・検証に通らない値・開始日時の無い保存は受け付けない',()=>{
 const s=mem();const st=Sch.create({...s,validate,scope:()=>'x'});
 assert.equal(st.add({value:{kind:'detail'},start:1}).ok,false);assert.equal(st.add({value:plan(1),start:NaN}).ok,false);
 s.write(Sch.KEY+'x',[{id:'ok',value:plan(5),title:'t',start:5,end:4,savedAt:1},{id:1,value:plan(5),start:5,savedAt:1},{id:'bad',value:{kind:'x'},start:5,savedAt:1}]);
 const r=st.list();assert.equal(r.length,1);assert.equal(r[0].end,5,'終了が開始より前なら開始に揃える');
});
test('画面：記録の帯、撮影地点／予定のタブ、予定シートの保存ボタン、予定タブでは＋を隠す',()=>{
 const h=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),p=fs.readFileSync(new URL('./astronotes-plan.js',import.meta.url),'utf8'),c=fs.readFileSync(new URL('./astronotes-flair.css',import.meta.url),'utf8');
 assert.match(h,/role="tab" id="notebookPointsTab"[^>]*>撮影地点<\/button><button[^>]*id="notebookPlansTab"[^>]*>予定<\/button>/);
 assert.match(h,/<script src="astronotes-schedule\.js\?v=\d+"><\/script>\s*<script src="astronotes-plan\.js/);
 assert.match(p,/id="planKeep" hidden>記録の予定に保存<\/button>/);assert.match(p,/\$\('planKeep'\)\.hidden=!localSave\|\|!keep\|\|!canKeep\(\)\|\|current\?\.payload\?\.kind!=='aim'/);
 assert.match(c,/content:"記録" \/ ""/);assert.doesNotMatch(c,/LOGBOOK/);// 2026-10-21: ＋を撮影地点パネル内へ移し、見出しの高さをタブで変えない。
 const m=fs.readFileSync(new URL('./astronotes-myplaces.js',import.meta.url),'utf8');assert.match(m,/actions\.append\(edit,add\)/);assert.doesNotMatch(m,/heading\.append\(add\)/);
 assert.match(h,/撮影地点と見えたもの、これからの予定を残す/);
});
test('予定の使い方は0件のときだけ、保存先の説明はデータの控えの中（2026-10-20 ユーザー「出し方を変えた方がいいのも最適化して」）',()=>{
 const h=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),m=fs.readFileSync(new URL('./astronotes-myplaces.js',import.meta.url),'utf8');
 assert.match(h,/if\(!rows\.length\)\{const how=/);assert.doesNotMatch(h,/intro\.textContent='構図で見つけた重なりを/);
 assert.match(m,/backup\.append\(summary,note\)/);assert.doesNotMatch(m,/のブラウザに保存します。撮影地点の名前・代表位置（お気に入り）は同期します。'; host\.append\(note\)/);
});
