import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { open } from 'shapefile';
import polygonClipping from 'polygon-clipping';

const ZIP_2023 = 'https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_500k.zip';
const ZIP_2022 = 'https://www2.census.gov/geo/tiger/GENZ2022/shp/cb_2022_us_county_500k.zip';
const NYC = new Set(['005', '047', '061', '081', '085']);

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
  let eps = 8;
  let out = ring;
  for (let n = 0; n < 24 && out.length > limit; n++) {
    out = douglas(ring, eps);
    eps *= 1.55;
  }
  if (out.length > limit) out = out.filter((_, i) => i % Math.ceil(out.length / limit) === 0);
  if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0]);
  return out.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function close(ring) {
  if (ring.length < 3) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) return [...ring, a];
  return ring;
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function projectPolygon(polygon, lon0, lat0) {
  const mx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const my = 111320;
  return polygon.map((ring) => close(ring.map(([lon, lat]) => [(lon - lon0) * mx, (lat - lat0) * my])));
}

function centroidOf(polygons) {
  let lon = 0;
  let lat = 0;
  let n = 0;
  for (const polygon of polygons) {
    for (const [x, y] of polygon[0]) {
      lon += x;
      lat += y;
      n++;
    }
  }
  return { lon: lon / n, lat: lat / n };
}

function areaOf(polygons) {
  let area = 0;
  for (const polygon of polygons) {
    area += Math.abs(signedArea(polygon[0]));
    for (let i = 1; i < polygon.length; i++) area -= Math.abs(signedArea(polygon[i]));
  }
  return area;
}

function simplifyPolygons(polygons) {
  return polygons
    .map((polygon) => polygon.map((ring) => simplify(ring, 250)).filter((ring) => ring.length >= 4))
    .filter((polygon) => polygon.length);
}

async function download(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function censusDir() {
  const dir = '/tmp/cb_us_county_500k';
  mkdirSync(dir, { recursive: true });
  const zip = `${dir}.zip`;
  let url = ZIP_2023;
  try {
    await download(ZIP_2023, zip);
  } catch (error) {
    console.warn(`GENZ2023 failed (${error instanceof Error ? error.message : error}); trying GENZ2022`);
    url = ZIP_2022;
    await download(ZIP_2022, zip);
  }
  execFileSync('unzip', ['-o', zip, '-d', dir], { stdio: 'ignore' });
  const year = url.includes('2022') ? '2022' : '2023';
  return `${dir}/cb_${year}_us_county_500k.shp`;
}

const previous = JSON.parse(readFileSync('src/assets/outlines.json', 'utf8'));
const rhodeIsland = previous.outlines.find((item) => item.id === 'rhodeIsland');
if (!rhodeIsland) throw new Error('Rhode Island outline is missing from outlines.json');
if (typeof rhodeIsland.measured === 'number') rhodeIsland.area = Math.round(rhodeIsland.measured);

const shp = await censusDir();
const source = await open(shp);
const features = [];
while (true) {
  const result = await source.read();
  if (result.done) break;
  const props = result.value.properties ?? {};
  if (String(props.STATEFP) !== '36') continue;
  const county = String(props.COUNTYFP).padStart(3, '0');
  if (!NYC.has(county)) continue;
  features.push({ county, polygons: polygonsOf(result.value.geometry) });
}

const manhattan = features.find((item) => item.county === '061');
if (!manhattan) throw new Error('New York County was not in the Census file');
const origin = centroidOf(manhattan.polygons);
const manhattanMeters = simplifyPolygons(manhattan.polygons.map((polygon) => projectPolygon(polygon, origin.lon, origin.lat)));
const manhattanArea = areaOf(manhattanMeters);

const nycRaw = features.flatMap((item) => item.polygons.map((polygon) => projectPolygon(polygon, origin.lon, origin.lat)));
let nycMeters = nycRaw;
try {
  const union = polygonClipping.union(...nycRaw);
  if (union?.length) nycMeters = union;
} catch (error) {
  console.warn(`NYC union failed (${error instanceof Error ? error.message : error}); drawing counties without a union`);
}
nycMeters = simplifyPolygons(nycMeters);
const nycArea = areaOf(nycMeters);

const lat = 40.7826;
const lon = -73.9656;
const mx = 111320 * Math.cos((origin.lat * Math.PI) / 180);
const my = 111320;
const cx = (lon - origin.lon) * mx;
const cy = (lat - origin.lat) * my;
const theta = (29 * Math.PI) / 180;
const ux = Math.sin(theta);
const uy = Math.cos(theta);
const vx = Math.cos(theta);
const vy = -Math.sin(theta);
const halfL = 4020 / 2;
const halfW = 850 / 2;
const corner = (sx, sy) => [cx + sx * halfL * ux + sy * halfW * vx, cy + sx * halfL * uy + sy * halfW * vy];
const park = [corner(1, 1), corner(1, -1), corner(-1, -1), corner(-1, 1)];
park.push(park[0]);
const parkArea = Math.abs(signedArea(park));

const outlines = [
  {
    id: 'centralPark',
    label: 'Central Park (in Manhattan)',
    area: Math.round(parkArea),
    rings: [park.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])],
    faint: manhattanMeters.flat(),
    approx: false,
  },
  {
    id: 'manhattan',
    label: 'Manhattan',
    area: Math.round(manhattanArea),
    rings: manhattanMeters.flat(),
    approx: false,
  },
  {
    id: 'nyc',
    label: 'New York City',
    area: Math.round(nycArea),
    rings: nycMeters.flat(),
    approx: false,
  },
  rhodeIsland,
];

writeFileSync('src/assets/outlines.json', JSON.stringify({ outlines }));
console.log(
  outlines.map((item) => `${item.label}: ${(item.area / 1e6).toFixed(2)} km², ${item.rings.length} rings`).join('\n'),
);
