import { COATINGS, type CoatingId } from '../../physics/radiator';
import { createButtonRow, createSelect, createSlider, createToggle, type SliderHandle } from '../../ui/controls';
import { fmtTemp } from '../../ui/format';
import { el } from '../../ui/readout';

export interface RadiatorControlState {
  hKm: number;
  phi: number;
  theta: number;
  tilt: number;
  heading: number;
  tempK: number;
  coating: CoatingId;
  showView: boolean;
  drag: boolean;
}

function sideLabel(phi: number): string {
  const dist = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360;
    return Math.min(d, 360 - d);
  };
  if (dist(phi, 0) <= 35) return 'Noon side';
  if (dist(phi, 180) <= 35 || dist(phi, -180) <= 35) return 'Night side';
  return 'Day/night line';
}

export function createRadiatorPanel(opts: {
  state: RadiatorControlState;
  onChange: () => void;
  onOrient: (kind: 'up' | 'earth' | 'sun' | 'edge') => void;
  onScenario: (kind: 'best' | 'night' | 'term' | 'noon' | 'high') => void;
  onFocus: () => void;
  onReset: () => void;
  onSources: () => void;
  onEquations: () => void;
}): { element: HTMLElement; refresh: () => void } {
  const s = opts.state;
  const emit = () => opts.onChange();
  let alt: SliderHandle;
  let phi: SliderHandle;
  let theta: SliderHandle;
  let tilt: SliderHandle;
  let heading: SliderHandle;
  let temp: SliderHandle;

  const where = el('div', 'section');
  where.append(el('div', 'section-title', 'Where is it?'));
  alt = createSlider({
    id: 'alt',
    label: 'Altitude',
    min: 300,
    max: 2000,
    step: 10,
    value: s.hKm,
    format: (v) => `${Math.round(v)} km`,
    onInput: (v) => {
      s.hKm = v;
      emit();
    },
  });
  phi = createSlider({
    id: 'phi',
    label: 'Position around Earth',
    min: -180,
    max: 180,
    step: 1,
    value: s.phi,
    format: (v) => `${sideLabel(v)} · ${Math.round(v)}°`,
    marks: [
      { value: 0, label: 'Noon (under the Sun)' },
      { value: 90, label: 'Dawn/dusk line' },
      { value: -90, label: 'Dawn/dusk line' },
      { value: 180, label: 'Midnight' },
    ],
    onInput: (v) => {
      s.phi = v;
      emit();
    },
  });
  theta = createSlider({
    id: 'theta',
    label: 'Latitude',
    min: -90,
    max: 90,
    step: 1,
    value: s.theta,
    format: (v) => `${Math.round(v)}°`,
    onInput: (v) => {
      s.theta = v;
      emit();
    },
  });
  where.append(alt.element, phi.element, theta.element);

  const point = el('div', 'section');
  point.append(el('div', 'section-title', 'How is it pointed?'));
  tilt = createSlider({
    id: 'tilt',
    label: 'Tilt of face A from straight up',
    min: 0,
    max: 180,
    step: 1,
    value: s.tilt,
    format: (v) => `${Math.round(v)}°`,
    onInput: (v) => {
      s.tilt = v;
      emit();
    },
  });
  heading = createSlider({
    id: 'heading',
    label: 'Heading',
    min: 0,
    max: 360,
    step: 1,
    value: s.heading,
    format: (v) => `${Math.round(v)}°`,
    onInput: (v) => {
      s.heading = v;
      emit();
    },
  });
  point.append(
    tilt.element,
    heading.element,
    createButtonRow(
      [
        { label: 'A → straight up', onClick: () => opts.onOrient('up') },
        { label: 'A → Earth', onClick: () => opts.onOrient('earth') },
        { label: 'A → Sun', onClick: () => opts.onOrient('sun') },
        { label: 'Edge-on to Sun & Earth', onClick: () => opts.onOrient('edge') },
      ],
      'chips',
    ),
  );

  const rad = el('div', 'section');
  rad.append(el('div', 'section-title', 'Radiator'));
  temp = createSlider({
    id: 'temp',
    label: 'Temperature',
    min: 250,
    max: 400,
    step: 1,
    value: s.tempK,
    format: (v) => {
      const t = fmtTemp(v);
      return `${t.main} · ${t.sub}`;
    },
    onInput: (v) => {
      s.tempK = v;
      emit();
    },
  });
  const coat = createSelect({
    id: 'coat',
    label: 'Surface coating',
    value: s.coating,
    options: (Object.keys(COATINGS) as CoatingId[]).map((id) => ({ value: id, label: COATINGS[id].label })),
    onChange: (v) => {
      s.coating = v;
      emit();
    },
  });
  const show = createToggle({
    id: 'show-view',
    label: 'Show what each face sees',
    value: s.showView,
    onChange: (v) => {
      s.showView = v;
      emit();
    },
  });
  const drag = createToggle({
    id: 'drag-sat',
    label: 'Drag satellite on its orbit',
    value: s.drag,
    onChange: (v) => {
      s.drag = v;
      emit();
    },
  });
  rad.append(temp.element, coat.element, show.element, drag.element);

  const scenarios = el('div', 'section');
  scenarios.append(el('div', 'section-title', 'Scenarios'));
  scenarios.append(
    createButtonRow(
      [
        { label: 'Best case (edge-on)', onClick: () => opts.onScenario('best') },
        { label: 'Face A to space (night)', onClick: () => opts.onScenario('night') },
        { label: 'Face A to space (day/night)', onClick: () => opts.onScenario('term') },
        { label: 'Flat at noon', onClick: () => opts.onScenario('noon') },
        { label: '2000 km edge-on', onClick: () => opts.onScenario('high') },
      ],
      'scenarios',
    ),
  );

  const footer = el('div', 'footer-row');
  const sources = el('button', 'btn', 'Assumptions & sources');
  sources.type = 'button';
  sources.addEventListener('click', opts.onSources);
  const eqs = el('button', 'btn', 'Equations');
  eqs.type = 'button';
  eqs.addEventListener('click', opts.onEquations);
  const reset = el('button', 'btn', 'Reset view');
  reset.type = 'button';
  reset.addEventListener('click', opts.onReset);
  const focus = el('button', 'btn', 'Focus panel');
  focus.type = 'button';
  focus.addEventListener('click', opts.onFocus);
  footer.append(sources, eqs, focus, reset);

  const element = el('div');
  element.append(scenarios, where, point, rad, footer);

  return {
    element,
    refresh() {
      alt.setValue(s.hKm, true);
      phi.setValue(s.phi, true);
      theta.setValue(s.theta, true);
      tilt.setValue(s.tilt, true);
      heading.setValue(s.heading, true);
      temp.setValue(s.tempK, true);
      coat.setValue(s.coating, true);
      show.setValue(s.showView, true);
      drag.setValue(s.drag, true);
    },
  };
}
