import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const outPath = fileURLToPath(new URL('../perf/report.json', import.meta.url));
const phase = process.argv.includes('--after') ? 'after' : 'baseline';

const port = await freePort();
if (!process.argv.includes('--no-build')) await run('npm', ['run', 'build']);
const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const browser = await chromium.launch({ channel: 'chrome' });
const sweepOnly = process.argv.includes('--sweep');
const report = { desktop: {}, mobile: {}, thermalSweep: null };
try {
  await waitFor(`http://127.0.0.1:${port}/`);
  if (sweepOnly) {
    report.thermalSweep = await thermalSweep(browser, `http://127.0.0.1:${port}`);
  } else {
    report.desktop = await profile(browser, `http://127.0.0.1:${port}`, {
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    report.thermalSweep = await thermalSweep(browser, `http://127.0.0.1:${port}`);
    report.mobile = await profile(browser, `http://127.0.0.1:${port}`, {
      ...devices['Pixel 5'],
      throttle: 4,
    });
  }
} finally {
  await browser.close();
  preview.kill('SIGTERM');
}

if (sweepOnly) {
  console.log(JSON.stringify(report.thermalSweep, null, 2));
  process.exit(0);
}
await mkdir(new URL('../perf/', import.meta.url), { recursive: true });
let existing = {};
try {
  existing = JSON.parse(await readFile(outPath, 'utf8'));
} catch {
  existing = {};
}
existing[phase] = {
  recordedAt: new Date().toISOString(),
  desktop: { viewport: '1440x900', deviceScaleFactor: 2, tabs: report.desktop },
  thermalSweep: report.thermalSweep,
  mobile: { device: 'Pixel 5', cpuSlowdown: 4, tabs: report.mobile },
};
await writeFile(outPath, `${JSON.stringify(existing, null, 2)}\n`);
console.log(JSON.stringify(existing[phase], null, 2));

async function thermalSweep(browser, origin) {
  const options = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
  const context = await browser.newContext({ viewport: options.viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await lockViewport(context, page, options);
  await page.goto(`${origin}/#/thermal?perf=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#canvas-host canvas');
  await page.waitForTimeout(1000);
  await revealControls(page);
  const read = () => page.evaluate(() => window.__perf ?? null);
  const start = await read();
  let afterFirst = null;
  const sweeps = await trace(page, context, async () => {
    for (let i = 0; i < 10; i++) {
      await dragSlider(page, '#th-power [role="slider"]', 0, 1, 1500);
      await dragSlider(page, '#th-power [role="slider"]', 1, 0, 1500);
      if (i === 0) afterFirst = await read();
    }
  });
  const afterTen = await read();
  await dragSlider(page, '#th-power [role="slider"]', 0, 1, 1500);
  await page.waitForTimeout(1200);
  const restStart = await read();
  await page.waitForTimeout(5000);
  const restEnd = await read();
  const radiator = await trace(page, context, async () => {
    await page.goto(`${origin}/#/radiator?perf=1`, { waitUntil: 'domcontentloaded' });
    await lockViewport(context, page, options);
    await page.waitForSelector('#canvas-host canvas');
    await page.waitForTimeout(800);
    await revealControls(page);
    await dragSlider(page, '#tilt [role="slider"]', 0.15, 0.85, 1200);
    await dragSlider(page, '#tilt [role="slider"]', 0.85, 0.15, 1200);
    await orbit(page, 2200);
  });
  const radiatorCounters = await read();
  await context.close();
  return {
    start,
    afterFirstSweep: afterFirst,
    afterTenSweeps: afterTen,
    sweeps,
    restFrames: (restEnd?.renderedFrames ?? 0) - (restStart?.renderedFrames ?? 0),
    restStart,
    restEnd,
    radiator,
    radiatorCounters,
  };
}

async function profile(browser, origin, options) {
  const context = await browser.newContext({
    viewport: options.viewport,
    deviceScaleFactor: options.deviceScaleFactor,
    isMobile: options.isMobile,
    hasTouch: options.hasTouch,
    userAgent: options.userAgent,
  });
  const page = await context.newPage();
  const lock = () => lockViewport(context, page, options);
  await lock();
  if (options.throttle) {
    const setup = await context.newCDPSession(page);
    await setup.send('Emulation.setCPUThrottlingRate', { rate: options.throttle });
  }
  const tabs = {};
  tabs.radiator = await trace(page, context, async () => {
    await page.goto(`${origin}/#/radiator?perf=1`, { waitUntil: 'domcontentloaded' });
    await lock();
    await page.waitForSelector('#canvas-host canvas');
    await page.waitForTimeout(800);
    await revealControls(page);
    await armFrames(page);
    await dragSlider(page, '#tilt [role="slider"]', 0.15, 0.85, 1200);
    await dragSlider(page, '#tilt [role="slider"]', 0.85, 0.15, 1200);
    await orbit(page, 2200);
  });
  tabs.thermal = await trace(page, context, async () => {
    await page.goto(`${origin}/#/thermal?perf=1`, { waitUntil: 'domcontentloaded' });
    await lock();
    await page.waitForSelector('#canvas-host canvas');
    await page.waitForTimeout(800);
    await revealControls(page);
    await armFrames(page);
    await dragSlider(page, '#th-power [role="slider"]', 0, 1, 2000);
    await dragSlider(page, '#th-power [role="slider"]', 1, 0, 2000);
  });
  tabs.kessler = await trace(page, context, async () => {
    await page.goto(`${origin}/#/kessler?perf=1`, { waitUntil: 'domcontentloaded' });
    await lock();
    await page.waitForSelector('#canvas-host canvas');
    await revealControls(page);
    await armFrames(page);
    await page.getByRole('button', { name: 'SpaceX as filed' }).click();
    await page.waitForTimeout(5000);
    await page.getByRole('button', { name: '1 TW', exact: true }).click();
    await page.getByRole('button', { name: 'Spread out (500-2000 km)' }).click();
    await page.waitForTimeout(1500);
  });
  await context.close();
  return tabs;
}

async function trace(page, context, interact) {
  const cdp = await context.newCDPSession(page);
  const stamps = [];
  cdp.on('Tracing.dataCollected', (event) => {
    for (const row of event.value) {
      if (row.name === 'BeginFrame' && typeof row.ts === 'number') stamps.push(row.ts);
    }
  });
  await cdp.send('Tracing.start', {
    traceConfig: {
      includedCategories: ['disabled-by-default-devtools.timeline.frame', 'devtools.timeline'],
    },
  });
  await interact();
  await cdp.send('Tracing.end');
  await new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.detach();
  const raf = await page.evaluate(() => {
    if (window.__raf) cancelAnimationFrame(window.__raf);
    return window.__frames ?? [];
  });
  const traced = deltas(stamps);
  const fromRaf = raf.filter((row) => row.dt > 0 && row.dt < 500);
  const useTrace = traced.length >= 20;
  const times = (useTrace ? traced : fromRaf).map((row) => row.ms ?? row.dt);
  const source = useTrace ? traced : fromRaf;
  const t0 = source[0]?.ts ?? source[0]?.t ?? 0;
  const after = source.filter((row) => (row.ts ?? row.t) - t0 > 1000).map((row) => row.ms ?? row.dt);
  const summary = summarize(times, after.length ? after : times);
  summary.source = useTrace ? 'chrome-tracing' : 'raf';
  return summary;
}

function deltas(stamps) {
  const sorted = stamps.slice().sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < sorted.length; i++) {
    const ms = (sorted[i] - sorted[i - 1]) / 1000;
    if (ms > 0 && ms < 500) out.push({ ts: sorted[i] / 1000, ms });
  }
  return out;
}

function summarize(times, afterFirst) {
  const ordered = times.slice().sort((a, b) => a - b);
  const pick = (p) => (ordered.length ? ordered[Math.min(ordered.length - 1, Math.floor(p * (ordered.length - 1)))] : 0);
  const tail = afterFirst.slice().sort((a, b) => a - b);
  return {
    frames: times.length,
    p50: round(pick(0.5)),
    p95: round(pick(0.95)),
    max: round(ordered.length ? ordered[ordered.length - 1] : 0),
    maxAfter1s: round(tail.length ? tail[tail.length - 1] : 0),
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

async function lockViewport(context, page, options) {
  const width = options.viewport?.width ?? 1440;
  const height = options.viewport?.height ?? 900;
  await page.setViewportSize({ width, height });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: options.deviceScaleFactor ?? 1,
    mobile: Boolean(options.isMobile),
  });
  await cdp.detach();
}

async function revealControls(page) {
  await page.evaluate(() => {
    if (window.innerWidth >= 900) return;
    const sheet = document.getElementById('sheet');
    if (!sheet) return;
    sheet.hidden = false;
    sheet.style.height = `${Math.floor(window.innerHeight * 0.86)}px`;
    const body = sheet.querySelector('.sheet-body');
    if (body) body.hidden = false;
  });
}

async function armFrames(page) {
  await page.evaluate(() => {
    const w = window;
    if (w.__raf) cancelAnimationFrame(w.__raf);
    w.__frames = [];
    let last = performance.now();
    const loop = (now) => {
      w.__frames.push({ t: now, dt: now - last });
      last = now;
      w.__raf = requestAnimationFrame(loop);
    };
    w.__raf = requestAnimationFrame(loop);
  });
}

async function dragSlider(page, selector, from, to, ms) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { missing: true, innerWidth: window.innerWidth };
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, innerWidth: window.innerWidth, innerHeight: window.innerHeight };
  }, selector);
  if (!box || box.missing || box.width < 2) throw new Error(`slider not found: ${selector} ${JSON.stringify(box)}`);
  const y = box.y + box.height / 2;
  const xAt = (t) => box.x + 12 + (box.width - 24) * t;
  await page.mouse.move(xAt(from), y);
  await page.mouse.down();
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    await page.mouse.move(xAt(t), y);
    await page.waitForTimeout(ms / steps);
  }
  await page.mouse.up();
}

async function orbit(page, ms) {
  const canvas = page.locator('#canvas-host canvas');
  const box = await canvas.boundingBox();
  if (!box) return;
  const x = box.x + box.width * 0.45;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = 18;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + 140 * (i / steps), y - 40 * (i / steps));
    await page.waitForTimeout(ms / steps);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const value = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(value));
    });
  });
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function waitFor(url) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) {
          resolve();
          return;
        }
      } catch {
        /* preview still starting */
      }
      if (Date.now() - started > 20000) reject(new Error(`preview did not start: ${url}`));
      else setTimeout(tick, 200);
    };
    setTimeout(tick, 300);
  });
}
