const assert = require('node:assert/strict');

module.exports = async function checkOpportunityBack(page, engine, ready) {
 const cdp = engine === 'chrome' ? await page.context().newCDPSession(page) : null;
 const swipe = async ({start = 8, distance = 156, cancel = false} = {}) => {
  const y = 210;
  const moves = [0, .35, .65, 1].map(fraction => ({x: start + distance * fraction, y}));
  if (cdp) {
   for (const [index, point] of moves.entries()) {
    await cdp.send('Input.dispatchTouchEvent', {type: index ? 'touchMove' : 'touchStart', touchPoints: [{...point, id: 0}]});
    await page.waitForTimeout(22);
   }
   await cdp.send('Input.dispatchTouchEvent', {type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: []});
  } else {
   await page.evaluate(({moves, cancel}) => {
    const target = document.elementFromPoint(moves[0].x, moves[0].y);
    for (const [index, point] of [...moves, moves.at(-1)].entries()) {
     const touch = {identifier: 0, target, clientX: point.x, clientY: point.y};
     const type = index === moves.length ? (cancel ? 'touchcancel' : 'touchend') : index ? 'touchmove' : 'touchstart';
     const event = new Event(type, {bubbles: true, cancelable: true});
     Object.defineProperty(event, 'touches', {value: index === moves.length ? [] : [touch]});
     target.dispatchEvent(event);
    }
   }, {moves, cancel});
  }
 };
 const pointsTab = page.locator('#notebookPointsTab');
 const openMenu = page.locator('#toolsMenu.on:not([hidden])');
 const point = page.locator('[data-notebook-place="p1"]');
 const shortcut = point.locator('..').locator('.journey-place-find');
 const scope = page.locator('#recordOpportunityScope');
 const sheet = page.locator('#myPlaceSheet');
 const checkBackLabel = async selector => {
  const button = page.locator(selector).locator('[data-ui-control="back"] .ui-back-label');
  await button.waitFor({state: 'visible'});
  assert.equal(await button.innerText(), '戻る');
  assert.equal(await button.evaluate(label => label.previousElementSibling.querySelector('path').getAttribute('d')), 'm14 5-7 7 7 7');
 };
 try {
  await pointsTab.click();
  await shortcut.click();
  await ready(page);
  await checkBackLabel('#recordOpportunityScope');
  await swipe({start: 60});
  assert(await scope.isVisible(), 'a swipe away from the screen edge stays on the list');
  await swipe({distance: 18});
  assert(await scope.isVisible(), 'a short edge swipe stays on the list');
  await swipe({cancel: true});
  assert(await scope.isVisible(), 'a cancelled edge swipe stays on the list');
  assert.equal(await openMenu.count(), 0);
  await swipe();
  await point.waitFor({state: 'visible'});
  assert.equal(await pointsTab.getAttribute('aria-selected'), 'true');
  assert.equal(await openMenu.count(), 0);
  await page.waitForFunction(() => document.activeElement?.classList.contains('journey-place-find'));
  await page.waitForTimeout(125);

  await point.click();
  await page.locator('#myPlacePlanning > summary').click();
  await page.locator('#myPlaceFind').click();
  await ready(page);
  await swipe();
  await sheet.waitFor({state: 'visible'});
  await checkBackLabel('#myPlaceSheet > .sheet-head');
  assert(await page.locator('#myPlacePlanning').evaluate(node => node.open));
  assert.equal(await openMenu.count(), 0);
  await page.waitForTimeout(125);
  await page.locator('#myPlaceFind').click();
  await ready(page);
  await page.locator('#recordOpportunityScopeBack').click();
  await sheet.waitFor({state: 'visible'});
  assert(await page.locator('#myPlacePlanning').evaluate(node => node.open));
  await sheet.locator('.page-back').click();
  await sheet.waitFor({state: 'hidden'});
  await page.waitForFunction(() => !pagePop.n);

  await page.locator('#notebookOpportunitiesTab').click();
  await ready(page);
  await swipe();
  await openMenu.waitFor({state: 'visible'});
  await page.evaluate(() => closeTools());
  await openMenu.waitFor({state: 'hidden'});
  await page.evaluate(() => navigationHistory.pushRoute('#/explore'));
  await page.waitForFunction(() => TrialExplore.active() && SkyMapUI.workspaceHost());
  await page.evaluate(() => {
   SkyMapUI.setTarget('skytree');
   const body = document.getElementById('skyMapBody');
   body.value = 'moon';
   body.onchange();
   SkyMapUI.setTime(Date.parse('2026-11-25T12:00:00+09:00'));
  });
  await page.waitForFunction(() => SkyMapUI.selectionState().target?.id === 'skytree' && MyPlacesUI.opportunities.covers('skytree','moon'));
  await page.evaluate(() => document.dispatchEvent(new Event('astronotes-explore-open-opportunities')));
  await page.waitForFunction(() => location.hash === '#/records');
  await ready(page);
  await swipe();
  await page.waitForFunction(() => location.hash === '#/explore' && TrialExplore.active());
  assert.equal(await openMenu.count(), 0);
  assert.equal(await page.evaluate(() => SkyMapUI.selectionState().target?.id), 'skytree');
  await page.evaluate(() => navigationHistory.pushRoute('#/records'));
  await page.waitForTimeout(125);
  await page.locator('#authButton').click();
  await page.locator('#settingsScreen').click();
  await checkBackLabel('#appSettings > .sheet-head');
  await page.locator('#settingsBack').click();
  await page.locator('#settingsAccount').click();
  await checkBackLabel('#accountSheet > .sheet-head');
  await page.locator('#accountBack').click();
  await page.locator('#appSettingsClose').click();
  return {shortcut: true, placeDetails: true, backButtonMatches: true, mainTabKeepsMenu: true, explore: true, sharedBackLabels: true, driver: cdp ? 'CDP touch' : 'DOM touch'};
 } finally {
  if (cdp) await cdp.detach();
 }
};
