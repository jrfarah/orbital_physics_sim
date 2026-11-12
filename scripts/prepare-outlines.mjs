import { mkdirSync, writeFileSync } from 'node:fs';

const TARGETS = {
  centralPark: { area: 3.41e6, label: 'Central Park', aspect: 4.6 },
  manhattan: { area: 59e6, label: 'Manhattan', aspect: 5.8 },
  rhodeIsland: { area: 2.678e9, label: 'Rhode Island', aspect: 1.6 },
};

async function fetchText(url, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'orbital-explainer/1.0' } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function stitch(ways) {
  const unused = ways.map((way) => way.map((p) => ({ ...p })));
  if (!unused.length) return [];
  const rings = [];
  while (unused.length) {
    const ring = unused.pop();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = unused.length - 1; i >= 0; i--) {
        const way = unused[i];
        const a = ring[0];
        const b = ring[ring.length - 1];
        const c = way[0];
        const d = way[way.length - 1];
        const near = (p, q) => Math.abs(p.lat - q.lat) < 2e-4 && Math.abs(p.lon - q.lon) < 2e-4;
        if (near(b, c)) ring.push(...way.slice(1));
        else if (near(b, d)) ring.push(...way.slice(0, -1).reverse());
        else if (near(a, d)) ring.unshift(...way.slice(0, -1));
        else if (near(a, c)) ring.unshift(...way.slice(1).reverse());
        else continue;
        unused.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

function waysFromOverpass(json) {
  const ways = [];
  for (const el of json.elements ?? []) {
    if (el.type === 'way' && el.geometry) ways.push(el.geometry);
    if (el.type === 'relation') {
      for (const member of el.members ?? []) {
        if (member.type === 'way' && member.geometry && member.role !== 'inner') ways.push(member.geometry);
      }
    }
  }
  return stitch(ways);
}

const OVERPASS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter'];

async function overpass(query) {
  let last = 'overpass failed';
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'orbital-explainer/1.0' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        last = `${url} ${res.status}`;
        continue;
      }
      return waysFromOverpass(await res.json());
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(last);
}

function project(rings) {
  let lat = 0;
  let lon = 0;
  let n = 0;
  for (const ring of rings) {
    for (const p of ring) {
      lat += p.lat;
      lon += p.lon;
      n++;
    }
  }
  lat /= n;
  lon /= n;
  const my = 111320;
  const mx = 111320 * Math.cos((lat * Math.PI) / 180);
  return rings.map((ring) => ring.map((p) => [(p.lon - lon) * mx, (p.lat - lat) * my]));
}

function distToSeg(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return Math.hypot(x, y);
}

function douglas(points, eps) {
  if (points.length < 3) return points;
  let max = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = distToSeg(points[i], points[0], points[end]);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= eps) return [points[0], points[end]];
  const left = douglas(points.slice(0, index + 1), eps);
  const right = douglas(points.slice(index), eps);
  return left.slice(0, -1).concat(right);
}

function simplify(ring, limit) {
  let eps = 1;
  let out = ring;
  for (let n = 0; n < 24 && out.length > limit; n++) {
    out = douglas(ring, eps);
    eps *= 1.6;
  }
  return out.length > limit ? out.filter((_, i) => i % Math.ceil(out.length / limit) === 0) : out;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

function rounded(area, aspect) {
  const h = Math.sqrt(area / aspect);
  const w = h * aspect;
  const r = Math.min(w, h) * 0.12;
  const pts = [];
  const corners = [
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
    [w / 2 - r, -h / 2 + r, -Math.PI / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  pts.push(pts[0]);
  return { rings: [pts], approx: true, measured: area };
}

function pack(id, rings) {
  const target = TARGETS[id];
  const simplified = rings.map((ring) => simplify(ring, 200));
  const measured = simplified.reduce((sum, ring) => sum + ringArea(ring), 0);
  const ok = measured > 0 && Math.abs(measured - target.area) / target.area <= 0.15;
  if (!ok) {
    console.warn(`${id}: area ${measured.toFixed(0)} m² is outside ±15% of ${target.area}; using a rounded rectangle`);
    return { id, label: target.label, ...rounded(target.area, target.aspect) };
  }
  return { id, label: target.label, area: target.area, rings: simplified, approx: false, measured };
}

const failed = [];

async function loadPark() {
  const queries = [
    'relation["leisure"="park"]["name"="Central Park"](40.76,-73.99,40.81,-73.94);out geom;',
    'way["leisure"="park"]["name"="Central Park"](40.76,-73.99,40.81,-73.94);out geom;',
  ];
  for (const query of queries) {
    try {
      const rings = project(await overpass(query));
      if (rings.length) return pack('centralPark', rings);
    } catch (error) {
      console.warn('Central Park query failed', error.message);
    }
  }
  failed.push('Central Park');
  return { id: 'centralPark', label: TARGETS.centralPark.label, ...rounded(TARGETS.centralPark.area, TARGETS.centralPark.aspect) };
}

async function loadManhattan() {
  const queries = [
    'relation["place"="island"]["name"="Manhattan"](40.68,-74.05,40.89,-73.90);out geom;',
    'way["place"="island"]["name"="Manhattan"](40.68,-74.05,40.89,-73.90);out geom;',
  ];
  for (const query of queries) {
    try {
      const rings = project(await overpass(query));
      if (rings.length) return pack('manhattan', rings);
    } catch (error) {
      console.warn('Manhattan query failed', error.message);
    }
  }
  failed.push('Manhattan');
  return { id: 'manhattan', label: TARGETS.manhattan.label, ...rounded(TARGETS.manhattan.area, TARGETS.manhattan.aspect) };
}

async function loadRhodeIsland() {
  try {
    const text = await fetchText('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson', 30000);
    const json = JSON.parse(text);
    const feature = json.features.find((item) => item.properties?.name === 'Rhode Island');
    if (!feature) throw new Error('Rhode Island feature missing');
    const geom = feature.geometry;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    const latlon = polys.map((poly) => poly[0].map(([lon, lat]) => ({ lon, lat })));
    return pack('rhodeIsland', project(latlon));
  } catch (error) {
    console.warn('Rhode Island fetch failed', error.message);
    failed.push('Rhode Island');
    return { id: 'rhodeIsland', label: TARGETS.rhodeIsland.label, ...rounded(TARGETS.rhodeIsland.area, TARGETS.rhodeIsland.aspect) };
  }
}

const outlines = [await loadPark(), await loadManhattan(), await loadRhodeIsland()];
mkdirSync('src/assets', { recursive: true });
writeFileSync('src/assets/outlines.json', JSON.stringify({ outlines }));
console.log(outlines.map((item) => `${item.label}: ${item.approx ? 'approx' : 'traced'} ${item.rings[0].length} pts`));
if (failed.length) console.log('FAILED', failed.join(', '));
