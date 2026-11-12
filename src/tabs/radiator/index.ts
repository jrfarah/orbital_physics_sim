import { content } from '../../content';
import { openEquations, openSources } from '../../ui/drawer';
import { fmtSig } from '../../ui/format';
import { createMoreDetail, createSegmented } from '../../ui/controls';
import { bigNumber, card, el } from '../../ui/readout';
import { coalesce } from '../../ui/batch';
import { requestRender, setActiveView, isMobile } from '../../engine/renderer';
import { legendColor } from '../../engine/heatMaterial';
import {
  COATINGS,
  anglesFromNormal,
  earthSkyFraction,
  edgeOnNormal,
  faceNormalFromAngles,
  faceSeesSun,
  localFrame,
  positionHat,
  radiator,
} from '../../physics/radiator';
import type { Vec3 } from '../../physics/vec';
import { Vector3 } from 'three';
import { createHeatLegend, paintFace } from './faces2d';
import { createRadiatorPanel, type RadiatorControlState } from './panel';
import { createRadiatorScene } from './scene';
import { createSpectrumCard } from './spectrumChart';
import type { FishMode } from './fisheye';

const DEG = Math.PI / 180;

function placeCompareLabels(marks: { node: HTMLElement; pct: number }[], width: number): void {
  const ordered = [...marks].sort((a, b) => a.pct - b.pct);
  const rights: number[] = [];
  let rows = 1;
  for (const mark of ordered) {
    const textWidth = Math.ceil((mark.node.textContent?.length ?? 4) * 8);
    const half = textWidth / 2;
    const center = Math.min(Math.max(half, (mark.pct / 100) * width), Math.max(half, width - half));
    const left = center - half;
    let row = rights.findIndex((right) => left > right + 8);
    if (row < 0) {
      row = rights.length;
      rights.push(-1e9);
    }
    rights[row] = left + textWidth;
    rows = Math.max(rows, row + 1);
    mark.node.style.setProperty('--row', String(row));
    mark.node.style.left = `${center}px`;
  }
  markHost(ordered[0]?.node)?.style.setProperty('--mark-rows', String(rows));
}

function markHost(node: HTMLElement | undefined): HTMLElement | null {
  return node?.parentElement ?? null;
}

export function createRadiatorTab(summary: (text: string) => void) {
  const state: RadiatorControlState & { face: 'A' | 'B' } = {
    // DECISION: heading 0° (not the spec's 90°) so the opening view is dawn/dusk edge-on.
    // In the specified local frame, heading 90° at φ = 90° points a face at the anti-sun.
    hKm: 500,
    phi: 90,
    theta: 0,
    tilt: 90,
    heading: 0,
    tempK: 320,
    coating: 'blackbody',
    showView: true,
    drag: false,
    face: 'A',
  };

  const tag = el('div', 'scale-tag', 'not to scale');
  const scene = createRadiatorScene(isMobile(), tag);
  const hud = el('div');
  const key = card('Heat shed (both faces)');
  key.element.classList.add('hero');
  const keyNum = bigNumber(key.body);
  const compare = el('div', 'compare');
  const track = el('div', 'track');
  const dot = el('div', 'dot');
  const env = el('div', 'tick amber');
  const ideal = el('div', 'tick dim');
  const capThis = el('div', 'cap high', 'This');
  const capEnv = el('div', 'cap high', '1 kW/m² estimate');
  const capIdeal = el('div', 'cap high', '3 K-sky ideal');
  const sentence = el('div', 'sub');
  const warning = el('div', 'caption bad', 'Absorbing more than it sheds.');
  warning.hidden = true;
  compare.append(track, dot, env, ideal, capThis, capEnv, capIdeal);
  key.body.append(keyNum.el, compare, sentence, warning);

  const breakdown = el('div');
  const pattern = el('div');
  pattern.append(el('div', 'field-label', 'Heat pattern'));
  const patternRow = el('div', 'heat-pattern');
  const patA = document.createElement('canvas');
  const patB = document.createElement('canvas');
  patA.style.width = '96px';
  patB.style.width = '96px';
  patternRow.append(patA, patB);
  pattern.append(patternRow);
  let fishMode: FishMode = 'camera';
  let poseKey = '';
  const fishNote = el('div', 'caption', 'Sun drawn enlarged');
  const heatNote = el('div', 'caption', 'Area on this disk = share of heat received');
  heatNote.hidden = true;
  const fishPick = createSegmented<FishMode>({
    id: 'rad-fisheye',
    options: [
      { value: 'camera', label: 'Camera view' },
      { value: 'heat', label: 'Heat-weighted' },
    ],
    value: 'camera',
    onChange: (value) => {
      fishMode = value;
      heatNote.hidden = value !== 'heat';
      poseKey = '';
      coalesce(wrapped);
    },
  });
  const faces = el('div', 'faces');
  const faceA = faceCard('A');
  const faceB = faceCard('B');
  faces.append(faceA.root, faceB.root);
  const legend = createHeatLegend();
  const spectrum = createSpectrumCard();
  const foot = el('div', 'faint');
  const more = createMoreDetail('radiator', [pattern, breakdown, foot]);
  hud.append(key.element, fishPick.element, fishNote, heatNote, faces, legend.element, spectrum.element, more);
  const cameraPick = createSegmented<'overview' | 'sat'>({
    id: 'rad-camera',
    options: [
      { value: 'overview', label: 'Overview' },
      { value: 'sat', label: 'From the satellite' },
    ],
    value: 'sat',
    onChange: (value) => scene.setPreset(value),
  });
  cameraPick.element.classList.add('stage-presets');

  const panel = createRadiatorPanel({
    state,
    onChange: () => coalesce(wrapped),
    onOrient: (kind) => {
      const r = hat();
      let n: Vec3;
      if (kind === 'up') n = localFrame(r).up;
      else if (kind === 'earth') n = localFrame(r).up.map((v) => -v) as Vec3;
      else if (kind === 'sun') n = [1, 0, 0];
      else n = edgeOnNormal(r);
      const ang = anglesFromNormal(r, n, state.heading * DEG);
      state.tilt = (ang.tilt * 180) / Math.PI;
      state.heading = (ang.heading * 180) / Math.PI;
      panel.refresh();
      wrapped();
    },
    onScenario: (kind) => {
      state.hKm = kind === 'high' ? 2000 : 500;
      state.theta = 0;
      state.tempK = 320;
      state.coating = 'blackbody';
      if (kind === 'night') {
        state.phi = 180;
        state.tilt = 0;
      } else if (kind === 'noon') {
        state.phi = 0;
        state.tilt = 0;
      } else if (kind === 'term') {
        state.phi = 90;
        state.tilt = 0;
      } else {
        state.phi = 90;
        const r = positionHat(0, 90 * DEG);
        const n = edgeOnNormal(r);
        const ang = anglesFromNormal(r, n, 0);
        state.tilt = (ang.tilt * 180) / Math.PI;
        state.heading = (ang.heading * 180) / Math.PI;
      }
      panel.refresh();
      wrapped();
    },
    onFocus: () => scene.focusPanel(),
    onReset: () => scene.view().resetView(),
    onSources: () => openSources('Assumptions & sources', content.sources.radiator),
    onEquations: () => void openEquations('Equations', content.equations.radiator),
  });

  function hat(): Vec3 {
    return positionHat(state.theta * DEG, state.phi * DEG);
  }

  function recompute(): void {
    const r = hat();
    const frame = localFrame(r);
    const n = faceNormalFromAngles(r, state.tilt * DEG, state.heading * DEG);
    const coat = COATINGS[state.coating];
    const result = radiator(state.hKm, r, n, coat.alpha, coat.eps, state.tempK);
    scene.update(state.hKm, r, n, frame.east, result, state.showView);
    if (dragArmed !== state.drag) {
      dragArmed = state.drag;
      scene.setDrag(state.drag, (phi, theta) => {
        state.phi = Math.max(-180, Math.min(180, phi));
        state.theta = Math.max(-90, Math.min(90, theta));
        panel.refresh();
        coalesce(wrapped);
      });
    }
    const total = result.total_net;
    keyNum.set(`${fmtSig(total)} W/m²`);
    keyNum.el.classList.toggle('bad', total < 0);
    const scaleMax = Math.max(result.ideal, 1200, Math.max(total, 0));
    const at = (v: number) => Math.min(100, Math.max(0, (v / scaleMax) * 100));
    dot.style.left = `${at(total)}%`;
    env.style.left = `${at(content.backOfEnvelopeWm2)}%`;
    ideal.style.left = `${at(result.ideal)}%`;
    placeCompareLabels(
      [
        { node: capThis, pct: at(total) },
        { node: capEnv, pct: at(content.backOfEnvelopeWm2) },
        { node: capIdeal, pct: at(result.ideal) },
      ],
      compare.clientWidth || 300,
    );
    const pct = Math.round((100 * total) / content.backOfEnvelopeWm2);
    const pct2 = Math.round((100 * total) / result.ideal);
    sentence.textContent = `${pct}% of the estimate`;
    sentence.className = 'caption';
    void pct2;
    warning.hidden = total >= 0;
    paintFaceCard(faceA, 'A', result.A);
    paintFaceCard(faceB, 'B', result.B);
    maybeCapture(frame.up, frame.north, n);
    legend.setMarkers(result.A.T_sink, result.B.T_sink);
    const selected = state.face === 'A' ? result.A : result.B;
    spectrum.setFace(state.face, selected, coat.eps, state.tempK);
    const sky = Math.round(earthSkyFraction(state.hKm) * 100);
    const sun = faceSeesSun(state.hKm, r) ? 'in sunlight' : "in Earth's shadow";
    foot.textContent = `Altitude ${Math.round(state.hKm)} km · Earth fills ${sky}% of the sky · ${sun}`;
    summary(`${fmtSig(total)} W/m² · ${fmtSig(state.tempK)} K`);
    requestRender();
  }

  function maybeCapture(zenith: Vec3, north: Vec3, normal: Vec3): void {
    const key = [state.hKm, state.phi, state.theta, state.tilt, state.heading, fishMode].join('|');
    if (key === poseKey) return;
    poseKey = key;
    const up = new Vector3(zenith[0], zenith[1], zenith[2]);
    const nrm = new Vector3(north[0], north[1], north[2]);
    const n = new Vector3(normal[0], normal[1], normal[2]);
    scene.captureFisheye(
      [
        { normal: n, zenith: up, north: nrm, canvas: faceA.canvas },
        { normal: n.clone().multiplyScalar(-1), zenith: up, north: nrm, canvas: faceB.canvas },
      ],
      fishMode,
    );
  }

  function paintFaceCard(face: ReturnType<typeof faceCard>, which: 'A' | 'B', flux: ReturnType<typeof radiator>['A']): void {
    face.root.classList.toggle('selected', state.face === which);
    const sun = flux.q_sun > 0 ? ' · Sun in view' : '';
    face.fill.textContent = `Earth fills ${Math.round(flux.F * 100)}%${sun}`;
    const heat = Math.min(1, Math.max(0, (flux.T_sink - 1) / 399));
    const rgb = legendColor(heat);
    face.swatch.style.background = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    paintFace(which === 'A' ? patA : patB, heat);
    face.temp.textContent = `Sees ${fmtSig(flux.T_sink)} K`;
    const parts = [
      { v: flux.q_sun, color: '#ffd36b', name: 'Sunlight' },
      { v: flux.q_alb, color: '#7fb6ff', name: 'Sunlight reflected off Earth' },
      { v: flux.q_ir, color: '#ff8a5c', name: "Earth's infrared glow" },
      { v: flux.q_cmb, color: '#b58cff', name: 'Cosmic microwave background' },
    ];
    face.legend.replaceChildren(el('div', 'field-label', `Face ${which}`));
    for (const part of parts) {
      face.legend.append(el('div', 'faint', `${part.name}: ${fmtSig(part.v)} W/m²`));
    }
    face.shed.textContent = `Sheds ${fmtSig(flux.q_net)} W/m²`;
  }

  function faceCard(which: 'A' | 'B') {
    const root = el('article', 'card face');
    const title = el('div', 'field-label', `Face ${which}`);
    const view = el('div', 'fisheye');
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const rim = el('div', 'rim');
    const fill = el('div', 'fill');
    view.append(canvas, rim, fill);
    const tempRow = el('div', 'face-temp');
    const swatch = el('i', 'swatch');
    const temp = el('div', 'num-lg');
    tempRow.append(swatch, temp);
    const shed = el('div', 'caption');
    const legendRow = el('div');
    root.append(title, view, tempRow, shed);
    breakdown.append(legendRow);
    root.addEventListener('click', () => {
      state.face = which;
      spectrum.open();
      recompute();
    });
    return { root, canvas, fill, swatch, temp, legend: legendRow, shed };
  }

  let dragArmed = false;
  let urlTimer = 0;
  function writeUrl(): void {
    window.clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (state.hKm !== 500) params.set('h', String(state.hKm));
      if (state.phi !== 90) params.set('phi', String(Math.round(state.phi)));
      if (state.theta !== 0) params.set('th', String(Math.round(state.theta)));
      if (Math.round(state.tilt) !== 90) params.set('tilt', String(Math.round(state.tilt)));
      if (Math.round(state.heading) !== 0) params.set('head', String(Math.round(state.heading)));
      if (state.tempK !== 320) params.set('T', String(Math.round(state.tempK)));
      if (state.coating !== 'blackbody') params.set('coat', state.coating);
      const qs = params.toString();
      const next = `#/radiator${qs ? `?${qs}` : ''}`;
      if (location.hash !== next) history.replaceState(null, '', next);
    }, 300);
  }

  const wrapped = () => {
    recompute();
    writeUrl();
  };

  return {
    hud,
    controls: panel.element,
    corner: cameraPick.element,
    tag,
    show() {
      document.getElementById('stage')?.append(tag, scene.overlay);
      scene.rebind();
      const view = scene.view();
      setActiveView(view);
      wrapped();
    },
    hide() {
      tag.remove();
      scene.overlay.remove();
      scene.detach();
    },
    reset() {
      scene.view().resetView();
    },
    readParams(params: URLSearchParams) {
      const num = (k: string, fallback: number) => (params.has(k) ? Number(params.get(k)) : fallback);
      state.hKm = num('h', 500);
      state.phi = num('phi', 90);
      state.theta = num('th', 0);
      state.tilt = num('tilt', 90);
      state.heading = num('head', 0);
      state.tempK = num('T', 320);
      const coat = params.get('coat');
      if (coat === 'black' || coat === 'white' || coat === 'blackbody') state.coating = coat;
      panel.refresh();
    },
    recompute: wrapped,
  };
}
