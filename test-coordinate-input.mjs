import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const T=createRequire(import.meta.url)('./astronotes-terrain.js');
const expected={latitude:35.6994541,longitude:139.5072732};
for(const input of [
 '35.6994541,139.5072732',
 '35.6994541, 139.5072732',
 '(35.6994541,139.5072732)',
 '(35.6994541, 139.5072732)',
 ' ( 35.6994541 , 139.5072732 ) ',
 '35.6994541 139.5072732',
 '35.6994541\n139.5072732',
 '(35.6994541,\n139.5072732)',
 '35.6994541、139.5072732',
 '３５．６９９４５４１，１３９．５０７２７３２',
 '（３５．６９９４５４１， １３９．５０７２７３２）',
 'N35.6994541 E139.5072732',
 '(N35.6994541 E139.5072732)',
])assert.deepEqual(T.parseLatLon(input),expected,input);
for(const input of ['(35.6994541,139.5072732','35.6994541,139.5072732)','場所(35.6994541,139.5072732)','((35.6994541,139.5072732))','35.6994541,139.5072732,10','(91,139)','(35,181)','(35,139）'])assert.equal(T.parseLatLon(input),null,input);
console.log('COORDINATE INPUT OK: 13 pasted forms preserve exact coordinates; 8 malformed/out-of-range forms rejected');
