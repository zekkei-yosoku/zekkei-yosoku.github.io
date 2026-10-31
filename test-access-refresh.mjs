import {sourceHtml} from './tools/test-source.mjs';
import './tools/test-owner-adapter.mjs';
// 権限の確かめ直し（2026-10-15 総点検A04）。起動時だけでなく、前景へ戻ったとき・回線が戻ったとき・
// 表示中は5分ごとに /me を訊き直す。変わっていなければ描き直さない。取消しはその場で反映する。
// 圏外で確かめられないときは、最後に確かめた権限のまま使える（2026-09-28 ユーザー指摘を維持）。
import {readFileSync} from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const html=sourceHtml();
const start=html.indexOf('const ACCESS_RECHECK_MS'),end=html.indexOf('// 開いたときに、残っているトークンで入り直す。',start);
assert.ok(start>0&&end>start,'確かめ直しの処理がある');
const src=html.slice(start,end);
function fixture({tools=['plane','records'],now=10*60*1000}={}){
 const c={auth:{token:'fixture-token',loginId:'u1',role:'user',tools,ownerAdmin:false},authGeneration:1,accessCheckedAt:0,lastLoginId:null,atAim:false,atAdmin:false,adminUnmount:null,privateDraft:null,
  document:{hidden:false},calls:[],saved:0,renders:0,authButtons:0,aims:0,intervals:[],listeners:{},
  Date:{now:()=>c.clock},clock:now,AbortController,setTimeout:()=>0,clearTimeout(){},
  setInterval(fn,ms){c.intervals.push([fn,ms]);},window:{addEventListener(type,fn){c.listeners[type]=fn;}},
  saveAuth(){c.saved++;},localStorageHasToken:()=>true,openAim(){c.aims++;},renderAuthButton(){c.authButtons++;},render(){c.renders++;},
  apiCall(method,path){c.calls.push(method+' '+path);return c.answer();},answer:()=>Promise.resolve({loginId:'u1',role:'user',tools,ownerAdmin:false})};
 vm.createContext(c);vm.runInContext(src,c);return c;
}
// 変わっていなければ何も描き直さない（周期的に画面が閉じたり開き直したりしない）
{const c=fixture();await c.recheckAccess();
 assert.deepEqual(c.calls,['GET /me']);assert.equal(c.renders+c.authButtons+c.saved,0);assert.equal(c.accessCheckedAt,c.clock);
 c.clock+=60*1000;assert.equal(c.recheckAccess(),null,'5分以内は訊き直さない');assert.equal(c.calls.length,1);
 c.clock+=5*60*1000;await c.recheckAccess();assert.equal(c.calls.length,2,'5分過ぎたら訊き直す');}
// 別の端末で取り消された権限は、その場で外して描き直す
{const c=fixture();c.atAim=true;c.answer=()=>Promise.resolve({loginId:'u1',role:'user',tools:['records'],ownerAdmin:false});
 await c.recheckAccess();assert.deepEqual([...c.auth.tools],['records']);assert.equal(c.saved,1);assert.equal(c.authButtons,1);assert.equal(c.renders,1);assert.equal(c.aims,1);}
// サーバーが tools を返さなければ許可なし扱い（手元の古い許可を使い続けない）
{const c=fixture();c.answer=()=>Promise.resolve({loginId:'u1',role:'user'});await c.recheckAccess();assert.deepEqual([...c.auth.tools],[]);}
// 所有者の管理画面：描き直す前に書きかけを預ける（組み直しで入力が消えない）
{const c=fixture({tools:['diamond']});c.auth.ownerAdmin=false;c.atAdmin=true;c.adminUnmount={snapshot:()=>({note:'書きかけ'})};
 c.answer=()=>Promise.resolve({loginId:'u1',role:'admin',tools:['diamond','pearl'],ownerAdmin:true});
 await c.recheckAccess();assert.equal(c.privateDraft.loginId,'u1');assert.equal(c.privateDraft.value.note,'書きかけ');assert.equal(c.authButtons,1);}
// 圏外・失敗では今の権限のまま。次の機会にまた訊く
{const c=fixture();c.answer=()=>Promise.reject(Error('offline'));await c.recheckAccess();
 assert.deepEqual([...c.auth.tools],['plane','records']);assert.equal(c.renders+c.saved,0);assert.equal(c.accessCheckedAt,0);
 c.answer=()=>Promise.resolve({loginId:'u1',role:'user',tools:[],ownerAdmin:false});await c.recheckAccess();assert.deepEqual([...c.auth.tools],[]);}
// 背面・未ログインでは訊かない。同時に呼ばれても1回だけ訊く
{const c=fixture();c.document.hidden=true;assert.equal(c.recheckAccess(),null);c.document.hidden=false;
 const a=c.recheckAccess(),b=c.recheckAccess();assert.equal(a,b);await a;assert.equal(c.calls.length,1);
 c.auth=null;c.clock+=10*60*1000;assert.equal(c.recheckAccess(),null);assert.equal(c.calls.length,1);}
// 応答を待つ間にアカウントが変わったら、古い応答で上書きしない
{const c=fixture();let release;c.answer=()=>new Promise(r=>release=r);const job=c.recheckAccess();
 c.authGeneration++;c.auth={token:'other',loginId:'u2',role:'user',tools:['iss']};release({loginId:'u1',role:'user',tools:['plane','records'],ownerAdmin:true});await job;
 assert.deepEqual([...c.auth.tools],['iss']);assert.equal(c.auth.loginId,'u2');assert.equal(c.saved,0);}
// 呼び出す場所：表示中は1分ごとに期限を見る、回線と前景への復帰では30秒より古ければ訊く
{const c=fixture();assert.deepEqual(c.intervals.map(([,ms])=>ms),[60000]);assert.ok(typeof c.listeners.online==='function');}
const vis=html.slice(html.indexOf('document.addEventListener("visibilitychange", () => {\n  if (document.hidden) {\n    const draft'));
assert.match(vis.slice(0,600),/\} else \{[\s\S]*void recheckAccess\(30 \* 1000\);[\s\S]*\}\n\}\);/,'前景へ戻ったら確かめる');
assert.match(html,/window\.addEventListener\("pageshow", e => \{ if \(!e\.persisted\) return; if \(viewState\.admin\) renderAdmin\(\); void recheckAccess\(30 \* 1000\); \}\);/,'履歴から戻ったときも確かめる');
const restore=html.slice(html.indexOf('async function restoreSession('),html.indexOf('/// ログインできたときの共通処理。'));
assert.match(restore,/tools: Array\.isArray\(me\.tools\) \? me\.tools : \[\], ownerAdmin: !!me\.ownerAdmin \};\n    lastLoginId = auth\.loginId;\n    accessCheckedAt = Date\.now\(\);/,'起動時の確認でも、返事に無い権限は使わず時刻を残す');
assert.match(restore,/catch \{\n    \/\/ 401 は apiCall 側で片付いている。それ以外（圏外など）はトークンを捨てない/,'圏外の起動ではログインを保つ');
assert.ok(html.includes('accessCheckedAt = Array.isArray(res.tools) ? Date.now() : 0;'),'ログインの返事の権限も確認済みとして数える');
// ログイン直後の /me でも ownerAdmin まで持つ。欠けると5分後の確かめ直しが「変わった」と読み、所有者の管理画面を組み直していた（独立レビューW1）
const login=html.slice(html.indexOf('async function onLoggedIn('),html.indexOf('const plan = migrationPlan(',html.indexOf('async function onLoggedIn(')));
assert.match(login,/auth = \{ \.\.\.auth, tools: Array\.isArray\(me\.tools\) \? me\.tools : \[\], role: me\.role \?\? auth\.role, ownerAdmin: !!me\.ownerAdmin \};/,'ログイン直後の /me は確かめ直しと同じ項目を持つ');
{const c=fixture();const loggedIn={token:'fixture-token',loginId:'u1',role:'admin',tools:['diamond'],ownerAdmin:true};c.auth=loggedIn;c.answer=()=>Promise.resolve({loginId:'u1',role:'admin',tools:['diamond'],ownerAdmin:true});
 await c.recheckAccess();assert.equal(c.auth,loggedIn,'同じ権限なら auth を差し替えない（管理画面を組み直さない）');assert.equal(c.authButtons,0);}
// 記録一覧が 403 なら、空の一覧ではなく確かめ直して案内を出す
assert.match(html.slice(html.indexOf('async function loadPhotos('),html.indexOf('function renderPhotos()')),/if \(e\?\.status === 403\) void recheckAccess\(0\);/,'記録の403で権限を確かめ直す');
console.log('ACCESS REFRESH OK: unchanged no-op, revocation, missing tools, offline keep, hidden/coalesce, account switch, triggers');
