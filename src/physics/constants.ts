/**
 * Reference physics constants. Values match reference/model.py exactly.
 * Units: SI unless noted. Altitudes and orbital distances in km.
 */

export const SIGMA = 5.670374419e-8; // W m^-2 K^-4
export const S0 = 1361.0; // W m^-2, total solar irradiance at 1 AU (Kopp & Lean 2011)
export const R_E = 6371.0; // km
export const M_EARTH = 240.0; // W m^-2, Earth outgoing longwave (CERES EBAF ~240)
export const ALBEDO = 0.3; // Earth Bond albedo (CERES EBAF ~0.29-0.30)
export const T_EARTH = 255.0; // K, effective emission temperature (spectral SHAPE only)
export const T_SUN = 5772.0; // K (IAU 2015 nominal)
export const R_SUN = 6.957e5; // km
export const AU = 1.495978707e8; // km
export const T_CMB = 2.7255; // K (Fixsen 2009)
export const H_PLANCK = 6.62607015e-34;
export const C_LIGHT = 2.99792458e8;
export const K_B = 1.380649e-23;
export const C_KM_S = 299792.458;
export const YEAR_S = 3.15576e7; // Julian year, s
export const V_REL_KM_S = 10.0; // mean LEO impact speed (NASA ODPO FAQ)
export const V_KM_YR = V_REL_KM_S * YEAR_S;

/** Sun direction in the shared frame: +X. */
export const S_HAT = [1, 0, 0] as [number, number, number];
/** Earth's north pole: +Y. */
export const Y_HAT = [0, 1, 0] as [number, number, number];
