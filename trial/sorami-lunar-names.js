/* Calendar names are cultural conventions; events use geocentric ecliptic longitude. */
(function(g){'use strict';
const T=g.SoramiHomeTime||(typeof require==='function'?require('./sorami-home-time.js'):null),DAY=86400000,MONTHS=[
 ['ウルフムーン','Wolf Moon','冬のオオカミにちなむ呼び名'],['スノームーン','Snow Moon','雪の多い季節にちなむ呼び名'],
 ['ワームムーン','Worm Moon','春の地面に現れる虫にちなむ呼び名'],['ピンクムーン','Pink Moon','春に咲くピンク色の花にちなむ呼び名'],
 ['フラワームーン','Flower Moon','花が咲く季節にちなむ呼び名'],['ストロベリームーン','Strawberry Moon','イチゴの収穫期にちなむ呼び名'],
 ['バックムーン','Buck Moon','雄ジカの角が育つ季節にちなむ呼び名'],['スタージョンムーン','Sturgeon Moon','チョウザメの漁期にちなむ呼び名'],
 ['コーンムーン','Corn Moon','穀物の収穫期にちなむ呼び名'],['ハンターズムーン','Hunter’s Moon','収穫後の狩りにちなむ呼び名'],
 ['ビーバームーン','Beaver Moon','ビーバーの冬支度などにちなむ呼び名'],['コールドムーン','Cold Moon','冬の寒さにちなむ呼び名']
],MAJOR=[['新月','New Moon'],['上弦の月','First Quarter'],['満月','Full Moon'],['下弦の月','Last Quarter']],cache=new WeakMap();
const localDate=T.date,norm=a=>(a%360+360)%360;
function elong(t,A){return norm(A.moonGeocentric(t+A.DELTA_T_MS).longitude-A.sunPosition(t+A.DELTA_T_MS).longitude);}
function bisect(a,b,fn){for(let i=0;i<27;i++){const m=(a+b)/2;if(fn(m)<0)a=m;else b=m;}return(a+b)/2;}
function solar(year,month,target,A){const a=Date.UTC(year,month,19);return bisect(a,a+6*DAY,t=>norm(A.sunPosition(t+A.DELTA_T_MS).longitude-target+180)-180);}
function extremum(t,A,sign){let a=t-DAY,b=t+DAY;for(let i=0;i<32;i++){const x=a+(b-a)/3,y=b-(b-a)/3;if(sign*A.moonGeocentric(x+A.DELTA_T_MS).distanceKm<sign*A.moonGeocentric(y+A.DELTA_T_MS).distanceKm)b=y;else a=x;}return A.moonGeocentric((a+b)/2+A.DELTA_T_MS).distanceKm;}
function calendar(year,A){
 let years=cache.get(A);if(!years){years=new Map();cache.set(A,years);}const key=year+T.zone();if(years.has(key))return years.get(key);
 const start=T.parse(`${year}-01-01`),end=T.parse(`${year+1}-01-01`),events=[];let prev=elong(start-35*DAY,A),prevT=start-35*DAY,min=Infinity,max=0,minT=start,maxT=start;
 for(let t=prevT+DAY/4;t<=end+35*DAY;t+=DAY/4){const cur=elong(t,A),advance=norm(cur-prev),next=prev+advance;
  for(let target=(Math.floor(prev/90)+1)*90;target<=next;target+=90){const base=prev,want=target;const at=bisect(prevT,t,x=>base+norm(elong(x,A)-base)-want);events.push({at,kind:Math.round(target/90)%4});}
  if(t>=start&&t<end){const r=A.moonGeocentric(t+A.DELTA_T_MS).distanceKm;if(r<min){min=r;minT=t;}if(r>max){max=r;maxT=t;}}
  prev=cur;prevT=t;
 }
 min=extremum(minT,A,1);max=extremum(maxT,A,-1);
 const full=events.filter(e=>e.kind===2),autumn=solar(year,8,180,A),harvest=full.reduce((a,b)=>Math.abs(b.at-autumn)<Math.abs(a.at-autumn)?b:a),hunter=full[full.indexOf(harvest)+1];
 const boundaries=[solar(year-1,11,270,A),solar(year,2,0,A),solar(year,5,90,A),autumn,solar(year,11,270,A),solar(year+1,2,0,A)];
 for(const e of full){const month=Number(localDate(e.at).slice(5,7))-1;e.name=MONTHS[month];e.tags=[];
  if(e===harvest)e.name=['ハーベストムーン','Harvest Moon','北半球の秋分に最も近い満月'];else if(e===hunter)e.name=['ハンターズムーン','Hunter’s Moon','ハーベストムーンの次の満月'];
  const same=full.filter(f=>localDate(f.at).slice(0,7)===localDate(e.at).slice(0,7));if(same.indexOf(e)===1)e.tags.push(['ブルームーン','Blue Moon','同じ暦月で2回目の満月（端末のタイムゾーン）']);
  for(let i=0;i<boundaries.length-1;i++){const season=full.filter(f=>f.at>=boundaries[i]&&f.at<boundaries[i+1]);if(season.length===4&&season[2]===e)e.tags.push(['季節のブルームーン','Seasonal Blue Moon','二分二至で区切る季節に4回ある満月の3回目']);}
  e.distanceKm=A.moonGeocentric(e.at+A.DELTA_T_MS).distanceKm;
  if(e.distanceKm<=max-.9*(max-min))e.tags.push(['スーパームーン','Supermoon','その年の地心距離範囲のうち、近い側10％に入る満月']);
  if(e.distanceKm>=min+.9*(max-min))e.tags.push(['マイクロムーン','Micromoon','その年の地心距離範囲のうち、遠い側10％に入る満月']);
 }
 const result={events:events.filter(e=>e.at>=start&&e.at<end),minDistanceKm:min,maxDistanceKm:max};years.set(key,result);return result;
}
function describe(at,state,A){const day=localDate(at),event=calendar(Number(day.slice(0,4)),A).events.find(e=>localDate(e.at)===day);
 if(event)return {ja:MAJOR[event.kind][0],en:MAJOR[event.kind][1],event};
 const crescent=state.illuminatedFraction<.5;
 return state.waxing?{ja:'満ちゆく月',en:crescent?'Waxing Crescent':'Waxing Gibbous'}:{ja:'欠けゆく月',en:crescent?'Waning Crescent':'Waning Gibbous'};
}
const api={MONTHS,MAJOR,calendar,describe,elong};g.SoramiLunarNames=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
