"""Build the offline NRLMSIS 2.0 density table used by model.py.

Runtime code must not import pymsis. This script is the only place that calls it.

Source: Emmert et al. (2021), Earth and Space Science 8, e2020EA001321,
doi:10.1029/2020EA001321. Solar inputs are Lewis (2026): F10.7 = F10.7a = 130.
All seven Ap slots are 7. With pymsis's default geomagnetic switch only the
daily Ap is applied, and the global-mean temperature at 1000 km is the value
printed below (the target is about 977 K).
"""
import json
from pathlib import Path

import numpy as np
import pymsis
from pymsis import msis

# Lewis 2026, Methods: average solar activity of 130.
F107 = 130.0
F107A = 130.0
# All seven Ap slots. Chosen so the 1000 km temperature is about 977 K.
AP = [7.0, 7.0, 7.0, 7.0, 7.0, 7.0, 7.0]
# Equinox. Listed as an assumption in content.ts; not an annual mean.
DATE = np.datetime64("2010-03-20T00:00")

ALT_KM = np.arange(120.0, 2000.0 + 1e-9, 5.0)
LONS = np.arange(0.0, 360.0, 15.0)          # 0 through 345
LATS = np.arange(-87.5, 87.5 + 1e-9, 5.0)

OUT = Path(__file__).with_name("density_msis2_f130_ap7.json")


def global_mean(field):
    """field shape (nlon, nlat, nalt). Mean in longitude, then cos(lat) in latitude."""
    lon_mean = field.mean(axis=0)
    weights = np.cos(np.deg2rad(LATS))
    return np.sum(lon_mean * weights[:, None], axis=0) / weights.sum()


def main():
    raw = msis.run(
        np.array([DATE]),
        LONS,
        LATS,
        ALT_KM,
        np.array([F107]),
        np.array([F107A]),
        np.array([AP]),
        version=2.0,
    )
    rho = global_mean(raw[0, :, :, :, msis.Variable.MASS_DENSITY])
    temp = global_mean(raw[0, :, :, :, msis.Variable.TEMPERATURE])
    i1000 = int(np.where(np.isclose(ALT_KM, 1000.0))[0][0])
    print(f"pymsis {pymsis.__version__}")
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
            "f107": F107,
            "f107a": F107A,
            "ap": AP,
            "geomagnetic_activity": "pymsis default (daily Ap; slots 1-6 unused unless the switch is -1)",
            "longitude_deg": LONS.tolist(),
            "latitude_deg": LATS.tolist(),
            "altitude_step_km": 5.0,
            "mean": "arithmetic mean over longitude, then cos(latitude)-weighted mean over latitude",
            "T_1000km_K": float(temp[i1000]),
            "season": "2010-03-20T00:00 equinox, an assumption rather than an annual average",
        },
    }
    OUT.write_text(json.dumps(table))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
