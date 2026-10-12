// Generates the PNG icons in public/icons without any dependency. Run: node scripts/generate-icons.mjs
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0x0f, 0x5e, 0x57];
const FG = [0xff, 0xff, 0xff];

function inZ(u, v) {
  // u, v in 0..1 inside the safe zone (maskable-friendly): a "Z" glyph.
  if (u < 0.28 || u > 0.72 || v < 0.28 || v > 0.72) return false;
  const x = (u - 0.28) / 0.44;
  const y = (v - 0.28) / 0.44;
  if (y < 0.17 || y > 0.83) return true;
  return Math.abs(x - (1 - y)) < 0.13;
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const c = inZ((x + 0.5) / size, (y + 0.5) / size) ? FG : BG;
      raw.set(c, y * (size * 3 + 1) + 1 + x * 3);
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
