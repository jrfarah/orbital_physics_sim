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
        'The chips cap the radiator temperature, so radiator performance only moves by a factor of a few. A heat pump shrinks the radiator but costs more solar panel than it saves. Total area grows in step with power: about 4.6 km² per gigawatt.',
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
    ] as SourceItem[],
    thermal: [
      { parts: [{ text: 'Radiator emissivity 0.9; environment load 57.7 W/m² per face = best case from the Radiator tab (500 km, dawn-dusk orbit, edge-on).' }] },
      { parts: [{ text: 'GPU limit 90 °C and a 30 K drop from chip to radiator are illustrative defaults; adjust them.' }] },
      { parts: [{ text: 'Solar: 22% cells, 90% packing, continuous sunlight (dawn-dusk orbit), no batteries. All generous to orbital compute.' }] },
      { parts: [{ text: 'Heat pump: work = Q·(T_hot/T_cold − 1)/(fraction of Carnot).' }] },
      { parts: [{ text: 'Reference areas: U.S. Census Bureau land areas; NYC Parks (Central Park 843 acres). The OpenStreetMap fetch for Central Park and Manhattan failed, so those two insets are rounded rectangles of the published area. Rhode Island uses the Natural Earth coastline (public domain). © OpenStreetMap contributors (ODbL).' }] },
    ] as SourceItem[],
    kessler: [
      {
        parts: [
          { text: 'Starlink collision-avoidance maneuvers: 207,152 in Dec 2025-May 2026 (SpaceX semiannual report to the FCC), via Space.com: ' },
          link('https://www.space.com/space-exploration/satellites/every-spacex-starlink-satellite-has-to-dodge-a-collision-almost-weekly-and-experts-fear-the-worst'),
        ],
      },
      {
        parts: [
          { text: 'SpaceX maneuvers when collision probability exceeds 3 in 10 million (industry norm 1 in 10,000): ' },
          link('https://www.altagrove.com/grovewire-news/spacex-148696-starlink-collision-maneuvers-in-6-months-ending-nov-30-continued-issues-with-operators-slipshod-reporting'),
        ],
      },
      {
        parts: [
          { text: 'SpaceX Orbital Data Center System, FCC file SAT-LOA-20260108-00016: up to 1 million satellites in shells between 500 and 2000 km: ' },
          link('https://www.theregister.com/2026/02/05/spacex_1m_satellite_datacenter/'),
        ],
      },
      {
        parts: [
          { text: 'SpaceX AI satellite: ~70 m span, ~120 kW average compute: ' },
          link('https://news.bitcoin.com/musk-space-data-centers-scale-spacex/'),
        ],
      },
      {
        parts: [
          { text: 'Musk: "100 kW of compute per ton", 100 GW/yr, path to 1 TW/yr: ' },
          link('https://news.lavx.hu/article/spacex-s-bold-vision-million-ton-satellite-launches-to-power-space-based-ai-compute'),
        ],
      },
      { parts: [{ text: 'Satellite size 3,000 kg / 800 m² (SpaceX-stated, as used by) Lewis, H. G. (2026), "Critical Sizes of Satellite Constellations", arXiv:2607.29644. Also the source of 112 fragments per breakup and the ~1% failure rate.' }] },
      {
        parts: [
          { text: 'Debris counts (ESA MASTER-8): 54,000 objects >10 cm (incl. ~9,300 active payloads), 1.2 million 1-10 cm, 140 million 1 mm-1 cm: ' },
          link('https://sdup.esoc.esa.int/discosweb/statistics/'),
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
      { parts: [{ text: "75% of ESA's non-active >10 cm objects and 75% of the 1-10 cm objects are in LEO, with an altitude profile shaped to match published MASTER/ORDEM curves." }] },
      { parts: [{ text: 'The debris-lifetime curve is a single exponential fit (≈5 yr at 550 km, ≈100 yr at 800 km, capped at 10,000 yr). Real lifetimes depend on the solar cycle and the object\'s area-to-mass ratio.' }] },
      { parts: [{ text: 'The cascade factor R₀ uses Kessler\'s critical-density idea per 50 km shell, with the constellation evaluated alone (today\'s debris is not counted toward R₀), which is generous.' }] },
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
      { title: 'Areas', tex: 'A_{\\mathrm{rad}}=\\frac{P+W}{q}\\qquad A_{\\mathrm{sol}}=\\frac{P+W}{S_{0}\\,\\eta_{\\mathrm{PV}}\\,f_{\\mathrm{pack}}\\,f_{\\mathrm{sun}}}' },
    ] as Equation[],
    kessler: [
      { title: 'Satellites in orbit', tex: 'N=\\dot{P}\\,L/P_{\\mathrm{sat}}' },
      { title: 'Cascade factor', tex: 'R_{0}=N_{\\mathrm{eff}}/N_{\\mathrm{crit}}\\qquad N_{\\mathrm{crit}}=V/(F\\,\\sigma_{d}\\,v\\,\\tau)' },
      { title: 'Undodgeable hits', tex: '\\mathrm{kills}=N\\,n_{\\mathrm{small}}\\,(A/2)\\,v\\,f_{\\mathrm{vuln}}' },
    ] as Equation[],
  },
};
