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

export function createHeatLegend(): HTMLElement {
  const wrap = el('div');
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 14;
  canvas.className = 'legend';
  const ctx = canvas.getContext('2d');
  if (ctx) {
    for (let x = 0; x < 320; x++) {
      const temp = 3 + (x / 319) * (400 - 3);
      const heat = Math.min(1, Math.max(0, (temp - 150) / (400 - 150)));
      const rgb = legendColor(heat);
      ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      ctx.fillRect(x, 0, 1, 14);
    }
  }
  const labels = el('div', 'field-head faint');
  labels.append(el('span', '', '3 K'), el('span', '', '150 K'), el('span', '', '250 K'), el('span', '', '400 K'));
  wrap.append(canvas, labels, el('div', 'faint', 'Effective temperature this face sees'));
  return wrap;
}
