"""
Reference physics model for the orbital data-center explainer site.
The TypeScript physics module must reproduce these functions exactly
(same formulas, same constants, same shell grid). Run this file to
regenerate the test fixtures in fixtures.json.

Units: SI unless noted. Altitudes and orbital distances in km.
"""
import json
from pathlib import Path

import numpy as np

# Values this file still needs and that the task statement does not supply.
# Empty means every constant below is sourced.
UNSOURCED = []

# ---------------------------------------------------------------- constants
SIGMA = 5.670374419e-8        # W m^-2 K^-4
S0 = 1361.0                   # W m^-2, total solar irradiance at 1 AU (Kopp & Lean 2011)
R_E = 6371.0                  # km
M_EARTH = 240.0               # W m^-2, Earth outgoing longwave (CERES EBAF ~240)
ALBEDO = 0.30                 # Earth Bond albedo (CERES EBAF ~0.29-0.30)
T_EARTH = 255.0               # K, effective emission temperature (spectral SHAPE only)
T_SUN = 5772.0                # K (IAU 2015 nominal)
R_SUN = 6.957e5               # km
AU = 1.495978707e8            # km
T_CMB = 2.7255                # K (Fixsen 2009)
H_PLANCK = 6.62607015e-34
C_LIGHT = 2.99792458e8
K_B = 1.380649e-23
C_KM_S = 299792.458
YEAR_S = 3.15576e7            # Julian year, s
V_REL_KM_S = 10.0             # mean LEO impact speed (NASA ODPO FAQ)
V_KM_YR = V_REL_KM_S * YEAR_S

# ======================================================== TAB 1: RADIATOR
def view_factor_plate_to_earth(h_km, lam):
    """Configuration factor from a planar surface element to the Earth sphere.
    lam = angle (rad) between the face normal and the nadir direction.
    Closed form (Howell catalog, plane element of arbitrary tilt to sphere);
    verified against direct numerical integration to <1e-5."""
    H = (R_E + h_km) / R_E
    X = np.sqrt(H * H - 1.0)
    rho = np.arcsin(1.0 / H)                      # Earth angular radius
    if lam <= np.pi / 2 - rho:
        return np.cos(lam) / (H * H)              # whole disk in view
    if lam >= np.pi / 2 + rho:
        return 0.0                                # Earth entirely behind face
    s, c = np.sin(lam), np.cos(lam)
    cot = c / s
    return (0.5 - np.arcsin(X / (H * s)) / np.pi
            + (c * np.arccos(-X * cot) - X * np.sqrt(max(0.0, 1 - H * H * c * c))) / (np.pi * H * H))

def in_eclipse(r_vec_km, s_hat):
    along = float(np.dot(r_vec_km, s_hat))
    perp = float(np.linalg.norm(r_vec_km - along * s_hat))
    return along < 0 and perp < R_E                # cylindrical shadow

def face_fluxes(h_km, n_hat, r_hat, s_hat, alpha, eps, T_rad):
    """All fluxes in W m^-2 on ONE face with outward normal n_hat."""
    lam = np.arccos(np.clip(np.dot(n_hat, -r_hat), -1, 1))
    F = view_factor_plate_to_earth(h_km, lam)
    r_vec = (R_E + h_km) * r_hat
    q_sun = 0.0 if in_eclipse(r_vec, s_hat) else S0 * max(0.0, float(np.dot(n_hat, s_hat)))
    q_alb = ALBEDO * S0 * F * max(0.0, float(np.dot(r_hat, s_hat)))  # standard first-order albedo approx
    q_ir = F * M_EARTH
    q_cmb = SIGMA * T_CMB ** 4 * (1.0 - F)
    q_abs = alpha * (q_sun + q_alb) + eps * (q_ir + q_cmb)
    T_sink = (q_abs / (eps * SIGMA)) ** 0.25
    q_emit = eps * SIGMA * T_rad ** 4
    return dict(F=F, q_sun=q_sun, q_alb=q_alb, q_ir=q_ir, q_cmb=q_cmb,
                q_abs=q_abs, T_sink=T_sink, q_emit=q_emit, q_net=q_emit - q_abs)

def radiator(h_km, r_hat, n_hat, alpha=1.0, eps=1.0, T_rad=320.0, s_hat=(1, 0, 0)):
    r_hat = np.asarray(r_hat, float); r_hat /= np.linalg.norm(r_hat)
    n_hat = np.asarray(n_hat, float); n_hat /= np.linalg.norm(n_hat)
    s_hat = np.asarray(s_hat, float)
    A = face_fluxes(h_km, n_hat, r_hat, s_hat, alpha, eps, T_rad)
    B = face_fluxes(h_km, -n_hat, r_hat, s_hat, alpha, eps, T_rad)
    ideal = 2 * eps * SIGMA * T_rad ** 4
    return dict(A=A, B=B, total_net=A["q_net"] + B["q_net"], ideal=ideal)

def planck_lambda(lam_m, T):
    """Spectral radiance B_lambda, W m^-2 sr^-1 m^-1."""
    return 2 * H_PLANCK * C_LIGHT ** 2 / lam_m ** 5 / np.expm1(H_PLANCK * C_LIGHT / (lam_m * K_B * T))

def face_spectrum(lam_m, face):
    """lambda*E_lambda (W m^-2) for each component incident on a face.
    Plot this on a log-wavelength axis so area under each curve is energy."""
    sun_dilution = (R_SUN / AU) ** 2                               # Omega_sun / pi
    sun_shape = np.pi * planck_lambda(lam_m, T_SUN) / (SIGMA * T_SUN ** 4)    # normalized to integrate to 1
    earth_shape = np.pi * planck_lambda(lam_m, T_EARTH) / (SIGMA * T_EARTH ** 4)
    cmb_shape = np.pi * planck_lambda(lam_m, T_CMB) / (SIGMA * T_CMB ** 4)
    return dict(
        sun=lam_m * face["q_sun"] * sun_shape,
        reflected=lam_m * face["q_alb"] * sun_shape,
        earth_ir=lam_m * face["q_ir"] * earth_shape,
        cmb=lam_m * face["q_cmb"] * cmb_shape,
    )

# ================================================= TAB 2: THERMAL BUDGET
def thermal_budget(P=1.0, T_gpu_max=363.0, dT_chain=30.0, pump=False, T_hot=None,
                   carnot_frac=0.5, eps=0.9, q_env_face=57.7, pv_eff=0.22,
                   packing=0.9, sunlit=1.0):
    """Areas in m^2 for compute power P (W). Two-sided radiator."""
    T_cold = T_gpu_max - dT_chain
    if (not pump) or (T_hot is None) or (T_hot <= T_cold):
        T_hot, W = T_cold, 0.0
    else:
        W = P * (T_hot / T_cold - 1.0) / carnot_frac
    Q_reject = P + W
    q_net = 2.0 * (eps * SIGMA * T_hot ** 4 - q_env_face)
    A_rad = Q_reject / q_net if q_net > 0 else float("inf")
    A_sol = (P + W) / (S0 * pv_eff * packing * sunlit)
    return dict(T_cold=T_cold, T_hot=T_hot, W=W, Q_reject=Q_reject, q_net=q_net,
                A_rad=A_rad, A_sol=A_sol, A_tot=A_rad + A_sol)

# ======================================================== TAB 3: KESSLER
EDGES = np.arange(200, 2001, 50).astype(float)           # 37 edges -> 36 shells
H_C = 0.5 * (EDGES[:-1] + EDGES[1:])                     # shell centers, km
V_SH = 4.0 / 3.0 * np.pi * ((R_E + EDGES[1:]) ** 3 - (R_E + EDGES[:-1]) ** 3)  # km^3

def _g(h, mu, s):
    return np.exp(-0.5 * ((h - mu) / s) ** 2)

# Spatial-density SHAPE: main peak 750-1000 km (NASA ODPO FAQ), secondary ~1400-1500 km
# (MASTER, e.g. SDC9 sub-10 cm paper), small bump near 550 km, low floor.
SHAPE = 0.12 * _g(H_C, 550, 60) + 1.0 * _g(H_C, 850, 110) + 0.35 * _g(H_C, 1450, 130) + 0.03

def density_profile(N_total):
    """objects per km^3 in each shell, normalized so sum(n*V) = N_total."""
    return N_total * SHAPE / np.sum(SHAPE * V_SH)

N_BIG_LEO = 33_000.0     # >=10 cm non-operational objects in LEO (assumed ~75% of ESA's ~45k)
N_SMALL_LEO = 900_000.0  # 1-10 cm objects in LEO (assumed ~75% of ESA MASTER-8 1.2 million)
N_BIG = density_profile(N_BIG_LEO)
N_SMALL = density_profile(N_SMALL_LEO)

def debris_lifetime_yr(h_km):
    """Legacy hand fit: ~5 yr at 550 km, ~100 yr at 800 km, capped at 10,000 yr.

    Kept so lifetime_model='legacy_fit' reproduces the previous behaviour.
    """
    return np.clip(5.0 * np.exp((np.asarray(h_km, float) - 550.0) / 83.0), 0.1, 1.0e4)

# "msis_drag" is the drag model. "legacy_fit" is the exponential above, bit-for-bit.
LIFETIME_MODEL = "msis_drag"

# Lewis 2026 Eq. 10.
GM = 3.986004418e14          # m^3 s^-2, geocentric gravitational parameter in that equation
C_D = 2.2                    # Lewis 2026
H_REENTRY_KM = 125.0        # Lewis 2026, re-entry altitude
SHELL_KM = 50.0             # this model's shell width (EDGES step)

# Lewis 2026 supplementary, stated assumptions around Eqs. 17-18.
# ρ_f = 92.937 · d^{-0.74} kg/m^3 with d in metres (the ORDEM-style 2.8 · d_cm^{-0.74} g/cm^3 relation).
FRAG_MASS_DIVISOR = 1250.0
FRAG_DENSITY_COEFF = 92.937
FRAG_DENSITY_EXP = -0.74

_DENSITY = json.loads(Path(__file__).with_name("density_msis2_f130_ap7.json").read_text())
_ALT_KM = np.asarray(_DENSITY["alt_km"], float)
_LOG_RHO = np.log(np.asarray(_DENSITY["rho_kg_m3"], float))


def msis_density(h_km):
    """Global-mean NRLMSIS 2.0 density, kg/m^3. log(ρ) is linear in altitude."""
    return np.exp(np.interp(np.asarray(h_km, float), _ALT_KM, _LOG_RHO))


def fragment_properties(m_sat):
    """Mass, diameter, density, and A/m of one catastrophic fragment.

    Eq. 18 as extracted from the arXiv text could not be reconciled with these stated assumptions; we use the stated assumptions (sphere, m_f = m_i/1250, ρ_f(d)), not Eq. 18.
    """
    m_f = m_sat / FRAG_MASS_DIVISOR
    # m_f = ρ_f(d) · π d^3 / 6, and ρ_f ∝ d^{FRAG_DENSITY_EXP}, so m_f ∝ d^{3 + FRAG_DENSITY_EXP}.
    exponent = 3.0 + FRAG_DENSITY_EXP
    d = (m_f * 6.0 / (FRAG_DENSITY_COEFF * np.pi)) ** (1.0 / exponent)
    rho_f = FRAG_DENSITY_COEFF * d ** FRAG_DENSITY_EXP
    am = (np.pi * d ** 2 / 4.0) / m_f
    return m_f, d, rho_f, am


def fragment_area_to_mass(m_sat):
    return fragment_properties(m_sat)[3]


def derelict_area_to_mass(A_m2, m_sat):
    """Mean projected area of a tumbling flat plate, the same A/2 used for sig_d. m^2/kg."""
    return (A_m2 / 2.0) / m_sat


def _drag_seconds_per_unit_am(h_km):
    """Seconds per (m^2/kg) for |da/dt| at altitude h. Lewis 2026 Eq. 10 without A/m.

    |da/dt| = ρ C_D (A/m) sqrt(GM · a), a = R_E + h, so time scales as 1/(A/m).
    """
    h = np.asarray(h_km, float)
    a_m = (R_E + h) * 1000.0
    return 1.0 / (msis_density(h) * C_D * np.sqrt(GM * a_m))


def _reentry_seconds_per_unit_am(h_km):
    """∫_125km^h dh / |da/dt| per unit A/m. Trapezoid on the 5 km density table."""
    h = float(h_km)
    if h <= H_REENTRY_KM:
        return 0.0
    n = int(round((h - H_REENTRY_KM) / 5.0))
    hs = H_REENTRY_KM + 5.0 * np.arange(n + 1)
    f = _drag_seconds_per_unit_am(hs)
    x = hs * 1000.0
    return float(np.sum((f[1:] + f[:-1]) * np.diff(x) * 0.5))


def timescales_yr(h_km, A_m2, m_sat, lifetime_model=None):
    """Crossing, re-entry, and derelict times in years at each altitude.

    TAU_CROSS_FRAG is Δh / |da/dt| and is the τ in N_crit and in the doubling time.
    TAU_REENTRY_FRAG is the integral down to 125 km, for the displayed lifetime only.
    TAU_DERELICT is that same integral with the derelict area-to-mass ratio.
    """
    model = LIFETIME_MODEL if lifetime_model is None else lifetime_model
    h = np.asarray(h_km, float)
    if model == "legacy_fit":
        tau = debris_lifetime_yr(h)
        return tau, np.array(tau, copy=True), np.array(tau, copy=True)
    if model != "msis_drag":
        raise ValueError(f"unknown lifetime model {model}")
    am_f = fragment_area_to_mass(m_sat)
    am_d = derelict_area_to_mass(A_m2, m_sat)
    flat = h.reshape(-1)
    cross = np.empty(flat.shape)
    reentry = np.empty(flat.shape)
    derelict = np.empty(flat.shape)
    for i, hi in enumerate(flat):
        per = float(_drag_seconds_per_unit_am(hi))
        cross[i] = (SHELL_KM * 1000.0) * per / (am_f * YEAR_S)
        sec = _reentry_seconds_per_unit_am(hi)
        reentry[i] = sec / (am_f * YEAR_S)
        derelict[i] = sec / (am_d * YEAR_S)
    return cross.reshape(h.shape), reentry.reshape(h.shape), derelict.reshape(h.shape)

def distribution(preset, band=(500, 1000)):
    w = np.zeros_like(H_C)
    if preset == "spacex":          # 20% in 500-550 km, 80% spread over 700-1000 km
        lo = (H_C > 500) & (H_C < 550); hi = (H_C > 700) & (H_C < 1000)
        w[lo] = 0.2 / lo.sum(); w[hi] = 0.8 / hi.sum()
    elif preset == "low":           # everything in 500-550 km
        w[(H_C > 500) & (H_C < 550)] = 1.0
    elif preset == "spread":        # uniform 500-2000 km
        m = (H_C > 500) & (H_C < 2000); w[m] = 1.0 / m.sum()
    elif preset == "starlink":      # reference fleet: 500-600 km
        m = (H_C > 500) & (H_C < 600); w[m] = 1.0 / m.sum()
    elif preset == "custom":        # uniform within [band[0], band[1]]
        m = (H_C > band[0]) & (H_C < band[1]); w[m] = 1.0 / m.sum()
    return w

def shell_rates(N_i, A_m2, m_sat, L_yr, s, f_disp, f_vuln, t_yr, F_frag, coord, sigma_screen_km2,
                lifetime_model=None):
    sig_d = A_m2 / 2.0 / 1e6          # mean projected area vs small debris, km^2
    sig_ss = 2.0 * A_m2 / 1e6         # pair cross-section between two such satellites, km^2
    kills = N_i * N_SMALL * sig_d * V_KM_YR * f_vuln                       # /yr, undodgeable
    cams = N_i * (N_BIG + coord * N_i / V_SH) * (sigma_screen_km2 + sig_ss) * V_KM_YR  # /yr
    inflow = f_disp * N_i / L_yr + kills                                   # new derelicts /yr
    # N_crit uses the fragment shell-crossing time. Derelicts use their own re-entry time.
    tau_cross, tau_reentry, tau_derelict = timescales_yr(H_C, A_m2, m_sat, lifetime_model)
    D = inflow * tau_derelict * (1.0 - np.exp(-t_yr / tau_derelict))       # derelicts after t_yr
    N_crit = V_SH / (F_frag * sig_d * V_KM_YR * tau_cross)                 # Kessler R0 = 1 threshold
    N_eff = (1.0 - s) * N_i + D
    R0 = N_eff / N_crit
    coll_active = (N_i * N_BIG * sig_d * V_KM_YR * (1 - s)
                   + 0.5 * coord * N_i ** 2 / V_SH * sig_ss * V_KM_YR * (1 - s)
                   + N_i * D / V_SH * sig_ss * V_KM_YR * (1 - s))
    coll_derelict = 0.5 * D ** 2 / V_SH * sig_ss * V_KM_YR + D * N_BIG * sig_d * V_KM_YR
    return dict(kills=kills, cams=cams, D=D, N_crit=N_crit, R0=R0,
                coll_active=coll_active, coll_total=coll_active + coll_derelict,
                tau_cross=tau_cross, tau_reentry=tau_reentry, tau_derelict=tau_derelict)

# Calibrate the conjunction-screening cross-section so that "Starlink today"
# reproduces SpaceX's reported 207,152 maneuvers in Dec 2025 - May 2026.
STARLINK_N = 9000.0
STARLINK_A = 116.0            # m^2, approx. V2-mini array area
STARLINK_CAM_PER_MONTH = 207152.0 / 6.0

def calibrate_sigma_screen():
    Ni = STARLINK_N * distribution("starlink")
    base = np.sum(Ni * (N_BIG + Ni / V_SH)) * V_KM_YR
    return STARLINK_CAM_PER_MONTH * 12.0 / base - 2.0 * STARLINK_A / 1e6

SIGMA_SCREEN = calibrate_sigma_screen()

SPACEX_P_SAT = 120e3          # W, average compute per AI satellite
SPACEX_A_SAT = 800.0          # m^2 (SpaceX-stated size, as used by Lewis 2026)
SPACEX_M_SAT = 3000.0         # kg

def kessler(rate_W_per_yr=1e9, L_yr=5.0, P_sat=SPACEX_P_SAT, preset="spacex", band=(500, 1000),
            s=0.99, f_disp=0.01, f_vuln=0.10, t_yr=10.0, F_frag=112.0, coord=1.0,
            usd_per_W_compute=30.0, usd_per_kg=1000.0, fleet_override=None, lifetime_model=None):
    if fleet_override:                      # e.g. Starlink today: dict(N=9000, A=116, m=800)
        N, A, m = fleet_override["N"], fleet_override["A"], fleet_override["m"]
        P = 0.0
    else:
        N = rate_W_per_yr * L_yr / P_sat
        A = SPACEX_A_SAT * P_sat / SPACEX_P_SAT
        m = SPACEX_M_SAT * P_sat / SPACEX_P_SAT
        P = P_sat
    N_i = N * distribution(preset, band)
    r = shell_rates(N_i, A, m, L_yr, s, f_disp, f_vuln, t_yr, F_frag, coord, SIGMA_SCREEN, lifetime_model)
    occ = N_i > 0
    cost_sat = P * usd_per_W_compute + m * usd_per_kg
    # Linear-regime check: the rate equations assume each satellite is hit/collides
    # much less than once per year. Beyond ~0.3/yr the real outcome is simply
    # "fleet destroyed faster than it is replaced" and the UI must say so.
    kill_per_sat = np.where(N_i > 0, r["kills"] / np.maximum(N_i, 1e-30), 0.0)
    coll_per_sat = np.where(N_i > 0, r["coll_active"] / np.maximum(N_i, 1e-30), 0.0)
    worst_per_sat = float(max(kill_per_sat.max(), coll_per_sat.max()))
    frag10 = float(r["coll_total"].sum() * F_frag)
    return dict(
        N=N, A_sat=A, m_sat=m, span_m=70.0 * np.sqrt(A / SPACEX_A_SAT),
        launches_per_yr=N / L_yr,
        cam_per_month=float(r["cams"].sum() / 12.0),
        cam_ratio_vs_starlink=float(r["cams"].sum() / 12.0 / STARLINK_CAM_PER_MONTH),
        kills_per_yr=float(r["kills"].sum()),
        derelicts=float(r["D"].sum()),
        collisions_per_yr=float(r["coll_total"].sum()),
        fragments_per_yr=frag10,
        small_fragments_per_yr=frag10 * (10 ** 1.71 - 1.0),   # 1-10 cm, NASA SBM size law N ~ Lc^-1.71
        worst_rate_per_sat_per_yr=worst_per_sat,
        linear_regime_ok=bool(worst_per_sat < 0.3),
        R0_by_shell={int(h): float(x) for h, x in zip(H_C[occ], r["R0"][occ])},
        R0_max=float(r["R0"][occ].max()),
        cost_per_sat=cost_sat,
        planned_replacement_usd_per_yr=N / L_yr * cost_sat,
        unplanned_loss_usd_per_yr=float((r["kills"].sum() + r["coll_active"].sum()) * cost_sat),
        rtt_ms_max=2 * float(H_C[occ].max() + 25) / C_KM_S * 1e3,
    )

# ================================================================ fixtures
if __name__ == "__main__":
    def clean(d):
        if isinstance(d, dict): return {k: clean(v) for k, v in d.items()}
        if isinstance(d, (np.floating, float)): return float(f"{float(d):.6g}")
        return d
    fx = {}
    fx["view_factor"] = {f"{h}km_{l}deg": view_factor_plate_to_earth(h, np.radians(l))
                         for h in (500, 1000, 2000) for l in (0, 45, 90, 120)}
    fx["radiator"] = {
        "dawn_dusk_edge_on_500": radiator(500, [0, 1, 0], [0, 0, 1]),
        "noon_flat_500": radiator(500, [1, 0, 0], [1, 0, 0]),
        "terminator_faceA_zenith_500": radiator(500, [0, 1, 0], [0, 1, 0]),
        "noon_edge_on_500": radiator(500, [1, 0, 0], [0, 1, 0]),
        "dawn_dusk_edge_on_2000": radiator(2000, [0, 1, 0], [0, 0, 1]),
        "dawn_dusk_edge_on_500_whitepaint": radiator(500, [0, 1, 0], [0, 0, 1], alpha=0.2, eps=0.9),
    }
    fx["cmb_flux"] = SIGMA * T_CMB ** 4
    fx["thermal"] = {
        "no_pump": thermal_budget(),
        "pump_400K_eta0.5": thermal_budget(pump=True, T_hot=400.0),
        "pump_500K_eta0.5": thermal_budget(pump=True, T_hot=500.0),
        "pump_400K_eta1.0": thermal_budget(pump=True, T_hot=400.0, carnot_frac=1.0),
    }
    fx["sigma_screen_km2"] = SIGMA_SCREEN
    fx["tau_yr"] = {int(h): float(debris_lifetime_yr(h)) for h in (525, 725, 825, 975, 1225)}
    ref_h = [525, 625, 825, 875, 975, 1225]
    cross, reentry, derelict = timescales_yr(ref_h, SPACEX_A_SAT, SPACEX_M_SAT)
    fx["tau_msis_ref"] = {
        int(h): {"reentry_frag": float(a), "cross_frag": float(b), "derelict": float(c)}
        for h, a, b, c in zip(ref_h, reentry, cross, derelict)
    }
    m_f, d_f, rho_f, am_f = fragment_properties(SPACEX_M_SAT)
    fx["fragment_3000kg"] = {"m_f_kg": float(m_f), "d_m": float(d_f), "rho_kg_m3": float(rho_f), "am_m2_per_kg": float(am_f)}
    fx["kessler"] = {
        "starlink_today": kessler(fleet_override=dict(N=9000, A=116, m=800), preset="starlink", P_sat=1),
        "starlink_slider": kessler(rate_W_per_yr=(9000 * 116 * 150) / 5.0, P_sat=116 * (120e3 / 800.0), preset="starlink"),
        "1GW_spacex": kessler(1e9),
        "3GW_low": kessler(3e9, preset="low"),
        "10GW_spacex": kessler(10e9),
        "500GW_spacex": kessler(500e9),
        "1TW_spacex": kessler(1e12),
        "1GW_low": kessler(1e9, preset="low"),
        "1GW_low_bestcase": kessler(1e9, preset="low", s=0.9999, f_disp=0.001, coord=0.01, f_vuln=0.05),
        "1TW_low_bestcase": kessler(1e12, preset="low", s=0.9999, f_disp=0.001, coord=0.01, f_vuln=0.05),
        "1TW_spacex_5MWsats": kessler(1e12, P_sat=5e6),
    }
    fx = clean(fx)
    out = Path(__file__).with_name("fixtures.json")
    json.dump(fx, open(out, "w"), indent=1)
    print(json.dumps({
        "fragment_3000kg": fx["fragment_3000kg"],
        "tau_msis_ref": fx["tau_msis_ref"],
        "R0": {name: row["R0_max"] for name, row in fx["kessler"].items()},
        "R0_1GW_spacex": fx["kessler"]["1GW_spacex"]["R0_by_shell"],
    }, indent=1))
