import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');const grab=name=>{const a=html.indexOf('function '+name+'(');return html.slice(a,html.indexOf('\n}',a)+2)};
test('3択は自動条件へ一意に対応し手入力はUIへ出さない',()=>{
 const els={aimAirMode:{value:''}};
 const settings={mode:'auto',temperatureC:10,pressureHPa:1010},calls=[],c=vm.createContext({aimAirSettings:settings,$:id=>els[id],aimAirChange:()=>{calls.push({...settings});c.aimAirSync()}});vm.runInContext(grab('aimAirSync')+'\n'+grab('aimAirChoose'),c);
 for(const mode of ['standard','auto','none']){c.aimAirChoose(mode);assert.equal(settings.mode,mode);assert.equal(els.aimAirMode.value,mode);}
 const count=calls.length;c.aimAirChoose('manual');c.aimAirChoose('invalid');assert.equal(calls.length,count);assert.equal(settings.mode,'none');
 const src=html.slice(html.indexOf('<div id="aimAir"'),html.indexOf('</section><section id="previewPlaces"'));
 assert.equal((src.match(/<option value=/g)||[]).length,3);assert.ok(src.includes('<select id="aimAirMode"'));assert.ok(!src.includes('<input'));assert.ok(html.includes('if(!["auto","standard","none"].includes(aimAirSettings.mode))aimAirSettings.mode="auto"')); assert.ok(html.includes('host.querySelector(".aim-time-controls").append($("aimAir"))'));
});

test('大気差は選択モードと取得結果を区別して表示する',()=>{
 const els={aimAirSummary:{textContent:''},aimAirStatus:{textContent:''}},settings={mode:'standard'};let air={temperatureC:10,pressureHPa:1010,source:'標準条件'};
 const c=vm.createContext({aimAirSettings:settings,$:id=>els[id],SoramiAtmosphere:{at:()=>air},S:{JstCal:{hhmm:()=> '22:21'}}});vm.runInContext(grab('aimAirDescribe'),c);
 c.aimAirDescribe(0,{});assert.equal(els.aimAirSummary.textContent,'標準値を使用');
 settings.mode='auto';air={temperatureC:17.5,pressureHPa:1012,source:'気象予報'};c.aimAirDescribe(0,{});assert.equal(els.aimAirSummary.textContent,'17.5℃ / 1012hPa');
 air={temperatureC:10,pressureHPa:1000,source:'標準大気',fallback:true};c.aimAirDescribe(0,{});assert.equal(els.aimAirSummary.textContent,'予報なし・標準値を使用');
 settings.mode='none';air={none:true};c.aimAirDescribe(0,{});assert.equal(els.aimAirSummary.textContent,'補正なし');
});
