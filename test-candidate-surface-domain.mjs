import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{surfaceDomainKey:key}=require('./src/features/candidates/composition.js');
const seed={sourceId:'osm/way/1',surfaceId:'osm/way/1',polygonId:'way/1',latitude:35,longitude:139,groundM:10,surfaceAglM:0,eyeM:1.5,
 surfaceGeometry:{lines:[[[139,35],[139.01,35.01]]],polygons:[]}};

test('surface scheduling shares the exact mapped domain across samples and varying terrain',()=>{
 assert.equal(key(seed),key({...seed,latitude:35.005,longitude:139.005,groundM:150,elevation:150,surfaceElevationM:150,region:'other'}));
 assert.equal(key(seed),key({...seed,surfaceGeometry:structuredClone(seed.surfaceGeometry)}));
 assert.equal(key(seed),key({...seed,eyeM:undefined,eyeHeightAGL:1.5}));
});
test('distinct mapped source, geometry, floor and eye height retain separate turns',()=>{
 for(const patch of [{sourceId:'osm/way/2'},{polygonId:'way/2'},{surfaceAglM:3},{eyeM:3},
  {surfaceGeometry:{lines:[[[139,35],[139.011,35.01]]],polygons:[]}},
  {surfaceGeometry:{lines:[],polygons:[[[[139,35],[139.01,35],[139.01,35.01],[139,35]]]]}}])assert.notEqual(key(seed),key({...seed,...patch}));
});
test('absolute floors ignore changing ground but retain the actual floor and basis',()=>{
 const p={...seed,heightBasis:'constant-absolute-floor',standingElevationM:80};
 assert.equal(key(p),key({...p,groundM:70,elevation:80,surfaceAglM:10}));
 assert.notEqual(key(p),key({...p,standingElevationM:81}));
 assert.notEqual(key(p),key({...seed,surfaceAglM:80}));
 assert.equal(key(p),key({...p,heightBasis:undefined,sourceEvidence:{heightBasis:'constant-absolute-floor'}}));
});
test('unknown domains, invalid coordinates and unknown floors stay ungrouped',()=>{
 for(const p of [null,{}, {...seed,surfaceGeometry:null},{...seed,surfaceGeometry:{lines:[],polygons:[]}},
  {...seed,surfaceAglM:null,surfaceHeightM:null},{...seed,eyeM:NaN},{...seed,eyeM:-1},
  {...seed,sourceId:null,surfaceId:null,polygonId:null},
  {...seed,surfaceGeometry:{lines:[[[139,35],[NaN,35]]]}},
  {...seed,surfaceGeometry:{polygons:[[]]}},
  {...seed,heightBasis:'constant-absolute-floor',standingElevationM:null,surfaceElevationM:null}])assert.equal(key(p),null);
});
test('the key reads current values without mutation or a stale identity cache',()=>{
 const p=structuredClone(seed),before=structuredClone(p),first=key(p);assert.deepEqual(p,before);
 p.surfaceGeometry.lines[0][1][0]+=1e-10;assert.notEqual(key(p),first);
 assert.notEqual(key({...seed,surfaceAglM:-0}),key({...seed,surfaceAglM:0}));
});
test('place boundaries are part of a domain key; omitted boundaries keep the previous key',()=>{
 const within=[[[[138.99,34.99],[139.02,34.99],[139.02,35.02],[138.99,35.02],[138.99,34.99]]]],p={...seed,surfaceGeometry:{...seed.surfaceGeometry,within}};
 assert.notEqual(key(seed),key(p));assert.equal(key(p),key(structuredClone(p)));
 const copy=structuredClone(p);copy.surfaceGeometry.within[0][0][1][0]+=.0001;assert.notEqual(key(p),key(copy));
 assert.equal(key({...seed,surfaceGeometry:{...seed.surfaceGeometry,within:undefined}}),key(seed));
 assert.equal(key({...seed,surfaceGeometry:{...seed.surfaceGeometry,within:'invalid'}}),null);
});
