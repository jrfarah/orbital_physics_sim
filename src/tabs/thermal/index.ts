import { content } from '../../content';
import { REFERENCE_AREAS } from '../../physics/references';
import { thermalBudget, type ThermalInput } from '../../physics/thermal';
import { openEquations, openSources } from '../../ui/drawer';
import { fmtArea, fmtSig, fmtTemp } from '../../ui/format';
import { bigNumber, card, el } from '../../ui/readout';
import { createButtonRow, createCollapsible, createMoreDetail, createSlider, createToggle } from '../../ui/controls';
import { reducedMotion, setActiveView } from '../../engine/renderer';
import { createThermalCharts } from './charts';
import { createThermalScene } from './scene';

const SNAPS = [
  { label: '120 kW', watts: 120e3 },
  { label: '1 MW', watts: 1e6 },
  { label: '1 GW', watts: 1e9 },
  { label: '1 TW', watts: 1e12 },
];
const FOOT_NAME: Record<string, string> = {
  football: 'Football field',
  centralpark: 'Central Park',
  manhattan: 'Manhattan',
  sf: 'San Francisco',
  ri: 'Rhode Island',
  ct: 'Connecticut',
  spacex: 'SpaceX AI satellite (~800 m²)',
};

interface ThermalState {
  tGpu: number;
  dT: number;
  eps: number;
  qEnv: number;
  pv: number;
  pack: number;
  sunlit: number;
  pump: boolean;
  tHot: number;
  eta: number;
  power: number;
}

function defaults(): ThermalState {
  return {
    tGpu: 363,
    dT: 30,
    eps: 0.9,
    qEnv: 57.7,
    pv: 0.22,
    pack: 0.9,
    sunlit: 1,
    pump: false,
    tHot: 400,
    eta: 0.5,
    power: 120e3,
  };
}

function fmtPower(w: number): string {
  const ax = Math.abs(w);
  const steps: [number, string][] = [[1e12, 'TW'], [1e9, 'GW'], [1e6, 'MW'], [1e3, 'kW']];
  for (const [scale, unit] of steps) {
    if (ax >= scale * 0.9995) {
      const n = w / scale;
      const digits = n >= 100 ? 0 : n >= 10 ? 1 : 2;
      const text = n.toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
      return `${text} ${unit}`;
    }
  }
  return `${fmtSig(w)} W`;
}

export function createThermalTab(summary: (text: string) => void) {
  const state = defaults();
  const overlay = el('div', 'stage-overlay');
  const caption = el('div', 'stage-caption');
  const scene = createThermalScene(overlay);
  const charts = createThermalCharts();
  const hud = el('div');

  const hero = card('Total area');
  hero.element.classList.add('hero');
  const total = bigNumber(hero.body);
  const stats = el('div', 'pair');
  const radStat = el('div', 'num-lg');
  const solStat = el('div', 'num-lg');
  stats.append(labeled('Radiator', radStat, '#c4341a'), labeled('Solar', solStat, '#2a5bd7'));
  const delta = el('div', 'delta');
  delta.hidden = true;
  hero.body.append(stats, delta);

  const table = el('div');
  const more = createMoreDetail('thermal', [table, charts.detail]);
  hud.append(hero.element, charts.element, more);

  const gpu = createSlider({
    id: 'th-gpu',
    label: 'GPU limit',
    min: 330,
    max: 400,
    step: 1,
    value: 363,
    format: (v) => `${fmtTemp(v).main} · ${fmtTemp(v).sub}`,
    onInput: (v) => {
      state.tGpu = v;
      schedule();
    },
  });
  const drop = createSlider({
    id: 'th-dt',
    label: 'Chip-to-radiator drop',
    min: 5,
    max: 60,
    step: 1,
    value: 30,
    format: (v) => `${Math.round(v)} K`,
    onInput: (v) => {
      state.dT = v;
      schedule();
    },
  });
  const eps = createSlider({
    id: 'th-eps',
    label: 'Emissivity',
    min: 0.8,
    max: 1,
    step: 0.01,
    value: 0.9,
    format: (v) => fmtSig(v, 2),
    onInput: (v) => {
      state.eps = v;
      schedule();
    },
  });
  const env = createSlider({
    id: 'th-env',
    label: 'Environment heat load',
    min: 0,
    max: 200,
    step: 0.1,
    value: 57.7,
    format: (v) => `${fmtSig(v)} W/m²`,
    onInput: (v) => {
      state.qEnv = v;
      schedule();
    },
  });
  const pv = createSlider({
    id: 'th-pv',
    label: 'Cell efficiency',
    min: 0.15,
    max: 0.35,
    step: 0.01,
    value: 0.22,
    format: (v) => `${fmtSig(v * 100, 2)}%`,
    onInput: (v) => {
      state.pv = v;
      schedule();
    },
  });
  const pack = createSlider({
    id: 'th-pack',
    label: 'Packing',
    min: 0.7,
    max: 1,
    step: 0.01,
    value: 0.9,
    format: (v) => fmtSig(v, 2),
    onInput: (v) => {
      state.pack = v;
      schedule();
    },
  });
  const sun = createSlider({
    id: 'th-sun',
    label: 'Sunlit fraction',
    min: 0.6,
    max: 1,
    step: 0.01,
    value: 1,
    format: (v) => fmtSig(v, 2),
    onInput: (v) => {
      state.sunlit = v;
      schedule();
    },
  });
  const tHot = createSlider({
    id: 'th-hot',
    label: 'Hot-side temperature',
    min: 333,
    max: 600,
    step: 1,
    value: 400,
    format: (v) => `${fmtTemp(v).main} · ${fmtTemp(v).sub}`,
    onInput: (v) => {
      state.tHot = v;
      schedule();
    },
  });
  const eta = createSlider({
    id: 'th-eta',
    label: 'How close to ideal',
    min: 0.2,
    max: 1,
    step: 0.01,
    value: 0.5,
    format: (v) => fmtSig(v, 2),
    onInput: (v) => {
      state.eta = v;
      schedule();
    },
  });
  const pump = createToggle({
    id: 'th-pump',
    label: 'Heat pump',
    value: false,
    onChange: (on) => {
      state.pump = on;
      tHot.element.hidden = !on;
      eta.element.hidden = !on;
      schedule();
    },
  });
  tHot.element.hidden = true;
  eta.element.hidden = true;
  let powerAnim = 0;
  let zoomPower = false;
  function stopPowerAnim(): void {
    if (powerAnim) cancelAnimationFrame(powerAnim);
    powerAnim = 0;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }
  const power = createSlider({
    id: 'th-power',
    label: 'Compute power',
    min: 120e3,
    max: 1e12,
    step: 1,
    scale: 'log',
    value: 120e3,
    format: fmtPower,
    onInput: (v) => {
      stopPowerAnim();
      state.power = v;
      zoomPower = true;
      schedule();
    },
  });
  function animatePower(target: number): void {
    stopPowerAnim();
    if (reducedMotion()) {
      state.power = target;
      power.setValue(target, true);
      zoomPower = true;
      wrapped();
      return;
    }
    const from = state.power;
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 600);
      state.power = t >= 1 ? target : Math.exp(Math.log(from) + (Math.log(target) - Math.log(from)) * t);
      power.setValue(state.power, true);
      zoomPower = true;
      recompute();
      writeUrl();
      powerAnim = t < 1 ? requestAnimationFrame(step) : 0;
    };
    powerAnim = requestAnimationFrame(step);
  }
  const snaps = createButtonRow(
    SNAPS.map((snap) => ({ label: snap.label, onClick: () => animatePower(snap.watts) })),
    'chips',
  );

  const chips = el('div', 'section');
  chips.append(el('h2', 'section-title', 'Chips'), gpu.element, drop.element);
  const pumpBlock = el('div', 'section');
  pumpBlock.append(el('h2', 'section-title', 'Heat pump'), pump.element, tHot.element, eta.element);
  const advanced = createCollapsible('Advanced', [
    eps.element,
    env.element,
    createButtonRow(
      [
        { label: 'Deep space', onClick: () => env.setValue(0) },
        { label: 'Best LEO', onClick: () => env.setValue(57.7) },
      ],
      'chips',
    ),
    pv.element,
    pack.element,
    sun.element,
  ]);
  const controls = el('div');
  const footer = el('div', 'footer-row');
  footer.append(
    textButton('Assumptions & sources', () => openSources('Assumptions & sources', content.sources.thermal)),
    textButton('Equations', () => void openEquations('Equations', content.equations.thermal)),
    textButton('Reset view', () => scene.view().resetView()),
  );
  controls.append(power.element, snaps, chips, pumpBlock, advanced, footer);

  function inputFor(p: number): ThermalInput {
    const cold = state.tGpu - state.dT;
    return {
      P: p,
      T_gpu_max: state.tGpu,
      dT_chain: state.dT,
      pump: state.pump,
      T_hot: state.pump ? Math.max(cold + 1, state.tHot) : null,
      carnot_frac: state.eta,
      eps: state.eps,
      q_env_face: state.qEnv,
      pv_eff: state.pv,
      packing: state.pack,
      sunlit: state.sunlit,
    };
  }

  function paint(): void {
    gpu.setValue(state.tGpu, true);
    drop.setValue(state.dT, true);
    eps.setValue(state.eps, true);
    env.setValue(state.qEnv, true);
    pv.setValue(state.pv, true);
    pack.setValue(state.pack, true);
    sun.setValue(state.sunlit, true);
    pump.setValue(state.pump, true);
    tHot.setValue(state.tHot, true);
    eta.setValue(state.eta, true);
    power.setValue(state.power, true);
    tHot.element.hidden = !state.pump;
    eta.element.hidden = !state.pump;
  }

  function recompute(drag = false): void {
    const cold = state.tGpu - state.dT;
    const hot = Math.max(cold + 1, Math.min(600, state.tHot));
    state.tHot = hot;
    tHot.setRange(Math.min(599, cold + 1), 600, hot);
    const p = state.power;
    const input = inputFor(p);
    const result = thermalBudget(input);
    const bare = thermalBudget({ ...input, pump: false, T_hot: null });
      scene.layout(
      {
        aRad: result.A_rad,
        aTot: result.A_tot,
        tHot: result.T_hot,
      },
      zoomPower,
      drag,
    );
    zoomPower = false;
    total.set(fmtArea(result.A_tot));
    radStat.textContent = fmtArea(result.A_rad);
    solStat.textContent = fmtArea(result.A_sol);
    const pct = Math.round((result.A_tot / bare.A_tot - 1) * 100);
    delta.hidden = !state.pump;
    delta.textContent = `vs. no heat pump: ${pct >= 0 ? '+' : ''}${pct}%`;
    delta.className = pct > 0 ? 'delta bad' : pct < 0 ? 'delta good' : 'delta';
    table.replaceChildren(
      kv('Compute', fmtPower(p)),
      kv('Pump power', fmtPower(result.W)),
      kv('Electrical', fmtPower(p + result.W)),
      kv('Heat to dump', fmtPower(result.Q_reject)),
      kv('Radiator temperature', fmtTemp(result.T_hot).main),
      kv('Flux', `${fmtSig(result.q_net)} W/m²`),
    );
    charts.update(input, result.T_hot);
    const closest = REFERENCE_AREAS.reduce((best, ref) => {
      const score = Math.abs(Math.log(ref.m2 / result.A_tot));
      return score < best.score ? { score, ref } : best;
    }, { score: Infinity, ref: REFERENCE_AREAS[0]! });
    const k = result.A_tot / closest.ref.m2;
    const kText = k >= 10 ? String(Math.round(k)) : k.toFixed(1);
    caption.textContent = `${fmtPower(p)}: ${fmtArea(result.A_tot)} of solar + radiator ≈ ${kText}× ${FOOT_NAME[closest.ref.id] ?? closest.ref.label}`;
    summary(`${fmtArea(result.A_tot)} · ${fmtPower(p)}`);
  }

  let urlTimer = 0;
  function writeUrl(): void {
    window.clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (state.tGpu !== 363) params.set('Tgpu', String(Math.round(state.tGpu)));
      if (state.dT !== 30) params.set('dT', String(Math.round(state.dT)));
      if (state.eps !== 0.9) params.set('eps', String(state.eps));
      if (state.qEnv !== 57.7) params.set('q', String(state.qEnv));
      if (state.pv !== 0.22) params.set('pv', String(state.pv));
      if (state.pack !== 0.9) params.set('pack', String(state.pack));
      if (state.sunlit !== 1) params.set('sun', String(state.sunlit));
      if (state.pump) params.set('pump', '1');
      if (state.pump && state.tHot !== 400) params.set('Thot', String(Math.round(state.tHot)));
      if (state.pump && state.eta !== 0.5) params.set('eta', String(state.eta));
      if (Math.abs(state.power - 120e3) / 120e3 > 0.01) params.set('P', String(Math.round(state.power)));
      const qs = params.toString();
      const next = `#/thermal${qs ? `?${qs}` : ''}`;
      if (location.hash !== next) history.replaceState(null, '', next);
    }, 300);
  }

  const wrapped = () => {
    recompute();
    writeUrl();
  };
  let frame = 0;
  let powerHeld = false;
  power.element.addEventListener('pointerdown', () => {
    powerHeld = true;
  });
  function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      recompute(powerHeld);
      writeUrl();
    });
  }
  const releasePower = () => {
    if (!powerHeld) return;
    powerHeld = false;
    if (frame) return;
    schedule();
  };
  window.addEventListener('pointerup', releasePower);
  window.addEventListener('pointercancel', releasePower);

  return {
    hud,
    controls,
    show() {
      document.getElementById('stage')?.append(overlay, caption);
      scene.rebind();
      setActiveView(scene.view());
      wrapped();
    },
    hide() {
      overlay.remove();
      caption.remove();
      scene.detach();
    },
    reset() {
      scene.view().resetView();
    },
    readParams(params: URLSearchParams) {
      const next = defaults();
      const num = (key: string, fallback: number) => (params.has(key) ? Number(params.get(key)) : fallback);
      next.tGpu = num('Tgpu', 363);
      next.dT = num('dT', 30);
      next.eps = num('eps', 0.9);
      next.qEnv = num('q', 57.7);
      next.pv = num('pv', 0.22);
      next.pack = num('pack', 0.9);
      next.sunlit = num('sun', 1);
      next.pump = params.get('pump') === '1';
      next.tHot = num('Thot', 400);
      next.eta = num('eta', 0.5);
      const watts = Number(params.get('P'));
      const scaleId = params.get('scale');
      const legacy: Record<string, number> = { kw: 120e3, sat: 120e3, mw: 1e6, gw: 1e9, tw: 1e12 };
      if (Number.isFinite(watts) && watts > 0) next.power = Math.min(1e12, Math.max(120e3, watts));
      else if (scaleId && legacy[scaleId]) next.power = legacy[scaleId];
      else if (params.get('size') === 'mw') next.power = 1e6;
      Object.assign(state, next);
      paint();
    },
  };
}

function labeled(label: string, value: HTMLElement, swatch?: string): HTMLElement {
  const node = el('div');
  const head = el('div', 'field-label');
  if (swatch) {
    const dot = el('i', 'swatch');
    dot.style.background = swatch;
    head.append(dot);
  }
  head.append(document.createTextNode(label));
  node.append(head, value);
  return node;
}

function kv(label: string, value: string): HTMLElement {
  const row = el('div', 'kv');
  row.append(el('span', '', label), el('span', '', value));
  return row;
}

function textButton(label: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', 'btn', label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}
