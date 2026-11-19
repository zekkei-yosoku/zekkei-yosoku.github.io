import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {checkUiComponents} from './tools/check-ui-components.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('共通部品台帳は正本の実装・全直接呼出元・検証先と一致する',()=>{const m=JSON.parse(read('src/source-manifest.json'));const result=checkUiComponents(m.uiComponents,m,read);assert(result.components>=4);assert(result.bindings>=16);});
function fixture(){const manifest={legacyRuntimeOrder:['src/a.js'],generatedAssets:[{output:'generated.js',sourceOrder:[]}]},files={'src/index.html':'<script src="generated.js"></script>','src/a.js':'function control(){} function editor(){control();}','test-control.mjs':'test body'},component={id:'control',name:'共通選択',owner:{path:'src/a.js',symbol:'control'},calls:['control'],surfaces:['編集'],contract:'shared',checks:['test-control.mjs'],consumers:[{path:'src/a.js',scope:'editor',count:1}]};return {manifest,files,registry:{version:1,components:[component]},read:p=>{if(!(p in files))throw Error('Missing '+p);return files[p];}};}
test('既存画面への追加呼出しも、新画面の呼出しも未登録なら検出する',()=>{for(const code of ['function control(){} function editor(){control();control();}','function control(){} function editor(){control();} function other(){control();}']){const f=fixture();f.files['src/a.js']=code;assert.throws(()=>checkUiComponents(f.registry,f.manifest,f.read),/Stale UI consumers/);}});
test('実装所有者や受入検査が消えた台帳を成功にしない',()=>{for(const missing of ['owner','check']){const f=fixture();if(missing==='owner')f.registry.components[0].owner.symbol='removed';else f.registry.components[0].checks=['test-removed.mjs'];assert.throws(()=>checkUiComponents(f.registry,f.manifest,f.read),/Missing/);}});
test('コメントや文字列と生成した配信物のコピーを呼出元に数えない',()=>{const f=fixture();f.files['src/a.js']+=' // control();\nconst label="control()";';assert.equal(checkUiComponents(f.registry,f.manifest,f.read).bindings,1);});
test('共通APIを呼ばずに別実装した候補の説明語彙も検出する',()=>{
 const f=fixture();f.registry.components[0].vocabulary={terms:['共通の通過説明'],owners:[{path:'src/a.js',scope:'control'}]};
 f.files['src/a.js']='function control(){return "共通の通過説明";} function editor(){control();}';assert.equal(checkUiComponents(f.registry,f.manifest,f.read).components,1);
 f.files['src/a.js']+=' function otherList(){return `共通の通過説明`;}';assert.throws(()=>checkUiComponents(f.registry,f.manifest,f.read),/Unregistered UI wording.*otherList/);
});
