export function createRecordAlignmentPolicy({isMountain,limbs}){
 const parts=t=>(t?.parts||[]).filter(p=>typeof p.id==='string'&&p.id!=='__whole'&&Number.isFinite(p.m));
 const whole=t=>({partId:isMountain(t)?null:'__whole',limb:'center',matchMode:'overlap'});
 function clean(t,v){if(!v)return whole(t);if(v.matchMode==='overlap'||v.partId==='__whole')return whole(t);const part=v.partId==null?parts(t)[0]:parts(t).find(p=>p.id===v.partId);if(v.matchMode!=='limb'||!part||!limbs.some(l=>l.id===v.limb))return null;return {partId:part.id,limb:v.limb,matchMode:'limb'};}
 const map=p=>p?.recordAlignments==null?{}:typeof p.recordAlignments==='object'&&!Array.isArray(p.recordAlignments)?p.recordAlignments:null;
 const key=p=>map(p)===null?'invalid:'+JSON.stringify(p.recordAlignments):JSON.stringify(Object.entries(map(p)).sort(([a],[b])=>a.localeCompare(b)).map(([id,v])=>[id,v?.partId??null,v?.limb,v?.matchMode]));
 const text=(t,v)=>v?.matchMode==='overlap'?'全体':(parts(t).find(p=>p.id===v?.partId)?.name||'部位')+'・'+(limbs.find(l=>l.id===v?.limb)?.name||'真ん中');
 return {parts,whole,clean,map,key,text};
}
