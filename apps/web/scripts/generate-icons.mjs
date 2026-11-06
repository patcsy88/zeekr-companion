// Generates the PNG icons in public/icons without any dependency. Run: node scripts/generate-icons.mjs
// The mark is our own: a rounded "Z" whose diagonal is an accent stroke, on a teal gradient.
// It is not the Zeekr logo. Edges are smoothed by sampling each pixel 4 x 4 times.
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const TOP_LEFT = [0x14, 0x7a, 0x70];
const BOTTOM_RIGHT = [0x0a, 0x45, 0x40];
const BAR = [0xff, 0xff, 0xff];
const ACCENT = [0x8f, 0xe8, 0xd9];

// Coordinates are 0..1 and stay inside the middle 44% so a maskable crop never cuts the mark.
const HALF = 0.045; // half the stroke width
const TOP = [0.28, 0.3, 0.72, 0.3];
const DIAGONAL = [0.72, 0.3, 0.28, 0.7];
const BOTTOM = [0.28, 0.7, 0.72, 0.7];

function distance(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function colourAt(u, v) {
  if (distance(u, v, TOP) < HALF || distance(u, v, BOTTOM) < HALF) return BAR;
  if (distance(u, v, DIAGONAL) < HALF) return ACCENT;
  const k = (u + v) / 2;
  return TOP_LEFT.map((c, i) => c + (BOTTOM_RIGHT[i] - c) * k);
}

const SAMPLES = 4;

function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const c = colourAt((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size);
          sum[0] += c[0];
          sum[1] += c[1];
          sum[2] += c[2];
        }
      }
      const n = SAMPLES * SAMPLES;
      raw.set(
        sum.map((s) => Math.round(s / n)),
        y * (size * 3 + 1) + 1 + x * 3,
      );
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), png(size));
}
