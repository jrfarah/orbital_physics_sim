import { describe, expect, it } from 'vitest';
import fixtures from '../../../reference/fixtures.json';
import legacyFixtures from '../../../reference/fixtures_legacy.json';
import {
  SIGMA_SCREEN,
  SPACEX_A_SAT,
  SPACEX_M_SAT,
  SPACEX_P_SAT,
  STARLINK_A,
  STARLINK_M,
  STARLINK_N,
  activeSatelliteTerm,
  cascadeTimescale,
  debrisLifetimeYr,
  dragTimescalesYr,
  fragmentProperties,
  kessler,
  kesslerShellRates,
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
  starlink_today: { fleetOverride: { N: STARLINK_N, A: STARLINK_A, m: STARLINK_M }, preset: 'starlink', pSat: 1 },
  starlink_slider: {
    rateWPerYr: (STARLINK_N * STARLINK_A * (SPACEX_P_SAT / SPACEX_A_SAT)) / 5,
    pSat: STARLINK_A * (SPACEX_P_SAT / SPACEX_A_SAT),
    preset: 'starlink',
  },
  '1GW_spacex': { rateWPerYr: 1e9 },
  '3GW_low': { rateWPerYr: 3e9, preset: 'low' },
  '10GW_spacex': { rateWPerYr: 10e9 },
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
    const frag = fragmentProperties(3000);
    expectClose(frag.mF, fixtures.fragment_3000kg.m_f_kg);
    expectClose(frag.dM, fixtures.fragment_3000kg.d_m);
    expectClose(frag.rho, fixtures.fragment_3000kg.rho_kg_m3);
    expectClose(frag.am, fixtures.fragment_3000kg.am_m2_per_kg);
    const msis = fixtures.tau_msis_ref as Record<string, { reentry_frag: number; cross_frag: number; derelict: number }>;
    for (const [h, expected] of Object.entries(msis)) {
      const got = dragTimescalesYr(Number(h), SPACEX_A_SAT, SPACEX_M_SAT);
      expectClose(got.reentry, expected.reentry_frag);
      expectClose(got.cross, expected.cross_frag);
      expectClose(got.derelict, expected.derelict);
    }
  });

  it('drag timescales and R0 stay within 5% of the independent targets', () => {
    const within = (got: number, target: number) => {
      expect(Math.abs(got - target) / Math.abs(target)).toBeLessThanOrEqual(0.05);
    };
    const ref: [number, number, number, number][] = [
      [525, 1.85, 1.52, 0.32],
      [625, 8.9, 6.6, 1.5],
      [825, 117, 62, 20],
      [875, 192, 89, 33],
      [975, 437, 159, 75],
      [1225, 1820, 418, 312],
    ];
    for (const [h, reentry, cross, derelict] of ref) {
      const got = dragTimescalesYr(h, 800, 3000);
      within(got.reentry, reentry);
      within(got.cross, cross);
      within(got.derelict, derelict);
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
    const got = kessler({ fleetOverride: { N: STARLINK_N, A: STARLINK_A, m: STARLINK_M }, preset: 'starlink', pSat: 1 });
    expect(Math.abs(got.cam_per_month - 34525.3) / 34525.3).toBeLessThanOrEqual(0.001);
    for (const r0 of Object.values(got.R0_by_shell)) expect(r0).toBeLessThan(0.1);
  });

  it('shell rates sum to the yearly totals', () => {
    for (const input of Object.values(cases)) {
      const got = kessler(input);
      const rates = kesslerShellRates(input);
      expectClose(rates.kills.reduce((sum, value) => sum + value, 0), got.kills_per_yr);
      expectClose(rates.coll_total.reduce((sum, value) => sum + value, 0), got.collisions_per_yr);
      const active = rates.kills.reduce((sum, value, i) => sum + value + (rates.coll_active[i] ?? 0), 0);
      expectClose(active * got.cost_per_sat, got.unplanned_loss_usd_per_yr);
    }
  });

  it('Starlink slider settings keep N and every R0 shell', () => {
    const area = 116;
    const got = kessler({
      rateWPerYr: (STARLINK_N * area * (SPACEX_P_SAT / SPACEX_A_SAT)) / 5,
      LYr: 5,
      pSat: area * (SPACEX_P_SAT / SPACEX_A_SAT),
      preset: 'starlink',
    });
    expect(Math.abs(got.N - STARLINK_N)).toBeLessThanOrEqual(1);
    const shells = fixtures.kessler.starlink_slider.R0_by_shell as Record<string, number>;
    for (const [h, value] of Object.entries(shells)) {
      expect(Math.abs((got.R0_by_shell[h] ?? NaN) - value)).toBeLessThanOrEqual(1e-4);
    }
  });

  it('legacy_fit reproduces the pre-drag fixture values', () => {
    const tau = legacyFixtures.tau_yr as Record<string, number>;
    for (const [h, expected] of Object.entries(tau)) {
      expectClose(debrisLifetimeYr(Number(h)), expected);
    }
  });

  it('cascade timescale follows the fastest growth, or the slowest decay', () => {
    const expectTime = (
      input: KesslerInput,
      mode: 'doubling' | 'halving',
      lo: number,
      hi: number,
      years: number,
    ) => {
      const got = cascadeTimescale(input);
      expect(got.mode).toBe(mode);
      expect(got.shellLo).toBe(lo);
      expect(got.shellHi).toBe(hi);
      expect(Math.abs(got.years - years) / years).toBeLessThanOrEqual(1e-3);
    };
    expectTime(cases.starlink_today, 'halving', 550, 600, 1.92686);
    expectTime(cases['1GW_spacex'], 'doubling', 950, 1000, 1.2268);
    expectTime(cases['1TW_spacex'], 'doubling', 950, 1000, 0.0012133);
    expectTime(cases['1GW_low_bestcase'], 'halving', 500, 550, 1.07002);
  });

  it('active-satellite term scales with total area and with fragment crossing time', () => {
    const a = activeSatelliteTerm(1e9, 5, 30e3, 'spacex', 0.99);
    const b = activeSatelliteTerm(1e9, 5, 5e6, 'spacex', 0.99);
    const mass = (pSat: number) => (SPACEX_M_SAT * pSat) / SPACEX_P_SAT;
    const area = (pSat: number) => (SPACEX_A_SAT * pSat) / SPACEX_P_SAT;
    const sigmaF = (pSat: number) => {
      const aM2 = area(pSat);
      const d = fragmentProperties(mass(pSat)).dM;
      return (Math.sqrt(aM2 / 2) + Math.sqrt((Math.PI * d * d) / 4)) ** 2;
    };
    const tau = (pSat: number) => dragTimescalesYr(875, area(pSat), mass(pSat)).cross;
    // N_i scales as 1/P_sat and N_crit scales as 1/(σ_f τ), so the term scales as σ_f τ / P_sat.
    const ratio = ((sigmaF(30e3) * tau(30e3)) / 30e3) / ((sigmaF(5e6) * tau(5e6)) / 5e6);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      if (b[i] === 0) expect(a[i]).toBe(0);
      else expectClose(a[i] / b[i], ratio);
    }
  });
});
