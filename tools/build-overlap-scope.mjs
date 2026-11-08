import {readFileSync} from 'node:fs';
import {createOverlapPolicy} from './overlap-scope-policy.mjs';
// Trial-only "重ねる対象" adapters. Every hook is optional-chained so an absent
// runtime keeps the existing single main-target behaviour.
const patch=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Overlap scope boundary changed: '+a.slice(0,100));return s.replace(a,b);};
const O='globalThis.AstroNotesTrialOverlap';
export function overlapRuntime(){return patch(readFileSync(new URL('./overlap-scope-runtime.js',import.meta.url),'utf8'),'(/* OVERLAP_POLICY */)','('+createOverlapPolicy.toString()+')');}
// Candidate search bundle: generic search, evaluator frame, UI plan, composition editor.
export function overlapCandidateSearch(s){
 s=patch(s,'p.extraTargets,p.requireAllTargets]);}','p.extraTargets,p.requireAllTargets,...(p.overlapMembers?[p.overlapMembers]:[])]);}');
 s=patch(s,'const inverse=await Composition.inverseSeeds(plan,{bodies,isCurrent:wanted,yieldTask,...inverseOptions});',`const inverse=await (root.AstroNotesTrialOverlap?.inverse?.(plan,p=>Composition.inverseSeeds(p,{bodies,isCurrent:wanted,yieldTask,...inverseOptions}))??Composition.inverseSeeds(plan,{bodies,isCurrent:wanted,yieldTask,...inverseOptions}));`);
 s=patch(s,'const tested=await evaluate({...plan,requestKey:key},point,session.data,{isCurrent:wanted,signal});',`const tested=await (root.AstroNotesTrialOverlap?.evaluate?.(plan,p=>evaluate({...p,requestKey:key},point,session.data,{isCurrent:wanted,signal}))??evaluate({...plan,requestKey:key},point,session.data,{isCurrent:wanted,signal}));`);
 // A non-anchor member of 全て is framed like the preview, which centres the anchor.
 s=patch(s,'const frame=lensCheck(plan,solution.observer,state,solution.geometry,align);','const frame=plan.overlapAnchor?lensCheck({...plan,target:plan.overlapAnchor.target,partId:plan.overlapAnchor.partId},solution.observer,state,align.geometryFrom(solution.observer,plan.overlapAnchor.target,{eyeM:solution.observer.eyeM})||solution.geometry,align):lensCheck(plan,solution.observer,state,solution.geometry,align);');
 s=patch(s,'...(globalThis.AstroNotesTrialComposition?.plan(s)||{})};','...(globalThis.AstroNotesTrialComposition?.plan(s)||{}),...('+O+'?.searchPlan?.(s)||{})};');
 s=patch(s,"(p?.extraTargets?.length?'複数対象では先頭の対象を主に探します。ほかの対象は見え方で一緒に確認できます。 ':'')","(p?.overlapMembers?'全ての対象を合わせた輪郭に重なる地点を探します。':p?.extraTargets?.length?'重ねる対象で探します。ほかの対象は見え方で一緒に確認できます。 ':'')");
 s=patch(s,'const key=JSON.stringify([owner(),s?.target,s?.body,s?.partId,s?.limb,s?.matchMode]);','const key=JSON.stringify([owner(),s?.target,s?.body,s?.partId,s?.limb,s?.matchMode,'+O+'?.key?.(s)??null]);');
 s=patch(s,"if(!t||!st.host.closest('#exploreScenePanel')){","if(!t||!st.host.closest('#exploreScenePanel')||"+O+"?.isAll?.(s)){");
 return s+'\n'+overlapRuntime()+'\n';
}
// Explore asset: condition summary.
export function overlapExploreController(s){
 return patch(s,'globalThis.AstroNotesTrialComposition?.label?.(s)||alignment',O+'?.label?.(s)||globalThis.AstroNotesTrialComposition?.label?.(s)||alignment');
}
export function overlapMyplaces(s){
 s=patch(s,"{body=null,key='',change}","{body=null,key='',summitOnly=false,change}");
 s=patch(s,'host.append(label,limbs);','if(summitOnly)label.style.display="none";host.append(label,limbs);');
 s=patch(s,'JSON.stringify([target?.id,options,!!AstroNotesBodies.definition(body)?.limbs])',
  'JSON.stringify([target?.id,options,!!AstroNotesBodies.definition(body)?.limbs,summitOnly])');
 s=patch(s,"detail.hidden=!s?.target||"+O+"?.isAll(s)===true;",
  "const summitOnly=aimIsMountain(s?.target);detail.hidden=!s?.target||"+O+"?.isAll(s)===true||summitOnly&&!AstroNotesBodies.definition(s.body)?.limbs;");
 return patch(s,'alignmentControls(host,s.target,s,{body:s.body,change:',
  'alignmentControls(host,s.target,s,{body:s.body,summitOnly,change:');
}
// Inline document: picker, backdrop, candidate dates, figure accent, share/plan/record.
export function overlapHtml(html){
 html=patch(html,'  // Explicit shared/history/manual alignment must survive map refresh and scene projection.',`  if(aimIsMountain(session.target)&&!${O}?.isAll(session)){
   session.partId=session.target.parts[0].id;
   session.limb=session.matchMode==='limb'&&AstroNotesBodies.definition(session.body)?.limbs
    ?AstroNotesAlign.limbById(session.limb).id:'center';
   session.matchMode='limb';
   return;
  }
  // Explicit shared/history/manual alignment must survive map refresh and scene projection.`);
 html=patch(html,"session.matchMode='overlap';session.body=body;","if(!aimIsMountain(session.target))session.matchMode='overlap';session.body=body;");
 html=patch(html,'return aimTargetList().filter((t) => ids.has(t.id));','return aimTargetList().map((t) => t.id === "custom" && '+O+'?.custom?.() || t).filter((t) => ids.has(t.id));');
 html=patch(html,"main=ordered[0]?.id??'';aimSetSceneExtras(ordered.slice(1).map(t=>t.id));","main="+O+"?.chooseMain?.(ordered.map(t=>t.id),current?.id)??ordered[0]?.id??'';aimSetSceneExtras(ordered.map(t=>t.id).filter(id=>id!==main));");
 html=patch(html,'const syncSky=()=>{','const syncSky=()=>{queueMicrotask(()=>'+O+'?.sync?.());');
 html=patch(html,'key=JSON.stringify([inputKey,plan.ground]);','key=JSON.stringify([inputKey,plan.ground,'+O+'?.key?.(plan)??null]);');
 html=patch(html,'entry.promise=aimBuildingDays(obs,snapshot.target','entry.promise=('+O+'?.buildingDays?.(aimBuildingDays,plan)||aimBuildingDays)(obs,snapshot.target');
 html=patch(html,'entry.morePromise=aimBuildingDays(entry.obs,','entry.morePromise=('+O+'?.buildingDays?.(aimBuildingDays,session)||aimBuildingDays)(entry.obs,');
 html=patch(html,'ctx.restore();buildingCache={key:nextBuildingKey',O+'?.accent?.(ctx,{scene,t,shape,sceneBottom});ctx.restore();buildingCache={key:nextBuildingKey');
 html=patch(html,'=AstroNotesPlan.mapLink(s.observer);s.payload=payload;','=AstroNotesPlan.mapLink(s.observer);'+O+'?.annotate?.(kind,s,payload);s.payload=payload;');
 html=patch(html,'aim.pendingPlan=p;','aim.pendingPlan=p;'+O+'?.restore?.(p);');
 html=patch(html,"if(kind==='place')result=MyPlacesUI.quickRecord(","if(kind==='place')result="+O+"?.quickRecord?.(cur)??MyPlacesUI.quickRecord(");
 return html;
}
