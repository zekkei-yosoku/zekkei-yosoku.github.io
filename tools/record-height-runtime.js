// A solver belongs to one caller's job: its bounded memo must never cross owner/revision/air epochs.
function recordHeightSolver(deps){
 return createRecordHeightCandidates({shooting:AstroNotesShooting,align:AstroNotesAlign,bodies:AstroNotesBodies,atmosphere:AstroNotesAtmosphere,astro:AstroNotesAstro,terrain:AstroNotesTerrain,scanHeights:scanRecordHeights,preferHeights:preferRecordHeight,rangeOf:p=>RecordHeight.range(p.eyeHeightRangeAGL),isMountain:aimIsMountain,ensureModels:()=>AstroNotesAssets.ensureModels(),mountainRidge:async(obs,target)=>{const eye=obs.elevation+obs.eyeM,ridge=await aimLookRidge(obs,eye,target,{});return ridge?{ridge,cap:aimSummitCap(ridge,obs,eye,target)}:null;},...deps});
}
