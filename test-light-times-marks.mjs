import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
// 光の時間（2026-10-20 ユーザー「予報ならざっくり日の出日の入の時間を残すだけ」「夕焼けには日の入、朝焼けには日の出だけ」
// 「ホームの太陽のところにトワイライトタイムとかのバーを置くべき」）
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
test('予報の詳細は日の出・日の入の時刻だけ（夕焼けは日の入、朝焼けは日の出）',()=>{
 const src=html.slice(html.indexOf('function renderLightTimes('),html.indexOf('/// 選択中の現象の詳細'));
 const S={Sun:{lightWindows:()=>({sunrise:Date.parse('2026-10-21T05:52:00+09:00'),sunset:Date.parse('2026-10-21T16:58:00+09:00')})},JstCal:{hhmmRounded:x=>new Date(x+9*3600e3).toISOString().slice(11,16)}};
 const render=new Function('S','place','SoramiIcons',src+';return renderLightTimes;')(S,{latitude:35,longitude:139},{icon:k=>`<svg data-k="${k}"></svg>`});
 const sunset=render(0,0,'sunset'),sunrise=render(0,0,'sunrise'),other=render(0,0,'starrySky');
 assert.match(sunset,/日の入[\s\S]*16:58/);assert.doesNotMatch(sunset,/日の出/);
 assert.match(sunrise,/日の出[\s\S]*05:52/);assert.doesNotMatch(sunrise,/日の入/);
 assert.equal(other,'','朝焼け・夕焼け以外の見出しには出さない');
 for(const h of [sunset,sunrise])assert.doesNotMatch(h,/lt-band|ゴールデン|ブルー|月の|<svg/,'見出しの絵と重ねない');
});
test('ホームの光の時間は空をたどるの背景に一本化し、ゴールデン／ブルーアワーの2行をグラフのすぐ下に',()=>{
 const home=readFileSync(new URL('./sorami-almanac-dashboard.js',import.meta.url),'utf8');
 assert.doesNotMatch(home,/panel\('光の時間'/,'光の時間の帯の欄は出さない');
 assert.match(home,/function twilightLines\(day,d,astro\)/);
 assert.match(home,/const SKY_KEYS=\[\[-18,/,'太陽の高さで色をなめらかに変える');
 assert.match(home,/'stop-color':skyColor\(h\)/,'空をたどるの背景は空の色');
});
