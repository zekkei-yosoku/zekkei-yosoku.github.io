import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('PLATEAU structure metadata has reproducible, offline, fail-closed builder checks',()=>{
 const result=spawnSync('python3',['-I',fileURLToPath(new URL('./tools/test-plateau-structure-models.py',import.meta.url))],{encoding:'utf8',timeout:30000});
 assert.equal(result.error,undefined,String(result.error));
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stderr,/Ran 6 tests/);
});
