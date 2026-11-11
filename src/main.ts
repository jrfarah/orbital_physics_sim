import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { content } from './content';
import { mountRenderer } from './engine/renderer';
import { paintFace } from './tabs/radiator/faces2d';
import { createRadiatorTab } from './tabs/radiator';
import { createThermalTab } from './tabs/thermal';
import { createKesslerTab } from './tabs/kessler';
import { createSheet } from './ui/sheet';
import { el } from './ui/readout';

type TabName = 'radiator' | 'thermal' | 'kessler';

interface Tab {
  hud: HTMLElement;
  controls: HTMLElement;
  corner?: HTMLElement;
  show: () => void;
  hide: () => void;
  reset: () => void;
  readParams: (params: URLSearchParams) => void;
}

const titles: Record<TabName, string> = {
  radiator: content.tabs.radiator.label,
  thermal: content.tabs.thermal.label,
  kessler: content.tabs.kessler.label,
};

const takeaways: Record<TabName, string> = {
  radiator: content.tabs.radiator.takeaway,
  thermal: content.tabs.thermal.takeaway,
  kessler: content.tabs.kessler.takeaway,
};

const title = document.getElementById('site-title');
if (title) title.textContent = content.siteTitle;

const host = document.getElementById('canvas-host');
const hud = document.getElementById('hud');
const panel = document.getElementById('panel');
const takeaway = document.getElementById('takeaway');
const toast = document.getElementById('toast');
const tabbar = document.getElementById('tabbar');
if (!host || !hud || !panel || !takeaway || !toast || !tabbar) throw new Error('missing app shell');
const canvasHost: HTMLElement = host;
const hudEl: HTMLElement = hud;
const panelEl: HTMLElement = panel;
const takeawayEl: HTMLElement = takeaway;
const toastEl: HTMLElement = toast;
const tabbarEl: HTMLElement = tabbar;

mountRenderer(canvasHost);
const sheet = createSheet();

const summary = (text: string) => sheet.setSummary(text);
const tabs: Record<TabName, Tab> = {
  radiator: createRadiatorTab(summary),
  thermal: createThermalTab(summary),
  kessler: createKesslerTab(summary),
};

const buttons = new Map<TabName, HTMLButtonElement>();
for (const name of ['radiator', 'thermal', 'kessler'] as const) {
  const button = el('button', '', titles[name]);
  button.type = 'button';
  button.addEventListener('click', () => {
    location.hash = `#/${name}`;
  });
  tabbarEl.append(button);
  buttons.set(name, button);
}

const takeChip = el('button', 'takeaway-chip', 'Takeaway ▸');
takeChip.type = 'button';
const takeText = el('p', 'takeaway-body');
takeText.hidden = true;
takeChip.addEventListener('click', () => {
  takeText.hidden = !takeText.hidden;
  takeChip.textContent = takeText.hidden ? 'Takeaway ▸' : 'Takeaway ▾';
});
takeawayEl.append(takeChip, takeText);

const debug = el('div', 'heat-debug');
debug.hidden = true;
for (const heat of [0, 0.25, 0.5, 0.75, 1]) {
  const canvas = document.createElement('canvas');
  paintFace(canvas, heat);
  const cell = el('div');
  cell.append(canvas, el('div', 'faint', String(heat)));
  debug.append(cell);
}
document.getElementById('stage')?.append(debug);

const mq = window.matchMedia('(max-width: 899px)');
let current: TabName | null = null;
let corner: HTMLElement | null = null;

function placeControls(tab: Tab): void {
  if (mq.matches) sheet.body.append(tab.controls);
  else panelEl.append(tab.controls);
}

function showTakeaway(name: TabName): void {
  takeText.textContent = takeaways[name];
  takeText.hidden = true;
  takeChip.textContent = 'Takeaway ▸';
  takeawayEl.hidden = false;
}

function parseHash(): { name: string; params: URLSearchParams } {
  const raw = location.hash.replace(/^#/, '');
  const [path, query] = (raw || '/radiator').split('?');
  return { name: path.replace(/^\//, '') || 'radiator', params: new URLSearchParams(query ?? '') };
}

function route(): void {
  const { name, params } = parseHash();
  if (name === 'heat-debug') {
    debug.hidden = false;
    hudEl.hidden = true;
    return;
  }
  debug.hidden = true;
  hudEl.hidden = false;
  if (name !== 'radiator' && name !== 'thermal' && name !== 'kessler') {
    location.replace('#/radiator');
    return;
  }
  if (!location.hash || location.hash === '#') {
    history.replaceState(null, '', '#/radiator');
  }
  if (current && current !== name) tabs[current].hide();
  current = name;
  for (const [id, button] of buttons) {
    if (id === name) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
  const tab = tabs[name];
  hudEl.replaceChildren(tab.hud);
  panelEl.replaceChildren();
  sheet.body.replaceChildren();
  placeControls(tab);
  if (corner) corner.remove();
  corner = tab.corner ?? null;
  if (corner) document.getElementById('stage')?.append(corner);
  tab.readParams(params);
  tab.show();
  showTakeaway(name);
}

mq.addEventListener('change', () => {
  if (!current) return;
  panelEl.replaceChildren();
  sheet.body.replaceChildren();
  placeControls(tabs[current]);
});

document.getElementById('copy-link')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
  } catch {
    const input = document.createElement('input');
    input.value = location.href;
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  toastEl.textContent = 'Link copied';
  toastEl.classList.add('show');
  window.setTimeout(() => toastEl.classList.remove('show'), 1500);
});

window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  if (target && (target.closest('input, textarea, select, .slider') || target.isContentEditable)) return;
  if (event.key === '1') location.hash = '#/radiator';
  else if (event.key === '2') location.hash = '#/thermal';
  else if (event.key === '3') location.hash = '#/kessler';
  else if ((event.key === 'r' || event.key === 'R') && current) tabs[current].reset();
});

window.addEventListener('hashchange', route);

if (import.meta.env.PROD) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}

route();
