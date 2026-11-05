import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {File} from 'node:buffer';
import vm from 'node:vm';

// Minimal injected DOM for request ownership and preference contracts; browser
// tests separately exercise native dialogs, layout, downloads and user activation.
class Element {
  constructor(doc, tag='div') { Object.assign(this,{doc,tagName:tag.toUpperCase(),children:[],parentElement:null,dataset:{},style:{},events:new Map(),open:false,value:'',textContent:'',className:''}); }
  get isConnected() { return this===this.doc.body || !!this.parentElement?.isConnected; }
  get lastChild() { return this.children.at(-1); }
  append(...children) { for(let child of children){if(typeof child==='string'){const text=new Element(this.doc,'#text');text.textContent=child;child=text;}child.remove();child.parentElement=this;this.children.push(child);} }
  appendChild(child) { this.append(child);return child; }
  replaceChildren(...children) { for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children); }
  remove() { if(this.parentElement){const children=this.parentElement.children;children.splice(children.indexOf(this),1);this.parentElement=null;} }
  after(child) { const parent=this.parentElement,index=parent.children.indexOf(this);child.remove();child.parentElement=parent;parent.children.splice(index+1,0,child); }
  setAttribute(name,value) { this[name]=String(value); }
  addEventListener(name,fn) { if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(fn); }
  removeEventListener(name,fn) { this.events.get(name)?.delete(fn); }
  emit(name,event={}) { for(const fn of this.events.get(name)||[])fn({target:this,preventDefault(){},...event}); }
  close() { if(!this.open)return;this.open=false;queueMicrotask(()=>this.emit('close')); }
  focus() { this.doc.activeElement=this; }
  closest(selector) { for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null; }
  matches(selector) { return selector.startsWith('#')?this.id===selector.slice(1):selector.startsWith('.')?this.className.split(' ').includes(selector.slice(1)):selector==='[data-open-once]'?Object.hasOwn(this.dataset,'openOnce'):this.tagName===selector.toUpperCase(); }
  querySelector(selector) { for(const child of this.children){if(child.matches(selector))return child;const nested=child.querySelector(selector);if(nested)return nested;}return null; }
  add(option) { this.append(option); }
}
function documentFixture() {
  const doc={createElement(tag){return new Element(doc,tag);},getElementById(id){return doc.body.querySelector('#'+id);}};
  doc.body=new Element(doc,'body');doc.activeElement=doc.body;
  // Includes the existing map dialog and the equivalent lazily-created calendar
  // dialog, so no HTML parser is needed for these injected ownership tests.
  for(const prefix of ['mapApp','calendarApp']){
    const dialog=doc.createElement('dialog');dialog.id=prefix+'Sheet';
    const head=doc.createElement('div'),body=doc.createElement('div');body.className='sheet-body';
    for(const [tag,suffix,parent]of [['strong','Title',head],['button','Close',head],['p','Coord',body],['div','List',body]]){const el=doc.createElement(tag);el.id=prefix+suffix;parent.append(el);}
    const label=doc.createElement('label'),remember=doc.createElement('input');remember.id=prefix+'Remember';label.append(remember,'次回からも使う');body.append(label);dialog.append(head,body);doc.body.append(dialog);
  }
  return doc;
}
const source=readFileSync(new URL('./experiments/external-apps/external-apps.js',import.meta.url),'utf8');
const event={title:'月と建物',start:1_800_000_000_000,end:1_800_000_060_000,location:'撮影地点 (35.1234567, 139.7654321)',description:'同じ条件',reminder:0};
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
function fixture({ua='Android',saved={},canShare=false,shareFile,launchUrl}={}) {
  const doc=documentFixture(),values=new Map(Object.entries(saved)),writes=[],urls=[],files=[],shares=[],messages=[],shown=[];
  const parent=doc.createElement('dialog');parent.open=true;doc.body.append(parent);const button=doc.createElement('button');parent.append(button);doc.activeElement=button;
  const state={saveOK:true,mapChanges:0};
  const plan={google:e=>'https://calendar.google.com/calendar/render?text='+encodeURIComponent(e.title),ics:e=>JSON.stringify(e)};
  const context=vm.createContext({AstroNotesPlan:plan,File,structuredClone,Promise,Option:class extends Element {constructor(text,value){super(doc,'option');this.textContent=text;this.value=value;}}});
  vm.runInContext(source,context);
  const apps=plan.createExternalApps({doc,ua,storage:{get:(key,fallback)=>values.has(key)?values.get(key):fallback,set:(key,value)=>{writes.push([key,value]);if(!state.saveOK)return false;values.set(key,value);return true;}},
    show:dialog=>{shown.push(dialog.id);dialog.open=true;dialog.focus();},onMapChange:()=>state.mapChanges++,
    launchUrl:url=>{urls.push(url);launchUrl?.(url);},saveFile:file=>files.push(file),canShareFile:()=>canShare,
    shareFile:file=>{shares.push(file);return shareFile?.(file);}});
  const options={source:button,onStatus:message=>messages.push(message)};
  return {apps,doc,parent,button,state,values,writes,urls,files,shares,messages,shown,options,
    pick:(kind,id)=>doc.getElementById((kind==='map'?'mapApp':'calendarApp')+'List').children.find(el=>el.dataset.externalApp===id),
    remember:kind=>doc.getElementById((kind==='map'?'mapApp':'calendarApp')+'Remember')};
}

test('preferences are independent, allowlisted and only acknowledge successful storage',()=>{
  const f=fixture({saved:{'sorami.mapApp':'google','sorami.calendarApp':'invalid'}});
  assert.equal(f.apps.get('map'),'google');assert.equal(f.apps.get('calendar'),null);
  assert.equal(f.apps.set('calendar','device'),true);assert.equal(f.apps.get('map'),'google');assert.equal(f.apps.get('calendar'),'device');
  assert.equal(f.apps.set('calendar','apple'),false);assert.equal(f.apps.set('unknown','google'),false);
  f.state.saveOK=false;assert.equal(f.apps.set('calendar',null),false);assert.equal(f.apps.get('calendar'),'device');
  f.state.saveOK=true;assert.equal(f.apps.set('calendar',null),true);assert.equal(f.apps.get('calendar'),null);
  assert.equal(f.state.mapChanges,0);f.apps.set('map',null);assert.equal(f.state.mapChanges,1);
  assert.deepEqual(Array.from(f.apps.choices('map'),x=>x.id),['device','google','apple']);
  assert.deepEqual(Array.from(fixture({ua:'iPhone'}).apps.choices('map'),x=>x.id),['apple','google']);
});
test('first choice has no launch or persistence until selection; every-time and remembered modes differ',async()=>{
  const f=fixture();f.apps.requestMap({latitude:35.1234567,longitude:139.7654321},f.options);
  assert.deepEqual(f.urls,[]);assert.deepEqual(f.writes,[]);assert(f.doc.getElementById('mapAppSheet').open);
  f.pick('map','google').onclick();assert.equal(f.urls.length,1);assert.equal(new URL(f.urls[0]).searchParams.get('query'),'35.1234567, 139.7654321');assert.equal(f.apps.get('map'),null);
  await flush();f.apps.requestMap('35.1234567, 139.7654321',f.options);f.remember('map').checked=true;f.pick('map','apple').onclick();assert.equal(f.apps.get('map'),'apple');
  await flush();const count=f.shown.length;f.apps.requestMap('35.1234567, 139.7654321',f.options);assert.equal(f.shown.length,count);assert.equal(new URL(f.urls.at(-1)).hostname,'maps.apple.com');
});
test('preference failure needs an explicit open-once action and leaves the saved choice unchanged',()=>{
  const f=fixture();f.state.saveOK=false;f.apps.requestCalendar(event,f.options);f.remember('calendar').checked=true;f.pick('calendar','google').onclick();
  assert.deepEqual(f.urls,[]);assert.equal(f.apps.get('calendar'),null);assert(f.doc.getElementById('calendarAppStatus').textContent.includes('保存できません'));
  f.doc.getElementById('calendarAppSheet').querySelector('[data-open-once]').onclick();assert.equal(f.urls.length,1);assert.equal(f.apps.get('calendar'),null);
});
test('settings save failure restores the previous selection and every-time clears only that category',()=>{
  const f=fixture({saved:{'sorami.calendarApp':'google','sorami.mapApp':'apple'}}),box=f.apps.settings();f.doc.body.append(box);
  const calendar=f.doc.getElementById('externalDefaultCalendar'),map=f.doc.getElementById('externalDefaultMap');
  f.state.saveOK=false;calendar.value='device';calendar.onchange();assert.equal(calendar.value,'google');assert.equal(f.apps.get('calendar'),'google');
  f.state.saveOK=true;calendar.value='';calendar.onchange();assert.equal(f.apps.get('calendar'),null);assert.equal(map.value,'apple');
  f.apps.set('map','google');assert.equal(map.value,'google');
});
test('closing the parent cancels its chooser without launch or saved preference',async()=>{
  const f=fixture();f.apps.requestCalendar(event,f.options);const old=f.pick('calendar','google');f.parent.close();await flush();
  assert(!f.doc.getElementById('calendarAppSheet').open);old.onclick();assert.deepEqual(f.urls,[]);assert.deepEqual(f.writes,[]);
});
test('saved-app shortcuts reject an already-stale request or closed parent',()=>{
  const f=fixture({saved:{'sorami.calendarApp':'google','sorami.mapApp':'google'}});
  f.apps.requestCalendar(event,{...f.options,isCurrent:()=>false});f.apps.requestMap('35,139',{...f.options,isCurrent:()=>false});
  f.parent.open=false;f.apps.requestCalendar(event,f.options);f.apps.requestMap('35,139',f.options);
  assert.deepEqual(f.urls,[]);
});
test('a stale chooser callback or queued close cannot cancel a newer request of the same kind',async()=>{
  const f=fixture();f.apps.requestCalendar(event,f.options);const old=f.pick('calendar','google');
  f.apps.requestCalendar({...event,title:'新しい予定'},f.options);const latest=f.pick('calendar','google');
  await flush();
  old.onclick();assert(f.doc.getElementById('calendarAppSheet').open);latest.onclick();assert.equal(f.urls.length,1);assert(new URL(f.urls[0]).searchParams.get('text').includes('新しい予定'));
});
test('an invalid new request cannot cancel an existing valid chooser',()=>{
  const f=fixture();f.apps.requestCalendar(event,f.options);const latest=f.pick('calendar','google');
  f.apps.requestCalendar({...event,title:'無効な別予定'},{...f.options,isCurrent:()=>false});
  assert(f.doc.getElementById('calendarAppSheet').open);latest.onclick();assert.equal(f.urls.length,1);assert.equal(new URL(f.urls[0]).searchParams.get('text'),event.title);
});
test('the same chooser action cannot launch or save twice',()=>{
  const f=fixture();f.apps.requestCalendar(event,f.options);f.remember('calendar').checked=true;const choice=f.pick('calendar','google');
  choice.onclick();choice.onclick();assert.equal(f.urls.length,1);assert.equal(f.writes.length,1);
});
test('file transfer preserves event data and makes no claim that registration is complete',async()=>{
  const f=fixture({saved:{'sorami.calendarApp':'device'}});f.apps.requestCalendar(event,f.options);
  assert.equal(f.files.length,1);assert.deepEqual(JSON.parse(await f.files[0].text()),event);assert.equal(f.shares.length,0);assert(f.messages.at(-1).includes('追加してください'));
});
test('share cancellation neither downloads nor reopens a recovery chooser',async()=>{
  const f=fixture({saved:{'sorami.calendarApp':'device'},canShare:true,shareFile:()=>Promise.reject({name:'AbortError'})});
  f.apps.requestCalendar(event,f.options);await flush();assert.equal(f.shares.length,1);assert.equal(f.files.length,0);assert.equal(f.shown.length,0);assert(f.messages.at(-1).includes('取り消しました'));
});
test('share failure needs another click for recovery and does not silently change preferences',async()=>{
  const f=fixture({saved:{'sorami.calendarApp':'device'},canShare:true,shareFile:()=>Promise.reject({name:'NotAllowedError'})});
  f.apps.requestCalendar(event,f.options);await flush();assert.equal(f.files.length,0);assert(f.doc.getElementById('calendarAppSheet').open);assert(f.remember('calendar').disabled);
  f.doc.getElementById('calendarFileSave').onclick();assert.equal(f.files.length,1);assert.equal(f.apps.get('calendar'),'device');assert.equal(f.writes.length,0);
});
test('recovery rejects the previous chooser buttons even though the request itself is unchanged',async()=>{
  const f=fixture({canShare:true,shareFile:()=>Promise.reject({name:'NotAllowedError'})});
  f.apps.requestCalendar(event,f.options);const old=f.pick('calendar','device');old.onclick();await flush();
  old.onclick();assert.equal(f.shares.length,1);assert(f.doc.getElementById('calendarAppSheet').open);
  f.pick('calendar','google').onclick();assert.equal(f.urls.length,1);assert.equal(f.apps.get('calendar'),null);
});
test('the chooser transfers its captured event even if the caller later mutates the input',async()=>{
  const f=fixture(),input={...event};f.apps.requestCalendar(input,f.options);input.title='別の予定';input.start+=1000;
  f.pick('calendar','device').onclick();assert.deepEqual(JSON.parse(await f.files[0].text()),event);
});
test('late share failure after parent close cannot reopen a chooser or replace status',async()=>{
  let reject;const deferred=new Promise((yes,no)=>{reject=no;});
  const f=fixture({saved:{'sorami.calendarApp':'device'},canShare:true,shareFile:()=>deferred});
  f.apps.requestCalendar(event,f.options);const previous=f.messages.at(-1);f.parent.close();await flush();reject({name:'NotAllowedError'});await flush();
  assert.equal(f.messages.at(-1),previous);assert.equal(f.shown.length,0);assert.equal(f.files.length,0);
});
test('late share success or failure cannot overwrite or reopen a newer request',async()=>{
  for(const failed of [false,true]){
    let resolve,reject;const deferred=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const f=fixture({saved:{'sorami.calendarApp':'device'},canShare:true,shareFile:()=>deferred});
    f.apps.requestCalendar(event,f.options);f.apps.set('calendar','google');f.apps.requestCalendar({...event,title:'別の予定'},f.options);const status=f.messages.at(-1);
    if(failed)reject({name:'NotAllowedError'});else resolve();await flush();assert.equal(f.messages.at(-1),status);assert(!f.doc.getElementById('calendarAppSheet').open);assert.equal(f.files.length,0);
  }
});
