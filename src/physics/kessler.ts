/**
 * Tab 3 Kessler model. Port of reference/model.py.
 * The shell grid is 36 shells: edges at 200, 250, …, 2000 km.
 * SIGMA_SCREEN is computed once at module load by calibrateSigmaScreen().
 */
import densityTable from '../../reference/density_msis2_f130_ap7.json';
import { C_KM_S, R_E, V_KM_YR, YEAR_S } from './constants';

export const EDGES: number[] = [];
for (let h = 200; h <= 2000; h += 50) EDGES.push(h);

export const H_C: number[] = [];
export const V_SH: number[] = [];
for (let i = 0; i < EDGES.length - 1; i++) {
  const bot = EDGES[i];
  const top = EDGES[i + 1];
  H_C.push(0.5 * (bot + top));
  // Shell volume 4/3·π·((R_E+h_top)³ − (R_E+h_bot)³) km³
  V_SH.push((4 / 3) * Math.PI * ((R_E + top) ** 3 - (R_E + bot) ** 3));
}

function g(h: number, mu: number, s: number): number {
  return Math.exp(-0.5 * ((h - mu) / s) ** 2);
}

// Spatial-density SHAPE: main peak 750-1000 km (NASA ODPO FAQ), secondary ~1400-1500 km
// (MASTER, e.g. SDC9 sub-10 cm paper), small bump near 550 km, low floor.
export const SHAPE: number[] = H_C.map(
  (h) => 0.12 * g(h, 550, 60) + 1.0 * g(h, 850, 110) + 0.35 * g(h, 1450, 130) + 0.03,
);

/** objects per km^3 in each shell, normalized so sum(n*V) = N_total. */
export function densityProfile(nTotal: number): number[] {
  let denom = 0;
  for (let i = 0; i < SHAPE.length; i++) denom += SHAPE[i] * V_SH[i];
  return SHAPE.map((s) => (nTotal * s) / denom);
}

export const N_BIG_LEO = 33_000; // >=10 cm non-operational objects in LEO (assumed ~75% of ESA's ~45k)
export const N_SMALL_LEO = 900_000; // 1-10 cm objects in LEO (assumed ~75% of ESA MASTER-8 1.2 million)
export const N_BIG = densityProfile(N_BIG_LEO);
export const N_SMALL = densityProfile(N_SMALL_LEO);

/** Legacy hand fit: ~5 yr at 550 km, ~100 yr at 800 km, capped at 10,000 yr. */
export function debrisLifetimeYr(hKm: number): number {
  const raw = 5 * Math.exp((hKm - 550) / 83);
  return Math.min(1e4, Math.max(0.1, raw));
}

/** "msis_drag" is the drag model. "legacy_fit" is the exponential above, bit-for-bit. */
export type LifetimeModel = 'msis_drag' | 'legacy_fit';
export const LIFETIME_MODEL: LifetimeModel = 'msis_drag';

// Lewis 2026 Eq. 10.
const GM = 3.986004418e14; // m^3 s^-2, geocentric gravitational parameter in that equation
const C_D = 2.2; // Lewis 2026
const H_REENTRY_KM = 125; // Lewis 2026, re-entry altitude
const SHELL_KM = 50; // this model's shell width (EDGES step)

// Lewis 2026 supplementary, stated assumptions around Eqs. 17-18.
// ρ_f = 92.937 · d^{-0.74} kg/m^3 with d in metres (the ORDEM-style 2.8 · d_cm^{-0.74} g/cm^3 relation).
const FRAG_MASS_DIVISOR = 1250;
const FRAG_DENSITY_COEFF = 92.937;
const FRAG_DENSITY_EXP = -0.74;

const ALT_KM = densityTable.alt_km;
const LOG_RHO = densityTable.rho_kg_m3.map((rho) => Math.log(rho));

/** Global-mean NRLMSIS 2.0 density, kg/m^3. log(ρ) is linear in altitude. */
export function msisDensity(hKm: number): number {
  const n = ALT_KM.length;
  if (hKm <= ALT_KM[0]) return Math.exp(LOG_RHO[0]);
  if (hKm >= ALT_KM[n - 1]) return Math.exp(LOG_RHO[n - 1]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ALT_KM[mid] <= hKm) lo = mid;
    else hi = mid;
  }
  const span = ALT_KM[hi] - ALT_KM[lo];
  const t = span === 0 ? 0 : (hKm - ALT_KM[lo]) / span;
  return Math.exp(LOG_RHO[lo] + t * (LOG_RHO[hi] - LOG_RHO[lo]));
}

export interface FragmentProperties {
  mF: number;
  dM: number;
  rho: number;
  am: number;
}

/**
 * Mass, diameter, density, and A/m of one catastrophic fragment.
 * Eq. 18 as extracted from the arXiv text could not be reconciled with these stated assumptions; we use the stated assumptions (sphere, m_f = m_i/1250, ρ_f(d)), not Eq. 18.
 */
export function fragmentProperties(mSat: number): FragmentProperties {
  const mF = mSat / FRAG_MASS_DIVISOR;
  // m_f = ρ_f(d) · π d^3 / 6, and ρ_f ∝ d^{FRAG_DENSITY_EXP}, so m_f ∝ d^{3 + FRAG_DENSITY_EXP}.
  const exponent = 3 + FRAG_DENSITY_EXP;
  const dM = (mF * 6 / (FRAG_DENSITY_COEFF * Math.PI)) ** (1 / exponent);
  const rho = FRAG_DENSITY_COEFF * dM ** FRAG_DENSITY_EXP;
  const am = (Math.PI * dM ** 2 / 4) / mF;
  return { mF, dM, rho, am };
}

/** Mean projected area of a tumbling flat plate, the same A/2 used for sig_d. m^2/kg. */
export function derelictAreaToMass(areaM2: number, mSat: number): number {
  return areaM2 / 2 / mSat;
}

/** Seconds per (m^2/kg) for |da/dt| at altitude h. Lewis 2026 Eq. 10 without A/m. */
function dragSecondsPerUnitAm(hKm: number): number {
  const aM = (R_E + hKm) * 1000;
  return 1 / (msisDensity(hKm) * C_D * Math.sqrt(GM * aM));
}

/** Integral from 125 km to h of dh/|da/dt|, per unit A/m. Trapezoid on the 5 km table. */
function reentrySecondsPerUnitAm(hKm: number): number {
  if (hKm <= H_REENTRY_KM) return 0;
  const n = Math.round((hKm - H_REENTRY_KM) / 5);
  let acc = 0;
  let prevF = dragSecondsPerUnitAm(H_REENTRY_KM);
  let prevX = H_REENTRY_KM * 1000;
  for (let i = 1; i <= n; i++) {
    const h = H_REENTRY_KM + 5 * i;
    const f = dragSecondsPerUnitAm(h);
    const x = h * 1000;
    acc += (f + prevF) * (x - prevX) * 0.5;
    prevF = f;
    prevX = x;
  }
  return acc;
}

export interface DragTimescales {
  /** TAU_CROSS_FRAG. Used for N_crit and the doubling time. */
  cross: number;
  /** TAU_REENTRY_FRAG. Used only for the displayed debris lifetime. */
  reentry: number;
  /** TAU_DERELICT. Used for derelict accumulation. */
  derelict: number;
}

export function dragTimescalesYr(
  hKm: number,
  areaM2: number,
  massKg: number,
  model: LifetimeModel = LIFETIME_MODEL,
): DragTimescales {
  if (model === 'legacy_fit') {
    const tau = debrisLifetimeYr(hKm);
    return { cross: tau, reentry: tau, derelict: tau };
  }
  const amF = fragmentProperties(massKg).am;
  const amD = derelictAreaToMass(areaM2, massKg);
  const per = dragSecondsPerUnitAm(hKm);
  const sec = reentrySecondsPerUnitAm(hKm);
  return {
    cross: (SHELL_KM * 1000 * per) / (amF * YEAR_S),
    reentry: sec / (amF * YEAR_S),
    derelict: sec / (amD * YEAR_S),
  };
}

export type Preset = 'spacex' | 'low' | 'spread' | 'starlink' | 'custom';

export function distribution(preset: Preset, band: [number, number] = [500, 1000]): number[] {
  const w = H_C.map(() => 0);
  const mask = (pred: (h: number) => boolean): number[] => {
    const idx: number[] = [];
    for (let i = 0; i < H_C.length; i++) if (pred(H_C[i])) idx.push(i);
    return idx;
  };
  if (preset === 'spacex') {
    // 20% in 500-550 km, 80% spread over 700-1000 km
    const lo = mask((h) => h > 500 && h < 550);
    const hi = mask((h) => h > 700 && h < 1000);
    for (const i of lo) w[i] = 0.2 / lo.length;
    for (const i of hi) w[i] = 0.8 / hi.length;
  } else if (preset === 'low') {
    // everything in 500-550 km
    for (const i of mask((h) => h > 500 && h < 550)) w[i] = 1;
  } else if (preset === 'spread') {
    // uniform 500-2000 km
    const m = mask((h) => h > 500 && h < 2000);
    for (const i of m) w[i] = 1 / m.length;
  } else if (preset === 'starlink') {
    // reference fleet: 500-600 km
    const m = mask((h) => h > 500 && h < 600);
    for (const i of m) w[i] = 1 / m.length;
  } else if (preset === 'custom') {
    // uniform within [band[0], band[1]]
    const m = mask((h) => h > band[0] && h < band[1]);
    if (m.length > 0) for (const i of m) w[i] = 1 / m.length;
  }
  return w;
}

export interface ShellRates {
  kills: number[];
  cams: number[];
  D: number[];
  N_crit: number[];
  R0: number[];
  coll_active: number[];
  coll_total: number[];
  tau_cross: number[];
  tau_reentry: number[];
  tau_derelict: number[];
}

export function shellRates(
  nI: number[],
  aM2: number,
  mSat: number,
  lYr: number,
  s: number,
  fDisp: number,
  fVuln: number,
  tYr: number,
  fFrag: number,
  coord: number,
  sigmaScreenKm2: number,
  lifetimeModel: LifetimeModel = LIFETIME_MODEL,
): ShellRates {
  const sigD = aM2 / 2 / 1e6; // mean projected area vs small debris, km^2
  const sigSs = (2 * aM2) / 1e6; // pair cross-section between two such satellites, km^2
  const kills: number[] = [];
  const cams: number[] = [];
  const D: number[] = [];
  const nCrit: number[] = [];
  const r0: number[] = [];
  const collActive: number[] = [];
  const collTotal: number[] = [];
  const tauCross: number[] = [];
  const tauReentry: number[] = [];
  const tauDerelict: number[] = [];
  for (let i = 0; i < nI.length; i++) {
    const Ni = nI[i];
    const k = Ni * N_SMALL[i] * sigD * V_KM_YR * fVuln; // /yr, undodgeable
    const c = Ni * (N_BIG[i] + (coord * Ni) / V_SH[i]) * (sigmaScreenKm2 + sigSs) * V_KM_YR; // /yr
    const inflow = (fDisp * Ni) / lYr + k; // new derelicts /yr
    // N_crit uses the fragment shell-crossing time. Derelicts use their own re-entry time.
    const times = dragTimescalesYr(H_C[i], aM2, mSat, lifetimeModel);
    const d = inflow * times.derelict * (1 - Math.exp(-tYr / times.derelict)); // derelicts after t_yr
    const nc = V_SH[i] / (fFrag * sigD * V_KM_YR * times.cross); // Kessler R0 = 1 threshold
    const nEff = (1 - s) * Ni + d;
    const r = nEff / nc;
    const ca =
      Ni * N_BIG[i] * sigD * V_KM_YR * (1 - s) +
      0.5 * coord * Ni ** 2 / V_SH[i] * sigSs * V_KM_YR * (1 - s) +
      Ni * d / V_SH[i] * sigSs * V_KM_YR * (1 - s);
    const cd = 0.5 * d ** 2 / V_SH[i] * sigSs * V_KM_YR + d * N_BIG[i] * sigD * V_KM_YR;
    kills.push(k);
    cams.push(c);
    D.push(d);
    nCrit.push(nc);
    r0.push(r);
    collActive.push(ca);
    collTotal.push(ca + cd);
    tauCross.push(times.cross);
    tauReentry.push(times.reentry);
    tauDerelict.push(times.derelict);
  }
  return {
    kills,
    cams,
    D,
    N_crit: nCrit,
    R0: r0,
    coll_active: collActive,
    coll_total: collTotal,
    tau_cross: tauCross,
    tau_reentry: tauReentry,
    tau_derelict: tauDerelict,
  };
}

// Calibrate the conjunction-screening cross-section so that "Starlink today"
// reproduces SpaceX's reported 207,152 maneuvers in Dec 2025 - May 2026.
export const STARLINK_N = 9000;
export const STARLINK_A = 116; // m^2, approx. V2-mini array area
export const STARLINK_CAM_PER_MONTH = 207152 / 6;

export function calibrateSigmaScreen(): number {
  const ni = distribution('starlink').map((w) => STARLINK_N * w);
  let sum = 0;
  for (let i = 0; i < ni.length; i++) sum += ni[i] * (N_BIG[i] + ni[i] / V_SH[i]);
  const base = sum * V_KM_YR;
  return (STARLINK_CAM_PER_MONTH * 12) / base - (2 * STARLINK_A) / 1e6;
}

export const SIGMA_SCREEN = calibrateSigmaScreen();

export const SPACEX_P_SAT = 120e3; // W, average compute per AI satellite
export const SPACEX_A_SAT = 800; // m^2 (SpaceX-stated size, as used by Lewis 2026)
export const SPACEX_M_SAT = 3000; // kg

export interface FleetOverride {
  N: number;
  A: number;
  m: number;
}

export interface KesslerInput {
  rateWPerYr?: number;
  LYr?: number;
  pSat?: number;
  preset?: Preset;
  band?: [number, number];
  s?: number;
  fDisp?: number;
  fVuln?: number;
  tYr?: number;
  fFrag?: number;
  coord?: number;
  usdPerW?: number;
  usdPerKg?: number;
  fleetOverride?: FleetOverride | null;
  lifetimeModel?: LifetimeModel;
}

export interface ShellRow {
  h: number;
  hLo: number;
  hHi: number;
  N: number;
  R0: number;
  Ncrit: number;
  /** TAU_REENTRY_FRAG, the displayed debris lifetime. */
  tau: number;
  /** TAU_CROSS_FRAG, the τ in N_crit and the doubling time. */
  tauCross: number;
  kills: number;
  cams: number;
  D: number;
}

export interface KesslerResult {
  N: number;
  A_sat: number;
  m_sat: number;
  span_m: number;
  launches_per_yr: number;
  cam_per_month: number;
  cam_ratio_vs_starlink: number;
  kills_per_yr: number;
  derelicts: number;
  collisions_per_yr: number;
  fragments_per_yr: number;
  small_fragments_per_yr: number;
  worst_rate_per_sat_per_yr: number;
  linear_regime_ok: boolean;
  R0_by_shell: Record<string, number>;
  R0_max: number;
  cost_per_sat: number;
  planned_replacement_usd_per_yr: number;
  unplanned_loss_usd_per_yr: number;
  rtt_ms_max: number;
  /** Occupied shells, for the 3D view. Not part of the reference dict. */
  shells: ShellRow[];
  worst_h: number;
}

export function satelliteCount(rateWPerYr: number, lYr: number, pSat: number): number {
  return (rateWPerYr * lYr) / pSat;
}

export function powerPerSatellite(rateWPerYr: number, lYr: number, n: number): number {
  return (rateWPerYr * lYr) / n;
}

/** Per-shell loss rates already computed inside `kessler`. Sums match `kills_per_yr` and `collisions_per_yr`. */
export function kesslerShellRates(input: KesslerInput = {}): { kills: number[]; coll_total: number[]; coll_active: number[] } {
  const rate = input.rateWPerYr ?? 1e9;
  const lYr = input.LYr ?? 5;
  const pSatIn = input.pSat ?? SPACEX_P_SAT;
  const preset = input.preset ?? 'spacex';
  const band = input.band ?? [500, 1000];
  const s = input.s ?? 0.99;
  const fDisp = input.fDisp ?? 0.01;
  const fVuln = input.fVuln ?? 0.1;
  const tYr = input.tYr ?? 10;
  const fFrag = input.fFrag ?? 112;
  const coord = input.coord ?? 1;
  const fleet = input.fleetOverride ?? null;
  const lifetimeModel = input.lifetimeModel ?? LIFETIME_MODEL;
  let N: number;
  let A: number;
  let m: number;
  if (fleet) {
    N = fleet.N;
    A = fleet.A;
    m = fleet.m;
  } else {
    N = (rate * lYr) / pSatIn;
    A = (SPACEX_A_SAT * pSatIn) / SPACEX_P_SAT;
    m = (SPACEX_M_SAT * pSatIn) / SPACEX_P_SAT;
  }
  const nI = distribution(preset, band).map((wi) => N * wi);
  const rows = shellRates(nI, A, m, lYr, s, fDisp, fVuln, tYr, fFrag, coord, SIGMA_SCREEN, lifetimeModel);
  return { kills: rows.kills, coll_total: rows.coll_total, coll_active: rows.coll_active };
}

export function kessler(input: KesslerInput = {}): KesslerResult {
  const rate = input.rateWPerYr ?? 1e9;
  const lYr = input.LYr ?? 5;
  const pSatIn = input.pSat ?? SPACEX_P_SAT;
  const preset = input.preset ?? 'spacex';
  const band = input.band ?? [500, 1000];
  const s = input.s ?? 0.99;
  const fDisp = input.fDisp ?? 0.01;
  const fVuln = input.fVuln ?? 0.1;
  const tYr = input.tYr ?? 10;
  const fFrag = input.fFrag ?? 112;
  const coord = input.coord ?? 1;
  const usdPerW = input.usdPerW ?? 30;
  const usdPerKg = input.usdPerKg ?? 1000;
  const fleet = input.fleetOverride ?? null;
  const lifetimeModel = input.lifetimeModel ?? LIFETIME_MODEL;

  let N: number;
  let A: number;
  let m: number;
  let P: number;
  if (fleet) {
    N = fleet.N;
    A = fleet.A;
    m = fleet.m;
    P = 0;
  } else {
    N = (rate * lYr) / pSatIn;
    A = (SPACEX_A_SAT * pSatIn) / SPACEX_P_SAT;
    m = (SPACEX_M_SAT * pSatIn) / SPACEX_P_SAT;
    P = pSatIn;
  }
  const w = distribution(preset, band);
  const nI = w.map((wi) => N * wi);
  const r = shellRates(nI, A, m, lYr, s, fDisp, fVuln, tYr, fFrag, coord, SIGMA_SCREEN, lifetimeModel);

  let camSum = 0;
  let killSum = 0;
  let dSum = 0;
  let collSum = 0;
  let collActiveSum = 0;
  let worst = 0;
  let r0Max = 0;
  let hMaxOcc = 0;
  let worstH = H_C[0];
  const r0ByShell: Record<string, number> = {};
  const shells: ShellRow[] = [];
  for (let i = 0; i < nI.length; i++) {
    camSum += r.cams[i];
    killSum += r.kills[i];
    dSum += r.D[i];
    collSum += r.coll_total[i];
    collActiveSum += r.coll_active[i];
    if (nI[i] > 0) {
      const killPer = r.kills[i] / Math.max(nI[i], 1e-30);
      const collPer = r.coll_active[i] / Math.max(nI[i], 1e-30);
      worst = Math.max(worst, killPer, collPer);
      if (r.R0[i] >= r0Max) {
        r0Max = r.R0[i];
        worstH = H_C[i];
      }
      hMaxOcc = Math.max(hMaxOcc, H_C[i]);
      r0ByShell[String(Math.round(H_C[i]))] = r.R0[i];
      shells.push({
        h: H_C[i],
        hLo: EDGES[i],
        hHi: EDGES[i + 1],
        N: nI[i],
        R0: r.R0[i],
        Ncrit: r.N_crit[i],
        tau: r.tau_reentry[i],
        tauCross: r.tau_cross[i],
        kills: r.kills[i],
        cams: r.cams[i],
        D: r.D[i],
      });
    }
  }
  const costSat = P * usdPerW + m * usdPerKg;
  const frag10 = collSum * fFrag;
  // Linear-regime check: the rate equations assume each satellite is hit/collides
  // much less than once per year. Beyond ~0.3/yr the real outcome is simply
  // "fleet destroyed faster than it is replaced" and the UI must say so.
  return {
    N,
    A_sat: A,
    m_sat: m,
    span_m: 70 * Math.sqrt(A / SPACEX_A_SAT),
    launches_per_yr: N / lYr,
    cam_per_month: camSum / 12,
    cam_ratio_vs_starlink: camSum / 12 / STARLINK_CAM_PER_MONTH,
    kills_per_yr: killSum,
    derelicts: dSum,
    collisions_per_yr: collSum,
    fragments_per_yr: frag10,
    small_fragments_per_yr: frag10 * (10 ** 1.71 - 1), // 1-10 cm, NASA SBM size law N ~ Lc^-1.71
    worst_rate_per_sat_per_yr: worst,
    linear_regime_ok: worst < 0.3,
    R0_by_shell: r0ByShell,
    R0_max: r0Max,
    cost_per_sat: costSat,
    planned_replacement_usd_per_yr: (N / lYr) * costSat,
    unplanned_loss_usd_per_yr: (killSum + collActiveSum) * costSat,
    rtt_ms_max: ((2 * (hMaxOcc + 25)) / C_KM_S) * 1e3,
    shells,
    worst_h: worstH,
  };
}

export interface CascadeTimescale {
  mode: 'doubling' | 'halving';
  years: number;
  shellLo: number;
  shellHi: number;
  R0: number;
}

/**
 * Fastest doubling time among occupied shells with R₀ > 1.
 * If none are growing, the slowest halving time. A long-lived shell can outrank a higher R₀.
 */
export function cascadeTimescale(params: KesslerInput = {}): CascadeTimescale {
  const shells = kessler(params).shells;
  let growing: { years: number; shell: ShellRow } | null = null;
  let clearing: { years: number; shell: ShellRow } | null = null;
  for (const shell of shells) {
      if (shell.R0 > 1) {
      const years = (shell.tauCross * Math.LN2) / (shell.R0 - 1);
      if (!growing || years < growing.years) growing = { years, shell };
    } else {
      const years = (shell.tauCross * Math.LN2) / (1 - shell.R0);
      if (!clearing || years > clearing.years) clearing = { years, shell };
    }
  }
  const picked = growing ?? clearing;
  if (!picked) return { mode: 'halving', years: Infinity, shellLo: 0, shellHi: 0, R0: 0 };
  return {
    mode: growing ? 'doubling' : 'halving',
    years: picked.years,
    shellLo: picked.shell.hLo,
    shellHi: picked.shell.hHi,
    R0: picked.shell.R0,
  };
}

/** (1−s)·N_i / N_crit,i for the active-satellite term. Used by the area-not-count test. */
export function activeSatelliteTerm(
  rateWPerYr: number,
  lYr: number,
  pSat: number,
  preset: Preset,
  s: number,
): number[] {
  const N = (rateWPerYr * lYr) / pSat;
  const A = (SPACEX_A_SAT * pSat) / SPACEX_P_SAT;
  const m = (SPACEX_M_SAT * pSat) / SPACEX_P_SAT;
  const nI = distribution(preset).map((w) => N * w);
  const r = shellRates(nI, A, m, lYr, s, 0.01, 0.1, 10, 112, 1, SIGMA_SCREEN);
  return nI.map((n, i) => ((1 - s) * n) / r.N_crit[i]);
}
