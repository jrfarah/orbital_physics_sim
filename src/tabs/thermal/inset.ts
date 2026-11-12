import raw from '../../assets/outlines.json';

interface Packed {
  id: string;
  label: string;
  area?: number;
  rings: number[][][];
  faint?: number[][][];
  approx: boolean;
}

interface Shape {
  id: string;
  label: string;
  area: number;
  lines: number[][];
  faint: number[][];
  box: { w: number; h: number; cx: number; cy: number };
  dLines: string;
  dFaint: string;
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

function flatten(rings: number[][][]): number[][] {
  return rings.map((ring) => {
    const flat: number[] = [];
    for (const point of ring) flat.push(point[0]!, point[1]!);
    return flat;
  });
}

function bounds(lines: number[][]): { w: number; h: number; cx: number; cy: number } {
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
  return {
    w: Math.max(1e-6, maxX - minX),
    h: Math.max(1e-6, maxY - minY),
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function pentagon(): Shape {
  const side = 280.7;
  const radius = side / (2 * Math.sin(Math.PI / 5));
  const ring = (scale: number) => {
    const pts: number[] = [];
    for (let i = 0; i <= 5; i++) {
      const a = Math.PI / 2 + (i % 5) * ((2 * Math.PI) / 5);
      pts.push(Math.cos(a) * radius * scale, Math.sin(a) * radius * scale);
    }
    return pts;
  };
  const outer = ring(1);
  let area = 0;
  for (let i = 0; i < 5; i++) {
    const x = outer[i * 2]!;
    const y = outer[i * 2 + 1]!;
    const nx = outer[((i + 1) % 5) * 2]!;
    const ny = outer[((i + 1) % 5) * 2 + 1]!;
    area += x * ny - nx * y;
  }
  return {
    id: 'pentagon',
    label: 'The Pentagon',
    area: Math.abs(area) / 2,
    lines: [outer],
    faint: [ring(0.37)],
    box: { w: 0, h: 0, cx: 0, cy: 0 },
    dLines: '',
    dFaint: '',
  };
}

function catalog(): Shape[] {
  const packed = (raw as { outlines: Packed[] }).outlines;
  const geo = packed.map((item) => ({
    id: item.id,
    label: item.label,
    area: item.area ?? 1,
    lines: flatten(item.rings),
    faint: flatten(item.faint ?? []),
  }));
  return [
    { id: 'court', label: 'Basketball court', area: 436.6, lines: courtLines(), faint: [] },
    { id: 'field', label: 'Football field', area: 5351, lines: fieldLines(), faint: [] },
    pentagon(),
    ...geo,
  ].map(prepare);
}

function localPath(lines: number[][], cx: number, cy: number): string {
  return lines
    .map((line) => {
      let d = '';
      for (let i = 0; i < line.length; i += 2) {
        const x = line[i]! - cx;
        const y = -(line[i + 1]! - cy);
        d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      }
      return d;
    })
    .join(' ');
}

function prepare(shape: {
  id: string;
  label: string;
  area: number;
  lines: number[][];
  faint: number[][];
}): Shape {
  const box = bounds([...shape.lines, ...shape.faint]);
  return {
    ...shape,
    box,
    dLines: localPath(shape.lines, box.cx, box.cy),
    dFaint: localPath(shape.faint, box.cx, box.cy),
  };
}

function fmtArea(m2: number): string {
  if (m2 >= 1e6) {
    const km = m2 / 1e6;
    return `${km.toLocaleString('en-US', { maximumFractionDigits: km >= 100 ? 0 : 1 })} km²`;
  }
  return `${m2.toLocaleString('en-US', { maximumFractionDigits: m2 >= 100 ? 0 : 1 })} m²`;
}

const NS = 'http://www.w3.org/2000/svg';

function svgEl<T extends SVGElement>(name: string): T {
  return document.createElementNS(NS, name) as T;
}

function stylePath(path: SVGPathElement, color: string, width: number): void {
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', String(width));
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
}

export function mountScaleInset(overlay: HTMLElement): { setArea: (m2: number) => void } {
  const refs = catalog();
  const card = document.createElement('div');
  card.className = 'scale-inset';
  const svg = svgEl<SVGSVGElement>('svg');
  svg.setAttribute('aria-hidden', 'true');
  const clip = svgEl<SVGClipPathElement>('clipPath');
  clip.id = 'inset-clip';
  const clipRect = svgEl<SVGRectElement>('rect');
  clipRect.setAttribute('x', '0');
  clipRect.setAttribute('y', '0');
  clip.append(clipRect);
  const defs = svgEl<SVGDefsElement>('defs');
  defs.append(clip);
  const title = svgEl<SVGTextElement>('text');
  title.setAttribute('x', '10');
  title.setAttribute('y', '13');
  title.setAttribute('fill', 'var(--text-dim)');
  title.setAttribute('font-size', '11');
  title.setAttribute('font-family', 'Inter, system-ui, sans-serif');
  title.textContent = 'To scale';
  const group = svgEl<SVGGElement>('g');
  group.setAttribute('clip-path', 'url(#inset-clip)');
  const circle = svgEl<SVGCircleElement>('circle');
  circle.setAttribute('fill', 'rgba(92,225,255,0.25)');
  circle.setAttribute('stroke', '#5ce1ff');
  circle.setAttribute('stroke-width', '1');
  const fromG = svgEl<SVGGElement>('g');
  const toG = svgEl<SVGGElement>('g');
  const fromFaint = svgEl<SVGPathElement>('path');
  const fromMain = svgEl<SVGPathElement>('path');
  const toFaint = svgEl<SVGPathElement>('path');
  const toMain = svgEl<SVGPathElement>('path');
  stylePath(fromFaint, 'var(--text-dim)', 1);
  stylePath(fromMain, 'var(--text)', 1.25);
  stylePath(toFaint, 'var(--text-dim)', 1);
  stylePath(toMain, 'var(--text)', 1.25);
  fromG.append(fromFaint, fromMain);
  toG.append(toFaint, toMain);
  group.append(circle, fromG, toG);
  const arrayLabel = svgEl<SVGTextElement>('text');
  const refLabel = svgEl<SVGTextElement>('text');
  for (const label of [arrayLabel, refLabel]) {
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '10');
    label.setAttribute('font-family', 'Inter, system-ui, sans-serif');
    label.setAttribute('lengthAdjust', 'spacingAndGlyphs');
  }
  arrayLabel.setAttribute('fill', 'var(--text)');
  refLabel.setAttribute('fill', 'var(--text-dim)');
  svg.append(defs, title, group, arrayLabel, refLabel);
  card.append(svg);
  overlay.append(card);

  const lengths = new Map<string, number>();
  let shown: Shape | null = null;
  let pending: Shape | null = null;
  let pendingAt = 0;
  let area = 1;
  let fading: { from: Shape; to: Shape; t0: number } | null = null;
  let raf = 0;
  let lastScale = -1;
  let lastId = '';
  let lastFade = false;
  let lastMobile: boolean | null = null;
  let lastArrayText = '';
  let lastRefText = '';

  const closest = (m2: number): Shape => {
    if (m2 >= 1e6 && m2 <= 10e6) {
      const park = refs.find((ref) => ref.id === 'centralPark');
      if (park) return park;
    }
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

  const paintPath = (path: SVGPathElement, d: string, opacity: number, reveal: number, key: string) => {
    if (!d) {
      path.setAttribute('display', 'none');
      return;
    }
    path.setAttribute('display', '');
    if (path.getAttribute('d') !== d) path.setAttribute('d', d);
    path.setAttribute('opacity', (opacity).toFixed(3));
    let len = lengths.get(key);
    if (len === undefined) {
      len = path.getTotalLength() || 1;
      lengths.set(key, len);
    }
    path.setAttribute('stroke-dasharray', String(len));
    path.setAttribute('stroke-dashoffset', ((1 - reveal) * len).toFixed(1));
  };

  const draw = () => {
    const mobile = window.matchMedia('(max-width: 899px)').matches;
    const w = mobile ? 180 : 240;
    const h = mobile ? 130 : 170;
    const sizeChanged = mobile !== lastMobile;
    if (sizeChanged) {
      lastMobile = mobile;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      clipRect.setAttribute('width', String(w));
      clipRect.setAttribute('height', String(h));
      const labelW = Math.floor(w * 0.46);
      arrayLabel.setAttribute('x', (w * 0.26).toFixed(1));
      refLabel.setAttribute('x', (w * 0.74).toFixed(1));
      arrayLabel.setAttribute('y', String(h - 6));
      refLabel.setAttribute('y', String(h - 6));
      arrayLabel.setAttribute('textLength', String(labelW));
      refLabel.setAttribute('textLength', String(labelW));
    }
    const now = performance.now();
    const fade = fading ? Math.min(1, (now - fading.t0) / 400) : 1;
    const current = fading?.to ?? shown ?? refs[0]!;
    const previous = fading && fade < 1 ? fading.from : null;
    const r = Math.sqrt(Math.max(area, 1e-9) / Math.PI);
    const arrayBox = { w: r * 2, h: r * 2 };
    const refBox = current.box;
    const pad = 8;
    const content = { x: pad, y: 18, w: w - pad * 2, h: h - 18 - 16 };
    const gap = 8;
    const side = Math.min((content.w - gap) / (arrayBox.w + refBox.w), content.h / Math.max(arrayBox.h, refBox.h));
    const stacked = Math.min(content.w / Math.max(arrayBox.w, refBox.w), (content.h - gap) / (arrayBox.h + refBox.h));
    const scale = Math.max(side, stacked);
    const row = side >= stacked;
    const aw = arrayBox.w * scale;
    const ah = arrayBox.h * scale;
    const rw = refBox.w * scale;
    const rh = refBox.h * scale;
    const totalW = row ? aw + gap + rw : Math.max(aw, rw);
    const totalH = row ? Math.max(ah, rh) : ah + gap + rh;
    const x0 = content.x + (content.w - totalW) / 2;
    const y0 = content.y + (content.h - totalH) / 2;
    const arrayAt = row
      ? { x: x0 + aw / 2, y: y0 + totalH / 2 }
      : { x: x0 + totalW / 2, y: y0 + ah / 2 };
    const refAt = row
      ? { x: x0 + aw + gap + rw / 2, y: y0 + totalH / 2 }
      : { x: x0 + totalW / 2, y: y0 + ah + gap + rh / 2 };
    const arrayText = `This array · ${fmtArea(area)}`;
    const refText = `${current.label} · ${fmtArea(current.area)}`;
    if (arrayText !== lastArrayText) {
      arrayLabel.textContent = arrayText;
      lastArrayText = arrayText;
    }
    if (refText !== lastRefText) {
      refLabel.textContent = refText;
      lastRefText = refText;
    }
    card.dataset.insetLabel = refText;
    const fadingNow = previous !== null;
    const scaleClose = lastScale > 0 && Math.abs(scale - lastScale) / lastScale < 0.005;
    if (current.id === lastId && scaleClose && !fadingNow && !lastFade && !sizeChanged) {
      if (fading && fade < 1) requestAnimationFrame(draw);
      else fading = null;
      return;
    }
    lastScale = scale;
    lastId = current.id;
    lastFade = fadingNow;
    circle.setAttribute('cx', arrayAt.x.toFixed(2));
    circle.setAttribute('cy', arrayAt.y.toFixed(2));
    circle.setAttribute('r', (r * scale).toFixed(2));
    const transform = `translate(${refAt.x.toFixed(2)} ${refAt.y.toFixed(2)}) scale(${scale.toFixed(6)})`;
    toG.setAttribute('transform', transform);
    const reveal = fading ? fade : 1;
    const show = fading ? fade : 1;
    paintPath(toFaint, current.dFaint, show * 0.4, reveal, `${current.id}:faint`);
    paintPath(toMain, current.dLines, show, reveal, `${current.id}:lines`);
    if (previous) {
      fromG.setAttribute('display', '');
      fromG.setAttribute('transform', transform);
      paintPath(fromFaint, previous.dFaint, (1 - fade) * 0.4, 1, `${previous.id}:faint`);
      paintPath(fromMain, previous.dLines, 1 - fade, 1, `${previous.id}:lines`);
    } else {
      fromG.setAttribute('display', 'none');
    }
    if (fading && fade < 1) requestAnimationFrame(draw);
    else fading = null;
  };

  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  };

  const commit = (next: Shape) => {
    if (shown && shown.id !== next.id) fading = { from: shown, to: next, t0: performance.now() };
    shown = next;
    schedule();
  };

  return {
    setArea(m2: number) {
      area = m2;
      const next = closest(m2);
      if (!shown) {
        shown = next;
        schedule();
        return;
      }
      if (next.id === shown.id && !pending) {
        schedule();
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
        else schedule();
      };
      window.setTimeout(wait, 300);
    },
  };
}
