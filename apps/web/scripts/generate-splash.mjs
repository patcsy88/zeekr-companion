// Generates the iPhone launch (splash) images in public/splash, and prints the <link> tags for
// index.html. No dependency. Run: node scripts/generate-splash.mjs
// Each image is the icon's Z tile, centred, on the app's own background colour. iOS shows one image
// per exact screen size, so there is one per model group, in a light and a dark version.
// The sizes are from memory of Apple's screen sizes and are NOT verified on a device.
import { writeFileSync, mkdirSync } from 'node:fs';
import { colourAt, encodePng, insideRounded } from './lib/mark.mjs';

// [name, CSS width, CSS height, pixel ratio]
const SCREENS = [
  ['iphone-440x956', 440, 956, 3],
  ['iphone-402x874', 402, 874, 3],
  ['iphone-430x932', 430, 932, 3],
  ['iphone-393x852', 393, 852, 3],
  ['iphone-390x844', 390, 844, 3],
  ['iphone-375x667', 375, 667, 2],
];
const THEMES = [
  ['light', [0xf6, 0xf7, 0xf7]],
  ['dark', [0x0f, 0x15, 0x14]],
];
const TILE = 0.3; // the tile is 30% of the screen width
const RADIUS = 0.225; // corner radius as a share of the tile

mkdirSync(new URL('../public/splash/', import.meta.url), { recursive: true });
const tags = [];
for (const [name, cssW, cssH, ratio] of SCREENS) {
  const w = cssW * ratio;
  const h = cssH * ratio;
  const tile = w * TILE;
  const left = (w - tile) / 2;
  const top = (h - tile) / 2;
  for (const [theme, bg] of THEMES) {
    const colour = (fx, fy) => {
      const u = (fx * w - left) / tile;
      const v = (fy * h - top) / tile;
      if (u < 0 || u > 1 || v < 0 || v > 1 || !insideRounded(u, v, RADIUS)) return bg;
      return colourAt(u, v);
    };
    const file = `${name}-${theme}.png`;
    writeFileSync(new URL(`../public/splash/${file}`, import.meta.url), encodePng(w, h, colour, 3));
    tags.push(
      `<link rel="apple-touch-startup-image" href="/splash/${file}" media="(device-width: ${cssW}px) and (device-height: ${cssH}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait) and (prefers-color-scheme: ${theme})" />`,
    );
  }
}
console.log(tags.join('\n'));
