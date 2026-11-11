import { REFERENCE_AREAS } from '../../physics/references';
import { reducedMotion } from '../../engine/renderer';
import { fmtArea, fmtSig } from '../../ui/format';
import { el } from '../../ui/readout';

const NS = 'http://www.w3.org/2000/svg';

export function createScalePanel(): {
  element: HTMLElement;
  set: (area: number, label: string, yearly: boolean) => void;
} {
  const element = el('div');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 640 460');
  svg.id = 'scale-svg';
  const caption = el('div', 'sub');
  const multiple = el('div', 'num-lg');
  const too = el('div', 'too-small faint');
  element.append(svg, multiple, caption, too);
  let px = 0;
  let anim: { from: number; to: number; t0: number; dur: number; area: number; label: string; yearly: boolean } | null = null;

  function draw(area: number, scale: number, label: string, yearly: boolean): void {
    svg.replaceChildren();
    const originX = 36;
    const originY = 420;
    const main = Math.sqrt(area) * scale;
    rect(originX, originY - main, main, main, '#5ce1ff', 0.18, false);
    const hidden: string[] = [];
    for (const ref of REFERENCE_AREAS) {
      const side = Math.sqrt(ref.m2) * scale;
      if (side < 3) {
        hidden.push(ref.label);
        continue;
      }
      rect(originX, originY - side, side, side, '#9aa9bb', 0, true);
      if (side >= 28 && side < 560) {
        text(originX + 6, originY - side + 16, ref.label, '#9aa9bb');
      }
    }
    if (main >= 28) text(originX + 8, originY - main + 22, fmtArea(area), '#5ce1ff');
    too.textContent = hidden.length ? `too small to see: ${hidden.join(', ')}` : '';
    let best = REFERENCE_AREAS[0];
    let bestD = Infinity;
    for (const ref of REFERENCE_AREAS) {
      const d = Math.abs(Math.log(area) - Math.log(ref.m2));
      if (d < bestD) {
        bestD = d;
        best = ref;
      }
    }
    const k = area / best.m2;
    multiple.textContent = `≈ ${fmtSig(k, 2)}× ${best.label}`;
    caption.textContent = yearly
      ? `${label}: ${fmtArea(area)} of panels and radiators, deployed every year`
      : `${label}: ${fmtArea(area)} of panels and radiators`;
  }

  function go(area: number, label: string, yearly: boolean): void {
    const targetPx = 280 / Math.sqrt(Math.max(area, 1e-6));
    if (px <= 0 || reducedMotion()) {
      px = targetPx;
      draw(area, px, label, yearly);
      return;
    }
    const jump = Math.max(targetPx / px, px / targetPx) > 1.5;
    const dur = jump ? 1200 : 250;
    anim = { from: Math.max(px, 1e-12), to: targetPx, t0: performance.now(), dur, area, label, yearly };
    const step = (now: number) => {
      if (!anim) return;
      const t = Math.min(1, (now - anim.t0) / anim.dur);
      const e = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
      px = Math.exp(Math.log(anim.from) + (Math.log(anim.to) - Math.log(anim.from)) * e);
      draw(anim.area, px, anim.label, anim.yearly);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  return { element, set: go };

  function rect(x: number, y: number, w: number, h: number, color: string, fill: number, dashed: boolean): void {
    const node = document.createElementNS(NS, 'rect');
    node.setAttribute('x', String(x));
    node.setAttribute('y', String(y));
    node.setAttribute('width', String(Math.max(0, w)));
    node.setAttribute('height', String(Math.max(0, h)));
    node.setAttribute('fill', fill ? color : 'none');
    node.setAttribute('fill-opacity', String(fill));
    node.setAttribute('stroke', color);
    node.setAttribute('stroke-width', dashed ? '1.2' : '2');
    if (dashed) node.setAttribute('stroke-dasharray', '5 4');
    svg.append(node);
  }
  function text(x: number, y: number, value: string, color: string): void {
    const node = document.createElementNS(NS, 'text');
    node.setAttribute('x', String(x));
    node.setAttribute('y', String(y));
    node.setAttribute('fill', color);
    node.setAttribute('font-size', '13');
    node.setAttribute('font-family', 'JetBrains Mono, monospace');
    node.textContent = value;
    svg.append(node);
  }
}
