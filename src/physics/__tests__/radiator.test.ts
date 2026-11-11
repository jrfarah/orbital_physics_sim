import { describe, it } from 'vitest';
import fixtures from '../../../reference/fixtures.json';
import { radiator, type FaceFlux } from '../radiator';
import type { Vec3 } from '../vec';
import { expectClose } from './close';

const scenarios: Record<string, { h: number; r: Vec3; n: Vec3; alpha?: number; eps?: number }> = {
  dawn_dusk_edge_on_500: { h: 500, r: [0, 1, 0], n: [0, 0, 1] },
  noon_flat_500: { h: 500, r: [1, 0, 0], n: [1, 0, 0] },
  terminator_faceA_zenith_500: { h: 500, r: [0, 1, 0], n: [0, 1, 0] },
  noon_edge_on_500: { h: 500, r: [1, 0, 0], n: [0, 1, 0] },
  dawn_dusk_edge_on_2000: { h: 2000, r: [0, 1, 0], n: [0, 0, 1] },
  dawn_dusk_edge_on_500_whitepaint: { h: 500, r: [0, 1, 0], n: [0, 0, 1], alpha: 0.2, eps: 0.9 },
};

const faceKeys = ['F', 'q_sun', 'q_alb', 'q_ir', 'q_abs', 'T_sink', 'q_net'] as const;

describe('radiator', () => {
  for (const [name, spec] of Object.entries(scenarios)) {
    it(name, () => {
      const expected = fixtures.radiator[name as keyof typeof fixtures.radiator];
      const got = radiator(spec.h, spec.r, spec.n, spec.alpha ?? 1, spec.eps ?? 1);
      for (const face of ['A', 'B'] as const) {
        const e = expected[face] as FaceFlux;
        const g = got[face];
        for (const key of faceKeys) expectClose(g[key], e[key]);
      }
      expectClose(got.total_net, expected.total_net);
      expectClose(got.ideal, expected.ideal);
    });
  }
});
