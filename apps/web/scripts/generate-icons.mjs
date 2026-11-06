// Generates the PNG icons in public/icons without any dependency. Run: node scripts/generate-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { colourAt, encodePng } from './lib/mark.mjs';

mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(
    new URL(`../public/icons/${name}`, import.meta.url),
    encodePng(size, size, colourAt),
  );
}
