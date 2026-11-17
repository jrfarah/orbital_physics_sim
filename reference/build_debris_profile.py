"""Build the tracked-object altitude profile from the CelesTrak SATCAT (S4).

Downloads https://celestrak.org/pub/satcat.csv. Column names are the ones
documented at https://celestrak.org/satcat/satcat-format.php. If the header
does not match, this script stops.

Keeps objects with an empty DECAY_DATE and PERIGEE < 2000 km. Active objects
have OPS_STATUS_CODE in {+, P, B, S, X}; every other in-orbit object is
non-active. Each object is spread over the 50 km shells by the time-averaged
Keplerian radial distribution

    p(r) = r / (pi a sqrt(a^2 e^2 - (r - a)^2)),  a(1-e) < r < a(1+e)

with a = R_E + (perigee + apogee)/2 and e = (apogee - perigee)/(2a).
The integral over a shell is the mean-anomaly fraction |ΔM|/π. For e < 1e-3
the whole object goes in the shell that contains its mean altitude.
"""
import csv
import json
import math
import sys
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

SATCAT_URL = "https://celestrak.org/pub/satcat.csv"
EXPECTED_HEADER = [
    "OBJECT_NAME", "OBJECT_ID", "NORAD_CAT_ID", "OBJECT_TYPE", "OPS_STATUS_CODE",
    "OWNER", "LAUNCH_DATE", "LAUNCH_SITE", "DECAY_DATE", "PERIOD", "INCLINATION",
    "APOGEE", "PERIGEE", "RCS", "DATA_STATUS_CODE", "ORBIT_CENTER", "ORBIT_TYPE",
]
ACTIVE = {"+", "P", "B", "S", "X"}
R_E = 6371.0
EDGES = [float(h) for h in range(200, 2001, 50)]
N_SHELLS = len(EDGES) - 1

# C9: mean in-orbit Starlink payloads over the maneuver-report window (S9).
WINDOW_START = date(2025, 12, 1)
WINDOW_END = date(2026, 5, 31)


def shell_weights(perigee_km, apogee_km):
    rp = R_E + perigee_km
    ra = R_E + apogee_km
    if ra < rp:
        rp, ra = ra, rp
    a = 0.5 * (rp + ra)
    e = (ra - rp) / (2.0 * a)
    weights = [0.0] * N_SHELLS
    if e < 1e-3:
        mean_alt = 0.5 * (perigee_km + apogee_km)
        for i in range(N_SHELLS):
            top = EDGES[i + 1]
            inside = EDGES[i] <= mean_alt < top or (i == N_SHELLS - 1 and mean_alt == top)
            if inside:
                weights[i] = 1.0
                break
        return weights

    def mean_anomaly(r):
        c = (a - r) / (a * e)
        c = min(1.0, max(-1.0, c))
        ecc = math.acos(c)
        return ecc - e * math.sin(ecc)

    for i in range(N_SHELLS):
        lo = max(R_E + EDGES[i], rp)
        hi = min(R_E + EDGES[i + 1], ra)
        if hi <= lo:
            continue
        weights[i] = abs(mean_anomaly(hi) - mean_anomaly(lo)) / math.pi
    return weights


def parse_date(text):
    text = text.strip()
    if not text:
        return None
    return datetime.strptime(text, "%Y-%m-%d").date()


def main():
    # A circular object at 550 km must land entirely in the 550-600 km shell.
    circular = shell_weights(550.0, 550.0)
    if abs(sum(circular) - 1.0) > 1e-12 or circular[EDGES.index(550.0)] != 1.0:
        sys.exit("shell weight check failed for a circular 550 km orbit")

    download_date = date.today().isoformat()
    with urllib.request.urlopen(SATCAT_URL, timeout=120) as response:
        text = response.read().decode("utf-8")
    rows = list(csv.DictReader(text.splitlines()))
    header = list(rows[0].keys()) if rows else []
    if header != EXPECTED_HEADER:
        sys.exit(f"SATCAT columns differ from the documented format: {header}")

    non_active = [0.0] * N_SHELLS
    active = [0.0] * N_SHELLS
    starlink = [0.0] * N_SHELLS
    kept = 0
    skipped = 0
    starlink_pay = []
    for row in rows:
        name = row["OBJECT_NAME"]
        if name.startswith("STARLINK") and row["OBJECT_TYPE"] == "PAY":
            launch = parse_date(row["LAUNCH_DATE"])
            if launch is not None:
                starlink_pay.append((launch, parse_date(row["DECAY_DATE"])))
        if row["DECAY_DATE"].strip():
            continue
        try:
            perigee = float(row["PERIGEE"])
            apogee = float(row["APOGEE"])
        except ValueError:
            skipped += 1
            continue
        if perigee >= 2000.0:
            continue
        weights = shell_weights(perigee, apogee)
        kept += 1
        target = active if row["OPS_STATUS_CODE"].strip() in ACTIVE else non_active
        for i, w in enumerate(weights):
            target[i] += w
            if name.startswith("STARLINK"):
                starlink[i] += w

    day = WINDOW_START
    total = 0
    n_days = 0
    while day <= WINDOW_END:
        n_days += 1
        total += sum(1 for launch, decay in starlink_pay if launch <= day and (decay is None or decay > day))
        day += timedelta(days=1)
    starlink_mean = total / n_days
    print(f"SATCAT rows: {len(rows)}")
    print(f"kept (empty DECAY_DATE, PERIGEE < 2000 km): {kept}")
    print(f"skipped (non-numeric perigee or apogee, still in orbit): {skipped}")
    print(f"non-active count in shells: {sum(non_active):.1f}")
    print(f"active count in shells: {sum(active):.1f}")
    print(f"Starlink count in shells: {sum(starlink):.1f}")
    print(f"STARLINK_N mean {WINDOW_START} to {WINDOW_END} ({n_days} days): {starlink_mean:.6f}")

    out = Path(__file__).with_name(f"debris_profile_satcat_{download_date}.json")
    payload = {
        "download_date": download_date,
        "source": SATCAT_URL,
        "row_count": len(rows),
        "kept": kept,
        "skipped_non_numeric": skipped,
        "shell_edges_km": EDGES,
        "non_active": non_active,
        "active": active,
        "starlink": starlink,
        "starlink_mean_in_orbit": starlink_mean,
        "starlink_window": [WINDOW_START.isoformat(), WINDOW_END.isoformat()],
        "note": "Starlink shell counts are this download's current orbits, not the window average. STARLINK_N is the mean daily in-orbit count of payloads whose name starts with STARLINK.",
    }
    out.write_text(json.dumps(payload))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
