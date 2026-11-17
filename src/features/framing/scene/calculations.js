// Retain one observation for each live diagram. Sampling the sky is independent
// of the focal length, and the target's outline is independent of the camera.
const lookSkySamples = new WeakMap();
const lookTargetGeometry = new WeakMap();
const LOOK_PATH_STEP_SECONDS = 20;

function lookSkyFor(host, body, observer, frameDay) {
  const atmosphere = AstroNotesAtmosphere.dataKey?.();
  const key = JSON.stringify([body, observer.latitude, observer.longitude, observer.elevation, frameDay, atmosphere]);
  let sky = lookSkySamples.get(host);
  if (sky?.key !== key) {
    const samples = new Map();
    const sampleState = ms => {
      if (samples.has(ms)) return samples.get(ms);
      const state = AstroNotesBodies.state(body, ms, observer);
      const {azimuth, apparentAltitude, angularRadius, upperRadius, lowerRadius, illuminatedFraction, brightLimbZenithAngle} = state;
      const sample = {azimuth, apparentAltitude, angularRadius, upperRadius, lowerRadius, illuminatedFraction, brightLimbZenithAngle};
      // One day at 20 s and six hours on either side at 60 s fit in this bound.
      if (samples.size < 6000) samples.set(ms, sample);
      return sample;
    };
    sky = {key, sampleState};
    lookSkySamples.set(host, sky);
  }
  return sky;
}

async function warmLookEphemeris(host, body, observer, frameDay, isCurrent) {
  const {sampleState} = lookSkyFor(host, body, observer, frameDay);
  const end=frameDay+86400000;
  let started=performance.now();
  for(let at=frameDay;at<end;at+=LOOK_PATH_STEP_SECONDS*1000){
    sampleState(at);
    if(performance.now()-started>=4){
      await new Promise(resolve=>setTimeout(resolve,0));
      if(!isCurrent())return false;
      started=performance.now();
    }
  }
  return isCurrent();
}

function aimLookEphemeris(host, body, observer, frameDay, at, selectedAt, win, proj, frame) {
  const sky=lookSkyFor(host,body,observer,frameDay);
  const {sampleState} = sky;
  // Same axis means the angular projection is identical at any focal length.
  if (sky.az0 !== win.az0 || sky.alt0 !== win.alt0) {
    sky.az0 = win.az0;
    sky.alt0 = win.alt0;
    sky.path = null;
    sky.framePoints = null;
  }
  if (!sky.path || sky.at !== at || sky.selectedAt !== selectedAt) {
    sky.path = AstroNotesAlign.viewPath(body, observer, at, proj, win, {stepS:LOOK_PATH_STEP_SECONDS,includeAt: selectedAt, dayMs: frameDay, sampleState});
    sky.at = at;
    sky.selectedAt = selectedAt;
  }
  // 前日18時から翌日6時まで。画角の出入りは投影点を再利用して、その都度新しい枠で計算する。
  if (frame && !sky.framePoints) {
    sky.framePoints = AstroNotesAlign.frameDayPath(body, observer, frameDay, proj, { startMs: frameDay - 6 * 3600000, endMs: frameDay + 30 * 3600000, sampleState });
  }
  return {path:sky.path, framePoints:frame ? sky.framePoints : null, sampleState};
}

function aimLookSceneGeometry(host, observer, eyeM, targets, isMountain) {
  const align = AstroNotesAlign;
  const models = targets.map(t => t && (align.CITY_MODELS?.[t.id] || align.TOWER_MODELS?.[t.id] || null));
  const targetKeys = targets.map(t => t && [t.id, t.latitude, t.longitude, t.groundM, t.parts, t.rim]);
  const key = JSON.stringify([observer.latitude, observer.longitude, observer.elevation, eyeM, AstroNotesAtmosphere.targetK(), isMountain, targetKeys]);
  let geometry = lookTargetGeometry.get(host);
  if (geometry?.key !== key || !models.every((model, i) => model === geometry.models[i])) {
    const scene = align.sceneTargets(observer, targets, {eyeM});
    const primary = scene.find(item => item.target === targets[0]);
    const outline = isMountain ? null : primary && !targets[0].rim ? primary.outline : align.towerOutline(observer, targets[0], {eyeM});
    geometry = {key, models, outline, rows:scene.map(item => ({item, index:targets.indexOf(item.target)}))};
    lookTargetGeometry.set(host, geometry);
  }
  // Rendering assigns projected paths and async terrain to its own scene records.
  const scene = geometry.rows.map(({item, index}) => ({...item, target:targets[index]}));
  return {outline:geometry.outline, scene};
}

export {aimLookEphemeris,aimLookSceneGeometry,warmLookEphemeris};
