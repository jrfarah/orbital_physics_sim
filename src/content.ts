export interface SourcePart {
  text: string;
  href?: string;
}
export interface SourceItem {
  parts: SourcePart[];
}
export interface Equation {
  title: string;
  tex: string;
}

const link = (href: string): SourcePart => ({ text: href, href });

export const content = {
  siteTitle: 'Orbital Data Centers · The Physics',
  backOfEnvelopeWm2: 1000,
  tabs: {
    radiator: {
      label: 'Radiator',
      takeaway:
        'In low orbit a radiator always has a warm planet filling part of its view. Turn one face to deep space and the other face sees the Earth. Either way, what it sheds is set by its own temperature through σT⁴, and the 3 K sky barely enters.',
    },
    thermal: {
      label: 'Thermal budget',
      takeaway:
        'The coolant caps the radiator temperature, so radiator performance only moves by a factor of a few. A heat pump shrinks the radiator but costs more solar panel than it saves. Total area grows in step with power: about 5.7 km² per gigawatt.',
    },
    kessler: {
      label: 'Kessler',
      takeaway:
        'Collision risk follows the total area in orbit, and the power target fixes that area. More satellites mean more maneuvers; bigger satellites mean bigger targets and costlier losses. Untracked debris cannot be dodged at all.',
    },
  },
  sources: {
    radiator: [
      { parts: [{ text: 'Solar irradiance 1361 W/m². Kopp & Lean (2011), Geophys. Res. Lett. 38, L01706.' }] },
      { parts: [{ text: "Earth's outgoing infrared ≈ 240 W/m², albedo ≈ 0.30. CERES EBAF; Loeb et al. (2018), J. Climate 31, 895." }] },
      { parts: [{ text: 'CMB temperature 2.7255 K. Fixsen (2009), ApJ 707, 916.' }] },
      { parts: [{ text: 'Sun effective temperature 5772 K (IAU 2015 Resolution B3).' }] },
      { parts: [{ text: 'View factor from a tilted flat face to a sphere: closed form from the catalog of radiation configuration factors (Howell; thermalradiation.net), checked against direct numerical integration.' }] },
      { parts: [{ text: 'Reflected sunlight uses the standard first-order approximation albedo × S0 × F × cos(solar angle at the sub-satellite point).' }] },
      { parts: [{ text: "Earth's infrared is treated as a 255 K graybody for spectral shape only; the total is fixed at 240 W/m²." }] },
      { parts: [{ text: "Earth's shadow is approximated as a cylinder." }] },
      { parts: [{ text: 'S13a. AZ Technology AZ-93 white paint: ε = 0.91 ± 0.02, α_s = 0.15 ± 0.02, as given by Modus Advanced: ' }, link('https://www.modusadvanced.com/resources/blog/az-93-white-thermal-control-paint')] },
      { parts: [{ text: 'S13b. NASA MISSE flight data show α_s of 0.14–0.15 before and after flight. NTRS 20080031037: ' }, link('https://ntrs.nasa.gov/api/citations/20080031037/downloads/20080031037.pdf')] },
    ] as SourceItem[],
    thermal: [
      { parts: [{ text: 'S13a. Radiator emissivity 0.91, AZ-93 white paint. Environment load 57.7 W/m² per face = best case from the Radiator tab (500 km, dawn-dusk orbit, edge-on).' }] },
      { parts: [{ text: 'S14. Default radiator temperature without a pump is the coolant-loop mean, 55 °C (328 K). NVIDIA GB200 NVL72 maximum liquid inlet is 45 °C and maximum liquid return is 65 °C. The slider covers that range. The coolant-to-radiator temperature difference is ignored, which is optimistic. QCT, “Qoolrack Stand-Alone” (2025): ' }, link('https://blog.qct.io/wp-content/uploads/2025/04/QCT-Qoolrack-Stand-Alone_Advanced-Liquid-Cooling-for-NVIDIA-GB200-NVL72-Systems.pdf')] },
      { parts: [{ text: 'Musk’s ~1,300 W/m² requires a two-sided ε = 0.9 radiator at ~336 K (63 °C), at the top of this range.' }] },
      { parts: [{ text: 'S8b. Array output is 250 W/m², Musk’s figure for the AI1 solar array. Cell efficiency and packing are shown for context and do not enter the area. DataCenterDynamics, 9 Jun 2026: ' }, link('https://www.datacenterdynamics.com/en/news/spacex-details-ai1-satellite-data-center-claims-150kw-peak-compute/')] },
      { parts: [{ text: 'S15. Best space cells exceed 32%. NASA Small Spacecraft Technology State of the Art, Power chapter: ' }, link('https://www.nasa.gov/smallsat-institute/sst-soa/power-subsystems')] },
      { parts: [{ text: 'S5. SpaceX’s AI1 uses thin-film arrays. S8a says the orbit is sun-synchronous; the filing does not give the local time, so the 97–99° shells are assumed dawn-dusk (sunlit fraction 1). The 26–32° shells are not sun-synchronous. Their sunlit fraction is an annual average: uniform right ascension of the ascending node, solar declination swept over a year, Earth’s shadow treated as a cylinder. The declination scale is the J2000 mean obliquity, 23.439°, which is not in S1–S17. The default is the group-weighted fleet value, 0.836.' }] },
      { parts: [{ text: 'S12. Heat pump at 50% of Carnot. Arpagaus et al. (2018), Energy 152, 985–1010, doi:10.1016/j.energy.2018.03.166: most commercial high-temperature heat pumps reach 40–60% of Carnot. This is terrestrial industrial data; there is no space-qualified equivalent. Work = Q·(T_hot/T_cold − 1)/(fraction of Carnot).' }] },
      { parts: [{ text: 'Reference areas: a basketball court and a football field use their standard dimensions. The Pentagon is a regular pentagon with a side of 280.7 m. Central Park is a 4.02 km by 0.85 km rectangle, rotated 29° east of north, drawn inside the Manhattan outline. Manhattan and New York City use U.S. Census Bureau cartographic boundary files (public domain). Rhode Island uses the Natural Earth coastline (public domain).' }] },
    ] as SourceItem[],
    kessler: [
      {
        parts: [
          { text: 'S9. SpaceX Gen 1 and Gen 2 status report to the FCC, 1 Dec 2025 – 31 May 2026: Pc > 3×10⁻⁷, and 65,137 + 142,015 = 207,152 manoeuvres. ' },
          link('https://api-prod.fcc.gov/icfs-attachment/exp/api/v1/bff0244acfb947505791bf252f851ce6'),
          { text: ' Secondary account: ' },
          link('https://www.space.com/space-exploration/satellites/every-spacex-starlink-satellite-has-to-dodge-a-collision-almost-weekly-and-experts-fear-the-worst'),
        ],
      },
      {
        parts: [
          { text: 'S10. NASA CARA treats Pc > 10⁻⁴ as requiring mitigation: ' },
          link('https://www.nasa.gov/cara/close-approach-risk-assessment'),
        ],
      },
      {
        parts: [
          { text: 'S6. FCC Space Bureau Public Notice DA 26-113, 4 Feb 2026: up to one million satellites, 500–2,000 km. ' },
          link('https://docs.fcc.gov/public/attachments/DA-26-113A1.pdf'),
        ],
      },
      {
        parts: [
          { text: 'S7. SpaceX application narrative, ICFS SAT-LOA-20260108-00016, filed 30 Jan 2026: “launching 1 million tonnes per year of satellites generating 100 kW of compute power per tonne would add 100 gigawatts of AI compute capacity annually.” Quoted in Advanced Television: ' },
          link('https://www.advanced-television.com/?p=278402'),
        ],
      },
      {
        parts: [
          { text: 'S8a. SpaceX Starmind page (checked Nov 2026): 120 kW average, 150 kW peak, 70 m wingspan, 20 m height, 70 kW/ton, sun-synchronous orbit. ' },
          link('https://new.spacex.com/spacexai/starmind'),
        ],
      },
      {
        parts: [
          { text: 'S8b. DataCenterDynamics, 9 Jun 2026, quoting Ian Dahl and Musk: the same 120/150 kW figures, and 250 W per square metre of solar array. ' },
          link('https://www.datacenterdynamics.com/en/news/spacex-details-ai1-satellite-data-center-claims-150kw-peak-compute/'),
        ],
      },
      {
        parts: [
          { text: 'S8c. Later trade-press reports give an updated AI1 at 175 kW average / 250 kW peak and a 75 m span (R&D World, 25 Aug 2026). The SpaceX Starmind page still listed 120/150 kW when checked in Nov 2026. Defaults use the SpaceX page. ' },
          link('https://www.rdworldonline.com/spacex-unveils-100b-louisiana-spaceport-targets-175-kw-nvidia-ai-system-for-orbit-in-2027/'),
        ],
      },
      {
        parts: [
          { text: 'S5. SpaceX (C. Tenge-Rietberg) letter to the FCC, 29 May 2026, supplementing ICFS SAT-LOA-20260108-00016. Table 1 is the orbital configuration. Table 2 gives 3,000 kg, 800 m² total area, 100 m² bus and radiator, and the 0.1333 m²/kg area-to-mass ratio. The 1 TW deployment rate on this page is an illustrative scale, not a SpaceX claim. ' },
          link('https://api-prod.fcc.gov/icfs-attachment/exp/api/v1/52755717cf894b1068ecb8a42f851ce9'),
        ],
      },
      { parts: [{ text: 'S1. H. G. Lewis (2026), “Critical Sizes of Satellite Constellations”, arXiv:2607.29644. Source of the cascade formula, 112 fragments per breakup, η = 0.01, and the optimistic dodge factor α = 0.01 with perfect manoeuvre performance. Lewis notes that his reference numbers for the two McDowell logs appear swapped; the recorded Starlink failure rate he cites is 1.3%.' }] },
      { parts: [{ text: 'S1 methods: C_D = 2.2, re-entry at 125 km, fragment mass m_sat/1250 with density 92.937 d^−0.74 kg/m³ (d in metres), and |da/dt| = ρ C_D (A/m) sqrt(GM a) with GM = 3.986004418×10^14 m³/s². F10.7 = 130 is his average solar activity. Eq. 18 as extracted from the arXiv text could not be reconciled with these stated assumptions; this model uses the stated assumptions (sphere, m_f = m_i/1250, ρ_f(d)), not Eq. 18.' }] },
      { parts: [{ text: 'S16. J. T. Emmert et al. (2021), “NRLMSIS 2.0”, Earth and Space Science 8, e2020EA001321, doi:10.1029/2020EA001321.' }] },
      { parts: [{ text: 'S17. SpaceX’s orbital data-center filing states a planned disposal success above 99%. Converge Digest summary: ' }, link('https://convergedigest.com/spacex-fcc-filings-outline-orbital-ai-data-centers-built-on-optical-mesh/')] },
      {
        parts: [
          { text: 'S11. Starlink V2 Mini total surface area is 1,248 square feet, or 116 m², and the mass is about 800 kg. Spaceflight Now, 26 Feb 2023: ' },
          link('https://spaceflightnow.com/2023/02/26/spacex-unveils-first-batch-of-larger-upgraded-starlink-satellites/'),
        ],
      },
      {
        parts: [
          { text: 'S3. ESA Space Debris Office, DISCOSweb, MASTER-8 reference population 02/2026, page updated 13 Nov 2026: 68,450 objects >10 cm including about 11,300 active payloads, 1.5 million at 1–10 cm, 230 million at 1 mm–1 cm. ' },
          link('https://sdup.esoc.esa.int/discosweb/statistics/'),
        ],
      },
      {
        parts: [
          { text: 'S2. T. J. Colvin, J. Karcz, G. Wusk (2023), Cost and Benefit Analysis of Orbital Debris Remediation, NASA Office of Technology, Policy, and Strategy, 10 Mar 2023. NTRS 20230002817. Page 15: small and large debris share an altitude profile, and NASA’s ratio was about 27. Page 25: FRACLETHAL = 10%, citing Tibor et al. (2022), and the strike must hit a vital subsystem. ' },
          link('https://www.nasa.gov/wp-content/uploads/2023/03/otps_-_cost_and_benefit_analysis_of_orbital_debris_remediation_-_final.pdf'),
        ],
      },
      {
        parts: [
          { text: 'S4. CelesTrak SATCAT, downloaded 2026-11-17, 71,335 rows: ' },
          link('https://celestrak.org/pub/satcat.csv'),
          { text: ' Format: ' },
          link('https://celestrak.org/satcat/satcat-format.php'),
        ],
      },
      {
        parts: [
          { text: 'Debris concentration peaks near 750-1000 km; mean impact speed ~10 km/s; debris below 600 km falls within years, at 800 km in centuries, above 1000 km a thousand years or more (NASA Orbital Debris Program Office FAQ): ' },
          link('https://orbitaldebris.jsc.nasa.gov/faq/'),
        ],
      },
      {
        parts: [
          { text: 'ESA\'s and NASA\'s debris models differ by ~2.3× in the >1 cm flux at 800 km ("Flux comparison of MASTER-8 and ORDEM 3.1 modelled space debris population", 8th European Conference on Space Debris): ' },
          link('https://conference.sdo.esoc.esa.int/proceedings/sdc8/paper/11/SDC8-paper11.pdf'),
        ],
      },
      { parts: [{ text: 'Kessler & Cour-Palais (1978), J. Geophys. Res. 83(A6), 2637: collisional cascading.' }] },
      { parts: [{ text: 'Fragment size distribution N ∝ L^−1.71: NASA standard breakup model, Johnson et al. (2001), Adv. Space Res. 28(9), 1377.' }] },
      { parts: [{ text: 'MODEL ASSUMPTIONS:' }] },
      { parts: [{ text: 'Objects of 10 cm and larger are the non-active objects in the 17 Nov 2026 SATCAT with perigee below 2000 km, spread over the 50 km shells by the time a Keplerian orbit spends in each shell. Objects of 1–10 cm are that count times 26.2, from the ESA populations above (1.5 million divided by 68,450 − 11,300). Giving small debris the altitude distribution of tracked debris is the same assumption NASA OTPS makes.' }] },
      { parts: [{ text: 'Debris decay uses NRLMSIS 2.0. The default is F10.7 = F10.7a = 130 and Ap = 7, Lewis’s average solar activity, evaluated at the 2010-03-20 equinox rather than an annual average. The switch to F10.7 = 100 uses Ap = 5. Lifetimes depend strongly on solar activity: at F10.7 = 100 they are about 2× longer than at 130, and at 70 about 6× longer. Lower activity means larger R₀, so the default is the optimistic choice. N_crit and the doubling time use how long a fragment takes to cross the 50 km shell. The lifetime gauge uses how long it takes to fall from the shell centre to 125 km. A derelict of the 800 m², 3,000 kg satellite uses 0.1333 m²/kg. Other fleets use (A/2)/m. The old exponential fit remains available for comparison. The NASA FAQ lifetimes are only a qualitative sanity check.' }] },
      { parts: [{ text: 'Known differences from Lewis 2026: N_crit uses his V = 7,500 m/s, his eccentricity factor W = 1.1, and σ_f = (√A_i + √A_f)². Collision, kill, and dodge rates still use 10 km/s from the NASA ODPO FAQ and the projected area A/2. The atmosphere is NRLMSIS 2.0 instead of CIRA-72, at the same F10.7. The Starlink altitude profile is the current catalogue, not an average over the manoeuvre-report window.' }] },
      { parts: [{ text: 'The cascade factor R₀ uses Kessler\'s critical-density idea per 50 km shell, with the constellation evaluated alone (today\'s debris is not counted toward R₀), which is generous. τ in N_crit is the shell-crossing time, so R₀ does not depend on the bin width.' }] },
      { parts: [{ text: "The conjunction-screening cross-section is calibrated to Starlink's reported maneuver count." }] },
      { parts: [{ text: 'The model is good to roughly a factor of a few. Conclusions that hold by factors of 100-100,000 are robust; borderline cases are not.' }] },
      { parts: [{ text: 'Costs are illustrative.' }] },
    ] as SourceItem[],
  },
  equations: {
    radiator: [
      { title: 'Absorbed heat on one face', tex: 'q_{\\mathrm{abs}}=\\alpha(q_{\\mathrm{sun}}+q_{\\mathrm{alb}})+\\varepsilon(q_{\\mathrm{IR}}+q_{\\mathrm{CMB}})' },
      { title: 'Effective sink temperature', tex: 'T_{\\mathrm{sink}}=\\left(\\frac{q_{\\mathrm{abs}}}{\\varepsilon\\sigma}\\right)^{1/4}' },
      { title: 'Heat shed by one face', tex: 'q_{\\mathrm{net}}=\\varepsilon\\sigma T^{4}-q_{\\mathrm{abs}}' },
      { title: 'Both faces, and the 3 K ideal', tex: 'q_{\\mathrm{total}}=q_{A}+q_{B}\\qquad q_{\\mathrm{ideal}}=2\\varepsilon\\sigma T^{4}' },
    ] as Equation[],
    thermal: [
      { title: 'Chip to radiator', tex: 'T_{\\mathrm{cold}}=T_{\\mathrm{GPU}}-\\Delta T' },
      { title: 'Heat pump work', tex: 'W=P\\,\\frac{T_{\\mathrm{hot}}/T_{\\mathrm{cold}}-1}{\\eta_{\\mathrm{Carnot}}}' },
      { title: 'Heat shed per square meter', tex: 'q=2\\left(\\varepsilon\\sigma T_{\\mathrm{hot}}^{4}-q_{\\mathrm{env}}\\right)' },
      { title: 'Areas', tex: 'A_{\\mathrm{rad}}=\\frac{P+W}{q}\\qquad A_{\\mathrm{sol}}=\\frac{P+W}{250\\,f_{\\mathrm{sun}}}' },
    ] as Equation[],
    kessler: [
      { title: 'Satellites in orbit', tex: 'N=\\dot{P}\\,L/P_{\\mathrm{sat}}' },
      { title: 'Cascade factor, τ = shell-crossing time', tex: 'R_{0}=N_{\\mathrm{eff}}/N_{\\mathrm{crit}}\\qquad N_{\\mathrm{crit}}=V/(N_{0}\\,W\\,\\sigma_{f}\\,V\\,\\tau)' },
      { title: 'Undodgeable hits', tex: '\\mathrm{kills}=N\\,n_{\\mathrm{small}}\\,(A/2)\\,v\\,f_{\\mathrm{vuln}}' },
    ] as Equation[],
  },
};
