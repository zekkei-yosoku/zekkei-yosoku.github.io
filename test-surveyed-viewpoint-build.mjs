import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const header='地点ID,地点名,緯度,経度,標高_m,手動標高_m,目線_m,目線下限_m,目線上限_m,位置指定,形状,対象,天体,重ねる位置,住所,メモ';
const row=(id,name,target='富士山',manual='')=>[id,name,35,139,10,manual,1.5,'','','点','',target,'月','先端','',''].join(',');
const entry=(id,placeKind,basis='official-description')=>({id,placeKind,position:[35,139],
 categoryEvidence:{basis,detail:'公式資料に施設展望階を明記。',sourceUrls:['https://example.org/facility'],checkedAt:'2026-11-23'}});
function build(rows,categories=[]){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astronotes-surveyed-build-'));
 try{
  const input=path.join(dir,'in.csv'),output=path.join(dir,'out.json'),sidecar=path.join(dir,'categories.json');
  fs.writeFileSync(input,[header,...rows].join('\n')+'\n');
  fs.writeFileSync(sidecar,JSON.stringify({places:categories}));
  const run=spawnSync(process.execPath,[path.join(root,'tools/build-surveyed-viewpoints.mjs'),input,output,sidecar],{encoding:'utf8'});
  return {...run,data:run.status===0?JSON.parse(fs.readFileSync(output,'utf8')):null};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}

test('未分類は公園・展望台という名前や点形状から昇格せず、対象の統合と高さを保持する',()=>{
 const r=build([row('a','展望公園'),row('a','展望公園','東京スカイツリー'),row('b','屋上展望台','東京タワー','25')]);
 assert.equal(r.status,0,r.stderr);
 assert.deepEqual(r.data.places.map(p=>[p.id,p.placeKind,p.categoryEvidence.basis,p.targets,p.groundM,p.eyeM]),[
  ['a','unknown','unclassified',['fuji','skytree'],10,1.5],['b','unknown','unclassified',['tokyotower'],25,1.5]]);
 assert.equal(r.data.places[1].groundManual,true);
 assert.equal(r.data.places[0].shape,'point');
});

test('分類はIDで結合し、道路と不明を展望地点に変換せず、根拠を保持する',()=>{
 const categories=[entry('a','viewpoint'),entry('b','sidewalk','research-kind'),entry('c','unknown','unclassified'),entry('d','park','mapped-category')];
 const r=build(['d','c','b','a'].map(id=>row(id,'同じ名前')),categories);
 assert.equal(r.status,0,r.stderr);
 for(const p of r.data.places){const c=categories.find(c=>c.id===p.id);assert.equal(p.placeKind,c.placeKind);assert.deepEqual(p.categoryEvidence,c.categoryEvidence);}
 assert.deepEqual(r.data.places.map(p=>p.id),['d','c','b','a']);
});

test('同じIDの代表座標が変わった場合に古い施設根拠を引き継がない',()=>{
 const c=entry('a','park');c.position[0]+=0.000001;
 const r=build([row('a','変更された公園')],[c]);
 assert.notEqual(r.status,0);assert.match(r.stderr,/分類の代表座標が変わりました/);
});

test('分類の重複・無根拠昇格・不正な出典やカテゴリを拒否する',()=>{
 const valid=entry('a','park');
 const invalid=[
  [valid,valid], [{...valid,placeKind:'peak'}],
  [{...valid,categoryEvidence:{...valid.categoryEvidence,basis:'unclassified'}}],
  [{...valid,categoryEvidence:{...valid.categoryEvidence,sourceUrls:[]}}],
  [{...valid,categoryEvidence:{...valid.categoryEvidence,sourceUrls:['file:///private/source']}}],
  [{...valid,categoryEvidence:{...valid.categoryEvidence,detail:''}}],
 ];
 for(const cs of invalid){const r=build([row('a','公園')],cs);assert.notEqual(r.status,0,JSON.stringify(cs));assert.match(r.stderr,/分類の/);}
});

test('公式に失効した対象だけ除外し、同じ地点の別対象・高さ・履歴の地点を残す',()=>{
 const c=entry('a','park');c.targetExclusions=[{targetId:'tokyotower',reason:'運営公式が眺望喪失を明記。',sourceUrls:['https://example.org/park'],checkedAt:'2026-11-23'}];
 const r=build([row('a','公園','東京タワー'),row('a','公園','富士山')],[c]);
 assert.equal(r.status,0,r.stderr);assert.deepEqual(r.data.places[0].targets,['fuji']);
 assert.equal(r.data.places[0].groundM,10);assert.equal(r.data.places[0].eyeM,1.5);
 const only=build([row('a','公園','東京タワー')],[c]);
 assert.equal(only.status,0,only.stderr);assert.equal(only.data.places.length,1);assert.deepEqual(only.data.places[0].targets,[]);
 for(const x of [{...c.targetExclusions[0],sourceUrls:[]},{...c.targetExclusions[0],targetId:'all'},{...c.targetExclusions[0],reason:''}]){
  const bad=build([row('a','公園')],[{...c,targetExclusions:[x]}]);assert.notEqual(bad.status,0);assert.match(bad.stderr,/対象除外の/);
 }
});

test('同梱159地点はID・座標に結び付いた分類根拠を持ち、交差点・通常橋を標準へ昇格しない',()=>{
 const data=JSON.parse(fs.readFileSync(path.join(root,'data/candidate-surveyed-viewpoints.json'),'utf8'));
 const source=JSON.parse(fs.readFileSync(path.join(root,'data/surveyed-viewpoint-categories.json'),'utf8'));
 const byId=new Map(source.places.map(p=>[p.id,p]));
 assert.equal(data.places.length,159);assert.equal(byId.size,159);
 for(const p of data.places){const c=byId.get(p.id);assert.ok(c,p.id);assert.deepEqual(c.position,[p.latitude,p.longitude]);
  assert.equal(p.placeKind,c.placeKind);assert.deepEqual(p.categoryEvidence,c.categoryEvidence);}
 const kind=n=>data.places.find(p=>p.id.endsWith('-'+String(n).padStart(3,'0'))).placeKind;
 assert.equal(kind(75),'sidewalk');assert.equal(kind(141),'sidewalk');
 assert.equal(kind(139),'viewpoint');assert.equal(kind(142),'plaza');assert.equal(kind(151),'park');
 assert.equal(kind(105),'unknown');
 const retired=data.places.find(p=>p.id.endsWith('-072'));
 assert.deepEqual(retired.targets,[]);assert.equal(byId.get(retired.id).targetExclusions[0].targetId,'tokyotower');
});
