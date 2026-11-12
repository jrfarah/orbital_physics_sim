import { el } from './readout';

export interface SliderHandle {
  element: HTMLElement;
  setValue: (v: number, silent?: boolean) => void;
  getValue: () => number;
  setDisabled: (on: boolean) => void;
  setRange: (min: number, max: number, value?: number) => void;
  setMarks: (marks: { value: number; label: string }[]) => void;
}

export function createSlider(opts: {
  id: string;
  label: string;
  sublabel?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  scale?: 'linear' | 'log' | 'stops';
  stops?: number[];
  format: (v: number) => string;
  onInput: (v: number) => void;
  marks?: { value: number; label: string }[];
}): SliderHandle {
  let min = opts.min;
  let max = opts.max;
  let value = opts.value;
  const scale = opts.scale ?? 'linear';
  let stops = opts.stops ?? [];
  let marks = opts.marks ?? [];

  const element = el('div', 'field');
  element.id = opts.id;
  const head = el('div', 'field-head');
  head.append(el('div', 'field-label', opts.label));
  const chip = el('div', 'chip');
  head.append(chip);
  element.append(head);
  if (opts.sublabel) element.append(el('div', 'sub', opts.sublabel));
  const slider = el('div', 'slider');
  slider.tabIndex = 0;
  slider.setAttribute('role', 'slider');
  const track = el('div', 'track');
  const fill = el('div', 'fill');
  track.append(fill);
  const thumb = el('div', 'thumb');
  slider.append(track, thumb);
  element.append(slider);
  const markRow = el('div', 'marks');
  element.append(markRow);

  const toT = (v: number): number => {
    if (scale === 'stops' && stops.length > 1) {
      let best = 0;
      let bestD = Infinity;
      stops.forEach((s, i) => {
        const d = Math.abs(s - v);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best / (stops.length - 1);
    }
    if (scale === 'log') {
      const a = Math.log(Math.max(min, 1e-12));
      const b = Math.log(Math.max(max, 1e-12));
      if (b === a) return 0;
      return (Math.log(Math.max(v, 1e-12)) - a) / (b - a);
    }
    if (max === min) return 0;
    return (v - min) / (max - min);
  };
  const fromT = (t: number): number => {
    const c = Math.min(1, Math.max(0, t));
    if (scale === 'stops' && stops.length) {
      const i = Math.round(c * (stops.length - 1));
      return stops[Math.min(stops.length - 1, Math.max(0, i))];
    }
    if (scale === 'log') {
      const a = Math.log(Math.max(min, 1e-12));
      const b = Math.log(Math.max(max, 1e-12));
      return Math.exp(a + (b - a) * c);
    }
    let v = min + (max - min) * c;
    if (opts.step > 0) v = Math.round(v / opts.step) * opts.step;
    return Math.min(max, Math.max(min, v));
  };
  const paint = () => {
    const t = Math.min(1, Math.max(0, toT(value)));
    fill.style.width = `${t * 100}%`;
    thumb.style.left = `${t * 100}%`;
    chip.textContent = opts.format(value);
    slider.setAttribute('aria-valuenow', String(value));
    slider.setAttribute('aria-valuemin', String(min));
    slider.setAttribute('aria-valuemax', String(max));
    slider.setAttribute('aria-label', opts.label);
  };
  const set = (v: number, silent = false) => {
    value = v;
    paint();
    if (!silent) opts.onInput(value);
  };
  const paintMarks = () => {
    markRow.replaceChildren();
    const ticks = marks.filter((mark) => mark.value >= min && mark.value <= max);
    if (!ticks.length) {
      markRow.hidden = true;
      return;
    }
    const width = markRow.clientWidth || 280;
    let lastRight = -1e9;
    let labeled = false;
    for (const tick of ticks) {
      const node = el('div', 'mark-tick');
      const t = toT(tick.value);
      node.style.left = `${t * 100}%`;
      if (tick.label) node.title = tick.label;
      markRow.append(node);
      if (!tick.label || tick.label.length > 12) continue;
      const labelW = tick.label.length * 6.2;
      const left = t * width - labelW / 2;
      if (left < 4 || left + labelW > width - 4 || left < lastRight + 8) continue;
      const text = el('div', 'mark-name', tick.label);
      text.style.left = `${t * 100}%`;
      markRow.append(text);
      lastRight = left + labelW;
      labeled = true;
    }
    markRow.style.height = labeled ? '24px' : '';
    markRow.hidden = false;
  };
  paint();
  paintMarks();

  const fromEvent = (clientX: number) => {
    const rect = slider.getBoundingClientRect();
    set(fromT((clientX - rect.left) / rect.width));
  };
  slider.addEventListener('pointerdown', (event) => {
    slider.setPointerCapture(event.pointerId);
    fromEvent(event.clientX);
  });
  slider.addEventListener('pointermove', (event) => {
    if (!slider.hasPointerCapture(event.pointerId)) return;
    fromEvent(event.clientX);
  });
  slider.addEventListener('keydown', (event) => {
    const dir = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    if (!dir) return;
    event.preventDefault();
    const mult = event.shiftKey ? 10 : 1;
    if (scale === 'stops') {
      let i = 0;
      let best = Infinity;
      stops.forEach((s, idx) => {
        const d = Math.abs(s - value);
        if (d < best) {
          best = d;
          i = idx;
        }
      });
      const next = stops[Math.min(stops.length - 1, Math.max(0, i + dir * (event.shiftKey ? 2 : 1)))];
      set(next);
    } else if (scale === 'log') {
      set(fromT(toT(value) + dir * 0.02 * mult));
    } else {
      set(Math.min(max, Math.max(min, value + dir * (opts.step || 1) * mult)));
    }
  });

  return {
    element,
    getValue: () => value,
    setValue: (v, silent) => set(v, silent),
    setDisabled(on) {
      slider.classList.toggle('disabled', on);
      slider.tabIndex = on ? -1 : 0;
    },
    setRange(nextMin, nextMax, nextValue) {
      min = nextMin;
      max = nextMax;
      value = nextValue ?? Math.min(max, Math.max(min, value));
      paint();
      paintMarks();
    },
    setMarks(next) {
      marks = next;
      paintMarks();
    },
  };
}

export function createRangeSlider(opts: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: [number, number];
  format: (a: number, b: number) => string;
  onInput: (v: [number, number]) => void;
}): { element: HTMLElement; setValue: (v: [number, number], silent?: boolean) => void; setDisabled: (on: boolean) => void } {
  let value: [number, number] = [...opts.value];
  const element = el('div', 'field');
  const head = el('div', 'field-head');
  head.append(el('div', 'field-label', opts.label));
  const chip = el('div', 'chip');
  head.append(chip);
  const slider = el('div', 'slider');
  slider.tabIndex = 0;
  const track = el('div', 'track');
  const fill = el('div', 'fill');
  track.append(fill);
  const a = el('div', 'thumb');
  const b = el('div', 'thumb');
  slider.append(track, a, b);
  element.append(head, slider);
  const snap = (v: number) => {
    const s = Math.round(v / opts.step) * opts.step;
    return Math.min(opts.max, Math.max(opts.min, s));
  };
  const paint = () => {
    const t0 = (value[0] - opts.min) / (opts.max - opts.min);
    const t1 = (value[1] - opts.min) / (opts.max - opts.min);
    a.style.left = `${t0 * 100}%`;
    b.style.left = `${t1 * 100}%`;
    fill.style.left = `${t0 * 100}%`;
    fill.style.width = `${(t1 - t0) * 100}%`;
    chip.textContent = opts.format(value[0], value[1]);
  };
  paint();
  let which: 0 | 1 = 0;
  const pick = (clientX: number) => {
    const rect = slider.getBoundingClientRect();
    const t = (clientX - rect.left) / rect.width;
    const v = snap(opts.min + t * (opts.max - opts.min));
    which = Math.abs(v - value[0]) <= Math.abs(v - value[1]) ? 0 : 1;
    return v;
  };
  const move = (v: number, silent = false) => {
    if (which === 0) value = [Math.min(v, value[1] - opts.step), value[1]];
    else value = [value[0], Math.max(v, value[0] + opts.step)];
    paint();
    if (!silent) opts.onInput(value);
  };
  slider.addEventListener('pointerdown', (event) => {
    slider.setPointerCapture(event.pointerId);
    move(pick(event.clientX));
  });
  slider.addEventListener('pointermove', (event) => {
    if (!slider.hasPointerCapture(event.pointerId)) return;
    const rect = slider.getBoundingClientRect();
    const t = (event.clientX - rect.left) / rect.width;
    move(snap(opts.min + Math.min(1, Math.max(0, t)) * (opts.max - opts.min)));
  });
  return {
    element,
    setValue(v, silent) {
      value = v;
      paint();
      if (!silent) opts.onInput(value);
    },
    setDisabled(on) {
      slider.classList.toggle('disabled', on);
    },
  };
}

export function createSegmented<T extends string>(opts: {
  id: string;
  label?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}): { element: HTMLElement; setValue: (v: T, silent?: boolean) => void; setDisabled: (on: boolean) => void } {
  let value = opts.value;
  const element = el('div', 'field');
  if (opts.label) element.append(el('div', 'field-label', opts.label));
  const row = el('div', 'segmented');
  row.id = opts.id;
  const buttons = opts.options.map((opt) => {
    const button = el('button', '', opt.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      value = opt.value;
      paint();
      opts.onChange(value);
    });
    row.append(button);
    return { opt, button };
  });
  const fit = () => {
    row.style.gridTemplateColumns = `repeat(${buttons.length}, minmax(0, 1fr))`;
    for (const item of buttons) {
      item.button.style.whiteSpace = 'nowrap';
      item.button.style.overflow = 'hidden';
      item.button.style.textOverflow = 'ellipsis';
    }
    const overflows = buttons.some((item) => item.button.scrollWidth > item.button.clientWidth + 1);
    if (!overflows) return;
    row.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
    for (const item of buttons) {
      item.button.style.whiteSpace = 'normal';
      item.button.style.overflow = 'visible';
      item.button.style.textOverflow = 'clip';
    }
  };
  if (typeof ResizeObserver === 'function') {
    try {
      const observer = new ResizeObserver(() => requestAnimationFrame(fit));
      observer.observe(row);
    } catch {
      requestAnimationFrame(fit);
    }
  } else {
    requestAnimationFrame(fit);
  }
  requestAnimationFrame(fit);
  const paint = () => {
    for (const item of buttons) item.button.setAttribute('aria-pressed', String(item.opt.value === value));
  };
  paint();
  element.append(row);
  return {
    element,
    setValue(v, silent) {
      value = v;
      paint();
      if (!silent) opts.onChange(v);
    },
    setDisabled(on) {
      for (const item of buttons) item.button.disabled = on;
    },
  };
}

export function createToggle(opts: {
  id: string;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}): { element: HTMLElement; setValue: (v: boolean, silent?: boolean) => void } {
  let value = opts.value;
  const button = el('button', 'switch');
  button.id = opts.id;
  button.type = 'button';
  button.setAttribute('role', 'switch');
  const label = el('span', 'switch-label', opts.label);
  const track = el('span', 'switch-ui');
  track.append(el('span', 'switch-thumb'));
  button.append(label, track);
  const paint = () => {
    button.setAttribute('aria-checked', String(value));
    button.classList.toggle('on', value);
  };
  paint();
  button.addEventListener('click', () => {
    value = !value;
    paint();
    opts.onChange(value);
  });
  return {
    element: button,
    setValue(v, silent) {
      value = v;
      paint();
      if (!silent) opts.onChange(v);
    },
  };
}

export function createSelect<T extends string>(opts: {
  id: string;
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}): { element: HTMLElement; setValue: (v: T, silent?: boolean) => void } {
  const element = el('div', 'field');
  element.append(el('div', 'field-label', opts.label));
  const select = el('select', 'select');
  select.id = opts.id;
  for (const opt of opts.options) {
    const node = el('option', '', opt.label);
    node.value = opt.value;
    select.append(node);
  }
  select.value = opts.value;
  select.addEventListener('change', () => opts.onChange(select.value as T));
  element.append(select);
  return {
    element,
    setValue(v, silent) {
      select.value = v;
      if (!silent) opts.onChange(v);
    },
  };
}

export function createButtonRow(
  buttons: { label: string; onClick: () => void; variant?: string }[],
  layout: 'stack' | 'chips' | 'scenarios' = 'stack',
): HTMLElement {
  const row = el('div', layout === 'stack' ? 'btn-row' : 'chip-grid');
  for (const spec of buttons) {
    const button = el('button', spec.variant === 'accent' ? 'btn accent' : 'btn', spec.label);
    button.type = 'button';
    if (layout === 'scenarios') button.dataset.scenario = spec.label;
    button.addEventListener('click', spec.onClick);
    row.append(button);
  }
  return row;
}

export function createMoreDetail(id: string, children: HTMLElement[]): HTMLElement {
  const key = `more-detail:${id}`;
  let open = false;
  try {
    open = sessionStorage.getItem(key) === '1';
  } catch {
    open = false;
  }
  const wrap = el('div', 'collapsible more span-2');
  const button = el('button', '', open ? 'More detail ▾' : 'More detail ▸');
  button.type = 'button';
  const body = el('div');
  body.hidden = !open;
  body.append(...children);
  button.addEventListener('click', () => {
    body.hidden = !body.hidden;
    button.textContent = body.hidden ? 'More detail ▸' : 'More detail ▾';
    try {
      sessionStorage.setItem(key, body.hidden ? '0' : '1');
    } catch {
      /* private mode */
    }
  });
  wrap.append(button, body);
  return wrap;
}

export function createCollapsible(title: string, children: HTMLElement[], open = false): HTMLElement {
  const wrap = el('div', 'collapsible');
  const button = el('button', '', `${open ? '▾' : '▸'} ${title}`);
  button.type = 'button';
  const body = el('div');
  body.hidden = !open;
  body.append(...children);
  button.addEventListener('click', () => {
    body.hidden = !body.hidden;
    button.textContent = `${body.hidden ? '▸' : '▾'} ${title}`;
  });
  wrap.append(button, body);
  return wrap;
}
