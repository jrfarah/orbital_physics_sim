import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, devices, webkit } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = await freePort();
await run('npm', ['run', 'build']);
const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const browser = await chromium.launch({ channel: 'chrome' });
try {
  await waitFor(`http://127.0.0.1:${port}/`);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/#/debug/viewfactor`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.viewfactor, null, { timeout: 60_000 });
  const status = await page.evaluate(() => ({
    status: document.body.dataset.viewfactor,
    text: document.getElementById('viewfactor-results')?.textContent ?? '',
  }));
  console.log(status.text);
  if (status.status !== 'pass') {
    console.error('View-factor render check failed.');
    process.exitCode = 1;
  } else {
    console.log('View-factor render check passed.');
  }
  for (const project of [
    ['webkit iPhone', webkit, 'iPhone 13', null],
    ['chromium Pixel', chromium, 'Pixel 7', 'chrome'],
    ['webkit iPad', webkit, 'iPad (gen 7)', null],
  ]) {
    const [label, type, device, channel] = project;
    const launched = await type.launch(channel ? { channel } : {});
    const context = await launched.newContext({ ...devices[device] });
    const mobile = await context.newPage();
    try {
      await mobile.goto(`http://127.0.0.1:${port}/#/debug/viewfactor`, { waitUntil: 'domcontentloaded' });
      await mobile.waitForFunction(() => document.body.dataset.viewfactor, null, { timeout: 60_000 });
      const status = await mobile.evaluate(() => document.body.dataset.viewfactor);
      console.log(`${label}: ${status}`);
      if (status !== 'pass') process.exitCode = 1;
    } finally {
      await launched.close();
    }
  }
} finally {
  await browser.close();
  preview.kill('SIGTERM');
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
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // preview still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`preview did not start: ${url}`);
}
