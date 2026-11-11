import { describe, expect, it } from 'vitest';
import { spectrumReducer, type SpectrumState } from './spectrumStore';

const start: SpectrumState = { face: 'A', zoom: 1, log: false };

describe('spectrum chart store', () => {
  it('zooms by decades, keeps zoom across the axis mode, and resets', () => {
    let state = start;
    state = spectrumReducer(state, { type: 'zoom', factor: 10 });
    state = spectrumReducer(state, { type: 'zoom', factor: 10 });
    state = spectrumReducer(state, { type: 'zoom', factor: 10 });
    expect(state.zoom).toBe(1000);
    state = spectrumReducer(state, { type: 'log', value: true });
    state = spectrumReducer(state, { type: 'log', value: false });
    expect(state.log).toBe(false);
    expect(state.zoom).toBe(1000);
    state = spectrumReducer(state, { type: 'reset' });
    expect(state.zoom).toBe(1);
  });
});
