// Renders the store promo tiles to PNG at their exact sizes: node images/promo/render.js (from the project folder)
//   promo-tile.html    → promo-tile-440x280.png      (Chrome Web Store small promo tile)
//   promo-marquee.html → promo-marquee-1400x560.png  (marquee promo tile)
const path = require('path'), fs = require('fs'), { pathToFileURL } = require('url');
const { launch, sleep } = require(path.join(__dirname, '..', '..', 'tests', 'lib', 'browser.js'));
const TILES = [['promo-tile.html', 'promo-tile-440x280.png', 440, 280], ['promo-marquee.html', 'promo-marquee-1400x560.png', 1400, 560]];
(async () => {
  const b = await launch({ browser: 'edge' });
  const { cdp } = b;
  try {
    const t = (await cdp.send('Target.getTargets')).result.targetInfos.find(x => x.type === 'page');
    const s = (await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).result.sessionId;
    await cdp.send('Page.enable', {}, s);
    for (const [html, png, width, height] of TILES) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, s);
      await cdp.send('Page.navigate', { url: pathToFileURL(path.join(__dirname, html)).href }, s);
      await sleep(1200);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } }, s);
      fs.writeFileSync(path.join(__dirname, png), Buffer.from(shot.result.data, 'base64'));
      console.log('saved', png);
    }
  } finally { b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
