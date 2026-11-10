// 2026-11-10 Trial only. 対象を追加・編集する画面に、地図の＋の近くにあるPLATEAUの建物を並べる。選ぶと名前・位置
// （一番高い部分の中心）・地上からの高さが入る。保存の形は変えない（本番と共通のアカウント）。保存した対象がその建物の
// 上にあって高さも合えば、試用版の見え方と新しい地点の探索がPLATEAUの形を使う（experiments/candidate-visibility/plateau-buildings.js）。
export function patchPlateauTargetUi(source){
 const one=(from,to)=>{if(source.split(from).length!==2)throw Error('PLATEAU target boundary changed: '+from.slice(0,60));source=source.replace(from,to);};
 one('<label>名前<input type="text" class="fav-in" data-target-name',
  '<div class="target-plateau" data-target-plateau hidden><p class="tiny">PLATEAUの建物（地図の＋の近く）。選ぶと形・位置・高さを使います</p><div data-target-plateau-list></div></div><label>名前<input type="text" class="fav-in" data-target-name');
 one('map.onMove?.(()=>{request.cancel();syncDirty();});','map.onMove?.(()=>{request.cancel();syncDirty();plateauNear();});');
 one('map.open(L.point(center)?center:{latitude:35.68,longitude:139.76},16);s.editorBaseline=editorSignature();',
  'map.open(L.point(center)?center:{latitude:35.68,longitude:139.76},16);s.editorBaseline=editorSignature();plateauNear();');
 one(' function openEditor(target=null){',String.raw` let plateauTimer=0,plateauSeq=0;
 function plateauNear(){
  clearTimeout(plateauTimer);
  plateauTimer=setTimeout(async()=>{
   const box=q('[data-target-plateau]'),host=q('[data-target-plateau-list]'),api=globalThis.AstroNotesPlateauShapes,c=map?.center?.();
   if(!box||!host||!api||editor.hidden||!c||!L.point(c)){if(box)box.hidden=true;return;}
   const seq=++plateauSeq;let list=[];try{list=await api.near(c.latitude,c.longitude,{radiusM:250,limit:6});}catch{list=[];}
   if(seq!==plateauSeq||editor.hidden||!valid(state))return;
   host.replaceChildren(...list.map(b=>{const button=d.createElement('button');button.type='button';button.className='list-item';button.dataset.plateauBuilding=b.id;
    button.textContent=(b.name||'名前のない建物')+' ・ 高さ'+Math.round(b.heightM)+'m'+(b.distanceM?' ・ '+b.distanceM+'m先':'');
    button.onclick=()=>move({latitude:b.latitude,longitude:b.longitude,name:b.name||'',targetHeightM:Math.round(b.heightM*10)/10,zoom:18});return button;}));
   box.hidden=!list.length;
  },350);
 }
 function openEditor(target=null){`);
 return source;
}
