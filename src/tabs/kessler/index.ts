import { content } from '../../content';
import { openEquations, openSources } from '../../ui/drawer';
import { fmtArea, fmtBig, fmtSig, fmtUSD } from '../../ui/format';
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
import { reducedMotion, setActiveView } from '../../engine/renderer';
import {
  kessler,
  powerPerSatellite,
  satelliteCount,
  STARLINK_A,
  STARLINK_N,
  type KesslerResult,
  type Preset,
} from '../../physics/kessler';
import { createLifetimeGauge, r0Legend, r0Style } from './gauges';
import { createKesslerScene } from './scene';

type RateId = 'gw' | 'mid' | 'tw';

const RATES: Record<RateId, number> = { gw: 1e9, mid: 5e11, tw: 1e12 };
const DODGE = [0, 50, 90, 95, 99, 99.5, 99.9, 99.95, 99.99, 99.999];
const COORD = [1, 0.3, 0.1, 0.03, 0.01];

interface KesslerState {
  rate: number;
  L: number;
  pSat: number;
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
  starlink: boolean;
  debris: boolean;
  paused: boolean;
}

function defaults(): KesslerState {
  return {
    rate: 1e9,
    L: 5,
    pSat: 120e3,
    preset: 'spacex',
    band: [500, 1000],
    dodge: 99,
    dispPct: 1,
    vulnPct: 10,
    tYr: 10,
    fFrag: 112,
    coord: 1,
    usdPerW: 30,
    usdPerKg: 1000,
    starlink: false,
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

function rateId(rate: number): RateId {
  if (rate >= 7.5e11) return 'tw';
  if (rate >= 1e11) return 'mid';
  return 'gw';
}

export function createKesslerTab(summary: (text: string) => void) {
  const state = defaults();
  const tip = el('div', 'shell-tip card');
  tip.hidden = true;
  const scene = createKesslerScene(tip);
  const hud = el('div', 'grid-2');

  const banner = el('div', 'card hero span-2');
  const titleRow = el('div', 'field-label', 'Debris cascade');
  const info = el('button', 'info', 'ⓘ');
  info.type = 'button';
  info.setAttribute('aria-label', 'What tipping point means');
  titleRow.append(info);
  const bannerTitle = el('div', 'num-xl');
  const bannerSub = el('div');
  const bannerWarn = el('div', 'caption bad');
  bannerWarn.hidden = true;
  const pop = el('div', 'popover');
  pop.hidden = true;
  const term = el('b', '', 'Tipping point');
  pop.append(
    term,
    document.createTextNode(
      ' (R₀ = 1): each collision makes enough debris to cause one more collision before atmospheric drag clears it. Above 1, collisions breed collisions. "33,300× past" means that altitude holds 33,300 times more effective targets than it can sustain.',
    ),
  );
  info.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
  });
  banner.append(titleRow, bannerTitle, bannerSub, bannerWarn, pop);

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
      scene.setPaused(on);
    },
  });
  pause.element.classList.add('hud-corner');

  const badge = el('div', 'badge', 'Reference fleet: Starlink today');
  badge.hidden = true;
  const eachLine = el('div', 'caption');

  const rate = createSegmented<RateId>({
    id: 'k-rate',
    label: 'Rate',
    options: [
      { value: 'gw', label: '1 GW/yr' },
      { value: 'mid', label: '500 GW/yr' },
      { value: 'tw', label: '1 TW/yr' },
    ],
    value: 'gw',
    onChange: (id) => {
      state.starlink = false;
      state.rate = RATES[id];
      syncN(true);
      wrapped();
    },
  });
  const life = createSlider({
    id: 'k-life',
    label: 'Lifetime',
    min: 3,
    max: 15,
    step: 1,
    value: 5,
    format: (v) => `${Math.round(v)} years`,
    onInput: (v) => {
      state.L = v;
      if (!state.starlink) syncN(true);
      wrapped();
    },
  });
  const nSlider = createSlider({
    id: 'k-n',
    label: 'Satellites in orbit',
    min: satelliteCount(1e9, 5, 20e6),
    max: satelliteCount(1e9, 5, 10e3),
    step: 1,
    value: satelliteCount(1e9, 5, 120e3),
    scale: 'log',
    format: (v) => fmtBig(v),
    marks: [{ value: 1_000_000, label: 'SpaceX filing: 1,000,000' }],
    onInput: (v) => {
      state.starlink = false;
      state.pSat = powerPerSatellite(state.rate, state.L, v);
      wrapped();
    },
  });
  const resetSat = el('button', 'text-link', 'reset to SpaceX satellite');
  resetSat.type = 'button';
  resetSat.addEventListener('click', () => {
    state.starlink = false;
    state.pSat = 120e3;
    syncN(true);
    wrapped();
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
      state.starlink = false;
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
      scene.setDebris(on);
    },
  });

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
    life.element,
    nSlider.element,
    eachLine,
    resetSat,
    badge,
    preset.element,
    band.element,
    el('h2', 'section-title', 'Avoidance'),
    dodge.element,
    disp.element,
    createCollapsible('Advanced', [debrisToggle.element, vuln.element, frag.element, coord.element, years.element, usdW.element, usdKg.element]),
    el('div', 'footer-row', ''),
  );
  const footer = controls.querySelector('.footer-row') as HTMLElement;
  footer.append(
    button('Assumptions & sources', () => openSources('Assumptions & sources', content.sources.kessler)),
    button('Equations', () => void openEquations('Equations', content.equations.kessler)),
    button('Reset view', () => scene.view().resetView()),
  );

  function button(label: string, onClick: () => void): HTMLButtonElement {
    const node = el('button', 'btn', label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function syncN(fromPower: boolean): void {
    const min = satelliteCount(state.rate, state.L, 20e6);
    const max = satelliteCount(state.rate, state.L, 10e3);
    const n = fromPower ? satelliteCount(state.rate, state.L, state.pSat) : nSlider.getValue();
    nSlider.setRange(min, max, Math.min(max, Math.max(min, n)));
    nSlider.setMarks([{ value: 1_000_000, label: 'SpaceX filing: 1,000,000' }]);
    rate.setDisabled(state.starlink);
    nSlider.setDisabled(state.starlink);
    badge.hidden = !state.starlink;
    band.element.hidden = state.preset !== 'custom';
  }

  function paintControls(): void {
    rate.setValue(rateId(state.rate), true);
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
    syncN(true);
    pause.setValue(state.paused, true);
    scene.setPaused(state.paused);
    scene.setDebris(state.debris);
  }

  function applyScenario(kind: 'filed' | 'best' | 'starlink'): void {
    const rateNow = state.rate;
    const next = defaults();
    if (kind === 'best') {
      next.rate = rateNow;
      next.preset = 'low';
      next.dodge = 99.99;
      next.dispPct = 0.1;
      next.vulnPct = 5;
      next.coord = 0.01;
    } else if (kind === 'starlink') {
      next.starlink = true;
      next.preset = 'starlink';
    }
    Object.assign(state, next);
    paintControls();
    wrapped();
  }

  function resultOf(): KesslerResult {
    return kessler({
      rateWPerYr: state.rate,
      LYr: state.L,
      pSat: state.pSat,
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
      fleetOverride: state.starlink ? { N: STARLINK_N, A: STARLINK_A, m: 800 } : null,
    });
  }

  function recompute(): void {
    const result = resultOf();
    const count = scene.apply(result.shells);
    const style = r0Style(result.R0_max);
    const status = result.R0_max < 1 ? 'Stable' : result.R0_max < 10 ? 'Past tipping point' : 'Runaway';
    bannerTitle.textContent = status;
    bannerTitle.className = status === 'Past tipping point' ? 'num-lg' : 'num-xl';
    bannerTitle.style.color = style.css;
    const worst = result.shells.find((row) => row.h === result.worst_h) ?? result.shells[0];
    bannerSub.replaceChildren();
    if (worst) {
      const where = `Worst altitude: ${worst.hLo.toLocaleString('en-US')}–${worst.hHi.toLocaleString('en-US')} km is `;
      bannerSub.append(document.createTextNode(where));
      if (result.R0_max < 1) {
        bannerSub.append(document.createTextNode(`at ~${Math.round(result.R0_max * 100)}% of the tipping point`));
      } else {
        const times = result.R0_max >= 1000 ? fmtBig(result.R0_max) : String(Math.round(result.R0_max));
        const strong = el('b', '', `${times}× past the tipping point`);
        bannerSub.append(strong);
      }
    }
    bannerWarn.hidden = result.linear_regime_ok;
    bannerWarn.textContent = "Off the model's scale: satellites are destroyed faster than replaced.";
    satsNum.set(fmtBig(result.N));
    satsSub.textContent = `${fmtBig(result.launches_per_yr)}/yr to replace`;
    camNum.set(fmtBig(result.cam_per_month));
    camSub.textContent = `${fmtSig(result.cam_ratio_vs_starlink, 2)}× Starlink today`;
    hitsNum.set(fmtBig(result.kills_per_yr));
    const pct = result.N > 0 ? (100 * result.kills_per_yr) / result.N : 0;
    hitsSub.textContent = `${fmtSig(pct)}% of fleet per year`;
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
    const across = Math.round(result.span_m).toLocaleString('en-US');
    eachLine.textContent = state.starlink
      ? `${fmtArea(STARLINK_A)} · ${across} m across each`
      : `${fmtPower(state.pSat)} · ${fmtArea(result.A_sat)} · ${across} m across each`;
    summary(`${fmtBig(result.N)} sats · R₀ ${fmtSig(result.R0_max)}`);
    rate.setDisabled(state.starlink);
    nSlider.setDisabled(state.starlink);
    badge.hidden = !state.starlink;
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
      if (!state.starlink && state.rate !== 1e9) params.set('rate', state.rate.toExponential().replace('+', ''));
      if (state.L !== 5) params.set('L', String(state.L));
      if (!state.starlink && state.pSat !== 120e3) params.set('psat', String(Math.round(state.pSat)));
      if (state.preset !== 'spacex') params.set('preset', state.preset);
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
      scene.rebind();
      setActiveView(scene.view());
      shown = true;
      wrapped();
    },
    hide() {
      shown = false;
      scene.detach();
    },
    reset() {
      if (shown) scene.view().resetView();
    },
    readParams(params: URLSearchParams) {
      const next = defaults();
      if (params.has('rate')) next.rate = Number(params.get('rate'));
      if (params.has('L')) next.L = Number(params.get('L'));
      if (params.has('psat')) next.pSat = Number(params.get('psat'));
      const presetName = params.get('preset');
      if (presetName === 'low' || presetName === 'spread' || presetName === 'custom' || presetName === 'starlink' || presetName === 'spacex') {
        next.preset = presetName;
      }
      if (presetName === 'starlink') next.starlink = true;
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
