// Display order for registered shooting places. Pure: never mutates its input.
export function createRecordSort({distanceKm,collator=new Intl.Collator('ja',{numeric:true,sensitivity:'base'})}){
 const MODES=[['name','名前順'],['address','住所順'],['near','近い順'],['added','追加順']],DEFAULT='added';
 const valid=mode=>MODES.some(([id])=>id===mode);
 const label=v=>typeof v==='string'?v.normalize('NFKC').trim():'';
 const point=p=>!!p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180&&!(p.latitude===0&&p.longitude===0);
 const text=(a,b)=>!a!==!b?(a?-1:1):collator.compare(a,b);
 function sort(places,mode,origin){
  const rows=places.map((place,index)=>({place,index,name:label(place?.name),address:label(place?.subtitle),km:mode==='near'&&point(origin)&&point(place)?distanceKm(origin.latitude,origin.longitude,place.latitude,place.longitude):null}));
  const added=(a,b)=>b.index-a.index,byName=(a,b)=>text(a.name,b.name)||added(a,b);
  const order={
   name:byName,
   address:(a,b)=>text(a.address,b.address)||byName(a,b),
   near:(a,b)=>!Number.isFinite(a.km)!==!Number.isFinite(b.km)?(Number.isFinite(a.km)?-1:1):(Number.isFinite(a.km)&&a.km-b.km)||byName(a,b),
   added
  }[valid(mode)?mode:DEFAULT];
  return rows.sort(order).map(r=>r.place);
 }
 return {modes:MODES.map(([id])=>id),options:MODES.map(([value,label])=>({value,label})),DEFAULT,valid,point,sort};
}
