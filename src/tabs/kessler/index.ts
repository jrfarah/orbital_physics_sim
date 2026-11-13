import { content } from '../../content';
import { openEquations, openSources } from '../../ui/drawer';
import { fmtArea, fmtBig, fmtDuration, fmtSig, fmtUSD } from '../../ui/format';
import { bigNumber, card, el } from '../../ui/readout';
import {
  createButtonRow,
  createCollapsible,
  createMoreDetail,
  createRangeSlider,
  createSegmented,
  createSlider,
  createToggle,
} from '../../ui/controls';
import { isMobile, reducedMotion, setActiveView } from '../../engine/renderer';
import {
  cascadeTimescale,
  kessler,
  kesslerShellRates,
  type KesslerInput,
  type KesslerResult,
  type Preset,
} from '../../physics/kessler';
import { createLifetimeGauge, r0Legend, r0Style } from './gauges';
import { createKesslerScene } from './scene';

const STARLINK_RATE = (9000 * 116 * 150) / 5;
const W_PER_M2 = 120000 / 800;
const RATE_SNAPS = [
  { label: 'Starlink today', watts: STARLINK_RATE },
  { label: '1 GW', watts: 1e9 },
  { label: '100 GW', watts: 1e11 },
  { label: '500 GW', watts: 5e11 },
  { label: '1 TW', watts: 1e12 },
];
const DODGE = [0, 50, 90, 95, 99, 99.5, 99.9, 99.95, 99.99, 99.999];
const COORD = [1, 0.3, 0.1, 0.03, 0.01];

interface KesslerState {
  rate: number;
  area: number;
  L: number;
  preset: Preset;
  band: [number, number];
  dodge: number;
  dispPct: number;
  vulnPct: number;
  tYr: number;
  fFrag: number;
  coord: number;
  usdPerW: number;
  usdPerKg: number;
  debris: boolean;
  paused: boolean;
}

function defaults(): KesslerState {
  return {
    rate: STARLINK_RATE,
    area: 116,
    L: 5,
    preset: 'starlink',
    band: [500, 1000],
    dodge: 99,
    dispPct: 1,
    vulnPct: 10,
    tYr: 10,
    fFrag: 112,
    coord: 1,
    usdPerW: 30,
    usdPerKg: 1000,
    debris: true,
    paused: reducedMotion(),
  };
}

function fmtPower(w: number): string {
  const ax = Math.abs(w);
  if (ax >= 1e12) return `${fmtSig(w / 1e12)} TW`;
  if (ax >= 1e9) return `${fmtSig(w / 1e9)} GW`;
  if (ax >= 1e6) return `${fmtSig(w / 1e6)} MW`;
  if (ax >= 1e3) return `${fmtSig(w / 1e3)} kW`;
  return `${fmtSig(w)} W`;
}

function dodgeChip(pct: number): string {
  const denom = 100 / Math.max(1e-9, 100 - pct);
  const shown = denom >= 1000 ? fmtBig(denom) : fmtSig(denom, 3);
  return `${pct}% (misses 1 in ${shown})`;
}

function sizeChip(area: number): string {
  const across = Math.round(70 * Math.sqrt(area / 800));
  return `${fmtArea(area)} · ${across.toLocaleString('en-US')} m`;
}

function fmtCascadeTime(years: number): string {
  if (!Number.isFinite(years)) return '—';
  const days = years * 365.25;
  if (days * 24 < 1) return 'under an hour';
  if (days < 2) return cascadeUnit(days * 24, 'hour');
  if (days < 60) return cascadeUnit(days, 'day');
  if (years < 2) return cascadeUnit(years * 12, 'month');
  return cascadeUnit(years, 'year');
}

function cascadeUnit(value: number, name: string): string {
  const text = fmtSig(value, 2);
  const n = Number(text.replace(/,/g, ''));
  return `${text} ${name}${n === 1 ? '' : 's'}`;
}

function heroPhrase(mode: 'doubling' | 'halving', years: number, faster: boolean): string {
  const time = fmtCascadeTime(years);
  const verb = mode === 'doubling' ? 'doubles' : 'halves';
  const body = time === 'under an hour' ? `Debris ${verb} in under an hour` : `Debris ${verb} every ${time}`;
  return faster && mode === 'doubling' ? `${body} (or faster)` : body;
}

function popLine(parts: (string | HTMLElement)[]): HTMLElement {
  const line = el('div', 'pop-line');
  for (const part of parts) line.append(typeof part === 'string' ? document.createTextNode(part) : part);
  return line;
}

function bindTip(host: HTMLElement, button: HTMLButtonElement, pop: HTMLElement): void {
  let pinned = false;
  let over = false;
  const paint = () => {
    const open = pinned || over;
    pop.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  button.addEventListener('click', (event) => {
    event.preventDefault();
    pinned = !pinned;
    paint();
  });
  host.addEventListener('mouseenter', () => {
    over = true;
    paint();
  });
  host.addEventListener('mouseleave', () => {
    over = false;
    paint();
  });
  paint();
}

export function createKesslerTab(summary: (text: string) => void) {
  const state = defaults();
  const tip = el('div', 'shell-tip card');
  tip.hidden = true;
  let scene: ReturnType<typeof createKesslerScene> | null = isMobile() ? null : createKesslerScene(tip);
  const live = (): ReturnType<typeof createKesslerScene> => (scene ??= createKesslerScene(tip));
  const hud = el('div', 'grid-2');

  const banner = el('div', 'card hero span-2');
  const titleRow = el('div', 'field-label', 'Debris cascade');
  const statusEl = el('div', 'hero-status');
  const primary = el('div', 'num-xl');
  const primaryInfo = el('button', 'info', 'ⓘ');
  primaryInfo.type = 'button';
  primaryInfo.setAttribute('aria-label', 'What this number means');
  const tauText = el('span');
  const primaryPop = el('div', 'popover');
  primaryPop.append(
    popLine([
      el('b', '', 'What this number means.'),
      ' Every collision makes fragments. Each fragment either hits something else, making more fragments, or falls out of orbit, after about ',
      tauText,
      ' at this altitude. R₀ is how many new collisions one collision causes before its fragments fall out.',
    ]),
    popLine([
      'If R₀ is above 1, debris breeds faster than it decays and grows exponentially. It doubles in about τ·ln2/(R₀−1). If R₀ is below 1, it dies away, halving in about τ·ln2/(1−R₀).',
    ]),
    popLine([
      'This is a simplified, order-of-magnitude model. Its inputs are uncertain by up to about 10×. So a doubling time of weeks to months means clearly unstable, while one of decades is borderline.',
    ]),
  );
  const primaryHost = el('div', 'tip-host');
  const primaryRow = el('div', 'hero-figure');
  primaryRow.append(primary, primaryInfo);
  primaryHost.append(primaryRow, primaryPop);
  bindTip(primaryHost, primaryInfo, primaryPop);

  const secondaryText = el('div', 'hero-copy');
  const secondaryInfo = el('button', 'info', 'ⓘ');
  secondaryInfo.type = 'button';
  secondaryInfo.setAttribute('aria-label', 'What tipping point means');
  const secondaryPop = el('div', 'popover');
  const term = el('b', '', 'Tipping point');
  secondaryPop.append(
    term,
    document.createTextNode(
      ' (R₀ = 1): each collision makes enough debris to cause one more collision before atmospheric drag clears it. Above 1, collisions breed collisions. "33,300× past" means that altitude holds 33,300 times more effective targets than it can sustain.',
    ),
  );
  const secondaryHost = el('div', 'tip-host');
  const secondaryRow = el('div', 'hero-figure');
  secondaryRow.append(secondaryText, secondaryInfo);
  secondaryHost.append(secondaryRow, secondaryPop);
  bindTip(secondaryHost, secondaryInfo, secondaryPop);

  const worstLine = el('div', 'caption');
  const bannerWarn = el('div', 'caption bad');
  bannerWarn.hidden = true;
  banner.append(titleRow, statusEl, primaryHost, secondaryHost, worstLine, bannerWarn);

  const satsCard = card('Satellites in orbit');
  const satsNum = bigNumber(satsCard.body);
  const satsSub = el('div', 'caption');
  satsNum.el.classList.replace('num-xl', 'num-lg');
  satsCard.body.append(satsSub);

  const camCard = card('Dodges per month');
  const camNum = bigNumber(camCard.body);
  const camSub = el('div', 'caption');
  camNum.el.classList.replace('num-xl', 'num-lg');
  camCard.body.append(camSub);

  const hitsCard = card('Killed by untracked debris');
  const hitsNum = bigNumber(hitsCard.body);
  const hitsSub = el('div', 'caption');
  hitsNum.el.classList.replace('num-xl', 'num-lg');
  hitsCard.body.append(hitsSub);

  const deadCard = card('Dead satellites stranded');
  const deadNum = bigNumber(deadCard.body);
  const deadSub = el('div', 'caption');
  deadNum.el.classList.replace('num-xl', 'num-lg');
  deadCard.body.append(deadSub);

  const fragCard = card('New debris per year');
  const fragBody = el('div', 'sub');
  const fragWarn = el('div', 'bad', 'More new untracked debris every year than exists today.');
  fragWarn.hidden = true;
  fragCard.body.append(fragBody, fragWarn);

  const gauge = createLifetimeGauge();
  const gaugeCard = card();
  gaugeCard.body.append(gauge.element);

  const latency = el('div', 'card span-2 faint');
  const money = card('Money (illustrative)');
  const moneyBody = el('div');
  money.body.append(moneyBody, el('div', 'faint', 'Bigger satellites: fewer maneuvers, but each loss costs more.'));
  const dots = el('div', 'faint span-2');
  const more = createMoreDetail('kessler', [fragCard.element, gaugeCard.element, latency, money.element, r0Legend(), dots]);
  hud.append(banner, satsCard.element, camCard.element, hitsCard.element, deadCard.element, more);

  const pause = createToggle({
    id: 'k-pause',
    label: 'Pause motion',
    value: reducedMotion(),
    onChange: (on) => {
      state.paused = on;
      live().setPaused(on);
    },
  });
  pause.element.classList.add('hud-corner');

  const rate = createSlider({
    id: 'k-rate',
    label: 'Deployment rate',
    min: 1e7,
    max: 1e12,
    step: 1,
    value: STARLINK_RATE,
    scale: 'log',
    format: (v) => `${fmtPower(v)}/yr`,
    onInput: (v) => {
      state.rate = v;
      wrapped();
    },
  });
  const rateSnaps = createButtonRow(
    RATE_SNAPS.map((snap) => ({
      label: snap.label,
      onClick: () => {
        state.rate = snap.watts;
        rate.setValue(snap.watts, true);
        wrapped();
      },
    })),
    'chips',
  );
  const area = createSlider({
    id: 'k-area',
    label: 'Satellite size',
    min: 50,
    max: 200000,
    step: 1,
    value: 116,
    scale: 'log',
    format: sizeChip,
    marks: [
      { value: 116, label: 'Starlink' },
      { value: 800, label: 'SpaceX AI' },
    ],
    onInput: (v) => {
      state.area = v;
      wrapped();
    },
  });
  const resetSize = el('button', 'text-link', 'reset to SpaceX satellite');
  resetSize.type = 'button';
  resetSize.addEventListener('click', () => {
    state.area = 800;
    area.setValue(800, true);
    wrapped();
  });
  const life = createSlider({
    id: 'k-life',
    label: 'Satellite lifetime',
    min: 3,
    max: 15,
    step: 1,
    value: 5,
    format: (v) => `${Math.round(v)} years`,
    onInput: (v) => {
      state.L = v;
      wrapped();
    },
  });

  const preset = createSegmented<Preset>({
    id: 'k-where',
    label: 'Where?',
    options: [
      { value: 'spacex', label: 'SpaceX filing' },
      { value: 'low', label: 'All low (500-550 km)' },
      { value: 'spread', label: 'Spread out (500-2000 km)' },
      { value: 'custom', label: 'Custom band' },
    ],
    value: 'spacex',
    onChange: (value) => {
      state.preset = value;
      band.element.hidden = value !== 'custom';
      wrapped();
    },
  });
  const band = createRangeSlider({
    label: 'Custom altitude band',
    min: 500,
    max: 2000,
    step: 50,
    value: [500, 1000],
    format: (a, b) => `${a}-${b} km`,
    onInput: (v) => {
      state.band = v;
      wrapped();
    },
  });
  band.element.hidden = true;

  const dodge = createSlider({
    id: 'k-dodge',
    label: 'Dodge success',
    min: 0,
    max: 100,
    step: 1,
    value: 99,
    scale: 'stops',
    stops: DODGE,
    format: dodgeChip,
    onInput: (v) => {
      state.dodge = v;
      wrapped();
    },
  });
  const disp = createSlider({
    id: 'k-disp',
    label: 'Failed disposals at end of life',
    sublabel: "Starlink's in-orbit failure rate so far is about 1.3% (McDowell, cited in Lewis 2026)",
    min: 0.1,
    max: 10,
    step: 0.1,
    value: 1,
    format: (v) => `${fmtSig(v)}%`,
    onInput: (v) => {
      state.dispPct = v;
      wrapped();
    },
  });
  const vuln = createSlider({
    id: 'k-vuln',
    label: 'Fraction of a satellite where a 1-10 cm hit is fatal',
    min: 1,
    max: 50,
    step: 1,
    value: 10,
    format: (v) => `${Math.round(v)}%`,
    onInput: (v) => {
      state.vulnPct = v;
      wrapped();
    },
  });
  const frag = createSlider({
    id: 'k-frag',
    label: 'Fragments ≥10 cm per catastrophic collision',
    sublabel: 'NASA breakup model gives ~2,000+ for two 3-tonne satellites; 112 is conservative.',
    min: 50,
    max: 3000,
    step: 1,
    value: 112,
    format: (v) => fmtSig(v, 3),
    onInput: (v) => {
      state.fFrag = v;
      wrapped();
    },
  });
  const coord = createSlider({
    id: 'k-coord',
    label: 'Intra-constellation coordination',
    min: 0.01,
    max: 1,
    step: 0.01,
    value: 1,
    scale: 'stops',
    stops: COORD,
    format: (v) => fmtSig(v, 2),
    onInput: (v) => {
      state.coord = v;
      wrapped();
    },
  });
  const years = createSlider({
    id: 'k-years',
    label: 'Years of operation',
    min: 1,
    max: 30,
    step: 1,
    value: 10,
    format: (v) => `${Math.round(v)} years`,
    onInput: (v) => {
      state.tYr = v;
      wrapped();
    },
  });
  const usdW = createSlider({
    id: 'k-usdw',
    label: 'Compute hardware, illustrative',
    min: 5,
    max: 100,
    step: 1,
    value: 30,
    format: (v) => `$${Math.round(v)}/W`,
    onInput: (v) => {
      state.usdPerW = v;
      wrapped();
    },
  });
  const usdKg = createSlider({
    id: 'k-usdkg',
    label: 'Satellite + launch, illustrative',
    min: 100,
    max: 10000,
    step: 50,
    value: 1000,
    scale: 'log',
    format: (v) => `$${fmtSig(v)}/kg`,
    onInput: (v) => {
      state.usdPerKg = v;
      wrapped();
    },
  });
  const debrisToggle = createToggle({
    id: 'k-debris',
    label: 'Show tracked debris',
    value: true,
    onChange: (on) => {
      state.debris = on;
      live().setDebris(on);
    },
  });

  const sizePower = el('div', 'caption');
  const sizeNote = el('div', 'caption');
  sizeNote.append(document.createTextNode('Bigger satellites: fewer dodges, but each lost one strands a bigger target. '));
  const sizeInfo = el('button', 'info', 'ⓘ');
  sizeInfo.type = 'button';
  sizeInfo.setAttribute('aria-label', 'Why satellite size matters');
  const sizePop = el(
    'div',
    'note-pop',
    "For a fixed deployment rate, total area in orbit is fixed. Fewer, bigger satellites need fewer collision-avoidance maneuvers. But untracked debris hits the same total area just as often, and in this model each fatal hit strands a whole satellite. So the stranded area per year grows with satellite size, and the cascade factor rises. If giant satellites were modular, so a hit disables only one section, lower 'Fraction where a hit is fatal' in Advanced.",
  );
  sizePop.hidden = true;
  sizeInfo.addEventListener('click', () => {
    sizePop.hidden = !sizePop.hidden;
  });
  sizeNote.append(sizeInfo, sizePop);
  const controls = el('div');
  controls.append(
    el('h2', 'section-title', 'Scenarios'),
    createButtonRow(
      [
        { label: 'SpaceX as filed', onClick: () => applyScenario('filed') },
        { label: 'Best case for SpaceX', onClick: () => applyScenario('best') },
        { label: 'Starlink today', onClick: () => applyScenario('starlink') },
      ],
      'scenarios',
    ),
    rate.element,
    rateSnaps,
    area.element,
    resetSize,
    sizePower,
    sizeNote,
    preset.element,
    band.element,
    el('h2', 'section-title', 'Avoidance'),
    dodge.element,
    disp.element,
    createCollapsible('Advanced', [life.element, debrisToggle.element, vuln.element, frag.element, coord.element, years.element, usdW.element, usdKg.element]),
    el('div', 'footer-row', ''),
  );
  const footer = controls.querySelector('.footer-row') as HTMLElement;
  footer.append(
    button('Assumptions & sources', () => openSources('Assumptions & sources', content.sources.kessler)),
    button('Equations', () => void openEquations('Equations', content.equations.kessler)),
    button('Reset view', () => live().view().resetView()),
  );

  function button(label: string, onClick: () => void): HTMLButtonElement {
    const node = el('button', 'btn', label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function paintControls(): void {
    rate.setValue(state.rate, true);
    area.setValue(state.area, true);
    life.setValue(state.L, true);
    dodge.setValue(state.dodge, true);
    disp.setValue(state.dispPct, true);
    vuln.setValue(state.vulnPct, true);
    frag.setValue(state.fFrag, true);
    coord.setValue(state.coord, true);
    years.setValue(state.tYr, true);
    usdW.setValue(state.usdPerW, true);
    usdKg.setValue(state.usdPerKg, true);
    preset.setValue(state.preset, true);
    band.setValue(state.band, true);
    debrisToggle.setValue(state.debris, true);
    band.element.hidden = state.preset !== 'custom';
    pause.setValue(state.paused, true);
    live().setPaused(state.paused);
    live().setDebris(state.debris);
  }

  function applyScenario(kind: 'filed' | 'best' | 'starlink'): void {
    const rateNow = state.rate;
    const next = defaults();
    if (kind === 'filed') {
      next.rate = 1e9;
      next.area = 800;
      next.preset = 'spacex';
    } else if (kind === 'best') {
      next.rate = rateNow;
      next.area = 800;
      next.preset = 'low';
      next.dodge = 99.99;
      next.dispPct = 0.1;
      next.vulnPct = 5;
      next.coord = 0.01;
    }
    Object.assign(state, next);
    paintControls();
    wrapped();
  }

  function inputOf(): KesslerInput {
    return {
      rateWPerYr: state.rate,
      LYr: state.L,
      pSat: state.area * W_PER_M2,
      preset: state.preset,
      band: state.band,
      s: state.dodge / 100,
      fDisp: state.dispPct / 100,
      fVuln: state.vulnPct / 100,
      tYr: state.tYr,
      fFrag: state.fFrag,
      coord: state.coord,
      usdPerW: state.usdPerW,
      usdPerKg: state.usdPerKg,
    };
  }

  function resultOf(): KesslerResult {
    return kessler(inputOf());
  }

  function recompute(): void {
    const result = resultOf();
    live().resetSim();
    const rates = kesslerShellRates(inputOf());
    sizePower.textContent = fmtPower(state.area * W_PER_M2);
    const count = live().apply(result.shells, {
      area: result.A_sat,
      kills: rates.kills,
      coll: rates.coll_total,
      active: rates.coll_active,
      linearOk: result.linear_regime_ok,
    });
    const style = r0Style(result.R0_max);
    const status = result.R0_max < 1 ? 'Stable' : result.R0_max < 10 ? 'Past tipping point' : 'Runaway';
    statusEl.textContent = status;
    statusEl.style.color = style.css;
    const scale = cascadeTimescale(inputOf());
    const shown = result.shells.find((row) => row.hLo === scale.shellLo && row.hHi === scale.shellHi);
    primary.textContent = heroPhrase(scale.mode, scale.years, !result.linear_regime_ok);
    primary.style.color = style.css;
    tauText.textContent = shown ? fmtDuration(shown.tau) : '';
    if (shown) {
      secondaryHost.hidden = false;
      secondaryText.textContent = `at ${shown.hLo.toLocaleString('en-US')}–${shown.hHi.toLocaleString('en-US')} km · R₀ = ${fmtSig(scale.R0)}`;
    } else secondaryHost.hidden = true;
    const worst = result.shells.find((row) => row.h === result.worst_h);
    const different = Boolean(shown && worst && (worst.hLo !== shown.hLo || worst.hHi !== shown.hHi));
    worstLine.hidden = !different;
    if (worst && different) {
      worstLine.textContent = `Worst R₀: ${fmtSig(result.R0_max)} at ${worst.hLo.toLocaleString('en-US')}–${worst.hHi.toLocaleString('en-US')} km`;
    }
    bannerWarn.hidden = result.linear_regime_ok;
    bannerWarn.textContent = "Off the model's scale: satellites are destroyed faster than replaced.";
    satsNum.set(fmtBig(result.N));
    satsSub.textContent = `${fmtBig(result.launches_per_yr)}/yr to replace`;
    camNum.set(fmtBig(result.cam_per_month));
    camSub.textContent = `${fmtSig(result.cam_ratio_vs_starlink, 2)}× Starlink today`;
    hitsNum.set(fmtBig(result.kills_per_yr));
    const pct = result.N > 0 ? (100 * result.kills_per_yr) / result.N : 0;
    hitsSub.textContent = `${fmtSig(pct)}% per satellite per year`;
    deadNum.set(fmtBig(result.derelicts));
    deadSub.textContent = `after ${Math.round(state.tYr)} years`;
    fragBody.textContent = `${fmtBig(result.fragments_per_yr)} trackable fragments (≥10 cm) and ${fmtBig(result.small_fragments_per_yr)} untracked fragments (1-10 cm). Today's entire untracked population: ~1.2 million.`;
    fragWarn.hidden = result.small_fragments_per_yr <= 1.2e6;
    const top = result.shells.reduce((a, b) => (a.h > b.h ? a : b), result.shells[0]);
    if (top) gauge.set(top.tau, top.h);
    latency.textContent = `Round-trip light time to the highest shell: ${fmtSig(result.rtt_ms_max)} ms (coast-to-coast fiber is ~60-70 ms). Altitude doesn't hurt latency much; it hurts cleanup.`;
    moneyBody.replaceChildren(
      line('Cost per satellite', fmtUSD(result.cost_per_sat)),
      line('Planned replacement per year', fmtUSD(result.planned_replacement_usd_per_yr)),
      line('Unplanned losses per year', fmtUSD(result.unplanned_loss_usd_per_yr)),
    );
    const perDot = count > 0 ? result.N / count : 1;
    dots.textContent = perDot < 1.05 ? 'each dot = 1 satellite' : `each dot = ${fmtBig(Math.max(1, perDot))} satellites`;
    summary(`${fmtBig(result.N)} sats · R₀ ${fmtSig(result.R0_max)}`);
  }

  function line(label: string, value: string): HTMLElement {
    const row = el('div', 'kv');
    row.append(el('span', '', label), el('b', '', value));
    return row;
  }

  let urlTimer = 0;
  function writeUrl(): void {
    window.clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (Math.abs(state.rate - STARLINK_RATE) / STARLINK_RATE > 0.01) params.set('rate', state.rate.toExponential().replace('+', ''));
      if (Math.abs(state.area - 116) > 0.5) params.set('area', String(Math.round(state.area)));
      if (state.L !== 5) params.set('L', String(state.L));
      if (state.preset !== 'starlink') params.set('preset', state.preset);
      if (state.preset === 'custom' && (state.band[0] !== 500 || state.band[1] !== 1000)) {
        params.set('band', `${state.band[0]}-${state.band[1]}`);
      }
      if (state.dodge !== 99) params.set('s', String(state.dodge));
      if (state.dispPct !== 1) params.set('disp', String(state.dispPct));
      if (state.vulnPct !== 10) params.set('vuln', String(state.vulnPct));
      if (state.tYr !== 10) params.set('t', String(state.tYr));
      if (state.fFrag !== 112) params.set('frag', String(Math.round(state.fFrag)));
      if (state.coord !== 1) params.set('coord', String(state.coord));
      const qs = params.toString();
      const next = `#/kessler${qs ? `?${qs}` : ''}`;
      if (location.hash !== next) history.replaceState(null, '', next);
    }, 300);
  }

  const wrapped = () => {
    recompute();
    writeUrl();
  };

  let shown = false;
  return {
    hud,
    controls,
    corner: pause.element,
    show() {
      live().rebind();
      setActiveView(live().view());
      shown = true;
      wrapped();
    },
    hide() {
      shown = false;
      live().detach();
    },
    reset() {
      if (shown) live().view().resetView();
    },
    readParams(params: URLSearchParams) {
      const next = defaults();
      if (params.has('rate')) next.rate = Number(params.get('rate'));
      if (params.has('L')) next.L = Number(params.get('L'));
      if (params.has('area')) next.area = Number(params.get('area'));
      else if (params.has('psat')) next.area = Number(params.get('psat')) / W_PER_M2;
      const presetName = params.get('preset');
      if (presetName === 'low' || presetName === 'spread' || presetName === 'custom' || presetName === 'starlink' || presetName === 'spacex') {
        next.preset = presetName;
      }
      const bandRaw = params.get('band');
      if (bandRaw && bandRaw.includes('-')) {
        const [a, b] = bandRaw.split('-').map(Number);
        if (Number.isFinite(a) && Number.isFinite(b)) next.band = [a, b];
      }
      if (params.has('s')) next.dodge = Number(params.get('s'));
      if (params.has('disp')) next.dispPct = Number(params.get('disp'));
      if (params.has('vuln')) next.vulnPct = Number(params.get('vuln'));
      if (params.has('t')) next.tYr = Number(params.get('t'));
      if (params.has('frag')) next.fFrag = Number(params.get('frag'));
      if (params.has('coord')) next.coord = Number(params.get('coord'));
      Object.assign(state, next);
      paintControls();
    },
  };
}
