"""Build the offline NRLMSIS 2.0 density table used by model.py.

Runtime code must not import pymsis. This script is the only place that calls it.

Source: Emmert et al. (2021), Earth and Space Science 8, e2020EA001321,
doi:10.1029/2020EA001321 (S16). Two tables: F10.7 = F10.7a = 130 with Ap = 7
(S1, Lewis's average solar activity) and F10.7 = F10.7a = 100 with Ap = 5
(the low-activity comparison in S5, Table 2). With pymsis's default
geomagnetic switch only the daily Ap is applied.
"""
import json
from pathlib import Path

import numpy as np
import pymsis
from pymsis import msis

# Equinox. Listed as an assumption in content.ts; not an annual mean.
DATE = np.datetime64("2010-03-20T00:00")

ALT_KM = np.arange(120.0, 2000.0 + 1e-9, 5.0)
LONS = np.arange(0.0, 360.0, 15.0)          # 0 through 345
LATS = np.arange(-87.5, 87.5 + 1e-9, 5.0)

# S1: F10.7 = 130 is Lewis's average solar activity, with Ap = 7.
# S5 Table 2 is the F10.7 = 100 comparison, with Ap = 5.
CASES = (
    (130.0, 7.0, "density_msis2_f130_ap7.json"),
    (100.0, 5.0, "density_msis2_f100_ap5.json"),
)


def global_mean(field):
    """field shape (nlon, nlat, nalt). Mean in longitude, then cos(lat) in latitude."""
    lon_mean = field.mean(axis=0)
    weights = np.cos(np.deg2rad(LATS))
    return np.sum(lon_mean * weights[:, None], axis=0) / weights.sum()


def build(f107, ap_daily, filename):
    ap = [ap_daily] * 7
    raw = msis.run(
        np.array([DATE]),
        LONS,
        LATS,
        ALT_KM,
        np.array([f107]),
        np.array([f107]),
        np.array([ap]),
        version=2.0,
    )
    rho = global_mean(raw[0, :, :, :, msis.Variable.MASS_DENSITY])
    temp = global_mean(raw[0, :, :, :, msis.Variable.TEMPERATURE])
    i1000 = int(np.where(np.isclose(ALT_KM, 1000.0))[0][0])
    print(f"F10.7={f107:.0f} Ap={ap_daily:.0f}")
    print(f"global-mean T at 1000 km: {temp[i1000]:.6f} K")
    for h in (500.0, 800.0, 1000.0):
        i = int(np.where(np.isclose(ALT_KM, h))[0][0])
        print(f"rho at {h:.0f} km: {rho[i]:.6e} kg/m^3")
    table = {
        "alt_km": ALT_KM.tolist(),
        "rho_kg_m3": rho.tolist(),
        "T_K": temp.tolist(),
        "meta": {
            "model": "NRLMSIS 2.0",
            "pymsis_version": pymsis.__version__,
            "citation": "Emmert et al. (2021), Earth and Space Science 8, e2020EA001321, doi:10.1029/2020EA001321",
            "version": "2.0",
            "date": "2010-03-20T00:00",
            "f107": f107,
            "f107a": f107,
            "ap": ap,
            "geomagnetic_activity": "pymsis default (daily Ap; slots 1-6 unused unless the switch is -1)",
            "longitude_deg": LONS.tolist(),
            "latitude_deg": LATS.tolist(),
            "altitude_step_km": 5.0,
            "mean": "arithmetic mean over longitude, then cos(latitude)-weighted mean over latitude",
            "T_1000km_K": float(temp[i1000]),
            "season": "2010-03-20T00:00 equinox, an assumption rather than an annual average",
        },
    }
    out = Path(__file__).with_name(filename)
    out.write_text(json.dumps(table))
    print(f"wrote {out} ({out.stat().st_size} bytes)")


def main():
    print(f"pymsis {pymsis.__version__}")
    for f107, ap_daily, filename in CASES:
        build(f107, ap_daily, filename)


if __name__ == "__main__":
    main()
