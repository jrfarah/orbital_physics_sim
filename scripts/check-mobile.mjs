import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, devices, webkit } from 'playwright';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const tabs = ['radiator', 'thermal', 'kessler'];
const projects = [
  ['webkit iPhone', webkit, 'iPhone 13', null],
  ['chromium Pixel', chromium, 'Pixel 7', 'chrome'],
  ['webkit iPad', webkit, 'iPad (gen 7)', null],
];
const port = await freePort();
await run('npm', ['run', 'build']);
const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const failures = [];
try {
  await waitFor(`http://127.0.0.1:${port}/`);
  for (const [label, type, device, channel] of projects) {
    const browser = await type.launch(channel ? { channel } : {});
    const context = await browser.newContext({ ...devices[device] });
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', (err) => problems.push(`pageerror ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console ${msg.text()}`);
    });
    page.on('requestfailed', (req) => {
      const url = req.url();
      if (url.includes('favicon') || url.endsWith('.map')) return;
      problems.push(`failed ${url} ${req.failure()?.errorText ?? ''}`);
    });
    try {
      for (const tab of tabs) {
        await page.goto(`http://127.0.0.1:${port}/#/${tab}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#canvas-host canvas');
        await page.waitForTimeout(5000);
        const png = await page.locator('#canvas-host canvas').screenshot();
        if (!(await hasColor(png))) problems.push(`${tab} canvas is black`);
        const hidden = await page.locator('#boot-error').isHidden();
        if (!hidden) problems.push(`${tab} error panel is visible`);
        await page.locator('.sheet-handle').click();
        const scenarios = page.locator('[data-scenario]');
        const count = await scenarios.count();
        for (let i = 0; i < count; i++) await scenarios.nth(i).click();
        if (tab === 'thermal') {
          for (const name of ['120 kW', '1 MW', '1 GW', '1 TW']) {
            await page.getByRole('button', { name, exact: true }).click();
          }
        }
        await page.locator('.sheet-handle').click();
        const height = await page.locator('#sheet').evaluate((node) => node.getBoundingClientRect().height);
        if (height > 80) problems.push(`${tab} sheet stayed open at ${Math.round(height)}px`);
      }
    } finally {
      await browser.close();
    }
    if (problems.length) {
      failures.push(`${label}:\n${problems.map((line) => `  - ${line}`).join('\n')}`);
    } else {
      console.log(`${label} passed.`);
    }
  }
} finally {
  preview.kill('SIGTERM');
}

if (failures.length) {
  console.error(`Mobile check failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('Mobile check passed.');

async function hasColor(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let bright = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 30) bright += 1;
  }
  return bright > 40;
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
