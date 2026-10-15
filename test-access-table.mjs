// 画面ごとに要る許可（認可表 sorami-access.js）と、メニュー・画面・APIの名前が食い違わないこと（2026-10-15 総点検M04）。
// 以前は「構図＝diamond・pearl・tower のどれか」が別々の場所に書かれ、直URLの月丼・ISS・記録だけ判定が抜けていた（A01）。
import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const access=require('./sorami-access.js');
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const api=readFileSync(new URL('../api/src/index.js',import.meta.url),'utf8');

// 名前と並びはAPIの TOOLS が正本
const apiTools=JSON.parse(api.match(/const TOOLS = (\[[^\]]*\]);/)[1]);
assert.deepEqual([...access.TOOLS],apiTools,'認可表の道具名がAPIの TOOLS と同じ');
for(const [screen,rule] of Object.entries(access.SCREENS))for(const tool of rule.tools)assert.ok(apiTools.includes(tool),`${screen} の ${tool} はAPIにある`);

// メニューの入口は、行き先の画面と同じ許可で出す
const ROUTE={'#/aim':'framing','#/skymap':'skymap','#/plane':'plane','#/iss':'iss','#/records':'records'};
const seen=new Set();
for(const [,tool,ids] of html.matchAll(/<button[^>]*data-tool="([^"]+)"[^>]*data-id="([^"]+)"/g)){
 const screen=Object.entries(ROUTE).find(([prefix])=>tool===prefix||tool.startsWith(prefix+'/'))?.[1];
 assert.ok(screen,`メニュー ${tool} の画面が認可表にある`);
 assert.deepEqual(ids.split(' '),[...access.SCREENS[screen].tools],`メニュー ${tool} の data-id が認可表と同じ`);
 seen.add(screen);
}
assert.deepEqual([...seen].sort(),Object.keys(access.SCREENS).sort(),'認可表のどの画面にもメニューの入口がある');

// 画面単位の判定は認可表を通す。同じ組合せを別の場所へ書き写さない
for(const copy of ['toolAllowed("diamond") || toolAllowed("pearl") || toolAllowed("tower")',"['diamond','pearl','tower'].some(toolAllowed)",'RESTRICTED_TOOL_LABELS'])
 assert.ok(!html.includes(copy),`認可表の書き写しが残っていない: ${copy}`);
for(const screen of ['plane','iss','records'])assert.ok(html.includes(`id="${screen}Access"`)&&html.includes(`id="${screen}AccessMessage"`),`${screen} に許可が無いときの案内がある`);
assert.match(html,/<script src="sorami-access\.js\?v=\d+"><\/script>\s*\n(?:<script src="[^"]+"><\/script>\s*\n)*<script>/,'認可表は本体の前に読む');

// 判定そのもの
assert.equal(access.canOpen(['pearl'],'framing'),true);
assert.equal(access.canOpen(['skymap'],'framing'),false);
assert.equal(access.canOpen([],'records'),false);
assert.equal(access.canOpen(undefined,'plane'),false);
assert.throws(()=>access.canOpen(['plane'],'planes'),/Unknown screen/);
assert.ok(Object.isFrozen(access.SCREENS)&&Object.isFrozen(access.SCREENS.framing.tools),'表は書き換えられない');
console.log('ACCESS TABLE OK: API names, menu entries, no copied rules, guards and canOpen');
