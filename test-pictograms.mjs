import {sourceHtml} from './tools/test-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),I=require('./astronotes-icons.js'),S=require('./astronotes-core.js'),M=require('./astronotes-moon.js');
test('全予測現象に絵文字を含まない独自SVGがあり、未知IDは描画しない',()=>{
 for(const id of Object.keys(S.PHENOMENA)){const svg=I.icon(id);assert.match(svg,/<svg /);assert.match(svg,/aria-hidden="true"/);assert.doesNotMatch(svg,/\p{Extended_Pictographic}/u);}
 assert.equal(I.icon('<img src=x onerror=alert(1)>'),'');assert.equal(I.icon('toString'),'');
});
test('月のSVGの投影面積が輝面比に一致し、満ち欠けで左右が反転する',()=>{
 for(const waxing of [true,false])for(const f of [.001,.15,.499,.5,.501,.8,.999]){
  const svg=I.moon({illuminatedFraction:f,waxing});
  if(f===.5)assert.match(svg,/12 22L12 2Z/);
  else{const match=svg.match(/12 22A([\d.]+) 10 0 0 ([01]) 12 2Z/);assert.ok(match);const projected=.5+(+match[2]===0?-1:1)*(+match[1])/20;assert.ok(Math.abs(projected-f)<1e-5);}
  assert.match(svg,new RegExp('aria-label="'+(waxing?'満ちていく月':'欠けていく月')+'、輝面'+Math.round(f*100)+'%"'));assert.equal(svg.includes('scale(-1 1)'),!waxing);assert.doesNotMatch(svg,/NaN|Infinity|id="/);
 }
});
test('新月と満月を区別し、不明・不正な輝面比は新月を捏造しない',()=>{
 const fresh=I.moon({illuminatedFraction:0,waxing:true}),full=I.moon({illuminatedFraction:1,waxing:false});
 assert.doesNotMatch(fresh,/fill="currentColor" stroke="none"/);assert.match(full,/<circle[^>]*fill="currentColor" stroke="none"/);
 for(const illuminatedFraction of [undefined,null,NaN,Infinity,-.1,1.1,'0.5','<script>'])assert.equal(I.moon({illuminatedFraction,waxing:true}),I.icon('moon'));
 assert.equal(I.moon({illuminatedFraction:.5}),I.icon('moon'));
});
test('日時・観測座標から月相SVGを生成し、テキスト用出力を混ぜない',()=>{
 const html=sourceHtml();
 const src=html.slice(html.indexOf('function iconFor('),html.indexOf('/// 月を撮る時刻',html.indexOf('function iconFor(')));
 let fail=false;const calls=[],place={latitude:35,longitude:139};
 const {iconFor,moonGlyphAt}=new Function('S','AstroNotesMoon','AstroNotesIcons','AstroNotesAstro','place','AstroNotesCalendarMoon',src+';return {iconFor,moonGlyphAt};')(S,M,I,{moon:(at,obs)=>{calls.push([at,obs]);if(fail)throw Error('missing');return {illuminatedFraction:.15,waxing:true};}},place,{markup:()=>'<img data-moon-state="fixture">'});
 assert.match(iconFor('moon',123),/data-pictogram="moon-phase"/);assert.equal(calls[0][0],123);assert.deepEqual(calls[0][1],{...place,elevation:0});
 assert.match(moonGlyphAt(123),/<img data-moon-state=/);assert.equal(iconFor('moon',123,{text:true}),M.phaseOf({illuminatedFraction:.15,waxing:true}).name);assert.match(iconFor('sunset'),/data-pictogram="sunset"/);
 fail=true;assert.equal(iconFor('moon',123),I.icon('moon'));assert.equal(iconFor('unknown'),'');
});
