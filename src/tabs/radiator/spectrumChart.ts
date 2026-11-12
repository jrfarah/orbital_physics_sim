import type { FaceFlux } from '../../physics/radiator';
import { faceSpectrum } from '../../physics/spectrum';
import { reducedMotion } from '../../engine/renderer';
import { createChart, type ChartSpec } from '../../ui/charts';
import { createSegmented } from '../../ui/controls';
import { el } from '../../ui/readout';
import { incomingSeries, skyCallout } from './spectrumSeries';
import { spectrumReducer, zoomWords, type SpectrumState } from './spectrumStore';

const LAM0 = 1e-7;
const LAM1 = 1e-2;
const N = 480;

export function createSpectrumCard(): {
  element: HTMLElement;
  setFace: (which: 'A' | 'B', face: FaceFlux) => void;
  open: () => void;
} {
  const element = el('section', 'card spectrum');
  const title = el('button', 'spectrum-toggle', 'Light hitting face A ▸');
  title.type = 'button';
  const host = el('div');
  const chart = createChart(host, 1.45);
  const mag = el('div', 'caption', '×1');
  const callout = el('div', 'caption');
  callout.hidden = true;
  let chartState: SpectrumState = { face: 'A', zoom: 1, log: false };
  let anim: { from: number; to: number; t0: number } | null = null;
  let current: FaceFlux | null = null;
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

  function sample(face: FaceFlux) {
    const sun: number[] = [];
    const reflected: number[] = [];
    const earth: number[] = [];
    const cmb: number[] = [];
    for (const lam of lams) {
      const s = faceSpectrum(lam, face);
      sun.push(s.sun);
      reflected.push(s.reflected);
      earth.push(s.earth_ir);
      cmb.push(s.cmb);
    }
    return { sun, reflected, earth, cmb };
  }

  function heading(open: boolean): string {
    return `Light hitting face ${chartState.face} ${open ? '▾' : '▸'}`;
  }

  function peak(ys: number[]): number {
    let m = 0;
    for (const y of ys) if (y > m) m = y;
    return m;
  }

  function setOpen(on: boolean): void {
    opened = on;
    body.hidden = !on;
    title.textContent = heading(on);
    if (on) draw();
  }

  function draw(): void {
    if (!current) return;
    title.textContent = heading(opened);
    const face = current;
    const s = sample(face);
    const drawn = incomingSeries(face);
    const curves = { sun: s.sun, reflected: s.reflected, earth: s.earth, cmb: s.cmb };
    const bright = Math.max(peak(s.sun), peak(s.reflected), peak(s.earth));
    const cmbPeak = peak(s.cmb);
    const biggest = Math.max(bright, cmbPeak, 1e-12);
    const yMax = chartState.log ? 1e4 : biggest / chartState.zoom;
    const yMin = chartState.log ? Math.max(cmbPeak * 0.2, 1e-12) : 0;
    mag.textContent = zoomWords(chartState.zoom);
    const hint = skyCallout(bright, cmbPeak, chartState.zoom, chartState.log);
    callout.hidden = hint === null;
    callout.textContent = hint ?? '';
    host.dataset.series = drawn.map((part) => part.key).join(',');
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
      series: drawn.map((part) => ({
        name: part.label,
        color: part.color,
        xs: lams,
        ys: curves[part.key],
        peakLabel: true,
      })),
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
    setFace(which, face) {
      chartState = spectrumReducer(chartState, { type: 'face', face: which });
      current = face;
      if (opened) draw();
      else title.textContent = heading(false);
    },
  };
}
