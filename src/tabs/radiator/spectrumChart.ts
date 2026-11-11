import type { FaceFlux } from '../../physics/radiator';
import { faceSpectrum, panelEmission } from '../../physics/spectrum';
import { reducedMotion } from '../../engine/renderer';
import { createChart, type ChartSpec } from '../../ui/charts';
import { createButtonRow, createToggle } from '../../ui/controls';
import { fmtBig, fmtSig, fmtTimesWords } from '../../ui/format';
import { el } from '../../ui/readout';

const LAM0 = 1e-7;
const LAM1 = 1e-2;
const N = 480;

export function createSpectrumCard(): {
  element: HTMLElement;
  setFace: (which: 'A' | 'B', face: FaceFlux, eps: number, tempK: number) => void;
} {
  const element = el('section', 'card');
  const title = el('h2', '', "What's shining on face A");
  const host = el('div');
  const chart = createChart(host, 1.45);
  const mag = el('div', 'num-lg', 'Magnification ×1');
  const callout = el('div', 'warn');
  callout.hidden = true;
  const totals = el('div', 'sub');
  const ratio = el('div', 'sub');
  let zoom = 1;
  let logY = false;
  let anim: { from: number; to: number; t0: number } | null = null;
  let current: { which: 'A' | 'B'; face: FaceFlux; eps: number; tempK: number } | null = null;
  let shownCallout = false;

  const lams: number[] = [];
  for (let i = 0; i < N; i++) lams.push(LAM0 * (LAM1 / LAM0) ** (i / (N - 1)));

  const toggle = createToggle({
    id: 'log-brightness',
    label: 'Log brightness axis',
    value: false,
    onChange: (v) => {
      logY = v;
      draw();
    },
  });
  const buttons = createButtonRow([
    { label: 'Zoom in ×10', onClick: () => zoomBy(10) },
    { label: 'Reset zoom', onClick: () => { zoom = 1; anim = null; shownCallout = false; draw(); } },
  ]);

  element.append(title, mag, host, callout, totals, ratio, toggle.element, buttons);

  function sample(face: FaceFlux, eps: number, tempK: number) {
    const sun: number[] = [];
    const reflected: number[] = [];
    const earth: number[] = [];
    const cmb: number[] = [];
    const emit: number[] = [];
    for (const lam of lams) {
      const s = faceSpectrum(lam, face);
      sun.push(s.sun);
      reflected.push(s.reflected);
      earth.push(s.earth_ir);
      cmb.push(s.cmb);
      emit.push(panelEmission(lam, eps, tempK));
    }
    return { sun, reflected, earth, cmb, emit };
  }

  function peak(ys: number[]): number {
    let m = 0;
    for (const y of ys) if (y > m) m = y;
    return m;
  }

  function draw(): void {
    if (!current) return;
    title.textContent = `What's shining on face ${current.which}`;
    const s = sample(current.face, current.eps, current.tempK);
    const peaks = [peak(s.sun), peak(s.reflected), peak(s.earth), peak(s.emit)];
    const biggest = Math.max(...peaks, 1e-12);
    const cmbPeak = peak(s.cmb);
    const yMax = logY ? 1e4 : biggest / zoom;
    const yMin = logY ? 1e-12 : 0;
    mag.textContent = `Magnification ×${Math.round(zoom).toLocaleString('en-US')}`;
    if (!logY && cmbPeak > 0 && cmbPeak > 0.2 * yMax) {
      shownCallout = true;
    }
    if (shownCallout && cmbPeak > 0) {
      const n = biggest / cmbPeak;
      callout.hidden = false;
      callout.textContent = `There's the 3 K sky. You needed to magnify ${fmtTimesWords(n)} to see it.`;
    } else callout.hidden = true;
    const spec: ChartSpec = {
      xDomain: [LAM0, LAM1],
      yDomain: [yMin, yMax],
      xLog: true,
      yLog: logY,
      yLabel: logY ? 'Brightness (log)' : 'Brightness (W/m², linear)',
      xLabel: 'Wavelength',
      clipWalls: true,
      xTicks: [
        { value: 1e-7, label: '0.1 µm' },
        { value: 1e-6, label: '1 µm' },
        { value: 1e-5, label: '10 µm' },
        { value: 1e-4, label: '100 µm' },
        { value: 1e-3, label: '1 mm' },
        { value: 1e-2, label: '10 mm' },
      ],
      bandLabels: [
        { x: 2.2e-7, label: 'UV' },
        { x: 5.5e-7, label: 'Visible' },
        { x: 8e-6, label: 'Infrared' },
        { x: 2e-3, label: 'Microwave' },
      ],
      series: [
        { name: 'Sun', color: '#ffd36b', xs: lams, ys: s.sun },
        { name: 'Reflected', color: '#7fb6ff', xs: lams, ys: s.reflected },
        { name: 'Earth IR', color: '#ff8a5c', xs: lams, ys: s.earth },
        { name: 'CMB', color: '#b58cff', xs: lams, ys: s.cmb },
        { name: 'Emission', color: '#5ce1ff', xs: lams, ys: s.emit, dashed: true },
      ],
    };
    chart.draw(spec);
    const f = current.face;
    totals.textContent = `Sun ${fmtSig(f.q_sun)} · Reflected ${fmtSig(f.q_alb)} · Earth IR ${fmtSig(f.q_ir)} · CMB ${fmtSig(f.q_cmb)} W/m²`;
    const bigger = f.q_sun >= f.q_ir ? f.q_sun : f.q_ir;
    const name = f.q_sun >= f.q_ir ? 'The Sun' : "Earth's glow";
    const times = f.q_cmb > 0 ? bigger / f.q_cmb : Infinity;
    ratio.textContent = `${name} is ${fmtBig(times)} times brighter than the CMB on this face`;
  }

  function zoomBy(factor: number): void {
    const from = zoom;
    const to = zoom * factor;
    if (reducedMotion()) {
      zoom = to;
      draw();
      return;
    }
    anim = { from, to, t0: performance.now() };
    const step = (now: number) => {
      if (!anim) return;
      const t = Math.min(1, (now - anim.t0) / 300);
      const e = 1 - (1 - t) ** 3;
      zoom = anim.from + (anim.to - anim.from) * e;
      draw();
      if (t < 1) requestAnimationFrame(step);
      else anim = null;
    };
    requestAnimationFrame(step);
  }

  return {
    element,
    setFace(which, face, eps, tempK) {
      current = { which, face, eps, tempK };
      draw();
    },
  };
}
