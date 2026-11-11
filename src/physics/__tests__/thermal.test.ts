import { describe, expect, it } from 'vitest';
import fixtures from '../../../reference/fixtures.json';
import { thermalBudget } from '../thermal';
import { expectClose } from './close';

const keys = ['T_cold', 'T_hot', 'W', 'Q_reject', 'q_net', 'A_rad', 'A_sol', 'A_tot'] as const;

describe('thermal budget', () => {
  it('no_pump', () => {
    const got = thermalBudget();
    const expected = fixtures.thermal.no_pump;
    for (const k of keys) expectClose(got[k], expected[k]);
  });

  it('pump_400K_eta0.5', () => {
    const got = thermalBudget({ pump: true, T_hot: 400 });
    const expected = fixtures.thermal['pump_400K_eta0.5'];
    for (const k of keys) expectClose(got[k], expected[k]);
  });

  it('pump_500K_eta0.5', () => {
    const got = thermalBudget({ pump: true, T_hot: 500 });
    const expected = fixtures.thermal['pump_500K_eta0.5'];
    for (const k of keys) expectClose(got[k], expected[k]);
  });

  it('pump_400K_eta1.0', () => {
    const got = thermalBudget({ pump: true, T_hot: 400, carnot_frac: 1 });
    const expected = fixtures.thermal['pump_400K_eta1.0'];
    for (const k of keys) expectClose(got[k], expected[k]);
  });

  it('heat pump increases total area at every hotter radiator temperature', () => {
    const base = thermalBudget();
    for (const carnot of [0.5, 1]) {
      for (const tHot of [350, 400, 450, 500]) {
        const got = thermalBudget({ pump: true, T_hot: tHot, carnot_frac: carnot });
        expect(got.A_tot).toBeGreaterThan(base.A_tot);
      }
    }
  });
});
