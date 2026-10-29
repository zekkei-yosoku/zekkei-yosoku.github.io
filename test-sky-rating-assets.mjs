import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync,existsSync}from'node:fs';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
// 2026-10-28 写真の評価を本番へ昇格。旧「root不変」検査を、承認した昇格の範囲と生成一致の検査へ置き換える（弱めない）。
const BASE='772e3e79a2083864dbd4508717725a8d82fb0041',cwd=new URL('.',import.meta.url);
// Audit the promotion against its own commit; later approved map/camera/sharing releases are independent.
const PROMOTED='4efdd5c';
const read=n=>readFileSync(new URL(n,import.meta.url)),text=n=>read(n).toString(),git=(...a)=>execFileSync('git',a,{cwd,encoding:'utf8',maxBuffer:64<<20});
const tracked=new Set(git('ls-files').trim().split('\n')),catalog=JSON.parse(read('data/sky-rating-v1/catalog.json')),html=text('sky-rating.html'),js=text('sky-rating.js');
const sha=b=>createHash('sha256').update(b).digest('hex');

test('画像台帳は出典・撮影時刻・事象ID・hashを持ち、root/trialの全画像と画面資産が公開対象にある',()=>{
 assert.equal(catalog.items.length,18);
 for(const p of catalog.items){assert([52,70].includes(p.camera));assert(Number.isFinite(p.capturedAt));assert.match(p.eventId,/^\d+-\d{4}-\d{2}-\d{2}$/);assert.match(p.source,/^https:\/\/www\.sizenken\.biodic\.go\.jp\/view_hour\.php\?no=\d+$/);
  for(const dir of['','trial/']){assert.equal(sha(read(dir+p.src)),p.sha256,dir+p.src);assert(tracked.has(dir+p.src),dir+p.src);}}
 for(const dir of['','trial/'])for(const[,src]of text(dir+'sky-rating.html').matchAll(/(?:src|href)="([^"?#]+)(?:\?[^"#]*)?"/g)){if(src==='.'||src.startsWith('https:')||src.startsWith('./#'))continue;const f=dir+src.replace(/^\.\//,'');assert(existsSync(new URL(f,import.meta.url)),f);assert(tracked.has(f),f);}
 assert.match(catalog.purpose,/not a held-out evaluation set/,'過去の研究画像を独立した最終テストとして扱わない');
});

test('画像台帳はAPIの信頼できる台帳と一致する（今回のAPIを明示参照）',async t=>{
 const dir=process.env.RATING_API_DIR;if(!dir){t.skip('RATING_API_DIR（今回のAPIの作業コピー）未指定');return;}
 const{SKY_RATING_IMAGES,SKY_RATING_SET,SKY_RATING_INTRO,SKY_RATING_COMMON}=await import(new URL('src/sky-rating.js','file://'+dir.replace(/\/?$/,'/')).href);
 assert.equal(SKY_RATING_SET,'sky-rating-v1');assert.equal(SKY_RATING_INTRO,'sky-18');assert.deepEqual([...SKY_RATING_COMMON],['sky-01','sky-02']);
 assert.deepEqual(SKY_RATING_IMAGES.map(p=>[p.id,p.camera,p.capturedAt,p.eventId,p.sha256]),catalog.items.map(p=>[p.id,p.camera,p.capturedAt,p.eventId,p.sha256]));
 assert.match(js,/'sky-rating-v1'/);assert.match(js,/'sky-colour-strength\/1'/);
});

test('昇格コミットの変更は承認範囲だけ、現在のtrialはrootからの生成と一致、独立台帳は空',()=>{
 const changed=git('diff',BASE,PROMOTED,'--name-only').trim().split('\n').filter(Boolean);
 const allowed=n=>['index.html','sky-rating.html','sky-rating.css','sky-rating.js','sky-rating-theme.js','privacy.html','build-preview.py','update-assets.mjs','.gitignore'].includes(n)||n.startsWith('data/sky-rating-v1/')||n.startsWith('trial/')||n.startsWith('tools/')||/^test-[a-z0-9-]+\.mjs$/.test(n);
 assert.deepEqual(changed.filter(n=>!allowed(n)),[]);
 assert.deepEqual(git('diff',BASE,PROMOTED,'--name-only','--','terms.html','legal.css').trim(),'','昇格時に利用規約は変えない');
 execFileSync('python3',['build-preview.py','--check'],{cwd});
 const ledger=JSON.parse(text('trial/ui-experiment.json'));assert.deepEqual(ledger.files,{});assert.deepEqual(ledger.trialOnlyFiles,{});assert.equal(ledger.promotedFrom,BASE);
 for(const n of['sky-rating.js','sky-rating.css','sky-rating-theme.js','privacy.html','terms.html'])assert.equal(sha(read('trial/'+n)),sha(read(n)),n);
 assert.match(text('trial/sky-rating.html'),/AstroNotes <span>試用版<\/span>/);
});

test('昇格時のindex差分は承認範囲だけ、現在も協力入口と写真アップロード撤去を保つ',()=>{
 const norm=s=>s.split('\n').filter(l=>!/name="app-version"|http-equiv="Content-Security-Policy"|data-script-preload/.test(l)).map(l=>l.replace(/\?v=\d+/g,'?v='));
 const trial=git('show',BASE+':trial/index.html').replace('<title>AstroNotes 試用版</title>','<title>AstroNotes</title>').replace('content="AstroNotes 試用版"','content="AstroNotes"').replace(/  <p style="font-size:12px;padding:6px 2px;color:var\(--secondary\)">試用版 · 本番とアカウント・保存データ共通 <a href="\.\.\/">本番へ<\/a><\/p>\n/,'');
 const count=a=>a.reduce((m,l)=>m.set(l,(m.get(l)||0)+1),new Map()),A=count(norm(trial)),B=count(norm(git('show',PROMOTED+':index.html')));
 const added=[],removed=[];for(const[l,n]of B)for(let i=(A.get(l)||0);i<n;i++)added.push(l);for(const[l,n]of A)for(let i=(B.get(l)||0);i<n;i++)removed.push(l);
 const glue=/RATING_LOGIN|loginSettling|ratingLoginPending|finishRatingLogin|resumeRatingLogin|astronotes\.rating\.return|astronotes\.sky-ratings\.v2|ログインして送信|新しい写真のアップロードは受け付けていません|2026-10-28: 結果は点数評価|写真の評価（sky-rating\.html）|写真の評価から来たログイン|結果の写真アップロードは2026-10-28に撤去|回復コードやパスキーの案内|起動の画面選び|^  setTimeout\(\(\) => \{$|^  \}, 0\);$|^    if \(auth\) location\.href = "sky-rating\.html";$/;
 assert.deepEqual(added.filter(l=>!glue.test(l)&&!/^\s*(try \{|\}|)\s*$/.test(l)),[]);
 const old=/^\s*\/\* 写真から時刻を読む。|^\s*\.shot \{|^\s*color: var\(--accent\); font-size: 0\.81rem; cursor: pointer; \}$|^\s*\.shot input \{|astronotes\.trial\.rating\.return|運営にはまだ送信されません|この試用版では新しい写真|2026-10-28 trial:|"sorami\.skyMap:"\]\) \{|document\.documentElement\.removeAttribute\('data-startup-pending'\);\}\);|^\s*\/\/ 同期の状態（できている／未送信がある／失敗している）はアカウント画面に常時出す。\s*$|^\}$/;
 assert.deepEqual(removed.filter(l=>!old.test(l)),[]);
 const index=text('index.html');
 assert.equal((index.match(/id="skyRatingInvite"/g)||[]).length,1);assert.doesNotMatch(index,/id="skyRatingMenu"|data-shot-pid|<span>📷 写真をアップロード<\/span>/);
 assert.match(index,/<section class="card" id="skyRatingInvite">[\s\S]*?<\/section>\n  <details class="tiny fav-where" id="footer">/,'入口は出典の直前だけ');
});

test('評価ページは自前scriptだけで、送信先は今回のAPIの評価経路だけ。予測点や自動学習を持たず、以前の試用回答を送らない',()=>{
 assert.match(html,/connect-src 'self' https:\/\/zekkei-api\.okayu-sorami\.workers\.dev http:\/\/localhost:8787;/);
 assert.doesNotMatch(html,/unsafe-inline|unsafe-eval|<script[^>]+src="https:|運営にはまだ送信されません|AstroNotes <span>試用版|AstroNotes 試用版/);
 assert.match(html,/送信する内容[\s\S]*地点や予測の値は送りません[\s\S]*予測の精度の検証と改善[\s\S]*取り下げるか退会するまで/);
 const paths=[...js.matchAll(/api\('(GET|POST|DELETE)','([^']+)'/g)].map(m=>m[1]+' '+m[2]);
 assert.deepEqual([...new Set(paths)].sort(),['DELETE /ratings/sky','GET /ratings/sky','POST /ratings/sky/assignment','POST /ratings/sky/submit']);
 assert.equal((js.match(/fetch\(/g)||[]).length,2,'catalogの読込とapi()だけ');
 assert.doesNotMatch(js+JSON.stringify(catalog),/auto_score|observedQuality|predictedScore|forecast\b/);
 for(const m of js.matchAll(/LEGACY_KEY/g)){const line=js.slice(js.lastIndexOf('\n',m.index)+1,js.indexOf('\n',m.index));assert.doesNotMatch(line,/api\(/,'以前の試用回答はAPIへ渡さない');}
 assert.match(js,/current\.loginId!==draft\.owner/,'表示中のアカウントと下書きの所有者が違えば送らない');
});

test('プライバシーポリシーは写真の評価の取得・目的・保存期間・取り下げ・端末保存を実装どおりに書く',()=>{
 for(const dir of['','trial/']){const pp=text(dir+'privacy.html');
  assert.match(pp,/最終更新日：2026年10月28日/);assert.match(pp,/<dt>写真の評価（協力いただいた場合）<\/dt>/);assert.match(pp,/地点や予測の値は利用者から受け取りません/);
  assert.match(pp,/観測記録、写真の評価を、当時の予測と照らし合わせて/);assert.match(pp,/<th scope="row">写真の評価<\/th><td>取り下げるか、退会するまで/);
  assert.match(pp,/「回答の管理」から取り下げられます/);assert.match(pp,/退会すると、そのアカウントの記録、写真、写真の評価、/);assert.match(pp,/送信する前の写真の評価など一部の情報は、その端末の中だけ/);}
});
