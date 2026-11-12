import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const capture = process.argv.includes('--capture');
const baseArg = process.argv.find((arg) => arg.startsWith('--base='));
const goldenDir = new URL('../shots/golden/', import.meta.url);

const views = [
  { name: 'thermal-120kw', url: '#/thermal' },
  { name: 'thermal-120kw-roundtrip', url: '#/thermal', roundtrip: true, goldenName: 'thermal-120kw' },
  { name: 'thermal-1mw', url: '#/thermal?P=1000000' },
  { name: 'thermal-1gw', url: '#/thermal?P=1000000000' },
  { name: 'thermal-1tw', url: '#/thermal?P=1000000000000' },
  { name: 'kessler-filed', url: '#/kessler?rate=1e9&area=800&preset=spacex', pause: true },
  { name: 'kessler-1tw', url: '#/kessler?rate=1e12', pause: true },
  { name: 'kessler-spread', url: '#/kessler?preset=spread', pause: true, allow: true },
  { name: 'radiator-best-overview', url: '#/radiator', radiator: true, allow: true },
];

const port = await freePort();
let preview = null;
const base = baseArg ? baseArg.slice('--base='.length).replace(/\/$/, '') : `http://127.0.0.1:${port}`;
if (!baseArg) {
  await run('npm', ['run', 'build']);
  preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
  });
}

const browser = await chromium.launch({ channel: 'chrome' });
const failures = [];
const notes = [];
try {
  if (!baseArg) await waitFor(`${base}/`);
  await mkdir(goldenDir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  for (const view of views) {
    // A new page per view. Reusing one page lets the screenshot call drop devicePixelRatio to 1.
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/${view.url}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#canvas-host canvas');
    await page.waitForTimeout(1200);
    const info = await page.evaluate(() => {
      const canvas = document.querySelector('#canvas-host canvas');
      return { dpr: window.devicePixelRatio, w: canvas?.width ?? 0, css: canvas?.clientWidth ?? 1 };
    });
    if (info.dpr < 1.5 || info.w < info.css * 1.4) {
      failures.push(`${view.name}: capture was not 2× (${JSON.stringify(info)})`);
    }
    if (view.radiator) {
      await page.getByRole('button', { name: 'Best case (edge-on)' }).click();
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: 'Overview' }).click();
      await page.waitForTimeout(700);
    }
    if (view.roundtrip) {
      await page.getByRole('button', { name: '1 TW', exact: true }).click();
      await page.waitForTimeout(900);
      await page.getByRole('button', { name: '120 kW', exact: true }).click();
      await page.waitForTimeout(900);
    }
    const canvas = page.locator('#canvas-host canvas');
    const box = await canvas.boundingBox();
    const png = await canvas.screenshot();
    const masks = await hudRects(page, box);
    if (view.name.startsWith('thermal')) masks.push({ x: box.width - 252, y: box.height - 182, w: 252, h: 182 });
    if (view.name.startsWith('kessler')) {
      masks.push({ x: 0, y: 0, w: 380, h: 240 });
      masks.push({ x: box.width - 200, y: 0, w: 200, h: 64 });
    }
    const goldenKey = view.goldenName ?? view.name;
    const file = new URL(`${goldenKey}.png`, goldenDir);
    const maskFile = new URL(`${goldenKey}.json`, goldenDir);
    if (capture) {
      if (!view.roundtrip) {
        await writeFile(file, png);
        await writeFile(maskFile, JSON.stringify(masks));
        console.log(`captured ${view.name} ${png.length} bytes`);
      }
      await page.close();
      continue;
    }
    let golden;
    let goldenMasks = [];
    try {
      golden = await readFile(file);
      goldenMasks = JSON.parse(await readFile(maskFile, 'utf8'));
    } catch {
      failures.push(`${view.name}: missing golden`);
      await page.close();
      continue;
    }
    const diff = await compare(golden, png, [...masks, ...goldenMasks], box);
    const line = `${view.name}: ${(diff.ratio * 100).toFixed(2)}% masks ${masks.length}+${goldenMasks.length} (${diff.mismatch}/${diff.total})`;
    console.log(line);
    if (diff.ratio > 0.03) {
      await mkdir(new URL('../shots/visual-fail/', import.meta.url), { recursive: true });
      await writeFile(new URL(`../shots/visual-fail/${view.name}.png`, import.meta.url), png);
      if (diff.image) {
        await sharp(diff.image, { raw: { width: diff.width, height: diff.height, channels: 4 } }).png().toFile(
          fileURLToPath(new URL(`../shots/visual-fail/${view.name}-diff.png`, import.meta.url)),
        );
      }
    }
    if (diff.ratio > 0.03) {
      if (view.allow) notes.push(line);
      else failures.push(line);
    }
    await page.close();
  }
} finally {
  await browser.close();
  preview?.kill('SIGTERM');
}

if (notes.length) {
  console.log('Allowed differences:');
  for (const line of notes) console.log(`- ${line}`);
}
if (failures.length) {
  console.error(`Visual check failed (${failures.length}):`);
  for (const line of failures) console.error(`- ${line}`);
  process.exit(1);
}
if (!capture) console.log('Visual check passed.');

async function hudRects(page, box) {
  return page.evaluate(({ left, top, width, height }) => {
    const rects = [];
    for (const el of document.querySelectorAll('#stage *')) {
      if (el.id === 'canvas-host' || el.tagName === 'CANVAS') continue;
      if (el instanceof HTMLElement && el.hidden) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.width > width * 0.5 && r.height > height * 0.5) continue;
      rects.push({ x: r.left - left, y: r.top - top, w: r.width, h: r.height });
    }
    return rects;
  }, box);
}

function paintOut(data, width, height, rects, dpr, skip) {
  for (const rect of rects) {
    const x0 = Math.max(0, Math.floor(rect.x * dpr));
    const y0 = Math.max(0, Math.floor(rect.y * dpr));
    const x1 = Math.min(width, Math.ceil((rect.x + rect.w) * dpr));
    const y1 = Math.min(height, Math.ceil((rect.y + rect.h) * dpr));
    for (let y = y0; y < y1; y++) {
      data.fill(0, (y * width + x0) * 4, (y * width + x1) * 4);
      if (skip) skip.fill(1, y * width + x0, y * width + x1);
    }
  }
}

async function compare(aBuf, bBuf, rects, box) {
  const a = await raw(aBuf);
  const b = await raw(bBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return { ratio: 1, mismatch: a.width * a.height, total: a.width * a.height };
  }
  const dpr = a.width / box.width;
  const skip = new Uint8Array(a.width * a.height);
  paintOut(a.data, a.width, a.height, rects, dpr, skip);
  paintOut(b.data, b.width, b.height, rects, dpr, null);
  let total = 0;
  for (let i = 0; i < skip.length; i++) if (!skip[i]) total++;
  const image = Buffer.alloc(a.width * a.height * 4);
  const mismatch = pixelmatch(a.data, b.data, image, a.width, a.height, { threshold: 0.1 });
  return { ratio: total ? mismatch / total : 1, mismatch, total, image, width: a.width, height: a.height };
}

async function raw(buf) {
  const image = sharp(buf).ensureAlpha();
  const meta = await image.metadata();
  return { data: await image.raw().toBuffer(), width: meta.width, height: meta.height };
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
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

function waitFor(url) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      fetch(url)
        .then((res) => (res.ok ? resolve() : Promise.reject(new Error(String(res.status)))))
        .catch((error) => {
          if (Date.now() - started > 20000) reject(error);
          else setTimeout(tick, 200);
        });
    };
    tick();
  });
}
