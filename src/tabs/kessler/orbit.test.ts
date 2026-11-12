import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { orbitPosition } from './orbit';

describe('orbitPosition', () => {
  it('keeps a 53° orbit within sin(53°) of the equator', () => {
    const i = (53 * Math.PI) / 180;
    const out = new Vector3();
    let max = 0;
    for (let u = 0; u < Math.PI * 2; u += 0.002) {
      orbitPosition(1, i, 0.4, u, out);
      max = Math.max(max, Math.abs(out.y));
    }
    expect(Math.abs(max - Math.sin(i))).toBeLessThanOrEqual(1e-6);
  });

  it('tilts the orbit normal by the inclination', () => {
    const i = (53 * Math.PI) / 180;
    const a = new Vector3();
    const b = new Vector3();
    orbitPosition(1, i, 0.7, 0, a);
    orbitPosition(1, i, 0.7, 1.1, b);
    const normal = new Vector3().crossVectors(a, b).normalize();
    const angle = Math.acos(Math.min(1, Math.abs(normal.dot(new Vector3(0, 1, 0)))));
    expect(Math.abs(angle - i)).toBeLessThanOrEqual(1e-6);
  });

  it('never reaches above 82.4° on a 97.6° orbit', () => {
    const i = (97.6 * Math.PI) / 180;
    const cap = (82.4 * Math.PI) / 180;
    const out = new Vector3();
    let maxLat = 0;
    for (let u = 0; u < Math.PI * 2; u += 0.002) {
      orbitPosition(1, i, 1.3, u, out);
      maxLat = Math.max(maxLat, Math.asin(Math.min(1, Math.abs(out.y))));
    }
    expect(maxLat).toBeLessThanOrEqual(cap + 1e-6);
    expect(maxLat).toBeGreaterThan(cap - 1e-3);
  });
});
