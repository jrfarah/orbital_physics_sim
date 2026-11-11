import { el } from './readout';

export interface Sheet {
  element: HTMLElement;
  body: HTMLElement;
  setSummary: (text: string) => void;
}

export function createSheet(): Sheet {
  const element = document.getElementById('sheet') as HTMLElement;
  element.className = 'sheet';
  element.hidden = false;
  const handle = el('div', 'sheet-handle');
  const grabber = el('div', 'grabber');
  const title = el('div', 'field-label', 'Controls');
  const summary = el('div', 'sub');
  handle.append(grabber, title, summary);
  const body = el('div', 'sheet-body');
  element.append(handle, body);

  const snaps = () => {
    const full = Math.min(window.innerHeight * 0.86, window.innerHeight - 56);
    const half = Math.min(window.innerHeight * 0.46, full);
    return [64, half, full];
  };
  let snap = 0;
  const apply = (h: number) => {
    element.style.height = `${h}px`;
    body.hidden = h <= 70;
  };
  apply(64);

  let startY = 0;
  let startH = 64;
  let moved = false;
  handle.addEventListener('pointerdown', (event) => {
    handle.setPointerCapture(event.pointerId);
    startY = event.clientY;
    startH = element.getBoundingClientRect().height;
    moved = false;
  });
  handle.addEventListener('pointermove', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    const dy = startY - event.clientY;
    if (Math.abs(dy) > 4) moved = true;
    const next = Math.min(snaps()[2], Math.max(64, startH + dy));
    apply(next);
  });
  handle.addEventListener('pointerup', () => {
    if (!moved) {
      snap = snap === 0 ? 1 : 0;
      apply(snaps()[snap]);
      return;
    }
    const h = element.getBoundingClientRect().height;
    const points = snaps();
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(p - h) < Math.abs(points[best] - h)) best = i;
    });
    snap = best;
    apply(points[best]);
  });
  return {
    element,
    body,
    setSummary(text) {
      summary.textContent = text;
    },
  };
}
