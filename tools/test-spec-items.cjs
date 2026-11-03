// 概説書（Vault ドメイン/開発/AstroNotes/07_概説書）の項目IDごとに、実画面で期待する動きを1つずつ確かめる。
// APIはすべて偽の応答に差し替える。実アカウント、実API、実機は見ていない。
//   SPEC_BASE=http://127.0.0.1:8979/ SPEC_FORECAST=forecast.json [SPEC_ONLY=H-4,F-1] [SPEC_OUT=結果.json] node tools/test-spec-items.cjs [chrome|webkit]
const {chromium,webkit}=require('playwright'),assert=require('assert/strict'),fs=require('fs');
const base=process.env.SPEC_BASE||'http://127.0.0.1:8897/',engine=process.argv[2]||'chrome',only=new Set((process.env.SPEC_ONLY||'').split(',').filter(Boolean)),forecast=JSON.parse(fs.readFileSync(process.env.SPEC_FORECAST,'utf8'));
const FULL=['diamond','pearl','tower','skymap','framing','plane','iss','records','multiscene'];
const USERS={guest:null,none:{tools:[],role:'user'},full:{tools:FULL,role:'user'}};
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const FAV={id:'spec-1',name:'検査の地点',latitude:35.68,longitude:139.76,elevation:40,eyeHeightAGL:1.5,phenomena:['sunrise','sunset','moon']};
const OBSERVER={name:'菅生ケ丘',latitude:35.5895,longitude:139.561,groundManualM:63,standAglM:1.5};
// 軌道要素は fixtures の 2026-09-29 のもの。時計をその翌日に止めると、この地点で見える回が2回ある
const ISS_TLE=fs.readFileSync(require('path').join(__dirname,'..','fixtures','iss-20260929.tle'),'utf8');
// 同期の偽の応答はお気に入りを取り込まない形なので、記録の地点は端末側に置く
const OBS_KEY='sorami.observations.v1:spec',regOf=(key,name,latitude,longitude)=>({id:'reg-'+key,placeId:FAV.id,target:{key,name,latitude,longitude},registration:true,removed:false,result:'seen',date:'',note:'',observer:{latitude:FAV.latitude,longitude:FAV.longitude},createdAt:Date.parse('2026-10-01T12:00:00+09:00'),updatedAt:Date.parse('2026-10-01T12:00:00+09:00')});
const RECORDED={'sorami.favorites':JSON.stringify([FAV]),[OBS_KEY]:JSON.stringify([regOf('skytree','東京スカイツリー',35.710063,139.8107),regOf('tokyotower','東京タワー',35.658591,139.745444)])};
const ready=()=>{try{return typeof PAGE_DIALOGS==='object';}catch{return false;}};
const items=[],spec=(id,name,user,route,fn,opts={})=>items.push({id,name,user,route,fn,opts});
const text=(p,s)=>p.locator(s).first().innerText();
const shown=(p,s)=>p.locator(s).first().isVisible();
const hasText=(s,...words)=>{for(const w of words)assert.ok(s.includes(w),`「${w}」がない`);};
const y=(p,s)=>p.locator(s).first().evaluate(e=>e.getBoundingClientRect().top);
const menuLabels=async p=>{await p.locator('#toolsButton').click();await p.waitForTimeout(150);const r=await p.evaluate(()=>[...document.querySelectorAll('#toolsMenu a,#toolsMenu button,#toolsMenu [role=menuitem]')].filter(e=>e.getClientRects().length).map(e=>e.innerText.trim()).filter(Boolean));await p.keyboard.press('Escape');return r;};
const openDialog=p=>p.evaluate(()=>{const d=[...document.querySelectorAll('dialog[open]')].pop();if(!d)return null;const r=d.getBoundingClientRect(),vis=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';return {id:d.id,w:r.width,h:r.height,iw:innerWidth,ih:innerHeight,text:d.innerText,buttons:[...d.querySelectorAll('button')].filter(vis).map(b=>(b.getAttribute('aria-label')||b.innerText).trim())};});
const exploreReady=async p=>{await p.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>63;});await p.locator('#exploreMapTab').waitFor({state:'attached',timeout:15000});};
const setObserver=async p=>{await p.evaluate(o=>SkyMapUI.setObserver(o),OBSERVER);await p.waitForFunction(()=>!!SkyMapUI.selectionState()?.observer);};
const setTarget=(p,id)=>p.evaluate(id=>SkyMapUI.setTarget(id),id);
const clearObserver=p=>p.evaluate(()=>PLACE_PICKERS.skymap.reset());
const clearTarget=p=>p.evaluate(()=>{const s=document.getElementById('skyMapTarget');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));});

// ---- 共通
spec('C-1','ページ型は全画面で開き、戻るがあり×がない。端末の戻るで閉じる','guest','#/',async p=>{await p.locator('#placeButton').click();await p.waitForTimeout(400);const d=await openDialog(p);assert.ok(d,'開かない');assert.ok(d.w>=d.iw-1&&d.h>=d.ih-1,`全画面でない ${d.w}x${d.h}`);assert.ok(d.buttons.some(b=>b==='戻る'),'戻るがない');assert.ok(!d.buttons.some(b=>/^(×|✕|閉じる)$/.test(b)),'×がある');await p.goBack();await p.waitForTimeout(300);assert.equal(await openDialog(p),null,'端末の戻るで閉じない');});
spec('C-2','短いシートは元の画面を見たまま選ぶ（全画面にしない）','guest','#/almanac',async p=>{await p.locator('#almanacTimeMore').click();await p.waitForTimeout(300);const d=await openDialog(p);assert.ok(d,'開かない');assert.ok(d.h<d.ih-1,`全画面になっている ${d.h}`);});
spec('C-3','入力ページを変更して戻ると確認し、変更なしなら聞かない','full','#/',async p=>{const msgs=[];p.on('dialog',d=>{msgs.push(d.message());d.dismiss();});await p.locator('#favToggle').click();await p.waitForTimeout(350);assert.ok(await openDialog(p),'登録ページが開かない');await p.locator('dialog[open] button',{hasText:'戻る'}).first().click();await p.waitForTimeout(250);assert.equal(msgs.length,0,'変更なしで聞いた');await p.locator('#favToggle').click();await p.waitForTimeout(350);await p.locator('dialog[open] input[type=text],dialog[open] input:not([type])').first().fill('変更した名前');await p.locator('dialog[open] button',{hasText:'戻る'}).first().click();await p.waitForTimeout(250);assert.ok(msgs.length===1&&/破棄|変更|保存/.test(msgs[0]),`確認が出ない ${msgs}`);});
spec('C-4','待機中は「予測中」を出す','guest','#/',async p=>{assert.ok(await shown(p,'#status'),'待機が出ない');hasText(await text(p,'#status'),'予測中');},{hold:true});
spec('C-5','失敗は理由と再試行を出し、英語をそのまま出さない','guest','#/',async p=>{await p.waitForTimeout(800);const s=await text(p,'#status');hasText(s,'予測に失敗','再試行');assert.ok(!/error|failed|exception/i.test(s),'英語が出ている');},{fail:true});
// C-9 は似ているかを機械で決められない。主な画面の部品の種類（要素と class の組。状態の class は除く）が下の一覧から増えたら止め、既存の部品で足りないかを人が確かめる
const C9_ROUTES=['#/','#/sunset','#/almanac','#/forecast/results','#/explore','#/plane','#/iss','#/records'];
const C9_KINDS=['a','a.fav-btn','button','button.aim-from-fav.tap','button.al-row.jump','button.cell','button.chip','button.chip.explore-show-result','button.chip.journey-place-find','button.chip.my-add-point','button.chip.preview-history-icon','button.chip.ui-icon-label','button.condition-choice','button.day','button.fav-btn','button.list-item.my-place-row','button.map-ctl.sky-map-expand','button.place-pick','button.plan-trigger','button.tap','button.tool-datetime-date','button.tool-datetime-nav','button.tool-datetime-nav.tool-datetime-now','button.tool-datetime-nav.tool-datetime-play','input[checkbox]','input[date].fav-in','input[time].tool-datetime-time','select','select.fav-in','summary'];
spec('C-9','主な画面の部品の種類が、確かめた一覧から増えていない','full','#/',async p=>{const found=new Set();for(const h of C9_ROUTES){await p.evaluate(h=>{location.hash=h;},h);await p.waitForTimeout(1600);for(const k of await p.evaluate(()=>[...document.querySelectorAll('button,a[href],input,select,textarea,[role=button],[role=tab],summary')].filter(e=>e.getClientRects().length&&!e.closest('dialog:not([open])')).map(e=>e.tagName.toLowerCase()+(e.tagName==='INPUT'?'['+e.type+']':'')+[...e.classList].filter(c=>!/^(is-|has-)|^(next|past|today|on|active|selected|open|current|warn)$/.test(c)).sort().map(c=>'.'+c).join(''))))found.add(k);}if(process.env.SPEC_DUMP)console.log(JSON.stringify([...found].sort()));const extra=[...found].filter(k=>!C9_KINDS.includes(k)).sort();assert.deepEqual(extra,[],`新しい部品 ${extra.join(' ')}`);},{tle:ISS_TLE,storage:RECORDED});
spec('C-10','外観は自動、ライト、ダークを選べて、再読み込みしても保つ','full','#/',async p=>{await p.locator('#authButton').click();await p.waitForTimeout(250);await p.locator('#settingsScreen').click();await p.waitForTimeout(250);const before=await p.evaluate(()=>getComputedStyle(document.body).backgroundColor);const row=p.locator('#appSettings').getByRole('button',{name:'ライト'}).or(p.locator('#appSettings').getByText('ライト',{exact:true})).first();await row.click();await p.waitForTimeout(250);const after=await p.evaluate(()=>getComputedStyle(document.body).backgroundColor);assert.notEqual(after,before,'色が変わらない');await p.reload();await p.waitForFunction(ready);await p.waitForTimeout(600);assert.equal(await p.evaluate(()=>getComputedStyle(document.body).backgroundColor),after,'再読み込みで戻る');});
spec('C-D3','時刻を押すとその場で入力できる','guest','#/almanac',async p=>{await p.locator('#almanacTime').fill('09:30');await p.waitForTimeout(250);assert.equal((await p.locator('#almanacFooter .tool-datetime-face').innerText()).trim(),'09:30');});
spec('C-D4','現在に戻す時計で今の日時に戻す','guest','#/almanac',async p=>{const now=await text(p,'#almanacDayLabel');await p.locator('#almanacNext').click();await p.waitForTimeout(200);assert.notEqual(await text(p,'#almanacDayLabel'),now,'動かない');await p.locator('#almanacFooter .tool-datetime-now').click();await p.waitForTimeout(250);assert.equal(await text(p,'#almanacDayLabel'),now,'戻らない');});
spec('C-D6','…で関連情報を開く','guest','#/almanac',async p=>{await p.locator('#almanacTimeMore').click();await p.waitForTimeout(300);const d=await openDialog(p);assert.ok(d,'開かない');assert.ok(d.text.trim().length>0,'空');});
spec('C-K1','カレンダーは下の画面が残る小さなダイアログで、枠の外で閉じる','guest','#/almanac',async p=>{await p.locator('#almanacCalendarOpen').click();await p.waitForTimeout(300);const d=await openDialog(p);assert.ok(d,'開かない');assert.ok(d.h<d.ih-1,`全画面 ${d.h}`);await p.mouse.click(3,3);await p.waitForTimeout(300);assert.equal(await openDialog(p),null,'枠の外で閉じない');});

// ---- ホーム
spec('H-2','昼は太陽、夜は月を自動で選ぶ','guest','#/almanac',async p=>{const on=await p.locator('.alm-switch button[aria-pressed=true],.alm-switch button[aria-selected=true]').first().innerText();assert.ok(/太陽/.test(on),`昼に ${on}`);},{clock:'2026-11-03T12:00:00+09:00'});
spec('H-2n','夜は月を自動で選ぶ','guest','#/almanac',async p=>{const on=await p.locator('.alm-switch button[aria-pressed=true],.alm-switch button[aria-selected=true]').first().innerText();assert.ok(/月/.test(on),`夜に ${on}`);},{clock:'2026-11-03T23:00:00+09:00'});
spec('H-3','日付を動かしても天体を勝手に切り替えない','guest','#/almanac',async p=>{const sel='.alm-switch button[aria-pressed=true],.alm-switch button[aria-selected=true]',a=await p.locator(sel).first().innerText();await p.locator('#almanacNext').click();await p.waitForTimeout(300);await p.locator('#almanacNext').click();await p.waitForTimeout(300);assert.equal(await p.locator(sel).first().innerText(),a);},{clock:'2026-11-03T12:00:00+09:00'});
spec('H-4','出入り、空をたどる、天球図、7日間の表','guest','#/almanac',async p=>{const s=await text(p,'#almanacDashboard');hasText(s,'日の出','日の入','空をたどる','これから7日間');assert.ok(/N[\s\S]*E[\s\S]*S[\s\S]*W/.test(s),'天球図の方角がない');assert.equal(await p.locator('#almanacDashboard table tbody tr').count(),7,'7日の行数');},{clock:'2026-11-03T13:00:00+09:00'});  // 日没後は月へ自動で切り替わるので昼に固定（2026-11-03）
spec('H-5','節気と候、昼の長さ、ゴールデンアワー、ブルーアワー','guest','#/almanac',async p=>{await p.locator('.alm-switch button',{hasText:'太陽'}).click();await p.waitForTimeout(300);const s=await text(p,'#almanacDashboard');hasText(s,'次の節気','昼の長さ','ゴールデンアワー','ブルーアワー');assert.ok(/[初次末]候/.test(s),'七十二候がない');});
spec('H-8','金星の絵は輝面の割合に応じて陰が付く（試用版）','guest','trial/#/almanac',async p=>{await p.locator('.alm-switch button',{hasText:'金星'}).click();await p.waitForFunction(()=>{const c=document.querySelector('#almanacDashboard canvas');return c&&c.width>0;},null,{timeout:8000});await p.waitForTimeout(1200);const r=await p.evaluate(()=>{for(const c of document.querySelectorAll('#almanacDashboard canvas')){if(!/venus|portrait|surface/i.test(c.className+c.id+(c.parentElement?.className||'')))continue;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let lit=0,dark=0;for(let i=0;i<d.length;i+=4){if(d[i+3]<20)continue;const v=d[i]+d[i+1]+d[i+2];if(v>180)lit++;else dark++;}return {lit,dark,w:c.width};}return null;});assert.ok(r,'金星の絵の canvas がない');assert.ok(r.lit>0,'光る面がない');});
spec('H-10','金星の計算に失敗したら理由と再計算を出す（試用版）','guest','trial/#/almanac',async p=>{await p.locator('.alm-switch button',{hasText:'金星'}).click();await p.waitForTimeout(1500);const s=await text(p,'#almanacDashboard');hasText(s,'取得できませんでした','再計算');},{blockVenus:true});
spec('H-11','表示についてを押すと説明が開く','guest','#/almanac',async p=>{await p.getByText('表示について',{exact:true}).first().click();await p.waitForTimeout(250);const d=await openDialog(p);const s=d?d.text:await text(p,'#almanacDashboard');assert.ok(s.length>40,'説明がない');});

// ---- 予測
spec('F-1','地点カードと現象ごとの14日分の点数','guest','#/',async p=>{assert.ok(await shown(p,'#placeRow'));const s=await text(p,'#cards');hasText(s,'朝焼け','夕焼け','今日');const heads=await p.evaluate(()=>[...document.querySelectorAll('#cards .mxhead')].map(h=>h.children.length));assert.ok(heads.some(n=>n>=14),`日の列 ${heads}`);});
spec('F-2','点数の色は点数で変わり、信頼度は文字で別に出す','guest','#/',async p=>{const r=await p.evaluate(()=>{const cells=[...document.querySelectorAll('#cards button.cell')].filter(c=>/\d/.test(c.innerText)),by={};for(const c of cells){by[parseInt(c.innerText)]=c.getAttribute('style');}return {n:cells.length,colors:new Set(Object.values(by)).size,scores:Object.keys(by).length,letters:cells.filter(c=>/[ABC]/.test(c.innerText)).length};});assert.ok(r.n>=28,`セル ${r.n}`);assert.ok(r.colors>=r.scores*.8,`色の数 ${r.colors}/${r.scores}`);assert.equal(r.letters,r.n,'信頼度の文字がないセル');});
spec('F-4','判定対象外はまとめて、行き止まりの釦を作らない','guest','#/',async p=>{const sum=p.getByText(/判定対象外・データ不足/).first();await sum.click();await p.waitForTimeout(200);const r=await p.evaluate(()=>{const d=[...document.querySelectorAll('#cards details,#listView details')].find(e=>/判定対象外/.test(e.innerText));return d&&{open:d.open,text:d.innerText,links:[...d.querySelectorAll('a[href],button')].length};});assert.ok(r,'まとめがない');assert.ok(r.open,'開かない');assert.equal(r.links,0,'中に釦がある');});
spec('F-7','詳細に週間、点数のわけ、時間帯ごとの見込み、計画の共有','guest','#/sunset',async p=>{const s=await text(p,'#detailView');hasText(s,'週間','この点数のわけ','時間帯ごとの見込み');assert.ok(await p.evaluate(()=>[...document.querySelectorAll('#detailView button,#detailView a')].some(b=>/共有|計画/.test((b.getAttribute('aria-label')||'')+b.innerText))),'共有がない');});
spec('F-10','地点カードを押すと地点ページ、☆で登録ページ','full','#/',async p=>{await p.locator('#favToggle').click();await p.waitForTimeout(350);const f=await openDialog(p);assert.ok(f&&/お気に入り|登録/.test(f.text),'登録ページが開かない');await p.locator('dialog[open] button',{hasText:'戻る'}).first().click();await p.waitForTimeout(250);await p.locator('#placeButton').click();await p.waitForTimeout(300);const d=await openDialog(p);assert.ok(d&&/撮影地点/.test(d.text),'地点ページが開かない');});
spec('F-10g','未ログインで☆を押すとログインを案内する','guest','#/',async p=>{let m='';p.on('dialog',d=>{m=d.message();d.dismiss();});await p.locator('#favToggle').click();await p.waitForTimeout(250);hasText(m,'ログイン');});

// ---- 結果
spec('R-1','未ログインは案内だけで件数や写真を出さない','guest','#/forecast/results',async p=>{assert.ok(await shown(p,'#answersAccess'));for(const s of ['#answerHistory','#reviewPhotos','#recordsPending'])assert.ok(!await shown(p,s),s+' が出ている');assert.ok(!/\d+件/.test(await text(p,'#answersView')),'件数が出ている');});
spec('R-1n','権限なしも案内だけ','none','#/forecast/results',async p=>{assert.ok(await shown(p,'#answersAccess'));for(const s of ['#answerHistory','#reviewPhotos'])assert.ok(!await shown(p,s),s+' が出ている');});
spec('R-2','権限ありは入力、これまでの結果、写真の一覧','full','#/forecast/results',async p=>{const s=await text(p,'#answersView');hasText(s,'結果を残す','これまでの結果','以前提供した写真');assert.equal(await p.locator('#answersView input[type=file]:visible').count(),0,'アップロードがある');});

// ---- 探す
spec('E-1','条件は天体、対象、撮影地点、結果の順','full','#/explore',async p=>{await exploreReady(p);const s=await text(p,'#skyMapContent'),t=s.slice(s.indexOf('条件を閉じる')),a=t.indexOf('天体'),b=t.search(/\n対象\n/),c=t.search(/\n撮影地点\n/);assert.ok(a>=0&&b>a&&c>b,`順番 ${a},${b},${c}`);});
spec('E-2','足りない条件で釦が変わり、押すと選択ページを開く','full','#/explore',async p=>{await exploreReady(p);await clearObserver(p);await clearTarget(p);await p.waitForTimeout(300);const b=p.getByRole('button',{name:/対象を選ぶ/}).first();assert.ok(await b.isVisible(),'対象を選ぶがない');await setTarget(p,'skytree');await p.waitForTimeout(300);const o=p.getByRole('button',{name:/撮影地点を選ぶ/}).first();assert.ok(await o.isVisible(),'撮影地点を選ぶがない');await o.click();await p.waitForTimeout(300);assert.ok(await openDialog(p),'選択ページが開かない');});
spec('E-5','重ね方に部位や縁の選択を出さない','full','#/explore',async p=>{await exploreReady(p);await setObserver(p);await setTarget(p,'skytree');await p.waitForTimeout(400);const s=await text(p,'#skyMapContent');for(const w of ['部位','上の縁','下の縁','てっぺん'])assert.ok(!s.includes(w),w+' が出ている');});
spec('E-9','構図権限だけならメニューは構図で、構図を開く','framing-only','#/',async p=>{const l=(await menuLabels(p)).map(x=>x.split('\n')[0]);assert.ok(l.includes('構図')&&!l.includes('探す'),`メニュー ${l}`);await p.evaluate(()=>{location.hash='#/aim/tower';});await p.waitForTimeout(900);assert.ok(await shown(p,'#aimView'),'構図が開かない');assert.ok(!await p.locator('#exploreMapTab').isVisible(),'タブが出ている');});
spec('E-9m','地図権限だけならタブなしの地図を開く','map-only','#/skymap',async p=>{await p.waitForTimeout(500);assert.ok(await shown(p,'#skyMapView'));assert.ok(!await p.locator('#exploreSceneTab').isVisible(),'見え方タブが出ている');const l=(await menuLabels(p)).map(x=>x.split('\n')[0]);assert.ok(l.includes('探す')&&!l.includes('構図'),`メニュー ${l}`);});
spec('E-10','未ログインは案内だけ','guest','#/explore',async p=>{assert.ok(await shown(p,'#skyMapAccess'));assert.ok(!await p.locator('#exploreMapTab').isVisible(),'タブが出ている');});
spec('S-2','対象がないと不足を案内する','full','#/explore',async p=>{await exploreReady(p);await clearTarget(p);await p.waitForTimeout(300);await p.locator('#exploreSceneTab').click();await p.waitForTimeout(400);assert.ok(/対象を選ぶと/.test(await text(p,'#skyMapContent')),'案内がない');});
spec('S-5','画角の外の対象は図と読み上げに含めない','full','#/explore',async p=>{await exploreReady(p);await setObserver(p);await setTarget(p,'skytree');await p.locator('#exploreSceneTab').click();await p.waitForTimeout(1500);const l=await p.locator('[data-look-canvas]').getAttribute('aria-label');assert.ok(l&&l.includes('スカイツリー'),`主の対象がない ${l}`);assert.ok(!l.includes('富士山'),'選んでいない山が読み上げにある');});
spec('S-11','見え方は1本指でページをスクロールする','full','#/explore',async p=>{await exploreReady(p);await setObserver(p);await setTarget(p,'skytree');await p.locator('#exploreSceneTab').click();await p.waitForTimeout(800);const t=await p.locator('[data-look-canvas]').evaluate(e=>{for(let n=e;n;n=n.parentElement){const v=getComputedStyle(n).touchAction;if(v&&v!=='auto')return v;}return 'auto';});assert.ok(/pan-y|auto/.test(t),`touch-action ${t}`);});
spec('P-1','天体は分類つきの全画面ページで選ぶ','full','#/explore',async p=>{await exploreReady(p);await p.locator('#skyMapBodyOpen').click();await p.waitForTimeout(400);const d=await openDialog(p);assert.ok(d,'開かない');assert.ok(d.h>=d.ih-1,'全画面でない');hasText(d.text,'太陽','月','金星');});
spec('Y-2','探すの選択を端末に保ち、再読み込みで戻す','full','#/explore',async p=>{await exploreReady(p);await setObserver(p);await setTarget(p,'tokyotower');await p.waitForTimeout(800);await p.reload();await p.waitForFunction(ready);await exploreReady(p);await p.waitForTimeout(800);const s=await p.evaluate(()=>SkyMapUI.selectionState());assert.equal(s.observer?.name,OBSERVER.name,'地点が戻らない');assert.ok(JSON.stringify(s.target||s.targetId||'').includes('tokyotower')||(await p.locator('#skyMapTarget').inputValue())==='tokyotower','対象が戻らない');});

// ---- 選択ページ
const openTargetPage=async p=>{await exploreReady(p);await setObserver(p);await clearTarget(p);await p.waitForTimeout(300);await p.getByRole('button',{name:/対象を選ぶ/}).first().click();await p.waitForTimeout(400);const d=await openDialog(p);assert.ok(d,'対象ページが開かない');return d;};
spec('P-2','権限 multiscene なしは1つ押すと選択して閉じる','no-multi','#/explore',async p=>{await openTargetPage(p);await p.locator('dialog[open] .preview-body-choice').nth(1).click();await p.waitForTimeout(350);assert.equal(await openDialog(p),null,'閉じない');assert.equal((await p.evaluate(()=>SkyMapUI.selectionState())).target?.id,'skytree');});
spec('P-3','権限 multiscene ありは複数選べて、適用で閉じる','full','#/explore',async p=>{await openTargetPage(p);const rows=p.locator('dialog[open] .preview-body-choice');await rows.nth(0).click();await rows.nth(1).click();await p.waitForTimeout(150);const s=await text(p,'dialog[open]');hasText(s,'2件を選択中','選択を適用');await p.getByRole('button',{name:/選択を適用/}).click();await p.waitForTimeout(400);assert.equal(await openDialog(p),null,'閉じない');assert.ok(/ほか/.test(await text(p,'#skyMapContent')),'要約にほかが出ない');});
spec('P-4','選んだ行は見た目で分かり、隣の行を動かさない','full','#/explore',async p=>{await openTargetPage(p);const rows=p.locator('dialog[open] .preview-body-choice'),row=rows.nth(1),st=()=>row.evaluate(e=>{const c=getComputedStyle(e);return [c.backgroundColor,c.boxShadow,c.borderColor].join('|');}),before=await st(),next=()=>rows.nth(2).evaluate(e=>e.offsetTop-e.parentElement.offsetTop),n0=await next();await row.click();await p.mouse.move(2,2);await p.waitForTimeout(250);assert.equal(await next(),n0,'隣の行が動く');assert.notEqual(await st(),before,'見た目で分からない');});
spec('P-5','続けて素早く押しても全部反映し、一覧を作り直さない','full','#/explore',async p=>{await openTargetPage(p);const r=await p.evaluate(()=>{const rows=[...document.querySelectorAll('dialog[open] .preview-body-choice')].slice(0,3);rows.forEach(x=>x.click());return rows.every(x=>x.isConnected);});await p.waitForTimeout(150);assert.ok(r,'一覧が作り直された');hasText(await text(p,'dialog[open]'),'3件を選択中');});
spec('P-6','検索しても選択を保つ','full','#/explore',async p=>{await openTargetPage(p);await p.locator('dialog[open] .preview-body-choice').first().click();await p.waitForTimeout(150);assert.ok(/1件を選択中/.test(await text(p,'dialog[open]')),'選択中が出ない');await p.locator('dialog[open] .target-search').fill('東京');await p.waitForTimeout(350);assert.ok(/1件を選択中/.test(await text(p,'dialog[open]')),'検索で選択が消えた');});
spec('P-7','全部外して適用すると対象なしになる','full','#/explore',async p=>{await exploreReady(p);await setObserver(p);await setTarget(p,'skytree');await p.waitForTimeout(300);await p.locator('#skyMapTargetOpen').click();await p.waitForTimeout(400);await p.locator('dialog[open] .preview-body-choice',{hasText:'東京スカイツリー'}).first().click();await p.waitForTimeout(150);await p.getByRole('button',{name:/選択を適用|適用/}).click();await p.waitForTimeout(400);const s=await p.evaluate(()=>SkyMapUI.selectionState());assert.ok(!s.target,'対象が残る');});
spec('P-8','対象の行に住所、カテゴリで絞り込める','full','#/explore',async p=>{await openTargetPage(p);const s=await text(p,'dialog[open]');assert.ok(/都|道|府|県/.test(s),'住所がない');assert.ok(await p.locator('dialog[open] select,dialog[open] [role=tab],dialog[open] [data-category]').count()>0,'カテゴリがない');});
spec('P-9','地点ページは検索、現在地と地図、お気に入り、履歴の順','guest','#/',async p=>{await p.locator('#placeButton').click();await p.waitForTimeout(350);const s=await text(p,'dialog[open]');const a=s.indexOf('現在地'),b=s.indexOf('地図');assert.ok(a>=0&&b>=0,'現在地か地図で選ぶがない');const search=await p.locator('dialog[open] input').first().evaluate(e=>e.getBoundingClientRect().top),cur=await p.locator('dialog[open] button',{hasText:'現在地'}).first().evaluate(e=>e.getBoundingClientRect().top);assert.ok(search<cur,'検索欄が現在地より下');});

// ---- 月丼
spec('D-1','題名、運用、撮影地点、日付、地図、候補の順','full','#/plane',async p=>{const ys=[];for(const s of ['#planeOp','#planeFromButton','#planeDate','#planeCanvas','#planeList'])ys.push(await y(p,s));assert.deepEqual([...ys].sort((a,b)=>a-b),ys,`順番 ${ys}`);});
spec('D-2','運用の向きを手で選べる','full','#/plane',async p=>{const v=await p.locator('#planeOp').evaluate(e=>[...e.options||[]].map(o=>o.value));assert.ok(v.length>=3,`選択肢 ${v}`);await p.locator('#planeOp').selectOption(v[1]);await p.waitForTimeout(300);assert.equal(await p.locator('#planeOp').inputValue(),v[1]);});
spec('D-3','地図の凡例で着陸と離陸を分ける','full','#/plane',async p=>{hasText(await text(p,'#planeView'),'着陸','離陸');});
spec('D-4','中心ピン、ここから重ねる、座標、地図アプリ','full','#/plane',async p=>{assert.ok(await shown(p,'#planePickHere'));assert.ok(/\d+\.\d+,\s*\d+\.\d+/.test(await text(p,'#planeCoord')),'座標がない');hasText(await text(p,'#planeView'),'地図アプリ','ここから重ねる');});
spec('D-5','重ならない日は撮影地点から重ならないことを書く','full','#/plane',async p=>{hasText(await text(p,'#planeView'),'重なりません');},{clock:'2026-11-03T12:00:00+09:00'});
spec('D-6','未ログインは案内だけ','guest','#/plane',async p=>{assert.ok(await shown(p,'#planeAccess'));assert.ok(!await shown(p,'#planeCanvas'));});
spec('D-6n','権限なしは案内だけ','none','#/plane',async p=>{assert.ok(await shown(p,'#planeAccess'));assert.ok(!await shown(p,'#planeCanvas'));});

// ---- 人工衛星
spec('I-1','衛星カード、中心、通過と月太陽の切替（初めは通過）','full','#/iss',async p=>{for(const s of ['#issSatButton','#issFromButton','#issPassTab','#issTransitTab'])assert.ok(await shown(p,s),s);assert.equal(await p.locator('#issPassTab').getAttribute('aria-selected'),'true');});
spec('I-2','衛星はページで開き、初めはすべて、☆で登録','full','#/iss',async p=>{await p.locator('#issSatButton').click();await p.waitForTimeout(400);const d=await openDialog(p);assert.ok(d,'開かない');assert.ok(d.h>=d.ih-1,'全画面でない');assert.ok(/すべて/.test(d.text),'すべてがない');assert.ok(/☆|★/.test(d.text)||d.buttons.some(b=>/お気に入り/.test(b)),'☆がない');});
spec('I-4','押した回の下にだけ方角図と地図を開き、もう一度押すと閉じる','full','#/iss',async p=>{const rows=p.locator('#issPassList [data-pass]');await rows.first().waitFor({timeout:10000});assert.ok(await rows.count()>=2,'回が2つない');const st=()=>p.evaluate(()=>{const d=document.getElementById('issPassDetail'),prev=d.previousElementSibling;return {hidden:d.hidden||!d.getClientRects().length,under:prev?.dataset?.pass??null,inList:d.parentElement?.id,sky:!!d.querySelector('#issSky'),map:!!d.querySelector('#issCanvas'),open:[...document.querySelectorAll('#issPassList [data-pass]')].filter(e=>e.getAttribute('aria-expanded')==='true').map(e=>e.dataset.pass)};});
 let s=await st();assert.ok(s.hidden,'押す前から開いている');assert.deepEqual(s.open,[]);
 await rows.nth(0).click();await p.waitForTimeout(400);s=await st();assert.ok(!s.hidden,'開かない');assert.equal(s.inList,'issPassList');assert.equal(s.under,'0','押した回の下でない');assert.ok(s.sky&&s.map,'方角図か地図がない');assert.deepEqual(s.open,['0']);
 await rows.nth(1).click();await p.waitForTimeout(400);s=await st();assert.equal(s.under,'1','次の回の下へ移らない');assert.deepEqual(s.open,['1'],'前の回が開いたまま');
 await rows.nth(1).click();await p.waitForTimeout(300);s=await st();assert.ok(s.hidden,'もう一度押しても閉じない');assert.deepEqual(s.open,[]);},{clock:'2026-09-30T00:00:00+09:00',tle:ISS_TLE});
spec('I-3','どこの近くで探すかと書き、標高と☆を出さない','full','#/iss',async p=>{hasText(await text(p,'#issFromLabel'),'どこの近くで探すか');const s=await text(p,'#issFromButton');assert.ok(!s.includes('標高'),'標高が出ている');assert.ok(!/☆|★/.test(s),'☆が出ている');});
spec('I-6','未ログインは案内だけ','guest','#/iss',async p=>{assert.ok(await shown(p,'#issAccess'));assert.ok(!await shown(p,'#issMain'));});
spec('I-6n','権限なしは案内だけ','none','#/iss',async p=>{assert.ok(await shown(p,'#issAccess'));assert.ok(!await shown(p,'#issMain'));});

// ---- 記録
spec('N-1','撮影地点と予定のタブ、地図で探す、編集','full','#/records',async p=>{for(const s of ['#notebookPointsTab','#notebookPlansTab','#notebookEdit'])assert.ok(await shown(p,s),s);hasText(await text(p,'#recordsView'),'地図で場所を探す');});
spec('N-3','まとめて保存は、失敗なら入力を残し、成功なら編集を閉じて一覧へ戻る','full','#/records',async p=>{const row=p.locator(`[data-notebook-place="${FAV.id}"]`);await row.waitFor({timeout:8000});await row.click();await p.waitForTimeout(400);const open=()=>p.locator('#myPlaceSheet').evaluate(d=>d.open),stored=()=>p.evaluate(k=>localStorage.getItem(k),OBS_KEY);
 assert.ok(await open(),'編集が開かない');hasText(await text(p,'#myPlaceRecords'),'東京スカイツリー','東京タワー');assert.ok(await p.locator('#myRecordSave').isDisabled(),'変更なしで保存できる');
 await p.getByRole('button',{name:'東京タワーを対象から外す'}).click();await p.waitForTimeout(200);
 const keeps=async why=>{assert.ok(await open(),why+'で閉じた');const r=await text(p,'#myPlaceRecords');assert.ok(r.includes('東京スカイツリー')&&!r.includes('東京タワー'),why+'で入力が戻った');};
 // 別の画面（別のタブ）で対象が変わっていたら保存しない
 const original=await stored();await p.evaluate(([k,v])=>localStorage.setItem(k,JSON.stringify(JSON.parse(v).filter(o=>o.target.key!=='skytree'))),[OBS_KEY,original]);await p.locator('#myRecordSave').click();await p.waitForTimeout(300);
 await keeps('別の画面の変更');hasText(await text(p,'#myRecordError'),'別の画面で対象が変更されました');await p.evaluate(([k,v])=>localStorage.setItem(k,v),[OBS_KEY,original]);
 // 端末の保存が一杯で失敗する
 await p.evaluate(k=>{const set=Storage.prototype.setItem;window.__specRestore=()=>{Storage.prototype.setItem=set;};Storage.prototype.setItem=function(key,v){if(key===k)throw new DOMException('full','QuotaExceededError');return set.call(this,key,v);};},OBS_KEY);
 const before=await stored();await p.locator('#myRecordSave').click();await p.waitForTimeout(300);
 await keeps('保存の失敗');hasText(await text(p,'#myRecordError'),'入力は残しています');assert.equal(await stored(),before,'失敗なのに書き換わった');
 await p.evaluate(()=>window.__specRestore());await p.locator('#myRecordSave').click();await p.waitForTimeout(400);
 assert.ok(!await open(),'成功で閉じない');assert.ok(await shown(p,'#notebookTabs'),'一覧へ戻らない');assert.ok(await row.isVisible(),'一覧に地点がない');
 const after=JSON.parse(await stored());assert.ok(after.some(o=>o.target.key==='tokyotower'&&o.removed),'外した対象が保存されていない');},{storage:RECORDED});
spec('N-7','未ログインは案内だけ','guest','#/records',async p=>{assert.ok(await shown(p,'#recordsAccess'));assert.ok(!await shown(p,'#notebookTabs'));});
spec('N-7n','権限なしは案内だけ','none','#/records',async p=>{assert.ok(await shown(p,'#recordsAccess'));assert.ok(!await shown(p,'#notebookTabs'));});

// ---- メニューと設定
spec('A-1','メニューは6項目。権限のないものは出さない','full','#/',async p=>{assert.deepEqual((await menuLabels(p)).map(x=>x.split('\n')[0]),['ホーム','予測','探す','記録','月丼','人工衛星']);});
spec('A-1g','未ログインのメニューも権限で隠す','guest','#/',async p=>{const l=(await menuLabels(p)).map(x=>x.split('\n')[0]);hasText(l.join(),'ホーム','予測');for(const w of ['月丼','人工衛星','記録'])assert.ok(!l.includes(w),w+' が出ている');});
spec('A-3','設定はアカウント・ログインと画面。所有者でなければ管理なし','full','#/',async p=>{await p.locator('#authButton').click();await p.waitForTimeout(400);const d=await openDialog(p);assert.ok(d,'開かない');assert.ok(/アカウント/.test(d.text),'アカウントがない');assert.ok(/画面/.test(d.text),'画面がない');assert.ok(!/^管理$/m.test(d.text),'管理が出ている');});
spec('A-4','画面の設定は表示モード3つと起動画面3つ','full','#/',async p=>{await p.locator('#authButton').click();await p.waitForTimeout(250);await p.locator('#settingsScreen').click();await p.waitForTimeout(250);const s=await p.locator('#appSettings').textContent();hasText(s,'自動','ライト','ダーク','ホーム','予測','探す');assert.ok(!/構図/.test(s),'旧の選択肢がある');});
spec('A-6','未ログインは右上がログインで、予測は使える','guest','#/',async p=>{assert.equal((await text(p,'#authButton')).trim(),'ログイン');assert.ok(await shown(p,'#cards'));});

(async()=>{
 const b=await (engine==='webkit'?webkit:chromium).launch(engine==='webkit'?{headless:true}:{channel:'chrome',headless:true}),res=[];
 for(const it of items){
  if(only.size&&!only.has(it.id))continue;
  const u=it.user==='framing-only'?{tools:['tower','framing'],role:'user'}:it.user==='map-only'?{tools:['skymap'],role:'user'}:it.user==='no-multi'?{tools:FULL.filter(t=>t!=='multiscene'),role:'user'}:USERS[it.user];
  const c=await b.newContext({viewport:{width:390,height:844},colorScheme:'dark',locale:'ja-JP',timezoneId:'Asia/Tokyo',permissions:[]});
  if(it.opts.clock)await c.clock.setFixedTime(new Date(it.opts.clock));
  if(u)await c.addInitScript(({u})=>{sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-spec',loginId:'spec',role:u.role,tools:u.tools}));},{u});
  if(it.opts.storage)await c.addInitScript(s=>{for(const [k,v] of Object.entries(s))localStorage.setItem(k,v);},it.opts.storage);
  await c.route('**/*',async r=>{const url=new URL(r.request().url());
   if(url.origin===new URL(base).origin){if(it.opts.blockVenus&&/astronomy/i.test(url.pathname))return r.abort();return r.continue();}
   if(/zekkei-api|localhost:8787/.test(url.href)){const P=url.pathname;
    if(P==='/prediction'){if(it.opts.hold)return;if(it.opts.fail)return r.fulfill({status:502,headers,json:{error:'予測を取得できませんでした'}});return r.fulfill({status:200,headers,json:{...forecast,asOf:Date.now(),bundle:{...forecast.bundle,fetchedAt:Date.now()}}});}
    if(P.startsWith('/prediction'))return r.fulfill({status:503,headers,json:{error:'x'}});
    return r.fulfill({status:200,headers,json:{allowed:!!u&&(u.tools||[]).includes('skymap'),tool:'skymap',loginId:'spec',role:u?.role||'user',tools:u?.tools||[],credentials:[],hasPassword:true,recoveryCodes:10,favorites:[{id:FAV.id,body:JSON.stringify(FAV),rev:1,updated_at:Date.parse('2026-10-01T12:00:00+09:00'),deleted:0}],sightings:[],records:[],rev:1,more:false}});}
   if(it.opts.tle&&url.hostname==='celestrak.org')return r.fulfill({status:200,headers,contentType:'text/plain',body:it.opts.tle});
   return r.abort();});
  const p=await c.newPage();let outcome;
  try{await p.goto(base+(it.route.startsWith('trial/')?it.route.replace('trial/','trial/index.html'):'index.html'+it.route));await p.waitForFunction(ready,null,{timeout:15000});await p.waitForTimeout(1400);const r=await it.fn(p);outcome=typeof r==='string'&&r.startsWith('skip')?{id:it.id,status:'SKIP',why:r.slice(5)}:{id:it.id,status:'PASS'};}
  catch(e){outcome={id:it.id,status:'FAIL',why:e.message.split('\n')[0].slice(0,200)};}
  res.push({...outcome,name:it.name});console.log(outcome.status,it.id,it.name,outcome.why||'');
  await c.close();
 }
 await b.close();
 if(process.env.SPEC_OUT)fs.writeFileSync(process.env.SPEC_OUT,JSON.stringify(res,null,1));
 const n=s=>res.filter(x=>x.status===s).length;console.log(`${n('FAIL')?'FAIL':'PASS'} spec items pass=${n('PASS')} fail=${n('FAIL')} skip=${n('SKIP')}`);
 process.exit(n('FAIL')?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
