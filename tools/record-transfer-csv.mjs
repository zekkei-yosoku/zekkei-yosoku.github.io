// Flat, editable CSV: one row per place/target. Converts to the existing portable
// graph so preview, validation, deduplication and atomic storage have one owner.
export function createRecordCsv(){
 const headers=['地点ID','地点名','緯度','経度','標高_m','手動標高_m','目線_m','目線下限_m','目線上限_m','対象','天体','重ねる位置','天体の縁','位置指定','形状','住所','メモ','根拠URL','高さ根拠','座標根拠URL','調査日','対象名','対象緯度','対象経度','対象標高_m','対象高_m','対象カテゴリ','結果'];
 const fail=(line,message)=>{throw Error('CSV '+line+'行目：'+message);};
 function rows(text){
  text=text.replace(/^\uFEFF/,'');const out=[];let row=[],cell='',quoted=false,closed=false,line=1,start=1;
  const push=()=>{row.push(cell);cell='';closed=false;};
  for(let i=0;i<text.length;i++){
   const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else{cell+=c;if(c==='\n')line++;}continue;}
   if(c===','){push();continue;}if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;push();if(row.some(x=>x.trim()))out.push({line:start,cells:row});row=[];line++;start=line;continue;}
   if(closed)fail(line,'引用符の後はカンマか改行にしてください');if(c==='"'){if(cell)fail(line,'引用符の位置を確認してください');quoted=true;}else cell+=c;
  }
  if(quoted)fail(line,'引用符が閉じられていません');push();if(row.some(x=>x.trim()))out.push({line:start,cells:row});return out;
 }
 function parse(text){
  if(typeof text!=='string'||text.includes('\uFFFD'))throw Error('CSVはUTF-8で保存してください');
  const table=rows(text);if(table.length<2)throw Error('CSVに撮影地点がありません');if(table.length>15001)throw Error('CSVは15000行以内にしてください');
  const names=table.shift().cells.map(x=>x.trim());while(names.at(-1)==='')names.pop();if(new Set(names).size!==names.length||names.some(x=>!headers.includes(x)))throw Error('CSVの列名が重複しているか、対応していません');
  for(const name of ['地点名','緯度','経度'])if(!names.includes(name))throw Error('CSVに「'+name+'」の列がありません');
  const places=new Map(),targets=new Map(),aliases={'東京スカイツリー':'skytree','スカイツリー':'skytree','東京タワー':'tokyotower','富士山':'fuji'},bodyAliases={'太陽':'sun','月':'moon','シリウス':'sirius','水星':'mercury','金星':'venus','火星':'mars','木星':'jupiter','土星':'saturn'};
  for(const entry of table){
   const {line,cells}=entry;while(cells.length>names.length&&cells.at(-1)==='')cells.pop();if(cells.length!==names.length)fail(line,'列数が見出しと一致しません');
   const r=Object.fromEntries(names.map((n,i)=>[n,cells[i].trim()])),str=k=>r[k]||'',num=k=>{const s=str(k);if(!s)return null;if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)||!Number.isFinite(Number(s)))fail(line,k+'は数値にしてください');return Number(s);};
   const latitude=num('緯度'),longitude=num('経度');if(latitude==null||longitude==null)fail(line,'緯度・経度を入力してください');
   const location={name:str('地点名'),latitude,longitude,elevation:num('標高_m'),groundManualM:num('手動標高_m'),eyeHeightAGL:num('目線_m'),subtitle:str('住所'),note:str('メモ'),terrain:null,phenomena:[],locationScope:'point'};
   const min=num('目線下限_m'),max=num('目線上限_m');if((min==null)!==(max==null))fail(line,'目線の下限と上限を両方入力してください');if(min!=null)location.eyeHeightRangeAGL={min,max};
   let shape=null;if(str('形状'))try{shape=JSON.parse(str('形状'));}catch{fail(line,'形状のJSONを確認してください');}
   if(str('位置指定')){const type={'点':'point','線':'line','範囲':'area',point:'point',line:'line',area:'area'}[str('位置指定')];if(!type||type!==(shape?.type||'point'))fail(line,'位置指定と形状が一致しません');}
   const bodies=str('天体')?[...new Set(str('天体').split('|').map(x=>bodyAliases[x.trim()]||x.trim()))].sort():null;
   const signature=JSON.stringify([location,shape,bodies]),id=str('地点ID')||signature;
   let place=places.get(id);if(place&&place.signature!==signature)fail(line,'同じ地点IDの場所・高さ・天体が一致しません');
   if(!place){place={id:'p'+(places.size+1),location,shape,bodies,targets:[],signature,notes:new Set()};places.set(id,place);}
   for(const k of ['根拠URL','高さ根拠','座標根拠URL','調査日'])if(str(k))place.notes.add(k+'：'+str(k));
   if(!str('対象')){if(['対象名','対象緯度','対象経度','対象標高_m','対象高_m','対象カテゴリ','重ねる位置','天体の縁','結果'].some(k=>str(k)))fail(line,'対象の指定がありません');continue;}
   const key=aliases[str('対象')]||str('対象');let definition;
   if(key==='custom'){
    const lat=num('対象緯度'),lon=num('対象経度'),height=num('対象高_m');if(!str('対象名')||lat==null||lon==null||height==null)fail(line,'独自対象は名前・緯度・経度・高さが必要です');
    definition={kind:'custom',name:str('対象名'),location:{name:str('対象名'),latitude:lat,longitude:lon,elevation:num('対象標高_m'),eyeHeightAGL:null},heightM:height,category:str('対象カテゴリ')};
   }else {if(['対象緯度','対象経度','対象標高_m','対象高_m','対象カテゴリ'].some(k=>str(k)))fail(line,'独自対象の定義には対象をcustomと指定してください');definition={kind:'builtin',key,name:str('対象名')||str('対象')};}
   const identity=definition.kind==='builtin'?'builtin:'+definition.key:JSON.stringify(definition);let target=targets.get(identity);if(!target){target={id:'t'+(targets.size+1),...definition};targets.set(identity,target);}
   const part=str('重ねる位置'),whole=!part||part==='全体'||part==='全て'||part==='__whole',limb={'真ん中':'center','下の縁':'onTop','上の縁':'behind'}[str('天体の縁')]||str('天体の縁')||'center';
   if(!['center','onTop','behind'].includes(limb))fail(line,'天体の縁の指定を確認してください');
   const result=({'見える':'seen','一部':'partial','見えない':'hidden'}[str('結果')]||str('結果')||'seen');if(!['seen','partial','hidden'].includes(result))fail(line,'結果の指定を確認してください');
   const binding={ref:target.id,result,alignment:{partId:whole?'__whole':part,limb:whole?'center':limb,matchMode:whole?'overlap':'limb'}};
   const previous=place.targets.find(t=>t.ref===binding.ref);if(previous&&JSON.stringify(previous)!==JSON.stringify(binding))fail(line,'同じ地点・対象の重ね方や結果が一致しません');if(!previous)place.targets.push(binding);
  }
  return {format:'astronotes.places',version:1,targets:[...targets.values()],places:[...places.values()].map(({signature,notes,...p})=>{const note=[p.location.note,...[...notes].sort()].filter(Boolean).join('\n');if(note.length>2000)throw Error('CSV「'+p.location.name+'」のメモ・根拠が2000文字を超えています');return {...p,location:{...p.location,note}};})};
 }
 return {headers,rows,parse};
}
