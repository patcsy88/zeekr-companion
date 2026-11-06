// Shared drawing code for the app icon and the splash screens. No dependency.
// The mark is our own: a rounded "Z" whose diagonal is an accent stroke, on a teal gradient.
// It is not the Zeekr logo.
import { deflateSync, crc32 } from 'node:zlib';

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

/** The icon colour at u, v in 0..1: the Z over the gradient. */
export function colourAt(u, v) {
  if (distance(u, v, TOP) < HALF || distance(u, v, BOTTOM) < HALF) return BAR;
  if (distance(u, v, DIAGONAL) < HALF) return ACCENT;
  const k = (u + v) / 2;
  return TOP_LEFT.map((c, i) => c + (BOTTOM_RIGHT[i] - c) * k);
}

/** True when u, v (0..1) is inside a square with rounded corners of radius r (also 0..1). */
export function insideRounded(u, v, r) {
  const cx = Math.min(Math.max(u, r), 1 - r);
  const cy = Math.min(Math.max(v, r), 1 - r);
  return Math.hypot(u - cx, v - cy) <= r;
}

/** An RGB PNG. colour(xFraction, yFraction) gives the colour of a point; each pixel is the mean
 * of samples x samples points, which smooths the edges. */
export function encodePng(width, height, colour, samples = 4) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(height * stride);
  const n = samples * samples;
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const c = colour((x + (sx + 0.5) / samples) / width, (y + (sy + 0.5) / samples) / height);
          sum[0] += c[0];
          sum[1] += c[1];
          sum[2] += c[2];
        }
      }
      raw.set(
        sum.map((s) => Math.round(s / n)),
        y * stride + 1 + x * 3,
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
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
