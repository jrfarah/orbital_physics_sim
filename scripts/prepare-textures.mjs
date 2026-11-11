import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

await mkdir('public/textures', { recursive: true });
const source = process.argv[2];
if (!source) {
  console.log(
    'No source image. Place earth_day_2k.jpg (2048x1024) and earth_day_1k.jpg (1024x512) in public/textures/, or run: npm run prepare-textures -- path/to/equirect.jpg',
  );
  process.exit(0);
}
await sharp(source).resize(2048, 1024).jpeg({ quality: 82 }).toFile('public/textures/earth_day_2k.jpg');
await sharp(source).resize(1024, 512).jpeg({ quality: 82 }).toFile('public/textures/earth_day_1k.jpg');
console.log('Wrote public/textures/earth_day_2k.jpg and earth_day_1k.jpg');
