import type { FaceFlux } from '../../physics/radiator';
import { faceSpectrum, panelEmission } from '../../physics/spectrum';
import { reducedMotion } from '../../engine/renderer';
import { createChart, type ChartSpec } from '../../ui/charts';
import { createSegmented } from '../../ui/controls';
import { el } from '../../ui/readout';
import { spectrumReducer, zoomWords, type SpectrumState } from './spectrumStore';

const LAM0 = 1e-7;
const LAM1 = 1e-2;
const N = 480;

export function createSpectrumCard(): {
  element: HTMLElement;
  setFace: (which: 'A' | 'B', face: FaceFlux, eps: number, tempK: number) => void;
  open: () => void;
} {
  const element = el('section', 'card spectrum');
  const title = el('button', 'spectrum-toggle', "What's shining on face A ▸");
  title.type = 'button';
  const host = el('div');
  const chart = createChart(host, 1.45);
  const mag = el('div', 'caption', '×1');
  const callout = el('div', 'caption');
  callout.hidden = true;
  let chartState: SpectrumState = { face: 'A', zoom: 1, log: false };
  let anim: { from: number; to: number; t0: number } | null = null;
  let current: { face: FaceFlux; eps: number; tempK: number } | null = null;
  let opened = false;

  const lams: number[] = [];
  for (let i = 0; i < N; i++) lams.push(LAM0 * (LAM1 / LAM0) ** (i / (N - 1)));

  const axis = createSegmented<'linear' | 'log'>({
    id: 'spec-axis',
    options: [
      { value: 'linear', label: 'Linear' },
      { value: 'log', label: 'Log' },
    ],
    value: 'linear',
    onChange: (value) => {
      chartState = spectrumReducer(chartState, { type: 'log', value: value === 'log' });
      draw();
    },
  });
  const zoomOut = el('button', 'btn', '−');
  zoomOut.type = 'button';
  zoomOut.addEventListener('click', () => zoomBy(0.1));
  const zoomIn = el('button', 'btn', '+');
  zoomIn.type = 'button';
  zoomIn.addEventListener('click', () => zoomBy(10));
  const reset = el('button', 'btn', 'Reset');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    anim = null;
    chartState = spectrumReducer(chartState, { type: 'reset' });
    draw();
  });
  const tools = el('div', 'spectrum-tools');
  tools.append(zoomOut, zoomIn, reset, mag);
  const body = el('div');
  body.hidden = true;
  body.append(axis.element, tools, host, callout);
  element.append(title, body);
  title.addEventListener('click', () => setOpen(!opened));

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

  function setOpen(on: boolean): void {
    opened = on;
    body.hidden = !on;
    title.textContent = `What's shining on face ${chartState.face} ${on ? '▾' : '▸'}`;
    if (on) draw();
  }

  function draw(): void {
    if (!current) return;
    title.textContent = `What's shining on face ${chartState.face} ${opened ? '▾' : '▸'}`;
    const s = sample(current.face, current.eps, current.tempK);
    const peaks = [peak(s.sun), peak(s.reflected), peak(s.earth), peak(s.emit)];
    const biggest = Math.max(...peaks, 1e-12);
    const cmbPeak = peak(s.cmb);
    const yMax = chartState.log ? 1e4 : biggest / chartState.zoom;
    const yMin = chartState.log ? Math.max(cmbPeak * 0.2, 1e-12) : 0;
    mag.textContent = zoomWords(chartState.zoom);
    const visible = !chartState.log && cmbPeak > 0 && cmbPeak >= yMax * 0.02;
    callout.hidden = !visible;
    if (visible) callout.textContent = `3 K sky visible at ${zoomWords(chartState.zoom)}`;
    const spec: ChartSpec = {
      xDomain: [LAM0, LAM1],
      yDomain: [yMin, yMax],
      xLog: true,
      yLog: chartState.log,
      yLabel: 'W/m²',
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
  }

  function zoomBy(factor: number): void {
    const from = chartState.zoom;
    const next = spectrumReducer(chartState, { type: 'zoom', factor });
    const to = next.zoom;
    if (reducedMotion()) {
      chartState = next;
      draw();
      return;
    }
    anim = { from, to, t0: performance.now() };
    const step = (now: number) => {
      if (!anim) return;
      const t = Math.min(1, (now - anim.t0) / 300);
      const e = 1 - (1 - t) ** 3;
      chartState = { ...chartState, zoom: anim.from + (anim.to - anim.from) * e };
      draw();
      if (t < 1) requestAnimationFrame(step);
      else {
        chartState = next;
        anim = null;
        draw();
      }
    };
    requestAnimationFrame(step);
  }

  return {
    element,
    open() {
      setOpen(true);
    },
    setFace(which, face, eps, tempK) {
      chartState = spectrumReducer(chartState, { type: 'face', face: which });
      current = { face, eps, tempK };
      if (opened) draw();
      else title.textContent = `What's shining on face ${which} ▸`;
    },
  };
}
