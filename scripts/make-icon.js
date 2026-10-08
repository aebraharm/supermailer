'use strict';

/**
 * Generates the Super Mailer application icon with no external dependencies:
 *   assets/icon.png  (256x256 PNG, used by the window and Linux builds)
 *   assets/icon.ico  (Windows icon container embedding the 256px PNG)
 *
 * Design: deep-blue rounded square with a subtle gradient and a white envelope.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Signed distance to a rounded rectangle (negative = inside). */
function roundedRectSdf(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function render() {
  const img = Buffer.alloc(SIZE * SIZE * 4);
  const c = SIZE / 2;
  const hw = 116;
  const hh = 116;
  const radius = 52;
  // Envelope geometry (white)
  const env = { x0: 58, x1: 198, y0: 84, y1: 176 };
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const i = (y * SIZE + x) * 4;
      const d = roundedRectSdf(x + 0.5, y + 0.5, c, c, hw, hh, radius);
      const alpha = Math.max(0, Math.min(1, 0.5 - d)); // anti-aliased edge
      // Background gradient: light blue (top-left) to deep navy (bottom-right)
      const t = (x + y) / (2 * SIZE);
      let r = 47 + (11 - 47) * t;
      let g = 122 + (42 - 122) * t;
      let b = 229 + (91 - 229) * t;
      // Soft highlight at top
      const hl = Math.max(0, 1 - y / 110) * 0.18;
      r += (255 - r) * hl;
      g += (255 - g) * hl;
      b += (255 - b) * hl;

      // Envelope body
      let inEnv = x >= env.x0 && x <= env.x1 && y >= env.y0 && y <= env.y1;
      // Flap: line from top corners to centre point
      const midX = (env.x0 + env.x1) / 2;
      const flapY = env.y0 + (y - env.y0) * 0;
      let onFlap = false;
      if (inEnv || (y >= env.y0 && y <= env.y1)) {
        const yy = y - env.y0;
        const span = (env.x1 - env.x0) / 2;
        const dy = (yy / (env.y1 - env.y0)) * 0.55 * (env.y1 - env.y0);
        const leftX = env.x0 + (dy / (0.55 * (env.y1 - env.y0))) * span;
        const rightX = env.x1 - (dy / (0.55 * (env.y1 - env.y0))) * span;
        if (y <= env.y0 + 0.55 * (env.y1 - env.y0)) {
          const edge = Math.abs(x - leftX) < 5 || Math.abs(x - rightX) < 5;
          if (edge && x >= env.x0 - 2 && x <= env.x1 + 2) onFlap = true;
        }
        void midX;
        void flapY;
      }
      // Diagonal V lines from bottom corners to centre
      const vy = (y - env.y0) / (env.y1 - env.y0);
      const vLeft = env.x0 + (1 - vy) * 0 + vy * (env.x1 - env.x0) / 2;
      void vLeft;
      let stroke = false;
      if (inEnv) {
        const bottomOffset = Math.abs(x - midX) / ((env.x1 - env.x0) / 2);
        const expected = env.y1 - bottomOffset * (env.y1 - env.y0) * 0.45;
        if (Math.abs(y - expected) < 4) stroke = true;
      }
      let shade = 255;
      if (inEnv) shade = 255;
      if (onFlap) shade = 255;
      if (stroke) shade = 225;
      // Check mark badge (top-right)
      const bx = 196;
      const by = 58;
      const bd = Math.hypot(x - bx, y - by) - 24;
      const badgeAlpha = Math.max(0, Math.min(1, 0.5 - bd));
      if (badgeAlpha > 0) {
        r += (96 - r) * badgeAlpha;
        g += (220 - g) * badgeAlpha;
        b += (151 - b) * badgeAlpha;
      }
      if (inEnv || onFlap) {
        r = r * 0.02 + shade * 0.98;
        g = g * 0.02 + shade * 0.98;
        b = b * 0.02 + shade * 0.98;
      }
      img[i] = Math.round(r);
      img[i + 1] = Math.round(g);
      img[i + 2] = Math.round(b);
      img[i + 3] = Math.round(alpha * 255);
    }
  }
  return img;
}

function encodeIco(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 0; // 256 px is written as 0
  entry[1] = 0;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12); // offset = 6 + 16
  return Buffer.concat([header, entry, pngBuffer]);
}

function main() {
  const assets = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const png = encodePng(SIZE, SIZE, render());
  fs.writeFileSync(path.join(assets, 'icon.png'), png);
  fs.writeFileSync(path.join(assets, 'icon.ico'), encodeIco(png));
  console.log(`Wrote assets/icon.png (${png.length} bytes) and assets/icon.ico`);
}

if (require.main === module) main();

module.exports = { encodePng, encodeIco, render, SIZE };
