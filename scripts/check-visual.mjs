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
  { name: 'thermal-120kw', url: '#/thermal', allow: true },
  { name: 'thermal-120kw-roundtrip', url: '#/thermal', roundtrip: true, goldenName: 'thermal-120kw', allow: true },
  { name: 'thermal-1mw', url: '#/thermal?P=1000000', allow: true },
  { name: 'thermal-1gw', url: '#/thermal?P=1000000000', allow: true },
  { name: 'thermal-1tw', url: '#/thermal?P=1000000000000', allow: true },
  { name: 'kessler-filed', url: '#/kessler?rate=1e9&area=800&preset=spacex', pause: true, limb: true },
  { name: 'kessler-1tw', url: '#/kessler?rate=1e12', pause: true, limb: true },
  { name: 'kessler-spread', url: '#/kessler?preset=spread', pause: true, limb: true },
  { name: 'radiator-best-overview', url: '#/radiator', radiator: true, limb: true },
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
    const diff = await compare(golden, png, [...masks, ...goldenMasks], box, view.limb);
    const limit = view.limb ? 0.01 : 0.03;
    const line = `${view.name}: ${(diff.ratio * 100).toFixed(2)}%${view.limb ? ' outside the limb band' : ''} masks ${masks.length}+${goldenMasks.length} (${diff.mismatch}/${diff.total})`;
    console.log(line);
    if (diff.ratio > limit) {
      await mkdir(new URL('../shots/visual-fail/', import.meta.url), { recursive: true });
      await writeFile(new URL(`../shots/visual-fail/${view.name}.png`, import.meta.url), png);
      if (diff.image) {
        await sharp(diff.image, { raw: { width: diff.width, height: diff.height, channels: 4 } }).png().toFile(
          fileURLToPath(new URL(`../shots/visual-fail/${view.name}-diff.png`, import.meta.url)),
        );
      }
    }
    if (diff.ratio > limit) {
      if (view.allow) notes.push(line);
      else failures.push(line);
    } else if (view.allow) {
      notes.push(line);
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

function earthCircle(data, width, height) {
  const count = width * height;
  const bg = new Uint8Array(count);
  for (let p = 0; p < count; p++) {
    const i = p * 4;
    if (Math.abs(data[i] - 5) < 6 && Math.abs(data[i + 1] - 7) < 6 && Math.abs(data[i + 2] - 12) < 8) bg[p] = 1;
  }
  const cx0 = width >> 1;
  const cy0 = height >> 1;
  let seed = -1;
  for (let rad = 0; rad < 400 && seed < 0; rad += 3) {
    for (let a = 0; a < 12; a++) {
      const x = Math.min(width - 1, Math.max(0, cx0 + Math.round(Math.cos(a) * rad)));
      const y = Math.min(height - 1, Math.max(0, cy0 + Math.round(Math.sin(a) * rad)));
      if (!bg[y * width + x]) {
        seed = y * width + x;
        break;
      }
    }
  }
  if (seed < 0) return null;
  const seen = new Uint8Array(count);
  const queue = [seed];
  seen[seed] = 1;
  const pts = [];
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    const x = p % width;
    const y = (p / width) | 0;
    let edge = false;
    for (const nx of [x - 1, x + 1]) {
      if (nx < 0 || nx >= width || bg[y * width + nx]) edge = true;
      else if (!seen[y * width + nx]) {
        seen[y * width + nx] = 1;
        queue.push(y * width + nx);
      }
    }
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= height || bg[ny * width + x]) edge = true;
      else if (!seen[ny * width + x]) {
        seen[ny * width + x] = 1;
        queue.push(ny * width + x);
      }
    }
    if (edge && x > 3 && y > 3 && x < width - 4 && y < height - 4 && ((x + y) & 3) === 0) pts.push([x, y]);
  }
  if (pts.length < 40) return null;
  const through = (a, b, c) => {
    const [x1, y1] = a;
    const [x2, y2] = b;
    const [x3, y3] = c;
    const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
    if (Math.abs(d) < 1e-3) return null;
    const s1 = x1 * x1 + y1 * y1;
    const s2 = x2 * x2 + y2 * y2;
    const s3 = x3 * x3 + y3 * y3;
    const cx = (s1 * (y2 - y3) + s2 * (y3 - y1) + s3 * (y1 - y2)) / d;
    const cy = (s1 * (x3 - x2) + s2 * (x1 - x3) + s3 * (x2 - x1)) / d;
    const r = Math.hypot(cx - x1, cy - y1);
    if (!Number.isFinite(r) || r < 80 || r > 4000) return null;
    return { cx, cy, r };
  };
  let rand = 1;
  const unit = () => {
    rand = (Math.imul(rand, 1664525) + 1013904223) >>> 0;
    return rand / 4294967296;
  };
  let best = [];
  for (let k = 0; k < 400; k++) {
    const circle = through(pts[(unit() * pts.length) | 0], pts[(unit() * pts.length) | 0], pts[(unit() * pts.length) | 0]);
    if (!circle) continue;
    const inliers = [];
    for (const pt of pts) {
      if (Math.abs(Math.hypot(pt[0] - circle.cx, pt[1] - circle.cy) - circle.r) < 8) inliers.push(pt);
    }
    if (inliers.length > best.length) best = inliers;
  }
  if (best.length < 40) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  for (const [x, y] of best) {
    const z = x * x + y * y;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }
  const n = best.length;
  const det = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const A = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const B = [sxz, syz, sz];
  const D = det(A);
  if (!D) return null;
  const replaced = (col) => A.map((row, i) => row.map((value, j) => (j === col ? B[i] : value)));
  const cx = det(replaced(0)) / D / 2;
  const cy = det(replaced(1)) / D / 2;
  let r = Math.sqrt(Math.max(0, det(replaced(2)) / D + cx * cx + cy * cy));
  const drops = [];
  for (let a = 0; a < 360; a += 3) {
    const dx = Math.cos((a * Math.PI) / 180);
    const dy = Math.sin((a * Math.PI) / 180);
    let prev = 0;
    for (let t = 80; t < r * 1.25; t++) {
      const x = Math.round(cx + dx * t);
      const y = Math.round(cy + dy * t);
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      const i = (y * width + x) * 4;
      const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (prev > 140 && prev - luma > 60) {
        drops.push(t);
        break;
      }
      prev = luma;
    }
  }
  if (drops.length >= 40) {
    drops.sort((a, b) => a - b);
    const med = drops[drops.length >> 1];
    const p80 = drops[Math.floor(drops.length * 0.8)];
    if (p80 - med < 20 && med > r * 0.7 && med < r * 1.02) r = med;
  }
  return { cx, cy, r };
}

function maskLimb(data, width, height, circle, skip) {
  if (!circle) return;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ratio = Math.hypot(x - circle.cx, y - circle.cy) / circle.r;
      if (ratio < 0.95 || ratio > 1.1) continue;
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
      if (skip) skip[y * width + x] = 1;
    }
  }
}

async function compare(aBuf, bBuf, rects, box, limb) {
  const a = await raw(aBuf);
  const b = await raw(bBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return { ratio: 1, mismatch: a.width * a.height, total: a.width * a.height };
  }
  const dpr = a.width / box.width;
  const skip = new Uint8Array(a.width * a.height);
  paintOut(a.data, a.width, a.height, rects, dpr, skip);
  paintOut(b.data, b.width, b.height, rects, dpr, null);
  if (limb) {
    const circle = earthCircle(a.data, a.width, a.height);
    maskLimb(a.data, a.width, a.height, circle, skip);
    maskLimb(b.data, b.width, b.height, circle, null);
  }
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
