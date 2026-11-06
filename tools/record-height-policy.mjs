// Trial-only, backwards-compatible optional metadata on a registered favorite.
export function createRecordHeightPolicy(){
 const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
 const range=value=>value&&finite(value.min,0,700)&&finite(value.max,0,700)&&value.min<value.max&&Math.abs(value.min*10-Math.round(value.min*10))<1e-7&&Math.abs(value.max*10-Math.round(value.max*10))<1e-7?{min:Math.round(value.min*10)/10,max:Math.round(value.max*10)/10}:null;
 const key=p=>JSON.stringify([p?.latitude,p?.longitude,p?.elevation??null,p?.groundManualM??null,p?.eyeHeightAGL??1.5,p?.eyeHeightRangeAGL??null]);
 const draft=p=>({mode:p?.eyeHeightRangeAGL?'range':'fixed',ground:String(Number.isFinite(p?.groundManualM)?p.groundManualM:Number.isFinite(p?.elevation)?p.elevation:''),fixed:String(p?.eyeHeightAGL??1.5),min:String(p?.eyeHeightRangeAGL?.min??''),max:String(p?.eyeHeightRangeAGL?.max??'')});
 function parse(d,fallbackEye=1.5){
  const num=s=>typeof s==='string'&&s.trim()?Number(s):NaN,eye=num(d.fixed),g=num(d.ground);
  if(d.ground.trim()&&!finite(g,-500,9000))throw Error('標高は−500〜9000mで入力してください');
  if(d.mode==='range'){const value=range({min:num(d.min),max:num(d.max)});if(!value)throw Error('高さの下限と上限を0〜700m・0.1m単位で入力してください（下限＜上限）');return {ground:Number.isFinite(g)?g:null,eye:finite(eye,0,700)?eye:finite(fallbackEye,0,700)?fallbackEye:1.5,range:value};}
  if(!finite(eye,0,700))throw Error('目線の高さは0〜700mで入力してください');
  return {ground:Number.isFinite(g)?g:null,eye,range:null};
 }
 return {range,key,draft,parse};
}
