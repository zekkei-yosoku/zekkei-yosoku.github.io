import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');const grab=name=>{const a=html.indexOf('function '+name+'(');return html.slice(a,html.indexOf('\n}',a)+2)};
test('3択は自動条件へ一意に対応し手入力はUIへ出さない',()=>{
 const els={aimAirMode:{value:''}};
 const settings={mode:'auto',temperatureC:10,pressureHPa:1010},calls=[],c=vm.createContext({aimAirSettings:settings,$:id=>els[id],aimAirChange:()=>{calls.push({...settings});c.aimAirSync()}});vm.runInContext(grab('aimAirSync')+'\n'+grab('aimAirChoose'),c);
 for(const mode of ['standard','auto','none']){c.aimAirChoose(mode);assert.equal(settings.mode,mode);assert.equal(els.aimAirMode.value,mode);}
 const count=calls.length;c.aimAirChoose('manual');c.aimAirChoose('invalid');assert.equal(calls.length,count);assert.equal(settings.mode,'none');
 const src=html.slice(html.indexOf('<div id="aimAir"'),html.indexOf('</section><section id="previewPlaces"'));
 assert.equal((src.match(/<option value=/g)||[]).length,3);assert.ok(src.includes('<select id="aimAirMode"'));assert.ok(!src.includes('<input'));assert.ok(html.includes('if(!["auto","standard","none"].includes(aimAirSettings.mode))aimAirSettings.mode="auto"')); assert.ok(html.includes('host.querySelector("[data-look-frame-times]").after($("aimAir"))'));
});
