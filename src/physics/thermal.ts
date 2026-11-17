/**
 * Tab 2 thermal budget. Port of thermal_budget in reference/model.py.
 * Areas in m^2 for compute power P (W). Two-sided radiator.
 */
import { SIGMA } from './constants';
import { FLEET_SUNLIT } from './kessler';

// S8b: "250W per sq m for the solar array".
export const ARRAY_W_PER_M2 = 250;
// S14: loop mean of the 45 °C inlet and 65 °C return, as 55 °C = 328 K.
export const T_LOOP_K = 328;
// S13a: AZ-93, ε = 0.91 ± 0.02.
export const AZ93_EPS = 0.91;
// S12: most commercial high-temperature heat pumps reach 40–60% of Carnot.
export const CARNOT_FRAC = 0.5;

export interface ThermalInput {
  P?: number;
  T_gpu_max?: number;
  dT_chain?: number;
  pump?: boolean;
  T_hot?: number | null;
  carnot_frac?: number;
  eps?: number;
  q_env_face?: number;
  pv_eff?: number;
  packing?: number;
  sunlit?: number;
}

export interface ThermalResult {
  T_cold: number;
  T_hot: number;
  W: number;
  Q_reject: number;
  q_net: number;
  A_rad: number;
  A_sol: number;
  A_tot: number;
}

export function thermalBudget(input: ThermalInput = {}): ThermalResult {
  const P = input.P ?? 1;
  const tGpuMax = input.T_gpu_max ?? T_LOOP_K;
  const dTChain = input.dT_chain ?? 0;
  const pump = input.pump ?? false;
  const tHotIn = input.T_hot === undefined ? null : input.T_hot;
  const carnotFrac = input.carnot_frac ?? CARNOT_FRAC;
  const eps = input.eps ?? AZ93_EPS;
  const qEnvFace = input.q_env_face ?? 57.7;
  const sunlit = input.sunlit ?? FLEET_SUNLIT;

  const tCold = tGpuMax - dTChain;
  let tHot: number;
  let w: number;
  if (!pump || tHotIn === null || tHotIn <= tCold) {
    tHot = tCold;
    w = 0;
  } else {
    tHot = tHotIn;
    // work = Q · (T_hot/T_cold − 1) / (fraction of Carnot), with Q_reject = P + W
    // which solves to W = P * (T_hot/T_cold − 1) / carnot_frac
    w = (P * (tHot / tCold - 1)) / carnotFrac;
  }
  const qReject = P + w;
  const qNet = 2 * (eps * SIGMA * tHot ** 4 - qEnvFace);
  const aRad = qNet > 0 ? qReject / qNet : Number.POSITIVE_INFINITY;
  // pv_eff and packing remain Advanced inputs and do not enter this area (S8b).
  const aSol = (P + w) / (ARRAY_W_PER_M2 * sunlit);
  return {
    T_cold: tCold,
    T_hot: tHot,
    W: w,
    Q_reject: qReject,
    q_net: qNet,
    A_rad: aRad,
    A_sol: aSol,
    A_tot: aRad + aSol,
  };
}

/** Heat shed per m² of a two-sided radiator, 2(εσT⁴ − q_env). Used by Chart A. */
export function qNetBothFaces(tHot: number, eps: number, qEnvFace: number): number {
  return 2 * (eps * SIGMA * tHot ** 4 - qEnvFace);
}
