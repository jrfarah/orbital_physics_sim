/**
 * Tab 3 Kessler model. Port of reference/model.py.
 * The shell grid is 36 shells: edges at 200, 250, …, 2000 km.
 * SIGMA_SCREEN is computed once at module load by calibrateSigmaScreen().
 */
import density130 from '../../reference/density_msis2_f130_ap7.json';
import density100 from '../../reference/density_msis2_f100_ap5.json';
import debrisProfile from '../../reference/debris_profile_satcat_2026-11-17.json';
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

// S4 CelesTrak SATCAT, built by reference/build_debris_profile.py.
export const NON_ACTIVE_COUNTS = debrisProfile.non_active;
export const STARLINK_COUNTS = debrisProfile.starlink;
// Tracked non-active objects per km^3. These are what satellites dodge.
export const N_BIG = NON_ACTIVE_COUNTS.map((count, i) => count / V_SH[i]);
// S3 MASTER-8 02/2026. R_small = 1.5e6 / (68450 − 11300) = 26.2.
// Small debris follows the tracked altitude profile, as in NASA OTPS (S2, p. 15).
export const ESA_GT_10CM = 68450;
export const ESA_ACTIVE_PAYLOADS = 11300;
export const ESA_1_TO_10CM = 1.5e6;
export const R_SMALL = ESA_1_TO_10CM / (ESA_GT_10CM - ESA_ACTIVE_PAYLOADS);
export const N_SMALL = N_BIG.map((n) => n * R_SMALL);

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

// S1 default is F10.7 = 130, Lewis's average solar activity, with Ap = 7.
// The other position is F10.7 = 100 with Ap = 5 (S5, Table 2).
export type SolarF107 = 130 | 100;
export const SOLAR_F107: SolarF107 = 130;
const DENSITY: Record<SolarF107, { alt: number[]; logRho: number[] }> = {
  130: { alt: density130.alt_km, logRho: density130.rho_kg_m3.map((rho) => Math.log(rho)) },
  100: { alt: density100.alt_km, logRho: density100.rho_kg_m3.map((rho) => Math.log(rho)) },
};

/** Global-mean NRLMSIS 2.0 density, kg/m^3. log(ρ) is linear in altitude. */
export function msisDensity(hKm: number, f107: SolarF107 = SOLAR_F107): number {
  const alt = DENSITY[f107].alt;
  const logRho = DENSITY[f107].logRho;
  const n = alt.length;
  if (hKm <= alt[0]) return Math.exp(logRho[0]);
  if (hKm >= alt[n - 1]) return Math.exp(logRho[n - 1]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (alt[mid] <= hKm) lo = mid;
    else hi = mid;
  }
  const span = alt[hi] - alt[lo];
  const t = span === 0 ? 0 : (hKm - alt[lo]) / span;
  return Math.exp(logRho[lo] + t * (logRho[hi] - logRho[lo]));
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

// S5 Table 2. SpaceX's own area-to-mass for this satellite: (800 m² / 2) / 3000 kg.
export const SPACEX_DERELICT_AM = 0.1333;

/** Mean projected area of a tumbling flat plate, m^2/kg. The 800 m², 3000 kg satellite uses S5; other fleets keep (A/2)/m. */
export function derelictAreaToMass(areaM2: number, mSat: number): number {
  if (areaM2 === SPACEX_A_SAT && mSat === SPACEX_M_SAT) return SPACEX_DERELICT_AM;
  return areaM2 / 2 / mSat;
}

/** Seconds per (m^2/kg) for |da/dt| at altitude h. Lewis 2026 Eq. 10 without A/m. */
function dragSecondsPerUnitAm(hKm: number, f107: SolarF107): number {
  const aM = (R_E + hKm) * 1000;
  return 1 / (msisDensity(hKm, f107) * C_D * Math.sqrt(GM * aM));
}

/** Integral from 125 km to h of dh/|da/dt|, per unit A/m. Trapezoid on the 5 km table. */
function reentrySecondsPerUnitAm(hKm: number, f107: SolarF107): number {
  if (hKm <= H_REENTRY_KM) return 0;
  const n = Math.round((hKm - H_REENTRY_KM) / 5);
  let acc = 0;
  let prevF = dragSecondsPerUnitAm(H_REENTRY_KM, f107);
  let prevX = H_REENTRY_KM * 1000;
  for (let i = 1; i <= n; i++) {
    const h = H_REENTRY_KM + 5 * i;
    const f = dragSecondsPerUnitAm(h, f107);
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
  f107: SolarF107 = SOLAR_F107,
): DragTimescales {
  if (model === 'legacy_fit') {
    const tau = debrisLifetimeYr(hKm);
    return { cross: tau, reentry: tau, derelict: tau };
  }
  const amF = fragmentProperties(massKg).am;
  const amD = derelictAreaToMass(areaM2, massKg);
  const per = dragSecondsPerUnitAm(hKm, f107);
  const sec = reentrySecondsPerUnitAm(hKm, f107);
  return {
    cross: (SHELL_KM * 1000 * per) / (amF * YEAR_S),
    reentry: sec / (amF * YEAR_S),
    derelict: sec / (amD * YEAR_S),
  };
}

export type Preset = 'spacex' | 'spacex_initial' | 'low' | 'spread' | 'starlink' | 'custom';

// S5 Table 1. [h0, h1, inc0, inc1, maximum satellites]. The six maxima sum to
// 1,198,120 against the 1,000,000 total, so the weights are scaled proportionally (S1).
export const SPACEX_GROUPS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [550, 568, 26, 32, 99900],
  [565, 585, 97.7, 97.7, 99980],
  [686, 718, 30, 30, 249750],
  [707, 744, 97.2, 97.2, 244860],
  [946, 978, 30, 30, 249750],
  [967, 1002, 99.4, 99.4, 253880],
];

// J2000 mean obliquity, 84381.448 arcsec (IAU 2006). Not in S1–S17; the declination sweep needs it.
const OBLIQUITY_DEG = 23.4392911;

/** Annual-average sunlit fraction. Uniform RAAN, solar declination swept over a year, cylindrical shadow. */
export function sunlitFraction(hKm: number, incDeg: number, nYear = 48, nRaan = 48, nU = 96): number {
  const eps = (OBLIQUITY_DEG * Math.PI) / 180;
  const inc = (incDeg * Math.PI) / 180;
  const r = R_E + hKm;
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  let eclipse = 0;
  let samples = 0;
  for (let iy = 0; iy < nYear; iy++) {
    const lam = (2 * Math.PI * iy) / nYear;
    const sx = Math.cos(lam);
    const sy = Math.cos(eps) * Math.sin(lam);
    const sz = Math.sin(eps) * Math.sin(lam);
    for (let ir = 0; ir < nRaan; ir++) {
      const om = (2 * Math.PI * ir) / nRaan;
      const co = Math.cos(om);
      const so = Math.sin(om);
      for (let iu = 0; iu < nU; iu++) {
        const u = (2 * Math.PI * iu) / nU;
        const cu = Math.cos(u);
        const su = Math.sin(u);
        const x = r * (co * cu - so * su * ci);
        const y = r * (so * cu + co * su * ci);
        const z = r * su * si;
        const along = x * sx + y * sy + z * sz;
        samples++;
        if (along < 0 && r * r - along * along < R_E * R_E) eclipse++;
      }
    }
  }
  return 1 - eclipse / samples;
}

/** 97–99° groups are sun-synchronous. Dawn-dusk (sunlit = 1) is an assumption: S8a says SSO, the filing gives no local time. */
export function groupSunlit(h0: number, h1: number, i0: number, i1: number): number {
  if (i0 > 90) return 1;
  const incs = i0 === i1 ? [i0] : [i0, i1];
  let sum = 0;
  let n = 0;
  for (const inc of incs) {
    for (let k = 0; k < 9; k++) {
      const h = h0 + ((h1 - h0) * k) / 8;
      sum += sunlitFraction(h, inc);
      n++;
    }
  }
  return sum / n;
}

/** Group-maximum-weighted sunlit fraction of the filed fleet. */
export function fleetSunlitFraction(): number {
  let weighted = 0;
  let total = 0;
  for (const [h0, h1, i0, i1, nMax] of SPACEX_GROUPS) {
    weighted += nMax * groupSunlit(h0, h1, i0, i1);
    total += nMax;
  }
  return weighted / total;
}

export const FLEET_SUNLIT = fleetSunlitFraction();

function filingWeights(groups: ReadonlyArray<readonly [number, number, number, number, number]>): number[] {
  const w = H_C.map(() => 0);
  let raw = 0;
  for (const group of groups) raw += group[4];
  for (const [h0, h1, , , nMax] of groups) {
    const share = nMax / raw;
    const width = h1 - h0;
    for (let i = 0; i < EDGES.length - 1; i++) {
      const overlap = Math.min(EDGES[i + 1], h1) - Math.max(EDGES[i], h0);
      if (overlap > 0) w[i] += share * (overlap / width);
    }
  }
  const total = w.reduce((a, b) => a + b, 0);
  return total > 0 ? w.map((v) => v / total) : w;
}

export function distribution(preset: Preset, band: [number, number] = [500, 1000]): number[] {
  const w = H_C.map(() => 0);
  const mask = (pred: (h: number) => boolean): number[] => {
    const idx: number[] = [];
    for (let i = 0; i < H_C.length; i++) if (pred(H_C[i])) idx.push(i);
    return idx;
  };
  if (preset === 'spacex') {
    return filingWeights(SPACEX_GROUPS);
  } else if (preset === 'spacex_initial') {
    // S5: begins with the orbital shells at nominal altitudes below 600 km.
    return filingWeights(SPACEX_GROUPS.slice(0, 2));
  } else if (preset === 'low') {
    // everything in 500-550 km
    for (const i of mask((h) => h > 500 && h < 550)) w[i] = 1;
  } else if (preset === 'spread') {
    // uniform 500-2000 km
    const m = mask((h) => h > 500 && h < 2000);
    for (const i of m) w[i] = 1 / m.length;
  } else if (preset === 'starlink') {
    // S4 current SATCAT orbits, not the Dec 2025–May 2026 window average.
    const total = STARLINK_COUNTS.reduce((a, b) => a + b, 0);
    return STARLINK_COUNTS.map((count) => count / total);
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
  f107: SolarF107 = SOLAR_F107,
  modular = false,
): ShellRates {
  // A satellite larger than one SpaceX AI satellite is a stack of those modules on one core.
  const modularGiant = modular && aM2 > SPACEX_A_SAT;
  const fatalArea = modularGiant ? SPACEX_A_SAT : aM2;
  const fragMass = modularGiant ? SPACEX_M_SAT : mSat;
  const sigD = aM2 / 2 / 1e6; // mean projected area vs small debris, km^2. Collisions use the whole structure.
  const sigKill = fatalArea / 2 / 1e6; // only a hit on the shared core is fatal
  const sigSs = (2 * aM2) / 1e6; // pair cross-section between two such satellites, km^2
  // S1 Lewis Eq. 1. Collision, kill, and dodge rates keep v = 10 km/s (NASA ODPO FAQ).
  const vLewisKmYr = (7500 / 1000) * YEAR_S; // 7500 m/s, "an assumed, conservative value"
  const wEcc = 1.1; // S1 eccentricity factor
  const dF = fragmentProperties(fragMass).dM;
  const aI = aM2 / 2;
  const aF = (Math.PI * dF * dF) / 4;
  const sigmaFKm2 = (Math.sqrt(aI) + Math.sqrt(aF)) ** 2 / 1e6;
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
    const k = Ni * N_SMALL[i] * sigKill * V_KM_YR * fVuln; // /yr, undodgeable, core only when modular
    const c = Ni * (N_BIG[i] + (coord * Ni) / V_SH[i]) * (sigmaScreenKm2 + sigSs) * V_KM_YR; // /yr
    const inflow = (fDisp * Ni) / lYr + k; // new derelicts /yr
    // N_crit uses the fragment shell-crossing time. Derelicts use their own re-entry time.
    // A modular collision breaks up one module; a dead core still strands the whole satellite.
    const times = dragTimescalesYr(H_C[i], aM2, fragMass, lifetimeModel, f107);
    const tauDer = modularGiant
      ? dragTimescalesYr(H_C[i], aM2, mSat, lifetimeModel, f107).derelict
      : times.derelict;
    const d = inflow * tauDer * (1 - Math.exp(-tYr / tauDer)); // derelicts after t_yr
    // N_0 is the fragment count F_frag (S1). 
    const nc = V_SH[i] / (fFrag * wEcc * sigmaFKm2 * vLewisKmYr * times.cross);
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
    tauDerelict.push(tauDer);
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

// S9: 65,137 + 142,015 = 207,152 maneuvers, 1 Dec 2025 through 31 May 2026.
// STARLINK_N is the mean daily in-orbit payload count from the same SATCAT download (S4).
export const STARLINK_N = debrisProfile.starlink_mean_in_orbit;
export const STARLINK_A = 116; // m^2, V2 Mini total surface area (S11), not the array area
export const STARLINK_M = 800; // kg, S11
export const STARLINK_CAM_PER_MONTH = 207152 / 6;

export function calibrateSigmaScreen(): number {
  const ni = distribution('starlink').map((w) => STARLINK_N * w);
  let sum = 0;
  for (let i = 0; i < ni.length; i++) sum += ni[i] * (N_BIG[i] + ni[i] / V_SH[i]);
  const base = sum * V_KM_YR;
  return (STARLINK_CAM_PER_MONTH * 12) / base - (2 * STARLINK_A) / 1e6;
}

export const SIGMA_SCREEN = calibrateSigmaScreen();

export const SPACEX_P_SAT = 120e3; // W average (S8a, S8b). Peak is 150 kW.
export const SPACEX_A_SAT = 800; // m^2 total area, S5 Table 2
export const SPACEX_M_SAT = 3000; // kg, S5 Table 2
export const SPACEX_SPAN_M = 70; // m wingspan, S8a and S8b

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
  solarF107?: SolarF107;
  /** Satellites above 120 kW are modules of that size on one core. Default on. */
  modular?: boolean;
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
  /** Undodgeable 1–10 cm hits per year on the non-core area of one modular satellite, worst occupied shell. */
  panel_hits_per_sat_per_yr: number;
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
  const f107 = input.solarF107 ?? SOLAR_F107;
  const modular = input.modular ?? true;
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
  const rows = shellRates(nI, A, m, lYr, s, fDisp, fVuln, tYr, fFrag, coord, SIGMA_SCREEN, lifetimeModel, f107, modular);
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
  const f107 = input.solarF107 ?? SOLAR_F107;
  const modular = input.modular ?? true;

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
  const r = shellRates(nI, A, m, lYr, s, fDisp, fVuln, tYr, fFrag, coord, SIGMA_SCREEN, lifetimeModel, f107, modular);

  let camSum = 0;
  let killSum = 0;
  let dSum = 0;
  let collSum = 0;
  let collActiveSum = 0;
  let worst = 0;
  let r0Max = 0;
  let hMaxOcc = 0;
  let worstH = H_C[0];
  let panelHits = 0;
  const panelSig = modular && A > SPACEX_A_SAT ? (A - SPACEX_A_SAT) / 2 / 1e6 : 0;
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
      if (panelSig > 0) panelHits = Math.max(panelHits, N_SMALL[i] * panelSig * V_KM_YR);
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
    span_m: SPACEX_SPAN_M * Math.sqrt(A / SPACEX_A_SAT),
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
    panel_hits_per_sat_per_yr: panelHits,
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
  modular = false,
): number[] {
  const N = (rateWPerYr * lYr) / pSat;
  const A = (SPACEX_A_SAT * pSat) / SPACEX_P_SAT;
  const m = (SPACEX_M_SAT * pSat) / SPACEX_P_SAT;
  const nI = distribution(preset).map((w) => N * w);
  const r = shellRates(nI, A, m, lYr, s, 0.01, 0.1, 10, 112, 1, SIGMA_SCREEN, LIFETIME_MODEL, SOLAR_F107, modular);
  return nI.map((n, i) => ((1 - s) * n) / r.N_crit[i]);
}
