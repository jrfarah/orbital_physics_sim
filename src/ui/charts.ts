export interface ChartSeries {
  name: string;
  color: string;
  xs: number[];
  ys: number[];
  dashed?: boolean;
  width?: number;
}

export interface ChartSpec {
  xDomain: [number, number];
  yDomain: [number, number];
  xLog?: boolean;
  yLog?: boolean;
  xLabel?: string;
  yLabel?: string;
  series: ChartSeries[];
  vLines?: { x: number; color: string; label?: string }[];
  hLines?: { y: number; color: string; label?: string; dashed?: boolean }[];
  shade?: { x0: number; x1: number; color: string; label?: string }[];
  points?: { x: number; y: number; color: string; label?: string }[];
  xTicks?: { value: number; label: string }[];
  bandLabels?: { x: number; label: string }[];
  clipWalls?: boolean;
}

export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#9aa9bb';
}

export function createChart(host: HTMLElement, aspect = 1.7): { draw: (spec: ChartSpec) => void; destroy: () => void } {
  const canvas = document.createElement('canvas');
  const labels = document.createElement('div');
  labels.className = 'chart-labels';
  host.classList.add('chart-wrap');
  host.append(canvas, labels);
  let spec: ChartSpec | null = null;
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const place = (text: string, x: number, y: number, color: string) => {
    const node = document.createElement('span');
    node.className = 'chart-label';
    node.textContent = text;
    node.style.color = color;
    labels.append(node);
    const w = node.offsetWidth;
    const h = node.offsetHeight || 12;
    const left = Math.max(0, Math.min(x, host.clientWidth - w));
    const top = Math.max(0, Math.min(y, host.clientHeight - h));
    const box = { x: left, y: top, w, h };
    const hit = placed.some((prev) => box.x < prev.x + prev.w && box.x + box.w > prev.x && box.y < prev.y + prev.h && box.y + box.h > prev.y);
    if (hit) {
      node.remove();
      return;
    }
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    placed.push(box);
  };
  const drawNow = () => {
    if (!spec) return;
    const width = Math.max(10, host.clientWidth);
    const height = Math.max(10, width / aspect);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    labels.replaceChildren();
    placed.length = 0;
    const left = 54;
    const right = 12;
    const top = spec.yLabel ? 22 : 8;
    const bottom = spec.bandLabels ? 46 : 28;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const [x0, x1] = spec.xDomain;
    const [y0, y1] = spec.yDomain;
    const xOf = (x: number) => {
      const t = spec!.xLog ? (Math.log10(x) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0)) : (x - x0) / (x1 - x0);
      return left + Math.min(1, Math.max(0, t)) * plotW;
    };
    const yOf = (y: number) => {
      const t = spec!.yLog
        ? (Math.log10(Math.max(y, y0)) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0))
        : (y - y0) / (y1 - y0 || 1);
      return top + (1 - Math.min(1, Math.max(0, t))) * plotH;
    };
    ctx.strokeStyle = 'rgba(120,180,255,0.08)';
    ctx.lineWidth = 1;
    ctx.font = '11px JetBrains Mono, ui-monospace, monospace';
    ctx.fillStyle = token('--text-dim');
    for (let i = 0; i <= 4; i++) {
      const y = top + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotW, y);
      ctx.stroke();
      const value = spec.yLog ? y0 * (y1 / y0) ** (1 - i / 4) : y1 - ((y1 - y0) * i) / 4;
      place(formatTick(value), 2, y - 6, token('--text-dim'));
    }
    if (spec.shade) {
      for (const shade of spec.shade) {
        const a = xOf(shade.x0);
        const b = xOf(shade.x1);
        ctx.fillStyle = shade.color;
        ctx.fillRect(Math.min(a, b), top, Math.abs(b - a), plotH);
      }
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, plotW, plotH);
    ctx.clip();
    for (const series of spec.series) {
      ctx.beginPath();
      ctx.strokeStyle = series.color;
      ctx.lineWidth = series.width ?? 2;
      ctx.setLineDash(series.dashed ? [5, 4] : []);
      let started = false;
      for (let i = 0; i < series.xs.length; i++) {
        const x = series.xs[i];
        let y = series.ys[i];
        if (!Number.isFinite(y) || (spec.yLog && y <= 0)) {
          started = false;
          continue;
        }
        if (spec.clipWalls && y > y1) y = y1;
        const px = xOf(x);
        const py = yOf(y);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.setLineDash([]);
    if (spec.vLines) {
      for (const line of spec.vLines) {
        const x = xOf(line.x);
        ctx.strokeStyle = line.color;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + plotH);
        ctx.stroke();
        if (line.label) place(line.label, x + 4, top + 2, line.color);
      }
    }
    if (spec.hLines) {
      for (const line of spec.hLines) {
        const y = yOf(line.y);
        ctx.strokeStyle = line.color;
        ctx.setLineDash(line.dashed === false ? [] : [4, 3]);
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (line.label) place(line.label, left + 4, y - 14, line.color);
      }
    }
    if (spec.points) {
      for (const point of spec.points) {
        ctx.fillStyle = point.color;
        ctx.beginPath();
        ctx.arc(xOf(point.x), yOf(point.y), 4, 0, Math.PI * 2);
        ctx.fill();
        if (point.label) place(point.label, xOf(point.x) + 6, yOf(point.y) - 14, point.color);
      }
    }
    const ticks = spec.xTicks ?? [];
    for (const tick of ticks) place(tick.label, xOf(tick.value) - 16, top + plotH + 6, token('--text-dim'));
    if (spec.bandLabels) {
      for (const band of spec.bandLabels) place(band.label, xOf(band.x) - 18, top + plotH + 20, token('--text-faint'));
    }
    if (spec.xLabel) place(spec.xLabel, left, height - 14, token('--text-dim'));
    if (spec.yLabel) place(spec.yLabel, left, 2, token('--text-dim'));
  };
  const observer = new ResizeObserver(() => drawNow());
  observer.observe(host);
  return {
    draw(next) {
      spec = next;
      drawNow();
    },
    destroy() {
      observer.disconnect();
    },
  };
}

function formatTick(value: number): string {
  const ax = Math.abs(value);
  if (ax !== 0 && (ax < 0.01 || ax >= 10000)) return value.toExponential(0);
  if (ax >= 100) return Math.round(value).toLocaleString('en-US');
  if (ax >= 10) return value.toFixed(0);
  return String(Math.round(value * 100) / 100);
}
