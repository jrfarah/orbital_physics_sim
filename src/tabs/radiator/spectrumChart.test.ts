import { describe, expect, it } from 'vitest';
import {
  anglesFromNormal,
  edgeOnNormal,
  faceNormalFromAngles,
  positionHat,
  radiator,
  type FaceFlux,
} from '../../physics/radiator';
import { incomingSeries, skyCallout } from './spectrumSeries';

const DEG = Math.PI / 180;

function pose(kind: 'noon' | 'best' | 'night') {
  const phi = kind === 'noon' ? 0 : kind === 'night' ? 180 : 90;
  const r = positionHat(0, phi * DEG);
  if (kind !== 'best') return radiator(500, r, faceNormalFromAngles(r, 0, 0), 1, 1, 320);
  const ang = anglesFromNormal(r, edgeOnNormal(r), 0);
  return radiator(500, r, faceNormalFromAngles(r, ang.tilt, ang.heading), 1, 1, 320);
}

function expected(face: FaceFlux): string[] {
  return [
    face.q_sun !== 0 ? 'sun' : '',
    face.q_alb !== 0 ? 'reflected' : '',
    face.q_ir !== 0 ? 'earth' : '',
    face.q_cmb !== 0 ? 'cmb' : '',
  ].filter((key) => key !== '');
}

describe('incoming spectrum on a face', () => {
  for (const kind of ['noon', 'best', 'night'] as const) {
    it(`${kind}: each face draws exactly its nonzero incoming light`, () => {
      const result = pose(kind);
      for (const which of ['A', 'B'] as const) {
        const face = result[which];
        const drawn = incomingSeries(face);
        expect(drawn.map((series) => series.key)).toEqual(expected(face));
        expect(drawn.some((series) => series.label.startsWith('Emission'))).toBe(false);
        for (const series of drawn) expect(series.label).toMatch(/ · .+ W\/m²$/);
      }
      const faceA = incomingSeries(result.A).map((series) => series.key);
      const faceB = incomingSeries(result.B).map((series) => series.key);
      expect(faceA).not.toEqual(faceB);
    });
  }

  it('asks for the zoom that reveals the 3 K sky from the incoming peaks only', () => {
    expect(skyCallout(100, 0.001, 1, false)).toBe('×2,000 to see the 3 K sky');
    expect(skyCallout(100, 0.001, 2000, false)).toBe('3 K sky visible at ×2,000');
    expect(skyCallout(100, 0, 1, false)).toBeNull();
    expect(skyCallout(0, 0.001, 1, false)).toBeNull();
    expect(skyCallout(100, 0.001, 1, true)).toBeNull();
  });
});
