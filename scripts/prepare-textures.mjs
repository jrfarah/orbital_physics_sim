import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const outDir = 'public/textures';
await mkdir(outDir, { recursive: true });

const layers = [
  {
    name: 'day',
    url: 'https://neo.gsfc.nasa.gov/archive/bluemarble/land_ocean_ice_8192.tif',
    fallback:
      'https://assets.science.nasa.gov/content/dam/science/esd/eo/content-feature/bluemarble/images/land_ocean_ice_2048.jpg',
    outputs: [
      { file: 'earth_day_8k.jpg', w: 8192, h: 4096 },
      { file: 'earth_day_4k.jpg', w: 4096, h: 2048 },
      { file: 'earth_day_2k.jpg', w: 2048, h: 1024 },
      { file: 'earth_day_1k.jpg', w: 1024, h: 512 },
    ],
    jpeg: { quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true },
  },
  {
    name: 'clouds',
    url: 'https://neo.gsfc.nasa.gov/archive/bluemarble/cloud_combined_8192.tif',
    fallback:
      'https://assets.science.nasa.gov/content/dam/science/esd/eo/content-feature/bluemarble/images/cloud_combined_2048.jpg',
    gray: true,
    outputs: [
      { file: 'earth_clouds_4k.jpg', w: 4096, h: 2048 },
      { file: 'earth_clouds_2k.jpg', w: 2048, h: 1024 },
      { file: 'earth_clouds_1k.jpg', w: 1024, h: 512 },
    ],
    jpeg: { quality: 88, mozjpeg: true },
  },
  {
    name: 'night',
    url: 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg',
    outputs: [
      { file: 'earth_night_4k.jpg', w: 4096, h: 2048 },
      { file: 'earth_night_2k.jpg', w: 2048, h: 1024 },
      { file: 'earth_night_1k.jpg', w: 1024, h: 512 },
    ],
    jpeg: { quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true },
  },
];

async function fetchImage(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html') || buf.subarray(0, 15).toString('utf8').includes('<!')) {
    throw new Error('response was HTML, not an image');
  }
  const meta = await sharp(buf, { limitInputPixels: false }).metadata();
  if (!meta.width || !meta.height || meta.width < 256) throw new Error('not a usable image');
  return { buf, width: meta.width, height: meta.height };
}

async function loadLayer(layer) {
  try {
    const img = await fetchImage(layer.url);
    console.log(`${layer.name}: ${img.width}×${img.height} from ${layer.url}`);
    return { ...img, fallback: false };
  } catch (err) {
    if (!layer.fallback) throw new Error(`${layer.name} download failed: ${err.message}`);
    console.warn(`FALLBACK ${layer.name}: ${err.message}`);
    console.warn(`  primary: ${layer.url}`);
    console.warn(`  using:   ${layer.fallback}`);
    const img = await fetchImage(layer.fallback);
    console.log(`${layer.name}: ${img.width}×${img.height} from fallback`);
    return { ...img, fallback: true };
  }
}

for (const layer of layers) {
  const img = await loadLayer(layer);
  for (const spec of layer.outputs) {
    if (img.width < spec.w || img.height < spec.h) {
      console.log(`  skip ${spec.file}: source is ${img.width}×${img.height}`);
      continue;
    }
    let pipeline = sharp(img.buf, { limitInputPixels: false }).resize(spec.w, spec.h, { fit: 'fill' });
    if (layer.gray) pipeline = pipeline.toColourspace('b-w');
    await pipeline.jpeg(layer.jpeg).toFile(`${outDir}/${spec.file}`);
    console.log(`  wrote ${spec.file}`);
  }
}
