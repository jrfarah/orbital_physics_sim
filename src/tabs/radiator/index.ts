import { content } from '../../content';
import { openEquations, openSources } from '../../ui/drawer';
import { fmtSig } from '../../ui/format';
import { bigNumber, card, el } from '../../ui/readout';
import { coalesce } from '../../ui/batch';
import { requestRender, setActiveView, isMobile } from '../../engine/renderer';
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
import { createHeatLegend, paintFace } from './faces2d';
import { createRadiatorPanel, type RadiatorControlState } from './panel';
import { createRadiatorScene } from './scene';
import { createSpectrumCard } from './spectrumChart';

const DEG = Math.PI / 180;

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
  const key = card('Heat shed by the radiator (both faces)');
  const keyNum = bigNumber(key.body);
  const keySub = el('div', 'sub');
  const compare = el('div', 'compare');
  const track = el('div', 'track');
  const dot = el('div', 'dot');
  const env = el('div', 'tick amber');
  const ideal = el('div', 'tick dim');
  const sentence = el('div', 'sub');
  const warning = el('div', 'bad', 'This panel is absorbing more than it sheds.');
  warning.hidden = true;
  compare.append(track, dot, env, ideal);
  key.body.append(keyNum.el, keySub, compare, sentence, warning);

  const faces = el('div', 'faces');
  const faceA = faceCard('A');
  const faceB = faceCard('B');
  faces.append(faceA.root, faceB.root);
  const legend = createHeatLegend();
  const spectrum = createSpectrumCard();
  const foot = el('div', 'faint');
  hud.append(key.element, legend, faces, spectrum.element, foot);

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
    keySub.textContent = `${fmtSig(total / 1000)} kW/m² · heat shed per square meter`;
    const scaleMax = Math.max(result.ideal, 1200, Math.max(total, 0));
    const at = (v: number) => `${Math.min(100, Math.max(0, (v / scaleMax) * 100))}%`;
    dot.style.left = at(total);
    env.style.left = at(content.backOfEnvelopeWm2);
    ideal.style.left = at(result.ideal);
    const pct = Math.round((100 * total) / content.backOfEnvelopeWm2);
    const pct2 = Math.round((100 * total) / result.ideal);
    sentence.innerHTML = `<strong>${pct}%</strong> of the back-of-envelope estimate · <strong>${pct2}%</strong> of the 3 K-sky ideal`;
    warning.hidden = total >= 0;
    paintFaceCard(faceA, 'A', result.A);
    paintFaceCard(faceB, 'B', result.B);
    const selected = state.face === 'A' ? result.A : result.B;
    spectrum.setFace(state.face, selected, coat.eps, state.tempK);
    const sky = Math.round(earthSkyFraction(state.hKm) * 100);
    const sun = faceSeesSun(state.hKm, r) ? 'in sunlight' : "in Earth's shadow";
    foot.textContent = `Altitude ${Math.round(state.hKm)} km · Earth fills ${sky}% of the sky · ${sun}`;
    summary(`${fmtSig(total)} W/m² · ${fmtSig(state.tempK)} K`);
    requestRender();
  }

  function paintFaceCard(face: ReturnType<typeof faceCard>, which: 'A' | 'B', flux: ReturnType<typeof radiator>['A']): void {
    face.root.classList.toggle('selected', state.face === which);
    paintFace(face.canvas, Math.min(1, Math.max(0, (flux.T_sink - 150) / 250)));
    const temp = flux.T_sink;
    face.temp.textContent = `${fmtSig(temp)} K`;
    face.celsius.textContent = `${Math.round(temp - 273)} °C`;
    const parts = [
      { v: flux.q_sun, color: '#ffd36b', name: 'Sunlight' },
      { v: flux.q_alb, color: '#7fb6ff', name: 'Sunlight reflected off Earth' },
      { v: flux.q_ir, color: '#ff8a5c', name: "Earth's infrared glow" },
      { v: flux.q_cmb, color: '#b58cff', name: 'Cosmic microwave background' },
    ];
    const sum = parts.reduce((a, p) => a + p.v, 0) || 1;
    face.stack.replaceChildren();
    face.legend.replaceChildren();
    for (const part of parts) {
      const seg = el('i');
      seg.style.width = `${(part.v / sum) * 100}%`;
      seg.style.background = part.color;
      face.stack.append(seg);
      face.legend.append(el('div', 'faint', `${part.name}: ${fmtSig(part.v)} W/m²`));
    }
    face.shed.textContent = `Sheds ${fmtSig(flux.q_net)} W/m²`;
  }

  function faceCard(which: 'A' | 'B') {
    const root = el('article', 'card face');
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    const title = el('div', 'field-label', `Face ${which}`);
    const sees = el('div', 'faint', 'Sees an effective temperature of');
    const temp = el('div', 'num-lg');
    const celsius = el('div', 'faint');
    const stack = el('div', 'stack');
    const legendRow = el('div');
    const shed = el('div', 'sub');
    root.append(title, canvas, sees, temp, celsius, stack, legendRow, shed);
    root.addEventListener('click', () => {
      state.face = which;
      recompute();
    });
    return { root, canvas, temp, celsius, stack, legend: legendRow, shed };
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
    tag,
    show() {
      scene.rebind();
      const view = scene.view();
      setActiveView(view);
      wrapped();
    },
    hide() {
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
