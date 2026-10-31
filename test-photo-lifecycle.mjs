import './tools/test-owner-adapter.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const nodes=()=>new Proxy({}, {get:(o,k)=>o[k]??=(k==='photoSheet'?{open:true,close(){this.open=false;}}:{value:'',disabled:false,hidden:false})});
function run(c,a,b){vm.createContext(c);vm.runInContext(source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a))),c);return c;}
{
 const el=nodes(),a=deferred(),b=deferred();
 const c={photoDraft:{},auth:{token:"synthetic"},photoSaving:false,photoSheetGeneration:1,photoAttachGeneration:0,AstroNotesExif:{readFile:f=>f.name==='A'?a.promise:b.promise},makeThumb:async f=>({url:f.name,width:20,height:10}),$:id=>el[id]};
 run(c,'async function photoAttach(file)','\n/**');
 const pa=c.photoAttach({name:'A',size:1}),pb=c.photoAttach({name:'B',size:2});assert.equal(el.photoSave.disabled,true);assert.equal(c.photoDraft.thumb,null);
 b.resolve({name:'B'});assert.equal(await pb,true);a.resolve({name:'A'});assert.equal(await pa,false);
 assert.equal(c.photoDraft.file.name,'B');assert.equal(c.photoDraft.thumb,'B');assert.equal(c.photoDraft.exif.name,'B');assert.equal(c.photoDraft.original.bytes,2);assert.equal(el.photoSave.disabled,false);
 const late=deferred();c.AstroNotesExif.readFile=()=>late.promise;const pc=c.photoAttach({name:'C'});c.photoSheetGeneration++;late.resolve({});assert.equal(await pc,false);assert.equal(c.photoDraft.thumb,null);
}
function saveFixture(){const el=nodes(),post=deferred(),analysis=deferred(),calls=[],sent=[];Object.assign(el.photoPhenom,{value:'sunset'});el.photoScore.value='80';
 const c={photoDraft:{thumb:'A',round:{pid:'sunset',peak:100},scoreMoved:true,exif:{id:'A'}},photoSaving:false,photoSheetGeneration:1,photoAttachGeneration:0,authGeneration:1,auth:{token:'synthetic'},$:id=>el[id],place:{name:'A',latitude:1,longitude:2},samePlaceAs:(a,b)=>a.latitude===b.latitude&&a.longitude===b.longitude,photoWhereAt:()=>null,photoWhenMs:()=>150,forecastCandidates:()=>[],photoAnalysisFor:async()=>analysis.promise,apiCall:async(m,p,b)=>{sent.push(b);return post.promise;},photoShot:async(b,e)=>({at:b.takenAt,exif:e.id}),recordAnswer:(...x)=>calls.push(x),findSighting:()=>null,loadPhotos:async()=>{}};
 run(c,'$("photoSave").onclick =','\n\nlet photos =');return {c,el,post,analysis,calls,sent};}
{
 const f=saveFixture(),p=f.el.photoSave.onclick({preventDefault(){}});assert.equal(f.el.photoClose.disabled,true);assert.equal(f.el.photoChoose.disabled,true);
 f.c.photoDraft.round={pid:'sunset',peak:200};f.c.photoDraft.exif={id:'B'};f.analysis.resolve(null);await Promise.resolve();await Promise.resolve();f.post.resolve({});await p;
 assert.equal(f.calls[0][1],100);assert.equal(f.calls[0][3].exif,'A');assert.equal(f.el.photoSheet.open,false);assert.equal(f.c.photoSaving,false);
}
{
 const f=saveFixture(),p=f.el.photoSave.onclick({preventDefault(){}});f.c.authGeneration++;f.analysis.resolve(null);await p;assert.equal(f.sent.length,0);assert.equal(f.calls.length,0);
}
{
 const f=saveFixture(),p=f.el.photoSave.onclick({preventDefault(){}});f.analysis.resolve(null);await Promise.resolve();await Promise.resolve();f.c.photoSheetGeneration++;f.post.resolve({});await p;assert.equal(f.calls.length,0);assert.equal(f.el.photoSheet.open,true);
}
{
 const f=saveFixture();f.c.photoDraft.ownerToken='previous-account';
 await f.el.photoSave.onclick({preventDefault(){}});assert.equal(f.sent.length,0);assert.equal(f.el.photoSheet.open,false);assert.equal(f.c.photoDraft.thumb,null);
}

{
 const c={photos:[{id:'first'}],photosCursor:'next',photosOwner:'synthetic',photosLoading:false,photosError:null,photosRetryAppend:false,photosRequest:0,auth:{token:'synthetic'},renderToolAccess:()=>true,toolAllowed:()=>true,apiCall:async()=>{throw Error('offline')},renderPhotos(){},renderPhotoListState(){},recheckAccess(){}};
 run(c,'async function loadPhotos(','function renderPhotos()');await c.loadPhotos();assert.equal(c.photos[0].id,'first');assert.match(c.photosError,/読み込めません/);assert.equal(c.photosLoading,false);assert.equal(c.photosRetryAppend,false);
 c.apiCall=async(m,path)=>{assert.match(path,/cursor=next/);return {photos:[{id:'first'},{id:'second'}],nextCursor:null};};await c.loadPhotos(true);assert.equal(c.photos.length,2);assert.equal(c.photosCursor,null);assert.equal(c.photosError,null);
 c.auth={token:'other'};c.apiCall=async()=>{throw Error('offline')};await c.loadPhotos();assert.equal(c.photos.length,0);
}
console.log('PHOTO LIFECYCLE OK: selection ordering, close invalidation, save snapshot, account switch, stale sheet, pagination, retry and offline preservation');
