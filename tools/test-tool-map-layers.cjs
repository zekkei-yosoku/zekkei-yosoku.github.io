// Shared map layers and satellite location roles, with fixture auth, tiles and TLE.
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const base = new URL(process.env.TOOL_MAP_BASE || 'http://127.0.0.1:8996/trial/');
const tle = readFileSync(process.env.TOOL_MAP_TLE || new URL('../fixtures/iss-20260929.tle', 'file://' + __filename), 'utf8');
const names = ['標準', '航空写真', '地形'];
const tools = ['iss', 'plane', 'skymap', 'records', 'tower', 'diamond', 'pearl', 'multiscene'];
const tile = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOYMGECAANkAbHtuOatAAAAAElFTkSuQmCC","base64");

async function run(browserName, browser, width, height) {
  const context = await browser.newContext({
    viewport: { width, height }, hasTouch: true, timezoneId: 'Asia/Tokyo',
    colorScheme: width === 320 ? 'light' : 'dark', serviceWorkers: 'block'
  });
  try {
    await context.addInitScript(tools => {
      window.toolMapVibrations=[];
      Object.defineProperty(navigator,'vibrate',{configurable:true,value:ms=>{window.toolMapVibrations.push(ms);return true;}});
      localStorage.setItem('sorami.place',JSON.stringify({name:'試験用の保存公園',latitude:35.57,longitude:139.56}));
      sessionStorage.setItem('sorami.token', JSON.stringify({token:'synthetic-tool-map', loginId:'tool-map-test', role:'user', tools}));
      localStorage.setItem('sorami.mapLayer', JSON.stringify('photo'));
    }, tools);
    const tiles = new Set();
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === base.origin) return route.continue();
      if (url.hostname === 'celestrak.org') return route.fulfill({body:tle,contentType:'text/plain'});
      if (url.hostname === 'cyberjapandata.gsi.go.jp') {
        const kind = url.pathname.split('/')[2];
        if (['seamlessphoto','pale','hillshademap'].includes(kind)) {
          tiles.add(kind);
          return route.fulfill({body:tile,contentType:'image/png'});
        }
      }
      if (/zekkei-api|localhost:8787/.test(url.origin)) return route.fulfill({
        json:{allowed:true,tool:url.pathname==='/tools/skymap/access'?'skymap':'iss',loginId:'tool-map-test',role:'user',tools,credentials:[],favorites:[],sightings:[],records:[],rev:1}
      });
      return route.abort();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.clock.setFixedTime(new Date('2026-09-30T00:00:00+09:00'));
    await page.goto(new URL('index.html?verify=tool-map#/almanac', base).href);
    await page.waitForFunction(() => typeof navigationHistory!=='undefined'&&typeof AstroNotesTerrain!=='undefined');
    await page.evaluate(()=>{
      AstroNotesTerrain.waterAt=async points=>points.map(()=>false);
      navigationHistory.pushRoute('#/iss');
    });
    await page.waitForFunction(() => typeof issUi!=='undefined'&&issUi.state==='ready'&&iss.standsDone&&!!issSelected()?.mapTrack);

    const go = async (route, root) => {
      await page.evaluate(route => navigationHistory.pushRoute('#/' + route), route);
      await page.locator(root+' .map-layers-btn:visible').first().waitFor();
    };
    const choose = async (root, layer, remembered) => {
      const surface = page.locator(root);
      const trigger = surface.getByRole('button', {name:'地図の種類'});
      await trigger.click();
      const menu = surface.getByRole('menu', {name:'地図の種類'});
      assert.deepEqual((await menu.getByRole('menuitemradio').allTextContents()).map(s => s.trim()), names);
      assert.equal(await menu.getByRole('menuitemradio').filter({hasText:remembered}).getAttribute('aria-checked'),'true');
      const box=await menu.boundingBox(), map=await surface.locator('canvas').first().boundingBox();
      assert(box.y>=map.y && box.y+box.height<=map.y+map.height, JSON.stringify({width,height,box,map}));
      await menu.getByRole('menuitemradio').filter({hasText:layer}).click();
      assert(await menu.isHidden());
    };
    const checkRail = async (root, extra = '') => {
      const controls = await page.locator(root).evaluate((node, extra) => [...node.querySelectorAll('.map-layers-btn,.mapzoom button' + extra)]
        .map(b => ({label:b.getAttribute('aria-label') || b.textContent, box:b.getBoundingClientRect().toJSON()})).filter(x => x.box.width), extra);
      const layer = controls.find(x => x.label === '地図の種類');
      assert(layer?.box.width >= 44 && layer.box.height >= 44, JSON.stringify(controls));
      assert(layer.box.top >= 0 && layer.box.bottom < height, JSON.stringify(layer));
      for (const other of controls.filter(x => x !== layer)) {
        const a=layer.box,b=other.box;
        assert(Math.min(a.right,b.right)-Math.max(a.left,b.left)<=1 || Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<=1, JSON.stringify([width,height,layer,other]));
      }
    };

    const checkZoom = async (root, readZoom) => {
      const surface = page.locator(root);
      const zoomIn = surface.getByRole('button', {name:/拡大$/,includeHidden:true});
      const zoomOut = surface.getByRole('button', {name:/縮小$/,includeHidden:true});
      const dimensions = await surface.locator('.mapzoom button>svg,.map-layers-btn>svg').evaluateAll(icons =>
        icons.map(icon => [getComputedStyle(icon).width, getComputedStyle(icon).height]));
      assert.deepEqual(dimensions, Array.from({length:4},()=>['26px','26px']));
      assert.equal(await zoomIn.locator('svg circle').count(),1);
      assert.equal(await zoomOut.locator('svg circle').count(),1);
      assert.equal(await zoomIn.locator('svg path').count(),2);
      assert.equal(await zoomOut.locator('svg path').count(),1);
      if (!await zoomIn.isVisible()) return; // 低い横画面はピンチで操作する
      const before = await page.evaluate(readZoom);
      await zoomIn.click();
      assert.equal(await page.evaluate(readZoom),before+1);
      await zoomOut.click();
      assert.equal(await page.evaluate(readZoom),before);
    };

    assert.equal(await page.locator('#issPassTab,#issFromButton').count(),0);
    assert(await page.locator('#issMoon').isVisible());
    assert(await page.locator('#issSun').isVisible());
    await checkRail('#issMapBox', ',.iss-map-head button');
    await checkZoom('#issMapBox', ()=>IssMap.zoom());
    await choose('#issMapBox', '標準', '航空写真');
    assert(await page.evaluate(()=>issSelected().mapTrack.length>20));
    const menu=page.locator('#issSuggestions');
    await page.locator('#issSuggestionsOpen').click();
    assert(!((await menu.innerText()).includes('試験用の保存公園')));
    assert(await page.locator('[data-iss-site]').count()>=1);
    const firstSite=await page.evaluate(()=>issSelected().sites[0]);
    const atText=await page.evaluate(at=>issHms(at), firstSite.at);
    assert((await page.locator('[data-iss-site]').first().innerText()).includes(atText));
    await page.locator('[data-iss-site]').first().click();
    assert(await menu.isHidden());
    assert.equal(await page.locator('#issTime').inputValue(),atText);
    assert.match(await page.locator('#issStatus').innerText(),new RegExp(atText));
    assert(await page.locator('.coord-row[data-map="iss"]').isVisible());
    const footerFits=await page.locator('#issTimeRow').evaluate(row=>[...row.children].every(b=>b.getBoundingClientRect().right<=innerWidth+1&&b.getBoundingClientRect().left>=-1));
    assert(footerFits);

    await page.evaluate(()=>{
      const daily=AstroNotesSkyMap.daily, next=issUi.at+1000;
      AstroNotesSkyMap.daily=(...args)=>({...daily(...args),events:[{at:next,side:'rise'}]});
      window.restoreDaily=()=>{AstroNotesSkyMap.daily=daily;};
    });
    await page.locator('#issTimeline').focus();
    await page.locator('#issTimeline').press('ArrowRight');
    assert.deepEqual(await page.evaluate(()=>window.toolMapVibrations),[16]);
    await page.evaluate(()=>window.restoreDaily());

    // With both bodies off the marker must follow the exact ruler instant.
    await page.evaluate(()=>{
      window.issMarkerLabels=[];
      const draw=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(text,...args){
        if(this.canvas.id==="issCanvas"&&String(text).startsWith("ISS "))window.issMarkerLabels.push(String(text));
        return draw.call(this,text,...args);
      };
    });
    await page.locator('#issMoon').click();
    await page.waitForFunction(()=>issUi.state==="orbit"&&issUi.orbit.length>2);
    assert.equal(await page.locator('#issMoon').getAttribute('aria-pressed'),'false');
    assert.equal(await page.locator('#issSun').getAttribute('aria-pressed'),'false');
    assert(await page.locator('#issSuggestionsOpen').isHidden());
    assert(await page.evaluate(()=>IssMap.zoom()<2));
    await page.waitForFunction(()=>window.issMarkerLabels.at(-1)==="ISS "+issHms(issUi.at));
    const before=await page.locator('#issTime').inputValue();
    await page.locator('#issTimeline').focus();
    await page.locator('#issTimeline').press('ArrowRight');
    await page.waitForFunction(()=>window.issMarkerLabels.at(-1)==="ISS "+issHms(issUi.at));
    const after=await page.locator('#issTime').inputValue();
    assert.notEqual(after,before);
    assert.match(await page.locator('#issStatus').innerText(),new RegExp(after));

    await page.locator('#issSun').click();
    await page.waitForFunction(()=>issUi.state==='ready'&&iss.standsDone&&!!issSelected()?.mapTrack);
    assert.match(await page.locator('#issStatus').innerText(),/太陽を横切る/);
    assert(await page.evaluate(()=>issUi.orbit.length>2));
    await page.evaluate(()=>{
      AstroNotesISS.transitsAsync=async()=>[];
      IssMap.setCenter(38,141);
    });
    await page.locator('#issSuggestionsOpen').click();
    await page.locator('#issSearchHere').click();
    await page.waitForFunction(()=>issUi.state==='ready'&&iss.result.length===0&&iss.from.latitude===38);
    assert.match(await page.locator('#issStatus').innerText(),/この日は太陽を横切る候補がありません/);
    assert(await page.locator('.coord-row[data-map="iss"]').isHidden());

    await go('plane', '#planeView');
    await page.locator('#planeView .plane-bar [data-plane-pane="list"]').click();
    await page.locator('#planeSheet [data-plane-pane="place"]').click();
    assert(await page.locator('#planeFromButton').isVisible());
    await page.locator('#planeSheetClose').click();
    await page.waitForFunction(()=>plane.observer);
    await page.evaluate(()=>{
      const daily=AstroNotesSkyMap.daily, next=plane.at+1000;
      AstroNotesSkyMap.daily=(...args)=>({...daily(...args),events:[{at:next,side:'rise'}]});
      window.restoreDaily=()=>{AstroNotesSkyMap.daily=daily;};
    });
    await page.locator('#planeTimeline').focus();
    await page.locator('#planeTimeline').press('ArrowRight');
    assert.deepEqual(await page.evaluate(()=>window.toolMapVibrations),[16,16]);
    await page.evaluate(()=>window.restoreDaily());
    await checkRail('#planeView .plane-map', ',.tool-map-actions button');
    await checkZoom('#planeView .plane-map', ()=>PlaneMap.zoom());
    await Promise.all([
      page.waitForRequest(request=>request.url().includes('/xyz/hillshademap/')),
      choose('#planeView .plane-map', '地形', '標準')
    ]);
    await go('explore', '#skyMapView');
    await choose('#skyMapView .sky-map-wrap', '航空写真', '地形');
    await page.waitForFunction(()=>SkyMapUI.workspaceHost()?.session);
    await page.evaluate(()=>{
      groundAt=async()=>30;
      SkyMapUI.workspaceHost().restoreObserver({latitude:35.58,longitude:139.56,name:'確認地点',groundManualM:30,eyeHeightAGL:1.5});
    });
    await page.waitForFunction(()=>SkyMapUI.workspaceHost()?.session.eye&&document.getElementById('skyMapView').classList.contains('map-ws'));
    await checkZoom('#skyMapView .sky-map-wrap', ()=>SkyMapUI.workspaceHost().map.zoom());
    await checkRail('#skyMapView .sky-map-wrap', ',#mapWsMode button');
    const exploreSizes = await page.locator('#mapWsMode svg').evaluateAll(icons => icons.map(icon => getComputedStyle(icon).width));
    assert.deepEqual(exploreSizes,['24px','28px','28px']);
    await page.evaluate(()=>{
      const s=SkyMapUI.workspaceHost().session;
      AstroNotesMapWorkspace.feedbackEvents=()=>[s.at+1000];
    });
    await page.locator('#skyMapTimeline').focus();
    await page.locator('#skyMapTimeline').press('ArrowRight');
    assert.deepEqual(await page.evaluate(()=>window.toolMapVibrations),[16,16,16]);
    await go('iss', '#issView');
    await choose('#issMapBox', '標準', '航空写真');
    await page.waitForFunction(() => IssMap.layer()==='map');
    assert(tiles.has('seamlessphoto') && tiles.has('pale') && tiles.has('hillshademap'), JSON.stringify([...tiles]));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({browserName,width,height,tiles:[...tiles]}));
  } finally { await context.close(); }
}

(async () => {
  for (const [name, engine, options] of [['chrome', chromium, {channel:'chrome'}], ['webkit', webkit, {}]]) {
    const browser = await engine.launch(options);
    try {
      for (const [width,height] of [[320,568],[390,844],[852,393]]) await run(name,browser,width,height);
    } finally { await browser.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
