// 写真の評価の送信（2026-10-28）。隔離した新しいAPI（wrangler dev --local・ローカルD1）と実Chromeで、
// ログイン復帰・割当・途中再開・送信の成功/失敗/再送・答え直し・アカウント切替・他人の割当・期限切れ・
// 以前の試用回答の分離・取り下げ・画面の幅と明暗を確かめる。送信後の見直しは完了画面ではなく「回答の管理」の
// 「回答を確認・修正する」から最初の写真へ（2026-10-28）。本人の回答がない・未ログインでは出さない。本番APIや既存利用者のデータには触れない。
//   RATING_API_DIR=<今回のAPIの作業コピー> RATING_BASE=http://127.0.0.1:8897/ node tools/test-sky-rating.cjs
// APIは ALLOWED_ORIGIN=<RATING_BASEのorigin> で localhost:8787 に起動しておく。
const{chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const base=process.env.RATING_BASE||'http://127.0.0.1:8897/',out=process.env.RATING_OUT||'/tmp/astronotes-sky-rating',API='http://localhost:8787',ORIGIN=new URL(base).origin;
const apiDir=process.env.RATING_API_DIR;
if(!apiDir||!fs.existsSync(path.join(apiDir,'src/sky-rating.js')))throw Error('RATING_API_DIR must point at the API checkout that has src/sky-rating.js');
const dbDir=path.join(apiDir,'.wrangler/state/v3/d1/miniflare-D1DatabaseObject'),dbFile=fs.readdirSync(dbDir).filter(f=>f.endsWith('.sqlite')&&f!=='metadata.sqlite').map(f=>path.join(dbDir,f))[0];
const sql=q=>execFileSync('sqlite3',['-cmd','.timeout 5000','-json',dbFile,q],{encoding:'utf8'});
const rows=q=>JSON.parse(sql(q)||'[]');
fs.mkdirSync(out,{recursive:true});
const PW='Tsukiyo-no-Kumo-Sagashi7',stamp=Date.now().toString(36),log=[];
const note=m=>{log.push(m);console.log('  ok  '+m);};
async function call(method,p,token,body){const r=await fetch(API+p,{method,headers:{origin:ORIGIN,...(token?{authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json().catch(()=>null)};}
async function user(name){const id=name+stamp;sql(`INSERT OR REPLACE INTO allowed_signups(login_id,note,created_at)VALUES('${id}','sky-rating-e2e',0);DELETE FROM auth_attempts;`);assert.equal((await call('POST','/signup',null,{loginId:id,password:PW})).status,200);const t=(await call('POST','/login',null,{loginId:id,password:PW})).data.token;return{id,token:t};}
const set=id=>rows(`SELECT s.* FROM sky_rating_sets s JOIN users u ON u.id=s.user_id WHERE u.login_id='${id}'`)[0];
const draftKey=id=>'astronotes.sky-ratings.v2:'+encodeURIComponent(id);
async function page(ctx){const p=await ctx.newPage(),errors=[],posts=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()!=='GET'&&r.method()!=='OPTIONS'&&!r.url().startsWith(ORIGIN))posts.push(r.method()+' '+new URL(r.url()).pathname);});return{p,errors,posts};}
async function context(b,opts={}){const c=await b.newContext({viewport:{width:390,height:850},...opts});await c.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===ORIGIN||u.origin===API?r.continue():r.abort();});return c;}
const ready=async p=>{await p.waitForFunction(()=>!document.getElementById('choices').disabled);await p.waitForTimeout(300);};
async function rateAll(p,pick=i=>i%5){for(let i=0;i<10;i++){if(await p.locator('#finish').isVisible())break;await ready(p);const n=await p.evaluate(()=>Number(document.getElementById('progressText').textContent.split(' ')[0])-1);if(n===4)await p.locator('#skip').click();else await p.locator(`[data-value="${pick(n)}"]`).click();}await p.locator('#finish').waitFor();}
const reviewShown=p=>p.locator('#reviewBox').evaluate(e=>!e.hidden);
const noReview=async(p,label)=>{assert(!await reviewShown(p),label+': 回答を確認・修正する は出さない');};
const reviewFromManage=async p=>{await p.locator('#manage summary').click();await p.locator('#reviewOpen').click();await ready(p);assert.match(await p.locator('#progressText').textContent(),/^1 \/ 10/);assert.equal(await p.locator('#manage').getAttribute('open'),null);};
const finishButtons=async p=>{assert.equal(await p.locator('#editLast').count(),0,'完了画面に最後の写真の見直しはない');return p.locator('#finish').evaluate(f=>[...f.querySelectorAll('button,a')].filter(x=>!x.hidden).map(x=>x.id));};
const wire=async(p,id)=>p.evaluate(k=>{const d=JSON.parse(localStorage.getItem(k));return JSON.stringify(Object.fromEntries(d.order.map(i=>{const a=d.answers[i];return[i,a.value==='skip'?(a.reason==='image_unavailable'?'image_unavailable':'unsure'):a.value];})));},draftKey(id));
async function layout(p,label){const x=await p.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...document.querySelectorAll('button,a.fav-btn')].filter(x=>{const r=x.getBoundingClientRect();return r.width&&r.height&&!x.closest('[hidden]')&&!x.closest('details:not([open])>:not(summary)');}).map(x=>{const r=x.getBoundingClientRect();return{id:x.id||x.dataset.value||x.textContent.trim().slice(0,12),w:r.width,h:r.height+(x.classList.contains('chip')?10:0)};})}));assert(!x.overflow,label+' overflow');for(const q of x.buttons){assert(q.w>=43.9,label+JSON.stringify(q));assert(q.h>=43.9,label+JSON.stringify(q));}}

(async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});
 const A=await user('ratea'),B=await user('rateb');
 // --- ログインしていない → 既存のログイン画面 → 評価へ戻る
 let c=await context(b),{p,errors,posts}=await page(c);
 await c.addInitScript(()=>{if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.setItem('astronotes.trial.sky-ratings.v1',JSON.stringify({version:'sky-rating-ui/1',order:['sky-03'],answers:{'sky-03':{value:3,at:1}}}));}});
 await p.goto(base+'sky-rating.html');await p.locator('#start:not([disabled])').waitFor();
 assert.equal(await p.locator('#start').textContent(),'ログインして始める');assert.match(await p.locator('#accountLine').textContent(),/ログインが必要/);
 assert(await p.locator('#legacyNote').isVisible(),'以前の試用回答を案内');assert.match(await p.locator('.send-note').textContent(),/送信する内容.*地点や予測の値は送りません.*取り下げ/s);
 await noReview(p,'未ログイン');assert.deepEqual(posts,[]);note('未ログインは説明とログイン案内だけ（回答の確認・修正は出さない）。以前の試用回答は案内のみで送信なし');
 await p.locator('#start').click();await p.waitForURL(u=>u.pathname===new URL(base).pathname);await p.locator('#authSheet[open]').waitFor();
 await p.fill('#authId',A.id);await p.fill('#authPw',PW);await p.locator('#pwLogin').click();
 await p.waitForURL('**/sky-rating.html');await p.locator('#start:not([disabled])').waitFor();
 assert.match(await p.locator('#accountLine').textContent(),new RegExp(A.id));note('既存のログイン画面でログインし、評価ページへ戻る');
 assert.equal(set(A.id),undefined,'ログインしただけでは割当を作らない');await noReview(p,'ログイン済み・回答なし');
 // --- 割当はサーバーから。途中で中断・再読み込みしても続きから
 await p.locator('#start').click();await ready(p);
 const order=await p.evaluate(k=>JSON.parse(localStorage.getItem(k)).order,draftKey(A.id));
 assert.deepEqual(order,JSON.parse(set(A.id).items),'端末の並びはサーバーの割当');assert(order.includes('sky-01')&&order.includes('sky-02')&&!order.includes('sky-18'));
 await p.locator('[data-value="2"]').click();await ready(p);await p.locator('[data-value="3"]').click();await ready(p);
 await p.locator('#pause').click();await p.reload();await p.locator('#start:not([disabled])').waitFor();
 assert.match(await p.locator('#introStatus').textContent(),/2 \/ 10枚.*未送信/);assert.equal(set(A.id).answers,null,'途中では送らない');assert(await reviewShown(p),'未送信の途中の回答も回答の管理から見直せる');
 await p.locator('#start').click();await ready(p);assert.match(await p.locator('#progressText').textContent(),/^3 \/ 10/);note('サーバー割当の10枚、中断と再読み込みのあとも続きから（未送信）');
 await rateAll(p);assert.match(await p.locator('#sendState').textContent(),/まだ送信していません/);assert.equal(set(A.id).answers,null);
 // --- 未送信のまま、回答の管理から最初の写真へ戻って見直せる（送信前のボタンは残る）
 assert.deepEqual(await finishButtons(p),['submit','finishBack']);const firstAnswer=await p.evaluate(k=>{const d=JSON.parse(localStorage.getItem(k));return String(d.answers[d.order[0]].value);},draftKey(A.id));
 await reviewFromManage(p);assert.equal(await p.locator('[aria-pressed="true"]').getAttribute('data-value'),firstAnswer,'1枚目の選択を表示');
 for(let i=0;i<10;i++){if(await p.locator('#finish').isVisible())break;await p.locator('#nextExisting').click();}await p.locator('#finish').waitFor();
 assert.match(await p.locator('#sendState').textContent(),/まだ送信していません/);assert.equal(await p.locator('#submit').textContent(),'回答を送信する');assert.equal(set(A.id).answers,null);note('未送信の完了画面は送信/予測へ戻るを残し、回答の管理から1枚目へ戻って見直せる（送信はしない）');
 // --- 送信の失敗（通信・500・429）は未送信のまま
 await c.route(API+'/ratings/sky/submit',r=>r.abort());await p.locator('#submit').click();
 await p.waitForFunction(()=>/通信できませんでした/.test(document.getElementById('sendState').textContent));
 assert.match(await p.locator('#sendState').textContent(),/未送信のまま/);assert(await p.locator('#submit').isVisible());assert.equal(set(A.id).answers,null);
 await c.unroute(API+'/ratings/sky/submit');await c.route(API+'/ratings/sky/submit',r=>r.fulfill({status:500,headers:{'access-control-allow-origin':ORIGIN},json:{error:'処理できませんでした'}}));
 await p.locator('#submit').click();await p.waitForFunction(()=>/処理できませんでした/.test(document.getElementById('sendState').textContent));assert.match(await p.locator('#sendState').textContent(),/もう一度送信/);
 await c.unroute(API+'/ratings/sky/submit');await c.route(API+'/ratings/sky/submit',r=>r.fulfill({status:429,headers:{'access-control-allow-origin':ORIGIN},json:{error:'送信が続いています。1分ほど待ってからお試しください'}}));
 await p.locator('#submit').click();await p.waitForFunction(()=>/送信が続いています/.test(document.getElementById('sendState').textContent));
 await c.unroute(API+'/ratings/sky/submit');assert.equal(set(A.id).answers,null);note('通信失敗・500・429は「未送信」と再試行の案内、サーバーは未保存');
 // --- 再送で成功。成功の応答のあとだけ「送信しました」
 let sawResponse=false;p.on('response',r=>{if(r.url().endsWith('/ratings/sky/submit')&&r.status()===200)sawResponse=true;});
 await p.locator('#submit').click();await p.waitForFunction(()=>/送信しました/.test(document.getElementById('sendState').textContent));assert(sawResponse);
 let row=set(A.id);assert.equal(row.revision,1);assert.equal(row.answers,await wire(p,A.id));assert(await p.locator('#submit').isHidden());note('再送で成功、DBの回答は端末の回答と一致（revision 1）');
 assert.deepEqual(await finishButtons(p),['finishBack']);assert(await p.locator('#finishBack').evaluate(a=>a.classList.contains('primary')));assert.match(await p.locator('#finish .eyebrow').textContent(),/ありがとう/);note('送信後の完了画面はお礼・送信状態・予測へ戻るだけ（最後の写真の見直しなし）');
 // --- 同じ内容の再送は変化なし、答え直しは上書き（行は1つ）
 const dup=await call('POST','/ratings/sky/submit',A.token,{assignmentId:row.id,answers:JSON.parse(row.answers)});assert.equal(dup.data.changed,false);assert.equal(set(A.id).revision,1);
 await reviewFromManage(p);const before=await p.evaluate(()=>[...document.querySelectorAll('[data-value]')].find(b=>b.getAttribute('aria-pressed')==='true')?.dataset.value);
 await p.locator(`[data-value="${before==='4'?'1':'4'}"]`).click();await ready(p);assert.match(await p.locator('#progressText').textContent(),/^2 \/ 10/);
 for(let i=0;i<10;i++){if(await p.locator('#finish').isVisible())break;await p.locator('#nextExisting').click();}await p.locator('#finish').waitFor();
 assert.match(await p.locator('#sendState').textContent(),/変更があります/);assert.equal(await p.locator('#submit').textContent(),'変更を送信する');
 await p.locator('#submit').click();await p.waitForFunction(()=>/送信しました/.test(document.getElementById('sendState').textContent));
 row=set(A.id);assert.equal(row.revision,2);assert.equal(row.answers,await wire(p,A.id));assert.equal(rows(`SELECT COUNT(*) n FROM sky_rating_sets s JOIN users u ON u.id=s.user_id WHERE u.login_id='${A.id}'`)[0].n,1);
 await p.reload();await p.locator('#start:not([disabled])').waitFor();assert.match(await p.locator('#introStatus').textContent(),/送信済み/);assert(await reviewShown(p));note('同じ内容の再送は変化なし、回答の管理→1枚目から訂正→変更を送信で同じ行を上書き（revision 2）、再読み込み後も送信済み');
 // --- 別のアカウントに切り替えても、前の人の回答は見せず・送らない
 const aRow=JSON.stringify(set(A.id));
 await p.evaluate(t=>{sessionStorage.setItem('sorami.token',JSON.stringify(t));localStorage.removeItem('sorami.token');},{token:B.token,loginId:B.id,role:'user'});
 await p.reload();await p.locator('#start:not([disabled])').waitFor();assert.match(await p.locator('#accountLine').textContent(),new RegExp(B.id));assert.equal(await p.locator('#start').textContent(),'10枚の評価を始める');await noReview(p,'別アカウント・回答なし');
 await p.locator('#start').click();await ready(p);const bOrder=await p.evaluate(k=>JSON.parse(localStorage.getItem(k)).order,draftKey(B.id));assert.deepEqual(bOrder,JSON.parse(set(B.id).items));
 await rateAll(p,()=>1);
 // 同じタブで別のアカウントに変わった（storageイベントが来ない）まま送ろうとしても、送らない
 const before2=posts.length;await p.evaluate(t=>sessionStorage.setItem('sorami.token',JSON.stringify(t)),{token:A.token,loginId:A.id,role:'user'});
 await p.locator('#submit').click();assert.match(await p.locator('#sendState').textContent(),/別のアカウント/);assert.equal(posts.length,before2,'送信の要求を出さない');assert.equal(set(B.id).answers,null);
 // 他人の割当IDを持つ下書きを作っても、サーバーが拒否する
 await p.evaluate(({k,id})=>{const d=JSON.parse(localStorage.getItem(k));d.owner=d.owner;d.assignmentId=id;localStorage.setItem(k,JSON.stringify(d));},{k:draftKey(B.id),id:JSON.parse(aRow).id});
 await p.evaluate(t=>sessionStorage.setItem('sorami.token',JSON.stringify(t)),{token:B.token,loginId:B.id,role:'user'});
 const forged=await call('POST','/ratings/sky/submit',B.token,{assignmentId:JSON.parse(aRow).id,answers:JSON.parse(JSON.parse(aRow).answers)});assert.equal(forged.status,404);
 await p.reload();await p.locator('#start:not([disabled])').waitFor();assert.match(await p.locator('#introStatus').textContent(),/送信できなくなりました/);await noReview(p,'送信できない下書き');
 assert.equal(JSON.stringify(set(A.id)),aRow,'Aの回答は変わらない');note('アカウント切替で他人の下書きを出さず、所有者違い・他人の割当IDは送信されない');
 // --- 期限切れ（401）は下書きを残してログインへ
 await p.evaluate(t=>sessionStorage.setItem('sorami.token',JSON.stringify(t)),{token:'expired-synthetic',loginId:A.id,role:'user'});
 await p.reload();await p.locator('#start:not([disabled])').waitFor();assert.match(await p.locator('#introStatus').textContent(),/有効期限/);assert.equal(await p.locator('#start').textContent(),'ログインして始める');await noReview(p,'期限切れ');
 assert(await p.evaluate(k=>!!localStorage.getItem(k),draftKey(A.id)),'下書きは残る');note('401では端末の回答を残してログインを案内');
 // --- 以前の試用回答は送らず、控え/削除だけ
 assert(!posts.some(x=>/legacy|trial/.test(x)));await p.evaluate(t=>sessionStorage.setItem('sorami.token',JSON.stringify(t)),{token:A.token,loginId:A.id,role:'user'});await p.reload();await p.locator('#start:not([disabled])').waitFor();
 await p.locator('#manage summary').click();const dl=p.waitForEvent('download');await p.locator('#legacyDownload').click();const legacyFile=await(await dl).path();assert.match(fs.readFileSync(legacyFile,'utf8'),/sky-rating-ui\/1/);
 await p.locator('#legacyClearOpen').click();await p.locator('#legacyClear').click();assert.equal(await p.evaluate(()=>localStorage.getItem('astronotes.trial.sky-ratings.v1')),null);assert(await p.locator('#legacyBox').isHidden());note('以前の試用回答は自動送信せず、控えの保存と削除だけ');
 // --- 本人の取り下げ
 assert(await p.locator('#withdrawOpen').isVisible());await p.locator('#withdrawOpen').click();await p.locator('#withdrawCancel').click();assert(set(A.id));
 await p.locator('#withdrawOpen').click();await p.locator('#withdraw').click();await p.waitForFunction(()=>/取り下げました/.test(document.getElementById('dataStatus').textContent));
 assert.equal(set(A.id),undefined);assert(set(B.id),'他人の割当は残る');assert.equal(await p.evaluate(k=>localStorage.getItem(k),draftKey(A.id)),null);assert.equal(await p.locator('#start').textContent(),'10枚の評価を始める');await noReview(p,'取り下げ後');note('取り下げで本人の割当と回答だけ削除、端末の回答も消える');
 assert.deepEqual(errors,[]);await c.close();
 // --- 幅と明暗。開始前・評価中・送信後の3画面
 const L=await user('ratel');const shots=[];
 for(const width of[320,390,1280])for(const theme of['light','dark']){
  const cx=await context(b,{viewport:{width,height:850},colorScheme:theme});await cx.addInitScript(t=>sessionStorage.setItem('sorami.token',JSON.stringify(t)),{token:L.token,loginId:L.id,role:'user'});
  await cx.addInitScript(theme=>localStorage.setItem('sorami.theme',theme),theme);
  const{p:q,errors:e2}=await page(cx);await q.goto(base+'sky-rating.html');await q.locator('#start:not([disabled])').waitFor();await layout(q,`${width}${theme}intro`);await q.screenshot({path:path.join(out,`${width}-${theme}-intro.png`),fullPage:true});
  await q.locator('#start').click();if(await q.locator('#finish').isVisible())await reviewFromManage(q);await ready(q);await layout(q,`${width}${theme}review`);await q.screenshot({path:path.join(out,`${width}-${theme}-review.png`)});
  await rateAll(q);if(await q.locator('#submit').isVisible()){await q.locator('#submit').click();await q.waitForFunction(()=>/送信しました/.test(document.getElementById('sendState').textContent));}
  assert.deepEqual(await finishButtons(q),['finishBack']);await layout(q,`${width}${theme}finish`);await q.screenshot({path:path.join(out,`${width}-${theme}-finish.png`)});
  await q.locator('#manage summary').click();assert(await q.locator('#reviewOpen').isVisible());await layout(q,`${width}${theme}manage`);await q.screenshot({path:path.join(out,`${width}-${theme}-manage.png`),fullPage:true});
  assert.equal(await q.evaluate(()=>document.documentElement.dataset.theme),theme);assert.deepEqual(e2,[]);shots.push({width,theme,passed:true});await cx.close();
 }
 note('320/390/1280px×明暗で開始前・評価中・送信後・回答の管理の横あふれなし・操作領域44px以上、完了画面は予測へ戻るだけ');
 await b.close();
 for(const u of[A,B,L])await call('DELETE','/me',u.token).catch(()=>{});
 sql(`DELETE FROM allowed_signups WHERE note='sky-rating-e2e';`);
 assert.equal(rows(`SELECT COUNT(*) n FROM users WHERE login_id IN ('${A.id}','${B.id}','${L.id}')`)[0].n,0);
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks:log,layouts:shots},null,2));console.log(`SKY RATING E2E OK — ${log.length} checks, ${shots.length} layouts`);
})().catch(e=>{console.error(e);process.exit(1);});
