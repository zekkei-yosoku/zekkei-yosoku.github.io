/* Shooting conditions shared by map candidates and framing. No place discovery. */
(function(global){
'use strict';
const DAY=86400000;
const day=at=>Math.floor((at+32400000)/DAY)*DAY-32400000;
const point=p=>p&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180;
// A registered point uses its recorded ground height until the user resets it.
const savedObserver=p=>point(p)?{...p,groundManualM:Number.isFinite(p.groundManualM)?p.groundManualM:Number.isFinite(p.elevation)?p.elevation:null}:null;
function conditions(p){
 if(!p||!point(p.target)||!Number.isFinite(p.at)||typeof p.body!=='string')return null;
 return {observer:point(p.observer)?{...p.observer}:null,target:{...p.target},body:p.body,partId:p.partId??null,limb:p.partId==='__whole'?'center':p.limb||'center',at:p.at,...(p.matchMode?{matchMode:p.matchMode==='overlap'?'overlap':'limb'}:{})};
}
function queryKey(p,records,owner,atmosphere){return JSON.stringify([owner,p?.body,p?.target,p?.partId??null,p?.limb||'center',day(p?.at),records.map(x=>[x.place,x.record]),atmosphere,p?.matchMode||'limb']);}
function searchOptions(p,isMountain){
 const broad=p.matchMode==='overlap',disc=p.body==='sun'||p.body==='moon';
 return {partId:broad?(isMountain(p.target)?null:'__whole'):p.partId,limb:broad?'center':p.limb,broad,disc};
}
function eventsFor(p,obs,start,{align,isMountain}){
 const o=searchOptions(p,isMountain),whole=o.partId==='__whole';
 const rows=(o.broad&&o.disc||whole&&!isMountain(p.target))?align.dailyView(obs,p.target,p.body,start,{partId:o.partId,eyeM:obs.eyeM}):align.upcoming(obs,p.target,p.body,{from:start,days:1,limit:Infinity,groupDays:false,partId:o.partId,limb:o.limb,eyeM:obs.eyeM,stepMs:3600000});
 return o.broad?rows.map(e=>({...e,matchMode:'overlap',partId:o.partId})):rows;
}
function matches(e,p,isMountain){
 const o=searchOptions(p,isMountain);
 return o.broad&&o.disc||o.partId==='__whole'?!!e.intersects:Number.isFinite(e.gap)&&Math.abs(e.gap)<=Math.max(1/60,.2*(e.radius||0));
}
async function candidates(plan,points,{align,isMountain,observerAt,elevationAt,ensure,isCurrent=()=>true}={}){
 const p=conditions(plan);if(!p)return {rows:[],failed:0};
 await ensure(p.body);const start=day(p.at),rows=[];let failed=0;
 for(const entry of points){
  await new Promise(resolve=>setTimeout(resolve,0));if(!isCurrent())return {rows:[],failed:0,cancelled:true};
  try{
   const f=entry.place,ground=Number.isFinite(f.groundManualM)?f.groundManualM:Number.isFinite(f.elevation)?f.elevation:await elevationAt(f.latitude,f.longitude);
   if(!Number.isFinite(ground))throw Error('missing elevation');
   const obs=observerAt(f,ground),events=eventsFor(p,obs,start,{align,isMountain});
   for(const e of events){
    if(e.at<start||e.at>=start+DAY||!matches(e,p,isMountain)||(p.body==='moon'&&!(e.sunAltitude<0)))continue;
    rows.push({place:f,record:entry.record,event:e});
   }
  }catch{failed++;}
 }
 rows.sort((a,b)=>a.event.at-b.event.at||a.place.name.localeCompare(b.place.name));
 return {rows,failed};
}
function hapticGate({vibrate=()=>{},clock=Date.now}={}){
 let previous=false,last=-Infinity,identity='';
 return (matched,key)=>{if(key!==identity){identity=key;previous=false;}const entered=matched&&!previous;previous=!!matched;if(entered&&clock()-last>800){last=clock();try{vibrate(12);}catch{}}return entered;};
}
global.SoramiShooting={day,point,savedObserver,conditions,queryKey,searchOptions,eventsFor,matches,candidates,hapticGate};
if(typeof module!=='undefined'&&module.exports)module.exports=global.SoramiShooting;
})(globalThis);
