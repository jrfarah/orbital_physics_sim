import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, devices, webkit } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const tabs = ['radiator', 'thermal', 'kessler'];
const viewports = [
  [375, 812],
  [812, 375],
  [768, 1024],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
];

const port = await freePort();
await run('npm', ['run', 'build']);
const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let previewLog = '';
preview.stdout.on('data', (chunk) => {
  previewLog += chunk.toString();
});
preview.stderr.on('data', (chunk) => {
  previewLog += chunk.toString();
});

  const browser = await chromium.launch({ channel: 'chrome' });
const offenders = [];
try {
  await waitFor(`http://127.0.0.1:${port}/`);
  await mkdir(new URL('../shots/', import.meta.url), { recursive: true });
  const page = await browser.newPage();
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    for (const tab of tabs) {
      await page.goto(`http://127.0.0.1:${port}/#/${tab}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#canvas-host canvas');
      await page.waitForTimeout(500);
      if (tab === 'kessler') await openKesslerTips(page);
      if (tab === 'kessler' && width === 1440 && height === 900) {
        const more = page.getByRole('button', { name: 'More detail' });
        if ((await more.count()) && (await more.first().innerText()).includes('▸')) await more.first().click();
        await page.waitForTimeout(200);
      }
      const shot = new URL(`../shots/${tab}-${width}x${height}.png`, import.meta.url);
      await page.screenshot({ path: fileURLToPath(shot), fullPage: true });
      offenders.push(...(await audit(page)).map((item) => `${tab} ${width}x${height}: ${item}`));
      if (width === 1440 && height === 900) {
        const count = await page.locator('[data-scenario]').count();
        for (let i = 0; i < count; i++) {
          await page.locator('[data-scenario]').nth(i).click();
          await page.waitForTimeout(250);
          const label = await page.locator('[data-scenario]').nth(i).innerText();
          offenders.push(...(await audit(page)).map((item) => `${tab} 1440x900 scenario "${label.trim()}": ${item}`));
        }
      }
      if (tab === 'thermal') {
        const powers = [120e3, 1e6, 10e6, 100e6, 1e9, 10e9, 100e9, 1e12];
        for (const power of powers) {
          await page.goto(`http://127.0.0.1:${port}/#/thermal?P=${power}`, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('.scale-inset');
          await page.waitForTimeout(500);
          const inset = await insetAudit(page);
          offenders.push(...inset.map((item) => `thermal ${width}x${height} ${power} W: ${item}`));
          if (power === 120e3 || power === 1e9 || power === 1e12) {
            await page.waitForTimeout(600);
            offenders.push(
              ...(await audit(page)).map((item) => `thermal ${width}x${height} settled ${power} W: ${item}`),
            );
          }
        }
      }
    }
  }
  await auditDevices(`http://127.0.0.1:${port}/`, offenders);
} finally {
  await browser.close();
  preview.kill('SIGTERM');
}

if (offenders.length) {
  console.error(`Layout check failed (${offenders.length}):`);
  for (const line of offenders) console.error(`- ${line}`);
  process.exit(1);
}
console.log('Layout check passed.');

async function insetAudit(page) {
  return page.evaluate(() => {
    const card = document.querySelector('.scale-inset');
    if (!card) return ['missing scale inset'];
    const cardRect = card.getBoundingClientRect();
    const problems = [];
    for (const el of card.querySelectorAll('circle, path')) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 0.5 && rect.height < 0.5) continue;
      const outside =
        rect.left < cardRect.left - 1 ||
        rect.top < cardRect.top - 1 ||
        rect.right > cardRect.right + 1 ||
        rect.bottom > cardRect.bottom + 1;
      if (outside) {
        problems.push(
          `inset drawing outside the card (${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)})`,
        );
      }
    }
    return problems;
  });
}

async function auditDevices(origin, offenders) {
  const projects = [
    ['webkit iPhone', webkit, 'iPhone 13', null],
    ['chromium Pixel', chromium, 'Pixel 7', 'chrome'],
    ['webkit iPad', webkit, 'iPad (gen 7)', null],
  ];
  for (const [label, type, device, channel] of projects) {
    const launched = await type.launch(channel ? { channel } : {});
    const context = await launched.newContext({ ...devices[device] });
    const page = await context.newPage();
    try {
      for (const tab of tabs) {
        await page.goto(`${origin}#/${tab}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#canvas-host canvas');
        await page.waitForTimeout(400);
        if (tab === 'kessler') await openKesslerTips(page);
        offenders.push(...(await audit(page)).map((item) => `${label} ${tab}: ${item}`));
      }
      for (const power of [120e3, 1e9, 1e12]) {
        await page.goto(`${origin}#/thermal?P=${power}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.scale-inset');
        await page.waitForTimeout(700);
        offenders.push(...(await audit(page)).map((item) => `${label} thermal ${power} W: ${item}`));
      }
    } finally {
      await launched.close();
    }
  }
}

async function openKesslerTips(page) {
  const buttons = page.locator('.card.hero button.info');
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  }
}

async function audit(page) {
  return page.evaluate(() => {
    const problems = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      problems.push(`horizontal overflow ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    }
    const boxes = [];
    const nodes = document.querySelectorAll('body *');
    for (const el of nodes) {
      if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) continue;
      if (!visible(el)) continue;
      const extra = el.getAttribute('data-boxes');
      if (extra) {
        try {
          const parsed = JSON.parse(extra);
          const host = el.getBoundingClientRect();
          for (const box of parsed) {
            const rect = { x: host.left + box.x, y: host.top + box.y, w: box.w, h: box.h };
            const outside = box.x < -1 || box.y < -1 || box.x + box.w > host.width + 1 || box.y + box.h > host.height + 1;
            if (outside) problems.push(`clipped "${String(box.text || 'chart').slice(0, 48)}" <data-boxes>`);
            boxes.push({ text: box.text || 'chart', rect, cls: 'data-boxes' });
          }
        } catch {
          problems.push('bad data-boxes');
        }
      }
      const text = (el.textContent || '').trim();
      if (!text) continue;
      if ([...el.children].some((child) => (child.textContent || '').trim())) continue;
      const style = getComputedStyle(el);
      const rect = clippedRect(el);
      if (!rect) continue;
      const ellipsis = style.textOverflow === 'ellipsis' || style.webkitLineClamp !== 'none';
      if (!ellipsis && el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'visible') {
        problems.push(`clipped "${text.slice(0, 48)}" <${el.tagName.toLowerCase()}.${el.className}>`);
      }
      if (!ellipsis && el instanceof HTMLElement && style.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1) {
        problems.push(`clipped "${text.slice(0, 48)}" <${el.tagName.toLowerCase()}.${el.className}>`);
      }
      if (el.classList?.contains('chart-label')) continue;
      boxes.push({ text: text.slice(0, 48), rect, cls: el.className });
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].rect;
        const b = boxes[j].rect;
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (w > 1 && h > 1) {
          problems.push(`overlap "${boxes[i].text}" × "${boxes[j].text}"`);
        }
      }
    }
    return problems;

    function visible(el) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      let node = el;
      while (node) {
        if (node instanceof HTMLElement && node.hidden) return false;
        node = node.parentElement;
      }
      return clippedRect(el) !== null;
    }

    function clippedRect(el) {
      const rect = el.getBoundingClientRect();
      let box = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      if (box.w < 1 || box.h < 1) return null;
      let parent = el.parentElement;
      while (parent) {
        const style = getComputedStyle(parent);
        const clip = `${style.overflow}${style.overflowX}${style.overflowY}`;
        if (/auto|hidden|scroll|clip/.test(clip)) {
          const host = parent.getBoundingClientRect();
          const x = Math.max(box.x, host.left);
          const y = Math.max(box.y, host.top);
          const right = Math.min(box.x + box.w, host.right);
          const bottom = Math.min(box.y + box.h, host.bottom);
          box = { x, y, w: right - x, h: bottom - y };
          if (box.w <= 1 || box.h <= 1) return null;
        }
        parent = parent.parentElement;
      }
      return box;
    }
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
    const tick = () => {
      fetch(url)
        .then((res) => (res.ok ? resolve() : Promise.reject(new Error(String(res.status)))))
        .catch(() => {
          if (Date.now() - started > 20000) reject(new Error(`preview did not start\n${previewLog}`));
          else setTimeout(tick, 200);
        });
    };
    tick();
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const chosen = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(chosen));
    });
    server.on('error', reject);
  });
}
