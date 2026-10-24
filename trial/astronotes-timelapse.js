/* Fixed-camera timelapse arithmetic. Times are exposure starts; no cloud/blur simulation. */
(function(root){'use strict';
const R=Math.PI/180;
function settings(v){return !!v&&Number.isFinite(v.interval)&&v.interval>=.1&&v.interval<=3600&&Number.isInteger(v.count)&&v.count>=2&&v.count<=10000&&[24,25,30,60].includes(v.fps)&&(v.count-1)*v.interval<=129600;}
function summary(v){if(!settings(v))throw Error('撮影間隔0.1〜3600秒・撮影回数2〜10000枚、撮影期間36時間以内で指定してください');return {duration:(v.count-1)*v.interval,video:v.count/v.fps,count:v.count};}
// The same gnomonic projection and pan as the scene. Positive margin means the complete disc fits.
function margin(p,frame,offset={x:0,y:0}){
 if(!p||![p.x,p.y,p.radius,frame?.halfW,frame?.halfH,offset.x,offset.y].every(Number.isFinite)||frame.halfW<=0||frame.halfH<=0||p.radius<0)return -180;
 const x=p.x*R,y=p.y*R,z=Math.hypot(x,y,1),left=(-frame.halfW-offset.x)*R,right=(frame.halfW-offset.x)*R,bottom=(-frame.halfH-offset.y)*R,top=(frame.halfH-offset.y)*R;
 const edges=[(x-left)/(z*Math.hypot(1,left)),(right-x)/(z*Math.hypot(1,right)),(y-bottom)/(z*Math.hypot(1,bottom)),(top-y)/(z*Math.hypot(1,top))];
 return Math.asin(Math.max(-1,Math.min(1,...edges)))/R-p.radius;
}
function boundary(fn,a,b){let fa=fn(a);for(let n=0;n<24&&b-a>50;n++){const mid=(a+b)/2,f=fn(mid);if((fa>=0)===(f>=0)){a=mid;fa=f;}else b=mid;}return (a+b)/2;}
// Bounded search; optimise near each coarse segment so a short grazing passage need not hit a sample.
async function passages(fn,start,end,{current=()=>true,yieldTask=()=>new Promise(r=>setTimeout(r,0))}={}){
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>129600000)throw Error('探索する日時を確認してください');
 const rows=[];let entry=null,openStart=false,prev=start,fp=fn(start),n=0;
 if(fp>=0){entry=start;openStart=true;}
 for(let at=Math.min(start+30000,end);at<=end;at=Math.min(at+30000,end)){
  if(!current())return null;
  const f=fn(at);let points=[[prev,fp],[at,f]];
  // 0.02 deg/s is a conservative bound for the supported celestial bodies, away from projection singularities.
  if(fp<0&&f<0&&Math.max(fp,f)>-.02*(at-prev)/2000){
   let lo=prev,hi=at;for(let k=0;k<32;k++){const a=(lo*2+hi)/3,b=(lo+hi*2)/3;if(fn(a)<fn(b))lo=a;else hi=b;}const peak=(lo+hi)/2,top=fn(peak);if(top>=0)points=[[prev,fp],[peak,top],[at,f]];
  }
  for(let i=1;i<points.length;i++){const [a,fa]=points[i-1],[b,fb]=points[i];if(fa<0&&fb>=0)entry=boundary(fn,a,b);if(fa>=0&&fb<0&&entry!==null){rows.push({start:entry,end:boundary(fn,a,b),openStart,openEnd:false});entry=null;openStart=false;}}
  prev=at;fp=f;if(++n%64===0)await yieldTask();if(at===end)break;
 }
 if(entry!==null)rows.push({start:entry,end,openStart,openEnd:true});return rows;
}
function firstOutside(start,v,rows){summary(v);for(let i=0;i<v.count;i++){const at=start+i*v.interval*1000;if(!rows.some(r=>at>=r.start&&at<=r.end))return i+1;}return null;}
const api={settings,summary,margin,boundary,passages,firstOutside};if(typeof module==='object'&&module.exports)module.exports=api;root.AstroNotesTimelapse=api;
})(typeof globalThis!=='undefined'?globalThis:this);
