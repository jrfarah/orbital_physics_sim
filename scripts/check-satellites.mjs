import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const SAT = 120e3;
const COUNTS = [2, 3, 7, 9, 19, 37, 60, 150];
const port = await freePort();
await run('npm', ['run', 'build']);
const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const browser = await chromium.launch({ channel: 'chrome' });
const failures = [];
try {
  await waitFor(`http://127.0.0.1:${port}/`);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${port}/#/thermal`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#canvas-host canvas');
  await page.waitForFunction(() => typeof window.__countSatellites === 'function');
  for (const pump of [false, true]) {
    const on = (await page.locator('#th-pump').getAttribute('aria-checked')) === 'true';
    if (on !== pump) await page.locator('#th-pump').click();
    await page.waitForTimeout(50);
    for (const n of COUNTS) {
      await setPower(page, n * SAT);
      await page.waitForTimeout(200);
      const got = await page.evaluate(() => window.__countSatellites());
      const chip = await page.locator('.tile-chip').innerText();
      if (got !== n) failures.push(`pump ${pump ? 'on' : 'off'} N=${n}: counted ${got}, chip "${chip.trim()}"`);
    }
  }
  await setPower(page, 1e6, true);
  await page.waitForTimeout(200);
  const chip = (await page.locator('.tile-chip').innerText()).trim();
  if (!chip.startsWith('9 satellites')) failures.push(`1 MW chip: "${chip}"`);
  const atMw = await page.evaluate(() => window.__countSatellites());
  if (atMw !== 9) failures.push(`1 MW count ${atMw}`);
} finally {
  await browser.close();
  preview.kill('SIGTERM');
}

if (failures.length) {
  console.error(`Satellite check failed (${failures.length}):`);
  for (const line of failures) console.error(`- ${line}`);
  process.exit(1);
}
console.log('Satellite check passed.');

async function setPower(page, watts, exact = false) {
  // Aim at the middle of the satellite bin. The top edge is only a fraction of a
  // pixel wide at large N, and landing on it rounds up to the next satellite.
  const point = await page.locator('#th-power [role="slider"]').evaluate((slider, value) => {
    const rect = slider.getBoundingClientRect();
    const min = 120e3;
    const max = 1e12;
    const t = Math.log(value / min) / Math.log(max / min);
    return { x: rect.left + t * rect.width, y: rect.top + rect.height / 2 };
  }, exact ? watts : watts - SAT / 2);
  await page.mouse.click(point.x, point.y);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const value = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(value));
    });
    server.on('error', reject);
  });
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function waitFor(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* preview still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`preview did not start: ${url}`);
}
