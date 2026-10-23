import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('日時バーの寸法は共通CSSだけで管理し全消費先に配信する',()=>{
 const html=read('index.html'),css=read('astronotes-datetime-ui.css');
 assert.match(html,/<link[^>]+href="astronotes-datetime-ui\.css\?v=\d+"/);
 const inline=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
 for(const source of [inline,read('astronotes-almanac-home.css')])assert.doesNotMatch(source,/\.tool-datetime|\.aim-date|#(?:almanacDateRow|almanacCalendarOpen|aimCalendarOpen)(?![A-Za-z])/,'画面別寸法指定を戻さない');
 assert.match(css,/grid-template-columns:44px max-content 44px 56px 40px 44px 40px/);
 for(const asset of ['astronotes-datetime-ui.css','astronotes-datetime-ui.js','astronotes-home-time.js'])assert.equal(read('trial/'+asset),read(asset));
});
