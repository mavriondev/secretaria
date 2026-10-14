// Renders the provisional symbol (open amber ring, teal point) into the PWA icons. No native dependencies.
// Run: node scripts/make-icons.mjs   (writes public/icons/*.png). Replace with the final logo when it exists.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [0x0e, 0x12, 0x17], AMBER = [0xe8, 0xa2, 0x1f], TEAL = [0x2a, 0xa1, 0x98];
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; for (let x = 0; x < size; x++) { const [r, g, b, a] = pixel(x, y); const o = y * (size * 4 + 1) + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const smooth = (d, edge, soft) => Math.max(0, Math.min(1, (edge - d) / soft + 0.5));
/** The symbol inside a square of side s with the ring centred; "pad" scales it down for maskable icons (safe zone = 80 %). */
function render(size, { pad, rounded }) {
  const c = size / 2, scale = (size / 32) * pad, soft = 1.2;
  const ringR = 11 * scale, ringW = 3 * scale, dotR = 3.2 * scale;
  // The ring is open on the upper right: from about -25° to 25° (matches the SVG path M26.2 11.2 ... 27 16).
  const gapFrom = -0.46, gapTo = 0.0;
  const corner = rounded ? size * 0.22 : 0;
  return png(size, (x, y) => {
    const px = x + 0.5 - c, py = y + 0.5 - c;
    let alpha = 1;
    if (corner) { const qx = Math.max(Math.abs(px) - (c - corner), 0), qy = Math.max(Math.abs(py) - (c - corner), 0); alpha = smooth(Math.hypot(qx, qy), corner, soft); }
    if (alpha <= 0) return [0, 0, 0, 0];
    let col = BG;
    const d = Math.hypot(px, py);
    const ang = Math.atan2(py, px);
    const inGap = ang > gapFrom && ang < gapTo;
    let ring = smooth(Math.abs(d - ringR), ringW / 2, soft);
    if (inGap) ring = 0;
    // round caps at the two ends of the arc
    for (const a of [gapFrom, gapTo]) { const ex = Math.cos(a) * ringR, ey = Math.sin(a) * ringR; ring = Math.max(ring, smooth(Math.hypot(px - ex, py - ey), ringW / 2, soft)); }
    col = mix(col, AMBER, ring);
    col = mix(col, TEAL, smooth(d, dotR, soft));
    return [...col, Math.round(alpha * 255)];
  });
}
mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true });
const out = (name, buf) => writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), buf);
out('icon-192.png', render(192, { pad: 0.78, rounded: true }));
out('icon-512.png', render(512, { pad: 0.78, rounded: true }));
out('icon-maskable-192.png', render(192, { pad: 0.6, rounded: false }));
out('icon-maskable-512.png', render(512, { pad: 0.6, rounded: false }));
out('apple-touch-icon.png', render(180, { pad: 0.7, rounded: false }));
console.log('icons written to public/icons');
