// Synthetic account/API only. Inspect startup while JavaScript and /me are held.
const {chromium, webkit} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.START_BASE || 'http://127.0.0.1:8888/';
const out = process.env.START_OUT || '/tmp/astronotes-startup-wait';
const tools = ['diamond', 'pearl', 'tower', 'skymap', 'records'];

(async () => {
  fs.mkdirSync(out, {recursive: true});
  const browser = await (process.env.START_ENGINE === 'webkit'
    ? webkit.launch({headless: true})
    : chromium.launch({channel: 'chrome', headless: true}));
  const rows = [];
  async function boot(width, theme, {holdScript = true, failImage = false} = {}) {
    const context = await browser.newContext({viewport: {width, height: 844}, colorScheme: theme});
    await context.addInitScript(tools => {
      localStorage.setItem('sorami.startupScreen', 'map');
      sessionStorage.setItem('sorami.token', JSON.stringify({
        token: 'synthetic-startup-wait', loginId: 'startup-test', tools
      }));
    }, tools);
    let releaseScript, releaseAccess;
    const scriptGate = new Promise(resolve => releaseScript = resolve);
    const accessGate = new Promise(resolve => releaseAccess = resolve);
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin
      ? route.continue() : route.abort());
    if (failImage) await context.route('**/astronotes-note-computing-branded-v2.png', route => route.abort());
    await context.route('**/astronotes-core.js*', async route => {
      await scriptGate;
      await route.continue();
    });
    await context.route(/(?:zekkei-api|localhost:8787)/, async route => {
      const name = new URL(route.request().url()).pathname;
      if (name === '/me') await accessGate;
      await route.fulfill({status: name.startsWith('/prediction') ? 503 : 200, json: {
        allowed: true, tool: 'skymap', tools, loginId: 'startup-test',
        favorites: [], sightings: [], rev: 1
      }});
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (!holdScript) releaseScript();
    await page.goto(base, {waitUntil: 'commit'});
    return {context, page, errors, releaseScript, releaseAccess};
  }
  const waitForLogin = page => page.waitForFunction(() =>
    document.querySelector('#startupStatus .note-wait-message')?.textContent
      .includes('ログイン状態を確認しています'));
  const waitForReady = page => page.waitForFunction(() =>
    !document.documentElement.hasAttribute('data-startup-pending'));

  try {
    for (const width of [320, 390, 1280]) for (const theme of ['light', 'dark']) {
      const c = await boot(width, theme), p = c.page;
      await p.locator('#startupStatus').waitFor({state: 'visible'});
      const character = p.locator('#startupStatus .note-wait-character');
      assert.equal(await character.count(), 1, 'Astro appears before application JS is ready');
      assert(await character.isVisible());
      const style = await character.evaluate(e => {
        const s = getComputedStyle(e), r = e.getBoundingClientRect();
        return {image: s.backgroundImage, opacity: s.opacity, animation: s.animationName, w: r.width, h: r.height};
      });
      assert.match(style.image, /astronotes-note-computing-branded-v2\.png/);
      assert.equal(style.opacity, '1');
      assert.equal(style.animation, 'none');
      assert.equal(style.w, 56);
      assert.equal(style.h, 56);
      await p.waitForFunction(() => performance.getEntriesByType('resource').some(r =>
        r.name.includes('astronotes-note-computing-branded-v2.png') && r.initiatorType === 'link'));
      // WebKit waits for document.fonts.ready before screenshots, which cannot
      // settle while the parser's script is deliberately held. Keep the same
      // pre-JS assertions; capture its visual after releasing that script.
      if (process.env.START_ENGINE !== 'webkit') {
        await p.screenshot({path: path.join(out, 'before-js-' + width + '-' + theme + '.png')});
      }
      c.releaseScript();
      await waitForLogin(p);
      await p.screenshot({path: path.join(out, 'access-wait-' + width + '-' + theme + '.png')});
      assert.equal(await p.locator('#listView').evaluate(e => getComputedStyle(e).visibility), 'hidden');
      assert.equal(await p.locator('#startupStatus').getAttribute('role'), 'status');
      const geometry = await p.locator('#startupStatus').evaluate(e => ({
        left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right,
        scroll: e.scrollWidth, width: e.clientWidth
      }));
      assert(geometry.left >= 0 && geometry.right <= width && geometry.scroll <= geometry.width);
      c.releaseAccess();
      await waitForReady(p);
      await p.waitForFunction(() => location.hash === '#/skymap');
      assert(await p.locator('#startupStatus').isHidden());
      assert.deepEqual(c.errors, []);
      rows.push({case: 'character', width, theme, geometry});
      console.log('PASS startup character', width, theme);
      await c.context.close();
    }

    // Opening the menu is not navigation. A deliberate destination must become
    // visible before the old /me completes, including forecast's unchanged hash.
    for (const destination of ['home', 'forecast']) for (const theme of ['light', 'dark']) {
      const c = await boot(390, theme, {holdScript: false}), p = c.page;
      await waitForLogin(p);
      await p.locator('#toolsButton').click();
      await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await p.evaluate(() => document.documentElement.hasAttribute('data-startup-pending')), true);
      if (destination === 'home') {
        await p.locator('#toolsClose').click();
        await p.locator('#homeLink').click();
      } else await p.locator('#toolsHome').click();
      await p.waitForFunction(() => !document.documentElement.hasAttribute('data-startup-pending'), {}, {timeout: 1500});
      const expected = destination === 'home' ? '#/almanac' : '';
      assert.equal(await p.evaluate(() => location.hash), expected);
      assert(await p.locator(destination === 'home' ? '#almanacView' : '#listView').isVisible());
      c.releaseAccess();
      await p.evaluate(() => startupSessionReady);
      await p.waitForTimeout(100);
      assert.equal(await p.evaluate(() => location.hash), expected, 'late session response preserves user navigation');
      if (destination === 'forecast') assert(await p.locator('#status').isVisible(), 'startup does not hide forecast feedback');
      assert.deepEqual(c.errors, []);
      rows.push({case: 'manual-navigation', destination, theme});
      console.log('PASS startup navigation', destination, theme);
      await c.context.close();
    }

    const c = await boot(390, 'dark', {failImage: true}), p = c.page;
    await p.locator('#startupStatus').waitFor({state: 'visible'});
    assert.match(await p.locator('#startupMessage').textContent(), /起動画面を開いています/);
    c.releaseScript();
    await waitForLogin(p);
    c.releaseAccess();
    await waitForReady(p);
    assert.deepEqual(c.errors, []);
    rows.push({case: 'image-failure-text-fallback'});
    console.log('PASS startup image failure retains message');
    await c.context.close();
    fs.writeFileSync(process.env.START_RESULT || path.join(out, 'results.json'), JSON.stringify(rows, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
