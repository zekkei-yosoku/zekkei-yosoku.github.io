import './tools/test-owner-adapter.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';import vm from 'node:vm';
const require=createRequire(import.meta.url),J=require('./trial/astronotes-journey.js');
const owner={loginId:'alice',generation:2};const row={id:'s1',value:{pan:[.2,-.3],timelapse:{interval:5,count:240,fps:30}},start:1800000000000,end:1800000001000,savedAt:1700000000000};
test('予定の比較元はcloneし、現在表示の編集で保存値や復帰元が変わらない',()=>{const c=J.create();assert(c.remember(row,owner));const r=c.current(owner,[row]);r.value.pan[0]=99;r.value.timelapse.count=2;assert.deepEqual(c.current(owner,[row]),row);assert.equal(row.value.pan[0],.2);});
test('アカウント/世代変更・同期削除・同期編集で比較元を失効し旧値を復活しない',()=>{for(const [who,rows]of [[{...owner,loginId:'bob'},[row]],[{...owner,generation:3},[row]],[owner,[]],[owner,[{...row,title:'updated'}]],[null,[row]]]){const c=J.create();c.remember(row,owner);assert.equal(c.current(who,rows),null);assert.equal(c.current(owner,[row]),null);}});
test('前日の終了済み予定を今日と表示せず、JST境界で明日を判定',()=>{const now=Date.parse('2026-10-26T23:59:00+09:00');assert.equal(J.dayLabel({start:now-86400000,end:now-86000000},now),'過ぎた予定');assert.equal(J.dayLabel({start:now-60000,end:now+60000},now),'撮影時間内');assert.equal(J.dayLabel({start:now+120000,end:now+180000},now),'明日');});
const read=n=>fs.readFileSync(new URL(n,import.meta.url),'utf8');
test('予定の高さ・画角・構図位置・TL条件をcodecと予定ストアの再生成後も保つ',()=>{
 const ctx=vm.createContext({TextEncoder,TextDecoder,URL,URLSearchParams,btoa,atob,Date,Uint8Array});vm.runInContext(read('trial/astronotes-plan.js')+';globalThis.P=AstroNotesPlan;',ctx);const P=ctx.P,Sch=require('./trial/astronotes-schedule.js');
 const p={v:1,kind:'aim',o:['高所',35.7,139.8,21,230.5,null],at:Date.parse('2027-02-01T17:30:00+09:00'),body:'moon',part:'tip',limb:'center',matchMode:'overlap',air:'standard',pan:[.12,-.21],timelapse:{interval:5,count:240,fps:30},l:{on:true,mode:'manual',focal:300,sensor:'aps',portrait:true,grid:'thirds'},t:{id:'skytree',name:'東京スカイツリー',latitude:35.7101,longitude:139.8107,groundM:0,kind:'tower',parts:[{id:'tip',name:'先端',m:634}]}};
 const m=new Map(),args={read:(k,f)=>m.has(k)?JSON.parse(m.get(k)):f,write:(k,v)=>{m.set(k,JSON.stringify(v));return true;},scope:()=>owner.loginId,validate:p=>P.decode(P.encode(p)),now:()=>1};const a=Sch.create(args).add({value:p,start:p.at,end:p.at+60000,title:'テスト'});assert(a.ok);const got=Sch.create(args).list()[0];assert.deepEqual(JSON.parse(JSON.stringify(got.value)),p);const c=J.create();c.remember(got,owner);assert.deepEqual(c.current(owner,[got]).value,p);
});
test('保存後の予定一覧の入口は保存世代/アカウント/現存行を再照合する',()=>{
 const h=read('trial/index.html');const start=h.indexOf('function notebookSavedCurrent('),end=h.indexOf('\nfunction openNotebookExplore',start);assert(start>0&&end>start);
 let auth={loginId:'alice',token:'synthetic'},generation=2,plans=[row];const c=vm.createContext({get auth(){return auth;},get authGeneration(){return generation;},toolAllowed:()=>true,schedule:()=>({list:()=>plans})});vm.runInContext(h.slice(start,end),c);
 const saved={ok:true,row,saveOwner:owner};assert(c.notebookSavedCurrent(saved));plans=[];assert(!c.notebookSavedCurrent(saved));plans=[row];auth={loginId:'bob',token:'other'};assert(!c.notebookSavedCurrent(saved));auth={loginId:'alice',token:'synthetic'};generation=3;assert(!c.notebookSavedCurrent(saved));
});
