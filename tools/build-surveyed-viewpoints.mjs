// 調査済みの撮影地点（対象が見えると調べた場所と立つ高さ）を、取り込み用CSVから探す（新しい撮影地点）の同梱データへ作る。
// 2026-11-14 ユーザー「調査済み159地点をアプリに組み込み、新しい撮影地点にも出してもいい」。
// 使い方: node tools/build-surveyed-viewpoints.mjs <取り込み用CSV> [出力] [ID別分類JSON]
// CSVは記録→撮影地点のインポートと同じ16列（1地点×対象1行）。地点ごとに対象をまとめ、線・範囲の地点は代表座標で持つ。
// 立つ高さ: 手動標高があればそれ、なければ標高を足元の高さにし、目線をその上の高さとして持つ（展望室は公称の眺望高度）。
import fs from 'node:fs';import path from 'node:path';
const dataDir=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../data');
const [input,output=path.join(dataDir,'candidate-surveyed-viewpoints.json'),categoryFile=path.join(dataDir,'surveyed-viewpoint-categories.json')]=process.argv.slice(2);
if(!input){console.error('usage: node tools/build-surveyed-viewpoints.mjs <csv> [out] [categories]');process.exit(2);}
// CSV's 16 columns do not encode a facility category. Keep the reviewed source
// and its evidence separate; neither a name nor a point/line/area proves a kind.
const kinds=new Set(['viewpoint','park','plaza','sidewalk','riverbank','road','unknown']);
const bases=new Set(['research-kind','research-description','mapped-category','official-description','unclassified']),categories=new Map();
const TARGETS={'東京スカイツリー':'skytree','東京タワー':'tokyotower','富士山':'fuji'},SHAPES={'点':'point','線':'line','範囲':'area'};
for(const c of JSON.parse(fs.readFileSync(categoryFile,'utf8')).places||[]){
 const e=c.categoryEvidence;
 if(!c.id||categories.has(c.id)||!kinds.has(c.placeKind)||!e||!bases.has(e.basis)||typeof e.detail!=='string'||!e.detail.trim())throw Error('分類の形式が不正: '+c.id);
 if(!Array.isArray(c.position)||c.position.length!==2||!c.position.every(Number.isFinite)||!Array.isArray(e.sourceUrls))throw Error('分類の根拠が不正: '+c.id);
 if(e.sourceUrls.some(u=>typeof u!=='string'||!/^https?:\/\//.test(u)))throw Error('分類の出典URLが不正: '+c.id);
 if(c.placeKind!=='unknown'&&(e.basis==='unclassified'||!e.sourceUrls.length))throw Error('分類の根拠がありません: '+c.id);
 const excluded=new Set();
 if(c.targetExclusions!==undefined&&!Array.isArray(c.targetExclusions))throw Error('対象除外の形式が不正: '+c.id);
 for(const x of c.targetExclusions||[]){
  if(!Object.values(TARGETS).includes(x.targetId)||excluded.has(x.targetId)||typeof x.reason!=='string'||!x.reason.trim())throw Error('対象除外の根拠が不正: '+c.id);
  if(!Array.isArray(x.sourceUrls)||!x.sourceUrls.length||x.sourceUrls.some(u=>typeof u!=='string'||!/^https?:\/\//.test(u)))throw Error('対象除外の出典URLが不正: '+c.id);
  excluded.add(x.targetId);
 }
 categories.set(c.id,c);
}
function parse(text){const rows=[];let row=[],cell='',quoted=false;text=text.replace(/^﻿/,'');
 for(let i=0;i<text.length;i++){const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;}
  else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell='';}else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell='';}else if(c!=='\r')cell+=c;}
 if(cell||row.length){row.push(cell);rows.push(row);}return rows;}
const rows=parse(fs.readFileSync(input,'utf8')),head=rows.shift(),col=name=>{const i=head.indexOf(name);if(i<0)throw Error('列がありません: '+name);return i;};
const num=v=>v===''?null:Number(v),places=new Map();
for(const r of rows){if(r.length<2)continue;
 const id=r[col('地点ID')],target=TARGETS[r[col('対象')]],manual=num(r[col('手動標高_m')]),ground=manual??num(r[col('標高_m')]),eye=num(r[col('目線_m')]);
 const latitude=num(r[col('緯度')]),longitude=num(r[col('経度')]),shape=SHAPES[r[col('位置指定')]];
 if(!id||!target||!shape||![latitude,longitude,ground,eye].every(Number.isFinite)||eye<0)throw Error('読めない行: '+r.slice(0,4).join(','));
 const place={id,name:r[col('地点名')],latitude,longitude,groundM:ground,...(manual!==null?{groundManual:true}:{}),eyeM:eye,shape,targets:[target]},previous=places.get(id);
 if(!previous){places.set(id,place);continue;}
 for(const k of ['name','latitude','longitude','groundM','eyeM','shape'])if(previous[k]!==place[k])throw Error('同じ地点IDで値が違います: '+id+' '+k);
 if(!previous.targets.includes(target))previous.targets.push(target);
}
for(const p of places.values()){
 const c=categories.get(p.id);
 if(c&&(c.position[0]!==p.latitude||c.position[1]!==p.longitude))throw Error('分類の代表座標が変わりました: '+p.id);
 // A later explicit source can invalidate one target without deleting the
 // historic place or changing another target, its coordinates or its height.
 const excluded=new Set((c?.targetExclusions||[]).map(x=>x.targetId));
 p.targets=p.targets.filter(id=>!excluded.has(id));
 p.placeKind=c?.placeKind||'unknown';
 p.categoryEvidence=c?.categoryEvidence||{basis:'unclassified',detail:'IDに対応する分類根拠が未登録。名称・形状から推定しない。',sourceUrls:[]};
}
const basis='対象が見えると調べた場所と立つ高さ（公的資料・運営施設の案内・実写の照合）。天体が重なった実績ではない。座標は代表点で、現地で調整する。';
const out={version:2,builtOn:new Date().toISOString().slice(0,10),basis,places:[...places.values()]};
fs.writeFileSync(output,JSON.stringify(out)+'\n');
const count=t=>out.places.filter(p=>p.targets.includes(t)).length;
const shaped=s=>out.places.filter(p=>p.shape===s).length;
console.log(`${out.places.length}地点 → ${output}（富士山${count('fuji')}・スカイツリー${count('skytree')}・東京タワー${count('tokyotower')}、`
 +`点${shaped('point')}・線${shaped('line')}・範囲${shaped('area')}）`);
