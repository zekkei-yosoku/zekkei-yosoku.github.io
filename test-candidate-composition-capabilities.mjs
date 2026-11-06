import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),S=require('./experiments/candidate-visibility/scene-surface.js'),C=require('./experiments/candidate-visibility/composition.js'),A=require('./astronotes-align.js'),B=require('./astronotes-bodies.js'),G=require('./astronotes-terrain.js');

test('existing tower volumes and georeferenced city triangles both support drawing-surface picking',()=>{
 for(const id of ['tokyotower','shibuya-sky','tocho-building']){
  const target=A.targetById(id),obs={...G.destination(target.latitude,target.longitude,170,.8),elevation:target.groundM,eyeM:1.5},m=S.model(A,target);assert(m,id);assert(m.surfaceTriangles.some(t=>t.length));
  const c=S.preset({obs,target,align:A,heightM:target.groundM+(target.parts[0].m-target.groundM)*.6,xM:0});assert(c,id+' preset');
  const g=S.geometry(obs,target,c,A),picked=S.pick({obs,target,align:A,azimuth:g.azimuth,altitude:g.angle});assert(picked,id+' pick');assert(C.valid(picked,target));assert(S.visible({obs,target,align:A,composition:picked}).visible);
  const back=S.geometry(obs,target,picked,A);assert(Math.hypot(...A.viewProjector(g.azimuth,g.angle)(back.azimuth,back.angle))<1e-5);
  if(id==='shibuya-sky'){
   const raw=A.CITY_MODELS[id],p=S.anchor(target,{eastM:m.vertices[0][0],northM:m.vertices[0][1],heightM:m.vertices[0][2]});assert(G.distanceKm(p.latitude,p.longitude,...raw.geoVertices[0])<1e-8,'source geographic vertices are preserved');
  }
 }
});

test('registered 3D shape has model-derived height/width limits beyond former 634m and 200m caps',()=>{
 const model={heightM:900,vertices:[[-500,-30,0],[500,-30,0],[500,30,0],[-500,30,0],[-500,-30,900],[500,-30,900],[500,30,900],[-500,30,900]],faces:[[0,1,2,3,4,5,6,7]]},target={id:'user-registered-large-building',latitude:35,longitude:139,groundM:10,parts:[{id:'tip',m:910}],model},obs={...G.destination(35,139,180,2),elevation:10,eyeM:1.5},bounds=S.bounds({target,align:A,obs});
 assert.equal(bounds.heightMaxM,910);assert(bounds.xMaxM>499);const c=S.preset({obs,target,align:A,heightM:800,xM:300});assert(c);assert(C.valid(c,target));assert(S.compatible(c,target));assert(!S.compatible({...c,modelSignature:c.modelSignature+1},target));assert(!C.valid({...c,eastM:1000},target));
 assert.equal(S.model(A,{...target,model:undefined,id:'no-shape'}),null,'height alone does not invent a 3D face');
 assert(C.valid({heightM:800,xM:500,limb:'center'},target),'legacy numerical plane no longer has a geographic 200m cap');
});

test('translate-top solid shapes keep their actual top and ground anchoring when target height changes',()=>{
 const target={id:'custom-top-translation',latitude:35,longitude:139,groundM:10,parts:[{id:'tip',m:110}],model:{id:'translated-shape',heightM:50,heightMode:'translate-top',groundAnchored:true,referenceBearing:0,solids:[[[-5,-5,0],[5,-5,0],[5,5,0],[-5,5,0],[-5,-5,50],[5,-5,50],[5,5,50],[-5,5,50]]]}},m=S.model(A,target),b=S.bounds({target,align:A});assert(m);assert.equal(b.heightMinM,10);assert.equal(b.heightMaxM,110);
 const taller={...target,parts:[{id:'tip',m:210}]};assert.equal(S.bounds({target:taller,align:A}).heightMaxM,210);assert.equal(S.bounds({target:taller,align:A}).heightMinM,10);
});

class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.style={};this.attrs={};this.isConnected=true;this.value='';}
 append(...xs){this.children.push(...xs);for(const x of xs)if(x&&typeof x==='object')x.parent=this;}
 replaceChildren(...xs){this.children=[];this.append(...xs);}
 setAttribute(k,v){this.attrs[k]=v;}
 removeAttribute(k){delete this.attrs[k];delete this[k];}
 cloneNode(){return new Element(this.tagName);}
 add(x){this.append(x);if(!this.value)this.value=x.value;}
 addEventListener(){}
 after(x){this.parent?.append(x);}
 before(x){this.parent?.append(x);}
 remove(){this.isConnected=false;}
 scrollIntoView(){}
 closest(){return this.scene?this:null;}
 querySelector(){return this.figure;}
 getBoundingClientRect(){return {left:0,top:0,width:1000,height:500};}
}
function ui(){
 let selection={body:'moon',target:{id:'arbitrary-model',latitude:35,longitude:139,groundM:10,parts:[{id:'tip',name:'先端',m:910}],hasShape:true}};
 const document={createElement:t=>new Element(t),getElementById:()=>null,dispatchEvent(){},activeElement:null},surface={model:(a,t)=>t.hasShape?{}:null,bounds:()=>({heightMinM:10,heightMaxM:910,xMinM:-500,xMaxM:500}),preset:({target,heightM,limb})=>({basis:'scene-surface',eastM:0,northM:0,xM:0,heightM,limb}),geometry:()=>({azimuth:0,angle:20}),pick:({limb})=>({basis:'scene-surface',eastM:0,northM:0,xM:0,heightM:910,limb})},sandbox={AstroNotesCandidateComposition:{geometry:surface.geometry},AstroNotesTrialSurface:surface,AstroNotesAlign:{viewProjector:()=>()=>[0,0]},AstroNotesBodies:B,AstroNotesTerrain:{inverse:()=>({azimuth:180})},SkyMapUI:{selectionState:()=>selection},document,Option:function(text,value){this.textContent=text;this.value=value;},Event:function(type){this.type=type;},structuredClone};
 vm.runInNewContext(fs.readFileSync(new URL('./experiments/candidate-visibility/composition-ui.js',import.meta.url),'utf8'),sandbox);
 const api=sandbox.AstroNotesTrialComposition,host=new Element('div'),figure=new Element('figure'),cv=new Element('canvas');host.scene=true;host.figure=figure;host.append(figure);const view={spec:{obs:{latitude:34.99,longitude:139,elevation:10},eyeM:1.5},cv,W:1000,H:500,k:20,win:{az0:0,alt0:20}};api.bind(host,view);
 const walk=e=>[e,...(e.children||[]).filter(x=>x&&typeof x==='object').flatMap(walk)],all=()=>walk(host),find=label=>all().find(e=>e.attrs['aria-label']===label);
 return {api,host,view,find,all,select:(body,hasShape=true)=>{selection={...selection,body,target:{...selection.target,hasShape}};api.bind(host,view);}};
}

test('composition UI enables every body by shape capability and uses model bounds with point-only centres',()=>{
 const u=ui(),button=u.all().find(e=>e.textContent==='重ねる位置を指定'),height=u.find('重ねる対象の高さ（地上からm）'),x=u.find('対象の中心から左右の位置（m）'),limb=u.find('天体の合わせる位置');
 assert.equal(button.disabled,false);assert.equal(height.max,'900');assert.equal(x.max,'500');assert.equal(x.min,'-500');assert.equal(limb.children.length,3);
 button.onclick();assert(u.api.plan().composition);assert.equal(u.api.plan().composition.limb,'center');
 for(const body of B.definitions){u.select(body.id);assert.equal(button.disabled,false,body.id);assert.equal(limb.children.length,body.limbs?3:1,body.id);assert.equal(limb.disabled,!body.limbs,body.id);}
 u.select('sirius',false);assert.equal(button.disabled,true);assert.equal(u.api.plan().composition,null);assert.equal(u.api.plan().compositionInvalid,false);assert.equal(button.attrs['aria-description'],'この対象は面を指定できません。');assert.equal(u.all().find(e=>e.id==='trialCompositionStatus').hidden,true,'unsupported surface does not cover the diagram');
});
