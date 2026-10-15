// アカウント画面は「ログイン方法」「安全」に分け、状態の右にそれを変える操作を置く（2026-10-15）。
// 以前は状態の文・端末・大きな釦が見出しなしで一列に並び、状態と操作が離れていた。
import {readFileSync} from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const sheet=html.slice(html.indexOf('<dialog class="sheet" id="accountSheet"'),html.indexOf('</dialog>',html.indexOf('id="accountSheet"')));

// 並び：戻る→ID/同期→ログイン方法（パスキー・端末・パスワード・回復コード・薦め）→安全（履歴・ほかの端末）→管理入口→ログアウト→削除
const order=['id="accountBack"','id="accountBody"','>ログイン方法</h3>','id="addPasskey"','id="accountPasskeys"','id="accountPwState"','id="disablePw"','id="enablePwWay"','id="accountCodesState"','id="newRecovery"','id="recoveryShown"','id="accountAdvice"','>安全</h3>','id="loginHistory"','id="logoutAll"','id="accountPrivateEntry"','id="logout"','id="deleteAccount"'];
let at=-1;for(const m of order){const i=sheet.indexOf(m);assert.ok(i>at,`並び順: ${m}`);at=i;}
assert.ok(!/class="card"/.test(sheet),'行は線で区切り、箱を作らない');
assert.match(html,/document\.getElementById\('accountBack'\)\.onclick=\(\)=>\{document\.getElementById\('accountSheet'\)\.close\(\);openSettings\(/,'←で設定一覧へ戻る');

const cut=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from)));
const src=cut('async function openAccountSheet() {','// 履歴は開いたときだけ取りに行く')+cut('function nextStep(u) {','\n}\n')+'\n}';
function el(){return {hidden:false,textContent:'',innerHTML:'',className:'',classes:new Set(),classList:{toggle(n,on){on?this.s.add(n):this.s.delete(n);},contains(n){return this.s.has(n);}},querySelectorAll(){return [];}};}
async function open(me){
 const els={};const $=id=>{if(!els[id]){const e=el();e.classList.s=e.classes;els[id]=e;}return els[id];};
 const c={$,me,esc:s=>String(s),syncError:null,pushQueue:[],RECOVERY_LOW:3,showSheet(){},renderPrivateEntry(){},adoptToken(){},accountFail(m){throw Error(m);},syncNow:async()=>{},apiCall:async()=>me};
 vm.createContext(c);vm.runInContext(src,c);await c.openAccountSheet();return $;
}
const base={loginId:'fixture-user',role:'user',ownerAdmin:false};

// パスキー0・パスワードのみ：パスキーの登録だけを塗る。薦めはパスキーの登録
{const $=await open({...base,credentials:[],hasPassword:true,recoveryCodes:9});
 assert.equal($('accountPasskeyState').textContent,'未登録');assert.equal($('accountPwState').textContent,'有効');assert.equal($('accountCodesState').textContent,'9件');
 assert.ok($('addPasskey').classes.has('primary'));assert.ok(!$('newRecovery').classes.has('primary'));
 assert.equal($('newRecovery').textContent,'発行し直す');assert.equal($('disablePw').hidden,true);assert.equal($('enablePwWay').hidden,true);
 assert.equal($('accountPasskeys').innerHTML,'');assert.equal($('accountAdvice').hidden,false);assert.match($('accountAdvice').textContent,/パスキーを登録すると/);
 assert.match($('accountBody').innerHTML,/fixture-user/);assert.match($('accountBody').innerHTML,/同期できています/);}

// パスキー2・パスワード無効・回復コード0：回復コードの発行だけを塗る。端末は2行、それぞれ消せる
{const cred=(id,label)=>({id,label,created_at:Date.UTC(2026,9,1),last_used_at:null});
 const $=await open({...base,credentials:[cred('k1','iPhone'),cred('k2','Mac')],hasPassword:false,recoveryCodes:0});
 assert.equal($('accountPasskeyState').textContent,'2台');assert.equal($('accountPwState').textContent,'無効');assert.equal($('accountCodesState').textContent,'0件');
 assert.ok(!$('addPasskey').classes.has('primary'));assert.ok($('newRecovery').classes.has('primary'));assert.equal($('newRecovery').textContent,'発行する');
 assert.equal($('enablePwWay').hidden,false);assert.equal($('disablePw').hidden,true);
 assert.equal(($('accountPasskeys').innerHTML.match(/data-delkey=/g)||[]).length,2);
 assert.equal($('accountAdvice').hidden,false);assert.equal($('accountAdvice').className,'warn');}

// パスキーと回復コードが揃い、パスワードも無効：薦めは出さない。パスワードは使わない釦なし（無効なので設定欄）
{const $=await open({...base,credentials:[{id:'k1',label:'iPhone'}],hasPassword:false,recoveryCodes:9});
 assert.equal($('accountAdvice').hidden,true);assert.ok(!$('addPasskey').classes.has('primary'));assert.ok(!$('newRecovery').classes.has('primary'));}

// パスキーがありパスワード有効：パスワードを使わない釦を出す
{const $=await open({...base,credentials:[{id:'k1',label:'iPhone'}],hasPassword:true,recoveryCodes:9});
 assert.equal($('disablePw').hidden,false);assert.equal($('enablePwWay').hidden,true);}

console.log('ACCOUNT LAYOUT OK: order, back to settings, row states, single filled action, advice, passkey rows');
