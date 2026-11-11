import { facePixel, legendColor } from '../../engine/heatMaterial';
import { el } from '../../ui/readout';

const last = new WeakMap<HTMLCanvasElement, number>();

export function paintFace(canvas: HTMLCanvasElement, heat01: number): void {
  const prev = last.get(canvas);
  if (prev !== undefined && Math.abs(prev - heat01) < 0.002) return;
  last.set(canvas, heat01);
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rgb = facePixel(heat01, x / (size - 1), y / (size - 1));
      const i = (y * size + x) * 4;
      image.data[i] = rgb[0];
      image.data[i + 1] = rgb[1];
      image.data[i + 2] = rgb[2];
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export function createHeatLegend(): { element: HTMLElement; setMarkers: (a: number, b: number) => void } {
  const wrap = el('div', 'heat-scale');
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 10;
  canvas.className = 'legend';
  const ctx = canvas.getContext('2d');
  if (ctx) {
    for (let x = 0; x < 320; x++) {
      const temp = 1 + (x / 319) * 399;
      const heat = Math.min(1, Math.max(0, (temp - 1) / 399));
      const rgb = legendColor(heat);
      ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      ctx.fillRect(x, 0, 1, 10);
    }
  }
  const pinA = el('i', 'pin a', 'A');
  const pinB = el('i', 'pin b', 'B');
  const bar = el('div', 'heat-bar');
  bar.append(canvas, pinA, pinB);
  const ticks = el('div', 'heat-ticks');
  for (const temp of [100, 200, 300]) {
    const tick = el('span', '', String(temp));
    tick.style.left = `${((temp - 1) / 399) * 100}%`;
    ticks.append(tick);
  }
  wrap.append(bar, ticks, el('div', 'caption', '1 K → 400 K'));
  const at = (temp: number) => `${Math.min(100, Math.max(0, ((temp - 1) / 399) * 100))}%`;
  return {
    element: wrap,
    setMarkers(a, b) {
      pinA.style.left = at(a);
      pinB.style.left = at(b);
    },
  };
}
