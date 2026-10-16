import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),terrain=require('./trial/sorami-terrain.js');
const source=fs.readFileSync(new URL('./trial/sorami-myplaces.js',import.meta.url),'utf8');
function fixture(){const values=new Map(),auth={loginId:'first'},favorites=[{id:'p',name:'撮影地',latitude:35,longitude:139,elevation:50,eyeHeightAGL:4}];const api=new Function('store','auth','favorites','SoramiTerrain',source.slice(source.indexOf('const RESULTS'),source.indexOf('// 目標は構図'))+';return {clean,load,statusOf,placesFor};')({get:(k,d)=>values.get(k)??d,set:(k,v)=>values.set(k,v)},auth,favorites,terrain);return {api,values,auth,favorites};}
const raw={id:'one',placeId:'p',target:{key:'tower',name:'塔',latitude:35.1,longitude:139.1},result:'seen',date:'2026-10-16',observer:{latitude:35,longitude:139,elevation:50,eyeHeightAGL:4},createdAt:1,updatedAt:1};
test('記録時の観測座標と高さを保持し、不正な識別子を保存対象にしない',()=>{const {api}=fixture(),r=api.clean(raw);assert.deepEqual(r.observer,raw.observer);assert.equal(api.clean({...raw,target:{...raw.target,name:'x'.repeat(201)}}),null);assert.equal(api.clean({...raw,result:'unknown'}),null);});
test('撮影場所の移動・立つ高さの変更後は古い実績を候補へ流用しない',()=>{const {api,favorites}=fixture(),r=api.clean(raw);assert.equal(api.statusOf('p','tower',[r]).id,'one');favorites[0].latitude=35.01;assert.equal(api.statusOf('p','tower',[r]),null);favorites[0].latitude=35;favorites[0].eyeHeightAGL=20;assert.equal(api.statusOf('p','tower',[r]),null);assert.equal(r.observer.eyeHeightAGL,4);});
test('最新が見えなかった組を候補にしない。アカウントの保存先を混ぜない',()=>{const {api,values,auth}=fixture();values.set('sorami.observations.v1:first',[raw,{...raw,id:'two',result:'hidden',updatedAt:2}]);assert.equal(api.load().length,2);assert.equal(api.placesFor('tower').length,0);auth.loginId='second';assert.deepEqual(api.load(),[]);});
