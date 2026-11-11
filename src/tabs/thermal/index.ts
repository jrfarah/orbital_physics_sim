import { content } from '../../content';
import { thermalBudget, type ThermalInput } from '../../physics/thermal';
import { openEquations, openSources } from '../../ui/drawer';
import { fmtArea, fmtAreaSub, fmtSig, fmtTemp } from '../../ui/format';
import { card, el } from '../../ui/readout';
import { createButtonRow, createSegmented, createSlider, createToggle } from '../../ui/controls';
import { setActiveView } from '../../engine/renderer';
import { createThermalCharts } from './charts';
import { createScalePanel } from './scalePanel';
import { createThermalScene } from './scene';

type SizeId = 'sat' | 'mw';
type ScaleId = 'sat' | 'gw' | 'tw';

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
  size: SizeId;
  scale: ScaleId;
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
    size: 'sat',
    scale: 'gw',
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

export function createThermalTab(summary: (text: string) => void) {
  const state = defaults();
  const disc = el('div', 'disc-tag');
  const scene = createThermalScene(disc);
  const charts = createThermalCharts();
  const scalePanel = createScalePanel();
  const hud = el('div');

  const power = card('Power and heat budget');
  const rows = el('div');
  const vs = el('div', 'sub');
  power.body.append(rows, vs);

  const legend = el('div', 'legend-row');
  legend.append(swatch('#c2341a', 'Radiator tile'), swatch('#16306e', 'Solar tile'), el('span', 'faint', '1 tile = 5 m²'));
  const tileNote = legend.lastElementChild as HTMLElement;

  const scaleSwitch = createSegmented<ScaleId>({
    id: 'th-scale',
    options: [
      { value: 'sat', label: 'One satellite' },
      { value: 'gw', label: '1 GW per year' },
      { value: 'tw', label: '1 TW per year' },
    ],
    value: 'gw',
    onChange: (value) => {
      state.scale = value;
      wrapped();
    },
  });
  const scaleWrap = el('div');
  scaleWrap.append(el('h2', 'section-title', 'How big is this?'), scaleSwitch.element, scalePanel.element);

  hud.append(power.element, legend, charts.element, scaleWrap);

  const gpu = createSlider({
    id: 'th-gpu',
    label: 'GPU temperature limit',
    min: 330,
    max: 400,
    step: 1,
    value: 363,
    format: (v) => `${fmtTemp(v).main} · ${fmtTemp(v).sub}`,
    onInput: (v) => {
      state.tGpu = v;
      wrapped();
    },
  });
  const drop = createSlider({
    id: 'th-dt',
    label: 'Temperature drop from chip to radiator',
    min: 5,
    max: 60,
    step: 1,
    value: 30,
    format: (v) => `${Math.round(v)} K`,
    onInput: (v) => {
      state.dT = v;
      wrapped();
    },
  });
  const eps = createSlider({
    id: 'th-eps',
    label: 'Radiator emissivity',
    min: 0.8,
    max: 1,
    step: 0.01,
    value: 0.9,
    format: (v) => fmtSig(v, 2),
    onInput: (v) => {
      state.eps = v;
      wrapped();
    },
  });
  const env = createSlider({
    id: 'th-env',
    label: 'Heat landing on each radiator face',
    min: 0,
    max: 200,
    step: 0.1,
    value: 57.7,
    format: (v) => `${fmtSig(v)} W/m²`,
    onInput: (v) => {
      state.qEnv = v;
      wrapped();
    },
  });
  const pv = createSlider({
    id: 'th-pv',
    label: 'Solar cell efficiency',
    min: 0.15,
    max: 0.35,
    step: 0.01,
    value: 0.22,
    format: (v) => `${fmtSig(v * 100, 2)}%`,
    onInput: (v) => {
      state.pv = v;
      wrapped();
    },
  });
  const pack = createSlider({
    id: 'th-pack',
    label: 'Packing (fraction of array that is cells)',
    min: 0.7,
    max: 1,
    step: 0.01,
    value: 0.9,
    format: (v) => fmtSig(v, 2),
    onInput: (v) => {
      state.pack = v;
      wrapped();
    },
  });
  const sun = createSlider({
    id: 'th-sun',
    label: 'Fraction of each orbit in sunlight',
    min: 0.6,
    max: 1,
    step: 0.01,
    value: 1,
    format: (v) => fmtSig(v, 2),
    onInput: (v) => {
      state.sunlit = v;
      wrapped();
    },
  });
  const tHot = createSlider({
    id: 'th-hot',
    label: 'Radiator temperature with heat pump',
    min: 333,
    max: 600,
    step: 1,
    value: 400,
    format: (v) => `${fmtTemp(v).main} · ${fmtTemp(v).sub}`,
    onInput: (v) => {
      state.tHot = v;
      wrapped();
    },
  });
  const eta = createSlider({
    id: 'th-eta',
    label: 'How close to a perfect heat pump',
    min: 0.2,
    max: 1,
    step: 0.01,
    value: 0.5,
    format: (v) => fmtSig(v, 2),
    onInput: (v) => {
      state.eta = v;
      wrapped();
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
      wrapped();
    },
  });
  tHot.element.hidden = true;
  eta.element.hidden = true;
  const size = createSegmented<SizeId>({
    id: 'th-size',
    label: 'Compute size',
    options: [
      { value: 'sat', label: 'One SpaceX AI satellite (120 kW)' },
      { value: 'mw', label: '1 MW' },
    ],
    value: 'sat',
    onChange: (value) => {
      state.size = value;
      wrapped();
    },
  });

  const controls = el('div');
  controls.append(
    size.element,
    gpu.element,
    drop.element,
    eps.element,
    env.element,
    createButtonRow([
      { label: 'Deep space (3 K): 0', onClick: () => env.setValue(0) },
      { label: 'Best LEO case (from the Radiator tab): 57.7', onClick: () => env.setValue(57.7) },
    ]),
    pv.element,
    pack.element,
    sun.element,
    pump.element,
    tHot.element,
    eta.element,
    el('div', 'footer-row'),
  );
  const footer = controls.querySelector('.footer-row') as HTMLElement;
  footer.append(
    textButton('Assumptions & sources', () => openSources('Assumptions & sources', content.sources.thermal)),
    textButton('Equations', () => void openEquations('Equations', content.equations.thermal)),
    textButton('Reset view', () => scene.view().resetView()),
  );

  function unitPower(): number {
    return state.size === 'mw' ? 1e6 : 120e3;
  }

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
    size.setValue(state.size, true);
    scaleSwitch.setValue(state.scale, true);
    tHot.element.hidden = !state.pump;
    eta.element.hidden = !state.pump;
    const cold = state.tGpu - state.dT;
    tHot.setRange(Math.min(600, cold + 1), 600, Math.max(cold + 1, Math.min(600, state.tHot)));
  }

  function recompute(): void {
    const cold = state.tGpu - state.dT;
    const hot = Math.max(cold + 1, Math.min(600, state.tHot));
    state.tHot = hot;
    tHot.setRange(Math.min(599, cold + 1), 600, hot);
    const p = unitPower();
    const input = inputFor(p);
    const result = thermalBudget(input);
    const bare = thermalBudget({ ...input, pump: false, T_hot: null });
    let tile = state.size === 'mw' ? 40 : 5;
    let nRad = Number.isFinite(result.A_rad) ? Math.ceil(result.A_rad / tile) : 0;
    let nSol = Number.isFinite(result.A_sol) ? Math.ceil(result.A_sol / tile) : 0;
    while (nRad + nSol > 4000) {
      tile *= 1.5;
      nRad = Math.ceil(result.A_rad / tile);
      nSol = Math.ceil(result.A_sol / tile);
    }
    scene.setTileArea(tile);
    scene.layout(nRad, nSol, result.A_tot, bare.A_tot, result.T_hot);
    const diameter = 2 * Math.sqrt(result.A_tot / Math.PI);
    disc.textContent = `Equivalent disc: ${fmtSig(diameter)} m across · ${fmtArea(result.A_tot)}`;
    tileNote.textContent = `1 tile = ${fmtSig(tile, 2)} m²`;
    rows.replaceChildren(
      kv('Compute (IT load)', fmtPower(p)),
      kv('Heat-pump power', `${fmtPower(result.W)} · +${fmtSig((100 * result.W) / p, 2)}% of compute`),
      kv('Total electrical power', fmtPower(p + result.W)),
      kv('Heat to dump', fmtPower(result.Q_reject)),
      kv('Radiator temperature', `${fmtTemp(result.T_hot).main} · ${fmtTemp(result.T_hot).sub}`),
      kv('Heat shed per m² of radiator (both faces)', `${fmtSig(result.q_net)} W/m²`),
      kv('Radiator area', areaText(result.A_rad), true),
      kv('Solar area', areaText(result.A_sol), true),
      kv('Total area', areaText(result.A_tot), true),
    );
    const pct = (result.A_tot / bare.A_tot - 1) * 100;
    const sign = pct >= 0 ? '+' : '';
    vs.textContent = `vs. no heat pump: ${sign}${pct.toFixed(1)}%`;
    vs.className = pct > 0.05 ? 'sub bad' : pct < -0.05 ? 'sub good' : 'sub';
    charts.update(input, result.T_hot);
    const scaleP = state.scale === 'tw' ? 1e12 : state.scale === 'gw' ? 1e9 : p;
    const scaled = thermalBudget(inputFor(scaleP));
    const label = state.scale === 'tw' ? '1 TW per year' : state.scale === 'gw' ? '1 GW per year' : 'One satellite';
    scalePanel.set(scaled.A_tot, label, state.scale !== 'sat');
    summary(`${fmtArea(result.A_tot)} total · ${fmtPower(p)}`);
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
      if (state.size !== 'sat') params.set('size', state.size);
      if (state.scale !== 'gw') params.set('scale', state.scale);
      const qs = params.toString();
      const next = `#/thermal${qs ? `?${qs}` : ''}`;
      if (location.hash !== next) history.replaceState(null, '', next);
    }, 300);
  }

  const wrapped = () => {
    recompute();
    writeUrl();
  };

  return {
    hud,
    controls,
    show() {
      scene.rebind();
      setActiveView(scene.view());
      wrapped();
    },
    hide() {
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
      if (params.get('size') === 'mw') next.size = 'mw';
      const scale = params.get('scale');
      if (scale === 'sat' || scale === 'gw' || scale === 'tw') next.scale = scale;
      Object.assign(state, next);
      paint();
    },
  };
}

function kv(label: string, value: string, strong = false): HTMLElement {
  const row = el('div', 'kv');
  row.append(el('span', '', label), el(strong ? 'b' : 'span', '', value));
  return row;
}

function areaText(m2: number): string {
  const sub = fmtAreaSub(m2);
  return sub ? `${fmtArea(m2)} · ${sub}` : fmtArea(m2);
}

function swatch(color: string, label: string): HTMLElement {
  const node = el('span', 'faint');
  const mark = el('i', 'swatch');
  mark.style.background = color;
  node.append(mark, document.createTextNode(label));
  return node;
}

function textButton(label: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', 'btn', label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}
