// 起動画面の選択肢は「探す」にまとめる。以前の「構図」「地図」を保存した端末も「探す」で開く
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('./src/startup/preferences.js',import.meta.url),'utf8');
test('起動画面の選択肢',()=>{
 assert.match(src,/choices=\[\['home','ホーム'\],\['forecast','予測'\],\['explore','探す'\]\]/);
 assert.match(src,/v==='framing'\|\|v==='map'\)return 'explore'/);
 assert.match(src,/selected==='explore'\?\(screenAllowed\('skymap'\)\?'#\/explore':'#\/aim\/tower'\)/);
});
