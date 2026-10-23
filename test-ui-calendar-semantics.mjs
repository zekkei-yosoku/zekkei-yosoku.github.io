import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const S=createRequire(import.meta.url)('./astronotes-core.js');
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function renderSkeleton(now)'),html.indexOf('// 一覧と詳細で、点数・棒・日付・信頼度'));
const render=new Function('S','sortFace','iconFor','esc',source+';return renderSkeleton;')(S,()=>'',()=>'',s=>s);
for(const [day,weekday,weekend] of [['2026-10-16','金',''],['2026-10-17','土','sat'],['2026-10-18','日','sun']])test('今日と曜日を両方保持する: '+day,()=>{
 const value=render(Date.parse(day+'T12:00:00+09:00'));
 assert.equal((value.match(/aria-current="date"/g)||[]).length,1);
 const head=/<div class="dhead ([^"]*)" aria-current="date"[^>]*><span class="d">([^<]*)<\/span><span>([^<]*)<\/span>/.exec(value);
 assert(head);assert(head[1].split(' ').includes('today'));assert.equal(head[3],weekday);
 if(weekend)assert(head[1].split(' ').includes(weekend),'今日が土日でも曜日状態を失わない');
 const rule=/\.dhead\.today \.d \{([^}]*)\}/.exec(html)[1];
 assert(!rule.includes('--accent'),'今日を操作色に結び付けない');
 assert(rule.includes('box-shadow'),'今日には色以外の囲みがある');
 // 2026-10-20 ユーザー「日付に枠がついてるから今日の表記もいらない」：見た目は枠だけ、今日は読み上げ用
 assert.match(value,/<span class="sr-only">今日<\/span><\/div>/,'今日は読み上げで伝える');assert.doesNotMatch(html,/\.dhead\.today::before|span:last-child::after \{ content: " 今日"/);
});
