import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const fragment=html.slice(html.indexOf('function renderMastheadCharacter('),html.indexOf('function renderForecastTabs('));
test('共通ロゴ横の1体を画面に応じて切替え、対象外の画面では隠す',()=>{
 const image={hidden:false,src:'',writes:0,getAttribute(){return this.src;},setAttribute(k,v){this.src=v;this.writes++;}};
 const render=new Function('$',fragment+';return renderMastheadCharacter;')(()=>image);
 for(const [view,pose] of [['list','forecast'],['aim','framing'],['skymap','map'],['records','records'],['answers','forecast'],['detail','forecast']]){render(view);assert.equal(image.hidden,false);assert.equal(image.src,`astronotes-header-${pose}-v1.png`);}
 const writes=image.writes;render('detail');assert.equal(image.writes,writes);render('iss');assert.equal(image.hidden,true);render('list');assert.equal(image.hidden,false);
});
test('ロゴ隣の装飾だけを持ち、画面見出しと予測タブにはキャラクターを置かない',()=>{
 assert.equal((html.match(/id="mastheadCharacter"/g)||[]).length,1);
 assert.match(html, /id="mastheadAstroMark"[^>]*><img id="mastheadCharacter"[^>]*alt="" aria-hidden="true"/);
 for(const id of ['aimFramingTitle','skyMapTitle','forecastTab'])assert.doesNotMatch(html,new RegExp(`id="${id}"[^>]*>\\s*<img`));
 assert.match(html,/id="recordsHeading"><h2>記録<\/h2>/);
});
