/**
 * Tab 1 radiator fluxes. Port of reference/model.py (view factor, eclipse, face fluxes).
 */
import { ALBEDO, M_EARTH, R_E, S0, S_HAT, SIGMA, T_CMB, Y_HAT } from './constants';
import { add, clamp, cross, dot, norm, normalize, scale, sub, type Vec3 } from './vec';

export interface FaceFlux {
  F: number;
  q_sun: number;
  q_alb: number;
  q_ir: number;
  q_cmb: number;
  q_abs: number;
  T_sink: number;
  q_emit: number;
  q_net: number;
}

export interface RadiatorResult {
  A: FaceFlux;
  B: FaceFlux;
  total_net: number;
  ideal: number;
}

function safeAsin(x: number): number {
  // DECISION: clamp to [-1, 1] so a 1 ulp overshoot does not produce NaN.
  return Math.asin(clamp(x, -1, 1));
}

function safeAcos(x: number): number {
  return Math.acos(clamp(x, -1, 1));
}

/**
 * Configuration factor from a planar surface element to the Earth sphere.
 * lam = angle (rad) between the face normal and the nadir direction.
 * Closed form (Howell catalog, plane element of arbitrary tilt to sphere);
 * verified against direct numerical integration to <1e-5.
 */
export function viewFactorPlateToEarth(hKm: number, lam: number): number {
  const H = (R_E + hKm) / R_E;
  const X = Math.sqrt(H * H - 1);
  const rho = Math.asin(1 / H); // Earth angular radius
  if (lam <= Math.PI / 2 - rho) {
    return Math.cos(lam) / (H * H); // whole disk in view
  }
  if (lam >= Math.PI / 2 + rho) {
    return 0; // Earth entirely behind face
  }
  const s = Math.sin(lam);
  const c = Math.cos(lam);
  const cot = c / s;
  return (
    0.5 -
    safeAsin(X / (H * s)) / Math.PI +
    (c * safeAcos(-X * cot) - X * Math.sqrt(Math.max(0, 1 - H * H * c * c))) / (Math.PI * H * H)
  );
}

/** Cylindrical Earth shadow. rVec is km. */
export function inEclipse(rVecKm: Vec3, sHat: Vec3): boolean {
  const along = dot(rVecKm, sHat);
  const perp = norm(sub(rVecKm, scale(sHat, along)));
  return along < 0 && perp < R_E;
}

/** All fluxes in W m^-2 on ONE face with outward normal nHat. */
export function faceFluxes(
  hKm: number,
  nHat: Vec3,
  rHat: Vec3,
  sHat: Vec3,
  alpha: number,
  eps: number,
  tRad: number,
): FaceFlux {
  const lam = safeAcos(dot(nHat, scale(rHat, -1)));
  const F = viewFactorPlateToEarth(hKm, lam);
  const rVec = scale(rHat, R_E + hKm);
  const qSun = inEclipse(rVec, sHat) ? 0 : S0 * Math.max(0, dot(nHat, sHat));
  // standard first-order albedo approx
  const qAlb = ALBEDO * S0 * F * Math.max(0, dot(rHat, sHat));
  const qIr = F * M_EARTH;
  const qCmb = SIGMA * T_CMB ** 4 * (1 - F);
  const qAbs = alpha * (qSun + qAlb) + eps * (qIr + qCmb);
  const tSink = (qAbs / (eps * SIGMA)) ** 0.25;
  const qEmit = eps * SIGMA * tRad ** 4;
  return {
    F,
    q_sun: qSun,
    q_alb: qAlb,
    q_ir: qIr,
    q_cmb: qCmb,
    q_abs: qAbs,
    T_sink: tSink,
    q_emit: qEmit,
    q_net: qEmit - qAbs,
  };
}

export function radiator(
  hKm: number,
  rHatIn: Vec3,
  nHatIn: Vec3,
  alpha = 1,
  eps = 1,
  tRad = 320,
  sHat: Vec3 = S_HAT,
): RadiatorResult {
  const rHat = normalize(rHatIn);
  const nHat = normalize(nHatIn);
  const A = faceFluxes(hKm, nHat, rHat, sHat, alpha, eps, tRad);
  const B = faceFluxes(hKm, scale(nHat, -1), rHat, sHat, alpha, eps, tRad);
  const ideal = 2 * eps * SIGMA * tRad ** 4;
  return { A, B, total_net: A.q_net + B.q_net, ideal };
}

/** r̂ = (cosθ cosφ, sinθ, −cosθ sinφ). Angles in radians. */
export function positionHat(thetaRad: number, phiRad: number): Vec3 {
  const ct = Math.cos(thetaRad);
  return [ct * Math.cos(phiRad), Math.sin(thetaRad), -ct * Math.sin(phiRad)];
}

export function localFrame(rHatIn: Vec3): { up: Vec3; east: Vec3; north: Vec3 } {
  const up = normalize(rHatIn);
  const crossed = cross(Y_HAT, up);
  // if |Ŷ × û| < 1e−6, use ê = (0,0,−1)
  const east = norm(crossed) < 1e-6 ? ([0, 0, -1] as Vec3) : normalize(crossed);
  const north = cross(up, east);
  return { up, east, north };
}

/** n_A = cos(tilt)·û + sin(tilt)·(cos(heading)·n̂_N + sin(heading)·ê). */
export function faceNormalFromAngles(rHat: Vec3, tiltRad: number, headingRad: number): Vec3 {
  const { up, east, north } = localFrame(rHat);
  const ct = Math.cos(tiltRad);
  const st = Math.sin(tiltRad);
  return normalize(
    add(scale(up, ct), add(scale(north, st * Math.cos(headingRad)), scale(east, st * Math.sin(headingRad)))),
  );
}

/**
 * Back-compute tilt = acos(n·û), heading = atan2(n·ê, n·n̂_N).
 * DECISION: when the face is within 0.05° of zenith or nadir, heading is undefined, so the previous heading is kept.
 */
export function anglesFromNormal(
  rHat: Vec3,
  nHatIn: Vec3,
  prevHeading = 0,
): { tilt: number; heading: number } {
  const { up, east, north } = localFrame(rHat);
  const nHat = normalize(nHatIn);
  const tilt = safeAcos(dot(nHat, up));
  if (Math.sin(tilt) < 1e-4) return { tilt, heading: prevHeading };
  let heading = Math.atan2(dot(nHat, east), dot(nHat, north));
  if (heading < 0) heading += Math.PI * 2;
  return { tilt, heading };
}

/** n_A = normalize(r̂ × ŝ); if degenerate, use ê. */
export function edgeOnNormal(rHat: Vec3): Vec3 {
  const c = cross(rHat, S_HAT);
  if (norm(c) < 1e-6) return localFrame(rHat).east;
  return normalize(c);
}

/** Earth's sky fraction = (1 − cos ρ) / 2, ρ = asin(R_E / (R_E + h)). */
export function earthSkyFraction(hKm: number): number {
  const rho = Math.asin(R_E / (R_E + hKm));
  return (1 - Math.cos(rho)) / 2;
}

export function faceSeesSun(hKm: number, rHat: Vec3, sHat: Vec3 = S_HAT): boolean {
  return !inEclipse(scale(normalize(rHat), R_E + hKm), sHat);
}

export const COATINGS = {
  blackbody: { alpha: 1, eps: 1, label: 'Ideal blackbody (absorbs α = 1, emits ε = 1)' },
  black: { alpha: 0.95, eps: 0.9, label: 'Black paint (α = 0.95, ε = 0.90)' },
  white: { alpha: 0.2, eps: 0.9, label: 'White radiator paint (α = 0.20, ε = 0.90)' },
} as const;

export type CoatingId = keyof typeof COATINGS;
