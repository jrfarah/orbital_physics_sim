/**
 * Planck spectra for Tab 1. Port of planck_lambda and face_spectrum.
 */
import { C_LIGHT, H_PLANCK, K_B, SIGMA, T_CMB, T_EARTH, T_SUN } from './constants';

/**
 * Spectral radiance B_lambda, W m^-2 sr^-1 m^-1.
 * If h c / (λ k T) exceeds 700, return 0 (avoids overflow; the Python run prints a harmless overflow warning there).
 */
export function planckLambda(lamM: number, t: number): number {
  const exponent = (H_PLANCK * C_LIGHT) / (lamM * K_B * t);
  if (exponent > 700) return 0;
  return (2 * H_PLANCK * C_LIGHT ** 2) / lamM ** 5 / Math.expm1(exponent);
}

export interface SpectrumComponents {
  sun: number;
  reflected: number;
  earth_ir: number;
  cmb: number;
}

/**
 * lambda*E_lambda (W m^-2) for each component incident on a face.
 * Plot this on a log-wavelength axis so area under each curve is energy.
 *
 * The reference computes sun_dilution = (R_SUN / AU)^2 and does not apply it:
 * each shape is normalized so it integrates to 1 over wavelength, then scaled by the face flux.
 */
export function faceSpectrum(
  lamM: number,
  face: { q_sun: number; q_alb: number; q_ir: number; q_cmb: number },
): SpectrumComponents {
  const sunShape = (Math.PI * planckLambda(lamM, T_SUN)) / (SIGMA * T_SUN ** 4);
  const earthShape = (Math.PI * planckLambda(lamM, T_EARTH)) / (SIGMA * T_EARTH ** 4);
  const cmbShape = (Math.PI * planckLambda(lamM, T_CMB)) / (SIGMA * T_CMB ** 4);
  return {
    sun: lamM * face.q_sun * sunShape,
    reflected: lamM * face.q_alb * sunShape,
    earth_ir: lamM * face.q_ir * earthShape,
    cmb: lamM * face.q_cmb * cmbShape,
  };
}

/** What the radiator itself emits: ε · π · B_λ(T) · λ. */
export function panelEmission(lamM: number, eps: number, tRad: number): number {
  return lamM * eps * Math.PI * planckLambda(lamM, tRad);
}
