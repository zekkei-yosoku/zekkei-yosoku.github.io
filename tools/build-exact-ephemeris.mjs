import {createExactTimeMemo} from './exact-time-memo.mjs';
const patch=(s,from,to)=>{
 if(s.split(from).length!==2)throw Error('Exact ephemeris boundary changed: '+from);
 return s.replace(from,to);
};

// Only the trial generator calls this. Keep all original astronomical equations,
// topocentric corrections, atmosphere application and search tolerances intact.
export function patchExactEphemeris(source){
 let s=patch(source,'  function sunPosition(ms) {','  function uncachedSunPosition(ms) {');
 s=patch(s,'  function moonGeocentric(ms) {','  function uncachedMoonGeocentric(ms) {');
 return patch(s,'  const DEG = Math.PI / 180;',
  '  const memoExactTime='+createExactTimeMemo.toString()+';\n'+
  '  const cachedSunPosition=memoExactTime(uncachedSunPosition),cachedMoonGeocentric=memoExactTime(uncachedMoonGeocentric);\n'+
  '  function sunPosition(ms){return cachedSunPosition(ms);}\n'+
  '  function moonGeocentric(ms){return cachedMoonGeocentric(ms);}\n'+
  '  const DEG = Math.PI / 180;');
}
