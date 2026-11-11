import { describe, expect, it } from 'vitest';
import fixtures from '../../../reference/fixtures.json';
import { viewFactorPlateToEarth } from '../radiator';
import { expectClose } from './close';

describe('view factor', () => {
  it('matches every fixture', () => {
    const table = fixtures.view_factor as Record<string, number>;
    expect(Object.keys(table).length).toBeGreaterThan(0);
    for (const [key, expected] of Object.entries(table)) {
      const match = key.match(/^(\d+)km_(\d+)deg$/);
      expect(match, key).toBeTruthy();
      const h = Number(match![1]);
      const deg = Number(match![2]);
      expectClose(viewFactorPlateToEarth(h, (deg * Math.PI) / 180), expected);
    }
  });
});
