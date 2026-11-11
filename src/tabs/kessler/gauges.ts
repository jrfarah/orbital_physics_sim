import { fmtDuration } from '../../ui/format';
import { el } from '../../ui/readout';

const STOPS: [number, [number, number, number]][] = [
  [-1, [61, 220, 151]],
  [-0.5, [155, 225, 93]],
  [0, [255, 216, 77]],
  [1, [255, 138, 61]],
  [2, [255, 77, 77]],
  [3, [255, 31, 75]],
];

export function r0Style(r0: number): { css: string; rgb: [number, number, number]; pulse: boolean } {
  const x = Math.log10(Math.max(r0, 1e-8));
  let rgb: [number, number, number];
  if (x <= STOPS[0][0]) rgb = STOPS[0][1];
  else if (x >= STOPS[STOPS.length - 1][0]) rgb = STOPS[STOPS.length - 1][1];
  else {
    let i = 0;
    while (i < STOPS.length - 2 && x > STOPS[i + 1][0]) i++;
    const [x0, c0] = STOPS[i];
    const [x1, c1] = STOPS[i + 1];
    const u = (x - x0) / (x1 - x0);
    rgb = [0, 1, 2].map((ch) => Math.round(c0[ch] + (c1[ch] - c0[ch]) * u)) as [number, number, number];
  }
  return {
    css: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    rgb: [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255],
    pulse: r0 > 100,
  };
}

export function r0Legend(): HTMLElement {
  const wrap = el('div');
  const bar = el('div', 'r0-strip');
  bar.style.background =
    'linear-gradient(90deg, #3ddc97 0%, #9be15d 12.5%, #ffd84d 25%, #ff8a3d 50%, #ff4d4d 75%, #ff1f4b 100%)';
  wrap.append(el('div', 'field-label', 'Cascade factor R₀'), bar);
  wrap.append(el('div', 'sub', '0.1 · 1 · 10 · 100 · 1000+'));
  wrap.append(
    el('div', 'faint', 'R₀ > 1: each debris-making collision triggers more than one more before drag removes the fragments.'),
  );
  return wrap;
}

const NS = 'http://www.w3.org/2000/svg';

/** Degrees, 180 at 1 year (left) and 0 at 10,000 years (right). */
export function lifetimeAngle(tauYears: number): number {
  const t = Math.min(1, Math.max(0, Math.log10(Math.max(tauYears, 1e-9)) / 4));
  return 180 - 180 * t;
}

export function createLifetimeGauge(): { element: HTMLElement; set: (tau: number, hKm: number) => void } {
  const element = el('div');
  element.append(el('div', 'field-label', 'Debris lifetime'));
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 320 168');
  svg.setAttribute('width', '100%');
  const cx = 160;
  const cy = 132;
  const radius = 86;
  const arc = document.createElementNS(NS, 'path');
  arc.setAttribute('d', `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 0 ${cx + radius} ${cy}`);
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', '#5ce1ff');
  arc.setAttribute('stroke-width', '5');
  arc.setAttribute('stroke-linecap', 'round');
  svg.append(arc);
  const labels = ['1 yr', '10 yr', '100 yr', '1,000 yr', '10,000+ yr'];
  labels.forEach((name, index) => {
    const ang = ((180 - index * 45) * Math.PI) / 180;
    const x = cx + Math.cos(ang) * (radius + 18);
    const y = cy - Math.sin(ang) * (radius + 18);
    const node = document.createElementNS(NS, 'text');
    node.setAttribute('x', String(x));
    node.setAttribute('y', String(y));
    node.setAttribute('fill', '#9aa9bb');
    node.setAttribute('font-size', '11');
    node.setAttribute('text-anchor', index === 0 ? 'end' : index === 4 ? 'start' : 'middle');
    node.setAttribute('dominant-baseline', 'middle');
    node.textContent = name;
    svg.append(node);
  });
  const needle = document.createElementNS(NS, 'line');
  needle.setAttribute('x1', String(cx));
  needle.setAttribute('y1', String(cy));
  needle.setAttribute('stroke', '#e6edf5');
  needle.setAttribute('stroke-width', '3');
  needle.setAttribute('stroke-linecap', 'round');
  svg.append(needle);
  const readout = el('div', 'caption');
  element.append(svg, readout);
  return {
    element,
    set(tau, hKm) {
      const ang = (lifetimeAngle(tau) * Math.PI) / 180;
      const reach = radius * 0.85;
      needle.setAttribute('x2', String(cx + Math.cos(ang) * reach));
      needle.setAttribute('y2', String(cy - Math.sin(ang) * reach));
      readout.textContent = `Debris at ${Math.round(hKm)} km lasts ~${fmtDuration(tau)}`;
    },
  };
}
