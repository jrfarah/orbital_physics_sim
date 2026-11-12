import raw from '../../assets/outlines.json';

interface Packed {
  id: string;
  label: string;
  area?: number;
  rings: number[][][];
  approx: boolean;
}

interface Shape {
  id: string;
  label: string;
  area: number;
  lines: number[][];
}

function arc(cx: number, cz: number, r: number, a0: number, a1: number, steps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
  }
  return out;
}

function rect(x0: number, z0: number, x1: number, z1: number): number[] {
  return [x0, z0, x1, z0, x1, z1, x0, z1, x0, z0];
}

function courtLines(): number[][] {
  const L = 28.65;
  const W = 15.24;
  const lines = [rect(-L / 2, -W / 2, L / 2, W / 2), [0, -W / 2, 0, W / 2], arc(0, 0, 1.83, 0, Math.PI * 2, 32)];
  for (const sign of [-1, 1]) {
    const base = (sign * L) / 2;
    const inward = base - sign * 5.79;
    lines.push(rect(Math.min(base, inward), -2.44, Math.max(base, inward), 2.44));
    const basket = base - sign * 1.6;
    const cornerZ = W / 2 - 0.91;
    const dx = Math.sqrt(Math.max(0, 7.24 ** 2 - cornerZ ** 2));
    const angle = Math.atan2(cornerZ, dx);
    const face = -sign;
    lines.push(arc(basket, 0, 7.24, face === 1 ? -angle : Math.PI - angle, face === 1 ? angle : Math.PI + angle, 28));
    const meetX = basket + face * dx;
    lines.push([base, cornerZ, meetX, cornerZ]);
    lines.push([base, -cornerZ, meetX, -cornerZ]);
  }
  return lines;
}

function fieldLines(): number[][] {
  const L = 109.7;
  const W = 48.8;
  const lines = [rect(-L / 2, -W / 2, L / 2, W / 2)];
  const yard = 0.9144 * 10;
  for (let x = -L / 2 + yard; x < L / 2 - yard * 0.5; x += yard) lines.push([x, -W / 2, x, W / 2]);
  return lines;
}

function heightOf(lines: number[][]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 2) {
      min = Math.min(min, line[i]!);
      max = Math.max(max, line[i]!);
    }
  }
  return Math.max(1e-6, max - min);
}

function centroid(lines: number[][]): { x: number; y: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const line of lines) {
    for (let i = 0; i < line.length; i += 2) {
      minX = Math.min(minX, line[i]!);
      maxX = Math.max(maxX, line[i]!);
      minY = Math.min(minY, line[i + 1]!);
      maxY = Math.max(maxY, line[i + 1]!);
    }
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

const AREAS: Record<string, number> = {
  court: 436.6,
  field: 5351,
  centralPark: 3.41e6,
  manhattan: 59e6,
  rhodeIsland: 2.678e9,
};

function catalog(): Shape[] {
  const packed = (raw as { outlines: Packed[] }).outlines;
  const geo = packed.map((item) => ({
    id: item.id,
    label: item.label,
    area: AREAS[item.id] ?? item.area ?? 1,
    lines: item.rings.map((ring) => {
      const flat: number[] = [];
      for (const point of ring) flat.push(point[0]!, point[1]!);
      return flat;
    }),
  }));
  return [
    { id: 'court', label: 'Basketball court', area: AREAS.court!, lines: courtLines() },
    { id: 'field', label: 'Football field', area: AREAS.field!, lines: fieldLines() },
    ...geo,
  ];
}

function fmtArea(m2: number): string {
  if (m2 >= 1e6) {
    const km = m2 / 1e6;
    return `${km.toLocaleString('en-US', { maximumFractionDigits: km >= 100 ? 0 : 1 })} km²`;
  }
  return `${m2.toLocaleString('en-US', { maximumFractionDigits: m2 >= 100 ? 0 : 1 })} m²`;
}

function pathData(lines: number[][], scale: number, cx: number, cy: number, ox: number, oy: number): string {
  return lines
    .map((line) => {
      let d = '';
      for (let i = 0; i < line.length; i += 2) {
        const x = ox + (line[i]! - cx) * scale;
        const y = oy - (line[i + 1]! - cy) * scale;
        d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      }
      return d;
    })
    .join(' ');
}

export function mountScaleInset(overlay: HTMLElement): { setArea: (m2: number) => void } {
  const refs = catalog();
  const card = document.createElement('div');
  card.className = 'scale-inset';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  card.append(svg);
  overlay.append(card);

  let shown: Shape | null = null;
  let pending: Shape | null = null;
  let pendingAt = 0;
  let area = 1;
  let fading: { from: Shape; to: Shape; t0: number } | null = null;

  const closest = (m2: number): Shape => {
    let best = refs[0]!;
    let bestD = Infinity;
    const log = Math.log(Math.max(m2, 1e-9));
    for (const ref of refs) {
      const d = Math.abs(log - Math.log(ref.area));
      if (d < bestD) {
        best = ref;
        bestD = d;
      }
    }
    return best;
  };

  const draw = () => {
    const mobile = window.matchMedia('(max-width: 899px)').matches;
    const w = mobile ? 180 : 240;
    const h = mobile ? 130 : 170;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    const now = performance.now();
    const fade = fading ? Math.min(1, (now - fading.t0) / 400) : 1;
    const current = fading?.to ?? shown ?? refs[0]!;
    const previous = fading?.from;
    const r = Math.sqrt(Math.max(area, 1e-9) / Math.PI);
    const refH = heightOf(current.lines);
    const avail = h - 46;
    const scale = (avail * 0.8) / Math.max(r * 2, refH);
    const midY = 16 + avail / 2;
    const leftX = w * 0.27;
    const rightX = w * 0.73;
    const parts: string[] = [];
    parts.push(`<text x="10" y="13" fill="var(--text-dim)" font-size="11" font-family="Inter, system-ui, sans-serif">To scale</text>`);
    parts.push(
      `<circle cx="${leftX}" cy="${midY}" r="${(r * scale).toFixed(2)}" fill="rgba(92,225,255,0.25)" stroke="#5ce1ff" stroke-width="1"/>`,
    );
    const stroke = (shape: Shape, opacity: number, dash: number) => {
      const c = centroid(shape.lines);
      const d = pathData(shape.lines, scale, c.x, c.y, rightX, midY);
      const len = 4000;
      const offset = (1 - dash) * len;
      return `<path d="${d}" fill="none" stroke="var(--text-dim)" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round" opacity="${opacity.toFixed(3)}" stroke-dasharray="${len}" stroke-dashoffset="${offset.toFixed(1)}"/>`;
    };
    if (previous && fade < 1) parts.push(stroke(previous, 1 - fade, 1));
    parts.push(stroke(current, fading ? fade : 1, fading ? fade : 1));
    parts.push(
      `<text x="${leftX}" y="${h - 8}" text-anchor="middle" fill="var(--text)" font-size="11" font-family="Inter, system-ui, sans-serif" textLength="${Math.floor(w * 0.42)}" lengthAdjust="spacingAndGlyphs">This array · ${fmtArea(area)}</text>`,
    );
    parts.push(
      `<text x="${rightX}" y="${h - 8}" text-anchor="middle" fill="var(--text-dim)" font-size="11" font-family="Inter, system-ui, sans-serif" textLength="${Math.floor(w * 0.42)}" lengthAdjust="spacingAndGlyphs">${current.label} · ${fmtArea(current.area)}</text>`,
    );
    svg.innerHTML = parts.join('');
    if (fading && fade < 1) requestAnimationFrame(draw);
    else fading = null;
  };

  const commit = (next: Shape) => {
    if (shown && shown.id !== next.id) fading = { from: shown, to: next, t0: performance.now() };
    shown = next;
    draw();
  };

  return {
    setArea(m2: number) {
      area = m2;
      const next = closest(m2);
      if (!shown) {
        shown = next;
        draw();
        return;
      }
      if (next.id === shown.id && !pending) {
        draw();
        return;
      }
      if (!pending || pending.id !== next.id) {
        pending = next;
        pendingAt = performance.now();
      }
      const wait = () => {
        if (!pending || pending.id !== next.id) return;
        if (performance.now() - pendingAt < 300) {
          window.setTimeout(wait, 40);
          return;
        }
        const chosen = pending;
        pending = null;
        if (chosen.id !== shown?.id) commit(chosen);
        else draw();
      };
      window.setTimeout(wait, 300);
    },
  };
}
