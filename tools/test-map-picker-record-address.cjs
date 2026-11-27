const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright');

const base = new URL(process.env.MAP_PICKER_BASE || 'http://127.0.0.1:8998/trial/');
const grants = ['skymap', 'records', 'tower', 'diamond', 'pearl', 'multiscene'];
const recorded = {id: 'fixture-recorded', name: '記録した屋上', subtitle: '東京都渋谷区道玄坂二丁目',
 latitude: 35.65995, longitude: 139.7005, elevation: 41, eyeHeightAGL: 12, recordRegistered: true};
const bare = {...recorded, id: 'fixture-favorite', name: '記録のないお気に入り', latitude: 35.659, recordRegistered: false};
const selected = {latitude: 35.6595, longitude: 139.7005};
const unknown = {latitude: 35.6589, longitude: 139.6984};

async function check(browser, name) {
 const context = await browser.newContext({viewport: {width: 390, height: 844}, locale: 'ja-JP', hasTouch: true, colorScheme: 'dark'});
 try {
  await context.addInitScript(tools => {
   sessionStorage.setItem('sorami.token', JSON.stringify({token: 'synthetic-map-picker', loginId: 'map-picker', tools}));
  }, grants);
  const geocoded = [];
  await context.route('**/*', route => {
   const url = new URL(route.request().url());
   if (url.origin === base.origin) return route.continue();
   if (url.hostname === 'nominatim.openstreetmap.org' && url.pathname === '/reverse') {
    geocoded.push('osm');
    return route.fulfill({status: 503, json: {error: 'synthetic outage'}});
   }
   if (url.hostname === 'mreversegeocoder.gsi.go.jp') {
    const latitude = Number(url.searchParams.get('lat'));
    geocoded.push('gsi');
    return route.fulfill({json: latitude === selected.latitude ? {results: {muniCd: '13113', lv01Nm: '道玄坂二丁目'}} : {}});
   }
   if (/zekkei-api|localhost:8787/.test(url.origin)) return route.fulfill({json: {allowed: true, tool:'skymap', role:'user', loginId: 'map-picker', tools: grants, favorites: [], records: [], rev: 1}});
   return route.abort();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(16000);
  await page.goto(new URL('index.html?verify=picker-records#/almanac', base).href);
  await page.waitForFunction(() => typeof SkyMapUI === 'object' && globalThis.MyPlacesUI && typeof startupSessionReady !== 'undefined');
  await page.evaluate(async () => {await startupSessionReady;await AstroNotesAssets.ensureModels();navigationHistory.pushRoute('#/explore');});
  await page.waitForFunction(() => SkyMapUI.workspaceHost());
  await page.evaluate(({recorded, bare, selected}) => {
   groundAt = async () => 28.2;
   favorites = [recorded, bare];
   MyPlacesUI.imported();
   SkyMapUI.workspaceHost().restoreObserver({name: '確認用撮影地点', ...selected, groundManualM: 28.2});
   window.recordMapLabels = new Set();
   const original = CanvasRenderingContext2D.prototype.fillText;
   CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
    if (this.canvas.id === 'mapCanvas') recordMapLabels.add(text);
    return original.call(this, text, ...rest);
   };
  }, {recorded, bare, selected});
  const picker = page.locator('#placeSheet'), mapSheet = page.locator('#mapSheet');
  await page.locator('#mapWsTitle').click();
  await page.locator('#skyMapChoose').click();
  const map = async () => { await page.locator('#mapButton').click(); await mapSheet.waitFor({state: 'visible'}); };
  await map();
  assert.equal(await page.evaluate(() => MapPick.layer()), 'map');
  assert.equal(await page.evaluate(() => SkyMapUI.workspaceHost().map.layer()), 'map');
  await page.evaluate(p => MapPick.setView(p.latitude, p.longitude, 17), selected);
  await page.waitForFunction(name => recordMapLabels.has(name), recorded.name);
  assert.equal(await page.evaluate(name => recordMapLabels.has(name), bare.name), false);
  const mark = await page.locator('#mapCanvas').evaluate((node, point) => {
   const box = node.getBoundingClientRect(), [x, y] = MapPick.project(point.latitude, point.longitude);
   return {x: box.left + x, y: box.top + y};
  }, recorded);
  await page.mouse.click(mark.x, mark.y);
  await page.waitForFunction(p => MapPick.center().latitude === p.latitude && document.getElementById('mapSearch').value === p.name, recorded);

  // Choices made from a nested map take effect in the already open Explore map.
  await mapSheet.getByRole('button', {name: '地図の種類'}).click();
  await mapSheet.getByRole('menuitemradio', {name: '航空写真'}).click();
  await page.waitForFunction(() => MapPick.layer() === 'photo' && SkyMapUI.workspaceHost().map.layer() === 'photo');
  const search = mapSheet.locator('#mapSearch');
  await search.fill('東京都渋谷区 道玄坂2丁目');
  const match = mapSheet.locator('#mapSearchResults button').filter({hasText: recorded.name});
  await match.waitFor({state: 'visible'});
  assert.match(await match.innerText(), /記録[\s\S]*東京都渋谷区道玄坂二丁目/);
  await mapSheet.locator('#mapSearchGo').click();
  await page.waitForFunction(() => !document.getElementById('mapSearchResults').hasAttribute('aria-busy'));
  await match.click();
  await page.locator('#mapPick').click();
  await mapSheet.waitFor({state: 'hidden'});
  const address = picker.locator('#placeSelectedAddress');
  await address.waitFor({state: 'visible'});
  assert.match(await address.innerText(), /東京都渋谷区道玄坂二丁目/);
  assert.equal(await page.evaluate(() => SkyMapUI.selectionState().observer.standAglM), recorded.eyeHeightAGL);
  assert.deepEqual(geocoded, []);

  await picker.locator('#searchBox').fill('東京都渋谷区道玄坂');
  await picker.locator('#searchResults button').filter({hasText: recorded.name}).waitFor({state: 'visible'});
  await map();
  await page.evaluate(p => MapPick.setCenter(p.latitude, p.longitude), selected);
  await page.locator('#mapPick').click();
  await mapSheet.waitFor({state: 'hidden'});
  await page.waitForFunction(() => SkyMapUI.selectionState().observer.subtitle === '東京都渋谷区道玄坂二丁目');
  assert.match(await address.innerText(), /東京都渋谷区道玄坂二丁目/);
  assert.deepEqual(geocoded, ['osm', 'gsi']);

  await map();
  await page.evaluate(p => MapPick.setCenter(p.latitude, p.longitude), unknown);
  await page.locator('#mapPick').click();
  await mapSheet.waitFor({state: 'hidden'});
  assert.match(await address.innerText(), /緯度経度 35\.65890, 139\.69840/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({browser:name, knownAddress:true, fallback:true, noAddress:true, recordSearch:true, recordPins:true, layerAppliedLive:true}));
 } finally { await context.close(); }
}

(async () => {
 for (const [name, type, options] of [['chrome', chromium, {channel:'chrome'}], ['webkit', webkit, {}]]) {
  const browser = await type.launch(options);
  try { await check(browser, name); } finally { await browser.close(); }
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
