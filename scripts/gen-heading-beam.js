// Generates assets/images/heading-beam.png — Apple-Maps-style flashlight cone
// (apex at canvas center, spreading upward), lime #CDFF3C, per-pixel alpha:
// strongest at the apex, fading with distance, soft cone edges.
// Canvas 280x280 (used at 140pt, @2x). Run: node scripts/gen-heading-beam.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const W = 280, H = 280, CX = 140, CY = 140;
const R = 0xcd, G = 0xff, B = 0x3c;
const RMAX = 128;        // cone length in px
const HALF_ANGLE = 0.62; // ~35.5° half-angle
const PENUMBRA = 0.14;   // soft edge width (rad)

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  const row = y * (1 + W * 4);
  raw[row] = 0;
  for (let x = 0; x < W; x++) {
    const dx = x - CX, dy = y - CY;
    const r = Math.sqrt(dx * dx + dy * dy);
    const phi = Math.atan2(Math.abs(dx), -dy); // 0 = straight up
    // angular: 1 inside the cone, soft fade across the penumbra
    const ang = 1 - smoothstep(HALF_ANGLE - PENUMBRA, HALF_ANGLE + PENUMBRA, phi);
    // radial: strongest at apex, eased fade to nothing at RMAX
    const rad = r >= RMAX ? 0 : (1 - r / RMAX) ** 1.35;
    const alpha = Math.max(0, Math.min(255, Math.round(150 * ang * rad)));
    const o = row + 1 + x * 4;
    raw[o] = R; raw[o + 1] = G; raw[o + 2] = B; raw[o + 3] = alpha;
  }
}

// --- minimal PNG encoder ---
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'assets', 'images', 'heading-beam.png');
fs.writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
