import { describe, expect, it } from 'vitest';
import fixtures from '../../../reference/fixtures.json';
import {
  SIGMA_SCREEN,
  activeSatelliteTerm,
  debrisLifetimeYr,
  kessler,
  type KesslerInput,
} from '../kessler';
import { expectClose } from './close';

const numericKeys = [
  'N',
  'A_sat',
  'm_sat',
  'span_m',
  'launches_per_yr',
  'cam_per_month',
  'cam_ratio_vs_starlink',
  'kills_per_yr',
  'derelicts',
  'collisions_per_yr',
  'fragments_per_yr',
  'small_fragments_per_yr',
  'worst_rate_per_sat_per_yr',
  'R0_max',
  'cost_per_sat',
  'planned_replacement_usd_per_yr',
  'unplanned_loss_usd_per_yr',
  'rtt_ms_max',
] as const;

const cases: Record<string, KesslerInput> = {
  starlink_today: { fleetOverride: { N: 9000, A: 116, m: 800 }, preset: 'starlink', pSat: 1 },
  '1GW_spacex': { rateWPerYr: 1e9 },
  '500GW_spacex': { rateWPerYr: 500e9 },
  '1TW_spacex': { rateWPerYr: 1e12 },
  '1GW_low': { rateWPerYr: 1e9, preset: 'low' },
  '1GW_low_bestcase': { rateWPerYr: 1e9, preset: 'low', s: 0.9999, fDisp: 0.001, coord: 0.01, fVuln: 0.05 },
  '1TW_low_bestcase': { rateWPerYr: 1e12, preset: 'low', s: 0.9999, fDisp: 0.001, coord: 0.01, fVuln: 0.05 },
  '1TW_spacex_5MWsats': { rateWPerYr: 1e12, pSat: 5e6 },
};

describe('kessler', () => {
  it('sigma screen and debris lifetimes', () => {
    expectClose(SIGMA_SCREEN, fixtures.sigma_screen_km2);
    const tau = fixtures.tau_yr as Record<string, number>;
    for (const [h, expected] of Object.entries(tau)) {
      expectClose(debrisLifetimeYr(Number(h)), expected);
    }
  });

  for (const [name, input] of Object.entries(cases)) {
    it(name, () => {
      const expected = fixtures.kessler[name as keyof typeof fixtures.kessler];
      const got = kessler(input);
      for (const key of numericKeys) expectClose(got[key], expected[key] as number);
      expect(got.linear_regime_ok).toBe(expected.linear_regime_ok);
      const shells = expected.R0_by_shell as Record<string, number>;
      expect(Object.keys(got.R0_by_shell).sort()).toEqual(Object.keys(shells).sort());
      for (const [h, value] of Object.entries(shells)) expectClose(got.R0_by_shell[h], value);
    });
  }

  it('Starlink today is the calibration anchor', () => {
    const got = kessler({ fleetOverride: { N: 9000, A: 116, m: 800 }, preset: 'starlink', pSat: 1 });
    expect(Math.abs(got.cam_per_month - 34525.3) / 34525.3).toBeLessThanOrEqual(0.001);
    for (const r0 of Object.values(got.R0_by_shell)) expect(r0).toBeLessThan(0.1);
  });

  it('active-satellite term depends on area, not satellite count', () => {
    const a = activeSatelliteTerm(1e9, 5, 30e3, 'spacex', 0.99);
    const b = activeSatelliteTerm(1e9, 5, 5e6, 'spacex', 0.99);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expectClose(a[i], b[i]);
  });
});
