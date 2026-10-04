import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const h=readFileSync(new URL('./index.html',import.meta.url),'utf8'),a=h.indexOf('function aimLineAtTime('),c=vm.createContext({});vm.runInContext(h.slice(a,h.indexOf('\n}',a)+2),c);
const pts=[{at:100,latitude:10,longitude:20},{at:200,latitude:20,longitude:40},{at:300,latitude:30,longitude:60}];
test('時刻補間は昇順・降順と端点で連続し区間外を表示しない',()=>{for(const p of [pts,[...pts].reverse()]){const q=c.aimLineAtTime(p,150);assert.equal(q.length,1);assert.equal(q[0].latitude,15);assert.equal(q[0].longitude,30);assert.equal(c.aimLineAtTime(p,200).length,1);assert.equal(c.aimLineAtTime(p,50).length,0);assert.equal(c.aimLineAtTime(p,350).length,0);}});
test('時間が折り返す場合は複数解、無効値は表示しない',()=>{const p=[...pts.slice(0,2),{...pts[2],at:100}];assert.equal(c.aimLineAtTime(p,150).length,2);assert.equal(c.aimLineAtTime(pts,NaN).length,0);assert.equal(c.aimLineAtTime([],100).length,0);});
