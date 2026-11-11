export interface SpectrumState {
  face: 'A' | 'B';
  zoom: number;
  log: boolean;
}

export type SpectrumAction =
  | { type: 'zoom'; factor: number }
  | { type: 'reset' }
  | { type: 'log'; value: boolean }
  | { type: 'face'; face: 'A' | 'B' };

export function spectrumReducer(state: SpectrumState, action: SpectrumAction): SpectrumState {
  if (action.type === 'zoom') return { ...state, zoom: state.zoom * action.factor };
  if (action.type === 'reset') return { ...state, zoom: 1 };
  if (action.type === 'log') return { ...state, log: action.value };
  return { ...state, face: action.face };
}

export function zoomWords(zoom: number): string {
  const rounded = Math.round(zoom);
  if (rounded < 1_000_000) return `×${rounded.toLocaleString('en-US')}`;
  const millions = rounded / 1_000_000;
  if (millions < 1000) return `×${millions.toLocaleString('en-US')} million`;
  return `×${(millions / 1000).toLocaleString('en-US')} billion`;
}
