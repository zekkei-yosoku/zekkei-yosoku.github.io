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
    await page.goto(new URL('index.html?verify=tool-map#/iss', base).href);
    await page.waitForFunction(() => typeof issUi !== 'undefined' && issUi.state === 'ready');

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

    assert.equal(await page.locator('#issPassTab').innerText(),'空を通る');
    assert.equal(await page.locator('#issTransitTab').innerText(),'月・太陽を横切る');
    assert.equal(await page.locator('#issMapBox #issFromButton').count(),0);
    await checkRail('#issMapBox', ',.iss-map-head button');
    await choose('#issMapBox', '標準', '航空写真');
    await page.locator('#issSuggestionsOpen').click();
    assert.equal(await page.locator('#issFromLabel').innerText(),'観察地');
    await page.locator('#issFromButton').click();
    assert.equal(await page.locator('#placeSheetTitle').textContent(),'観察地');
    await page.locator('#placeSheet .page-back').click();
    await page.locator('#issSuggestionsClose').click();

    await page.evaluate(() => { AstroNotesTerrain.waterAt=async points=>points.map(()=>false); });
    await page.locator('#issTransitTab').click();
    await page.waitForFunction(() => issUi.state==='ready' && iss.standsDone && iss.result.length>0);
    assert.match(await page.locator('#issStatus').innerText(),/月を横切る .*見える帯/);
    assert(await page.locator('.coord-row[data-map="iss"]').isVisible());
    await checkRail('#issMapBox', ',.iss-map-head button');
    await page.locator('#issSuggestionsOpen').click();
    assert.equal(await page.locator('#issFromLabel').innerText(),'探すエリアの中心');
    await page.locator('#issFromButton').click();
    assert.equal(await page.locator('#placeSheetTitle').textContent(),'探すエリアの中心');
    await page.locator('#placeSheet .page-back').click();
    await page.locator('#issSuggestionsClose').click();

    await page.evaluate(() => { AstroNotesISS.transitsAsync = async () => []; });
    await page.locator('#issSun').click();
    await page.waitForFunction(() => issUi.state==='ready' && iss.result.length===0);
    assert.match(await page.locator('#issStatus').innerText(),/この日は太陽を横切る候補がありません/);
    assert(await page.locator('.coord-row[data-map="iss"]').isHidden());
    await page.locator('#issPassTab').click();
    await page.waitForFunction(() => issUi.state==='ready');
    await page.locator('#issTransitTab').click();
    await page.waitForFunction(() => issUi.state==='ready');
    const zoom = await page.evaluate(() => IssMap.zoom());
    assert(zoom >= 8, 'no-result transit returns to regional scale');

    await go('plane', '#planeView');
    await checkRail('#planeView .plane-map', ',.tool-map-actions button');
    await Promise.all([
      page.waitForRequest(request=>request.url().includes('/xyz/hillshademap/')),
      choose('#planeView .plane-map', '地形', '標準')
    ]);
    await go('explore', '#skyMapView');
    await choose('#skyMapView .sky-map-wrap', '航空写真', '地形');
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
