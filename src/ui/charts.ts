export interface ChartSeries {
  name: string;
  color: string;
  xs: number[];
  ys: number[];
  dashed?: boolean;
  width?: number;
  /** Draw the series name at the last finite point instead of in a legend. */
  endLabel?: boolean;
  /** Draw the series name at its highest sample. */
  peakLabel?: boolean;
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
  points?: { x: number; y: number; color: string; label?: string; hollow?: boolean }[];
  xTicks?: { value: number; label: string }[];
  bandLabels?: { x: number; label: string }[];
  clipWalls?: boolean;
  legend?: boolean;
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
  const place = (text: string, x: number, y: number, color: string, clamp = true): boolean => {
    const node = document.createElement('span');
    node.className = 'chart-label';
    node.textContent = text;
    node.style.color = color;
    labels.append(node);
    const w = node.offsetWidth;
    const h = node.offsetHeight || 12;
    let left = x;
    let top = y;
    if (clamp) {
      left = Math.max(0, Math.min(x, Math.max(0, host.clientWidth - w)));
      top = Math.max(0, Math.min(y, Math.max(0, host.clientHeight - h)));
    } else if (left < 0 || top < 0 || left + w > host.clientWidth + 1 || top + h > host.clientHeight + 1) {
      node.remove();
      return false;
    }
    const box = { x: left, y: top, w, h };
    const hit = placed.some((prev) => box.x < prev.x + prev.w && box.x + box.w > prev.x && box.y < prev.y + prev.h && box.y + box.h > prev.y);
    if (hit) {
      node.remove();
      return false;
    }
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    placed.push(box);
    return true;
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
    const [y0, y1] = spec.yDomain;
    ctx.font = '11px JetBrains Mono, ui-monospace, monospace';
    const yTicks = niceTicks(y0, y1, spec.yLog);
    let left = 28;
    for (const value of yTicks) left = Math.max(left, ctx.measureText(formatTick(value)).width + 8);
    const right = 12;
    const top = spec.yLabel ? 22 : 8;
    const bottom = spec.bandLabels ? 46 : 28;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const [x0, x1] = spec.xDomain;
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
    ctx.fillStyle = token('--text-dim');
    for (const value of yTicks) {
      const y = yOf(value);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotW, y);
      ctx.stroke();
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
    const ends: { name: string; x: number; y: number; color: string }[] = [];
    const peaks: { name: string; x: number; y: number; color: string }[] = [];
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
      let lastX = 0;
      let lastY = 0;
      let peakValue = -Infinity;
      let peakX = 0;
      let peakY = 0;
      for (let i = 0; i < series.xs.length; i++) {
        const x = series.xs[i];
        const raw = series.ys[i] ?? 0;
        let y = raw;
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
        lastX = px;
        lastY = py;
        if (raw > peakValue) {
          peakValue = raw;
          peakX = px;
          peakY = py;
        }
      }
      ctx.stroke();
      if (series.endLabel && started) ends.push({ name: series.name, x: lastX, y: lastY, color: series.color });
      if (series.peakLabel && started) peaks.push({ name: series.name, x: peakX, y: peakY, color: series.color });
    }
    ctx.restore();
    const boxes: { text: string; x: number; y: number; w: number; h: number }[] = [];
    const pin = (name: string, x: number, y: number, color: string): boolean => {
      if (!place(name, x, y, color, false)) return false;
      const box = placed[placed.length - 1]!;
      boxes.push({ text: name, x: box.x, y: box.y, w: box.w, h: box.h });
      return true;
    };
    for (const end of ends) {
      const guess = end.name.length * 6.6 + 8;
      const x = Math.max(left + 4, Math.min(end.x, left + plotW) - guess);
      const y = Math.max(top + 2, end.y - 16);
      pin(end.name, x, y, end.color) || pin(end.name, x, Math.max(top + 2, y - 14), end.color);
    }
    for (const peak of peaks) {
      const guess = peak.name.length * 6.6 + 8;
      const xs = [peak.x + 8, Math.max(left + 4, peak.x - guess)];
      const ys = [peak.y - 16, peak.y - 32, peak.y - 48, peak.y + 4, peak.y + 18];
      let parked = false;
      for (const x of xs) {
        for (const y of ys) {
          if (pin(peak.name, Math.max(left + 2, x), Math.max(top + 2, y), peak.color)) {
            parked = true;
            break;
          }
        }
        if (parked) break;
      }
    }
    host.setAttribute(
      'data-boxes',
      JSON.stringify(boxes.map((box) => ({ text: box.text, x: box.x, y: box.y, w: box.w, h: box.h }))),
    );
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
    if (spec.legend) {
      let cursor = left + plotW;
      for (const series of [...spec.series].reverse()) {
        cursor -= series.name.length * 7 + 10;
        place(series.name, cursor, 2, series.color);
      }
    }
    if (spec.points) {
      for (const point of spec.points) {
        const px = xOf(point.x);
        const py = yOf(point.y);
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        if (point.hollow) {
          ctx.strokeStyle = point.color;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = point.color;
          ctx.fill();
        }
        if (!point.label) continue;
        const spots: [number, number][] = [
          [px + 8, py - 16],
          [px + 8, py + 8],
          [px - 72, py - 16],
          [left + 4, top + 16],
          [left + plotW - 72, top + 16],
        ];
        for (const [x, y] of spots) {
          if (place(point.label, x, y, point.color, false)) break;
        }
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
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver === 'function') {
    try {
      observer = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          if (!host.isConnected) return;
          drawNow();
        });
      });
      observer.observe(host);
    } catch {
      observer = null;
    }
  }
  return {
    draw(next) {
      spec = next;
      drawNow();
    },
    destroy() {
      observer?.disconnect();
    },
  };
}

function niceTicks(min: number, max: number, log = false): number[] {
  if (!(max > min)) return [min];
  if (log && min > 0 && max > 0) {
    const out: number[] = [];
    for (let exp = Math.ceil(Math.log10(min)); exp <= Math.floor(Math.log10(max)) && out.length < 5; exp++) out.push(10 ** exp);
    return out.length ? out : [min, max];
  }
  const rough = (max - min) / 4;
  const exp = Math.floor(Math.log10(Math.max(rough, 1e-12)));
  const base = rough / 10 ** exp;
  const nice = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  const step = nice * 10 ** exp;
  const start = Math.ceil((min - step * 1e-9) / step) * step;
  const out: number[] = [];
  for (let value = start; value <= max + step * 1e-6 && out.length < 5; value += step) out.push(value);
  return out.length ? out : [min, max];
}

function formatTick(value: number): string {
  const ax = Math.abs(value);
  if (ax === 0) return '0';
  if (ax < 1e-3 || ax >= 1e6) {
    const exp = Math.floor(Math.log10(ax));
    const mantissa = value / 10 ** exp;
    const digits = Math.abs(mantissa) >= 10 ? 0 : 1;
    const shown = Number(mantissa.toFixed(digits));
    return `${shown}×10${superscript(exp)}`;
  }
  if (ax >= 100) return Math.round(value).toLocaleString('en-US');
  if (ax >= 10) return value.toFixed(0);
  const text = value.toPrecision(3);
  return String(Number(text));
}

function superscript(exp: number): string {
  const digits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const body = String(Math.abs(exp))
    .split('')
    .map((d) => digits[Number(d)])
    .join('');
  return exp < 0 ? `⁻${body}` : body;
}
