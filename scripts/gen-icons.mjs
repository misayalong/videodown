import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const SS = 4; // 每输出像素采样 4x4 次，做简单抗锯齿
const BG = [255, 0, 0]; // YouTube 红 #FF0000
const FG = [255, 255, 255];

function insideRoundedRect(x, y, W) {
  const c = W / 2;
  const r = W * 0.225;
  const qx = Math.max(Math.abs(x - c) - (W / 2 - r), 0);
  const qy = Math.max(Math.abs(y - c) - (W / 2 - r), 0);
  return Math.hypot(qx, qy) <= r;
}

function insideArrow(x, y, W) {
  const u = W / 100;
  const dx = Math.abs(x - W / 2);
  if (dx <= 10 * u && y >= 24 * u && y <= 50 * u) return true; // 箭杆
  if (y >= 46 * u && y <= 72 * u && dx <= 72 * u - y) return true; // 箭头（向下三角）
  if (dx <= 24 * u && y >= 78 * u && y <= 85 * u) return true; // 底部托盘
  return false;
}

function drawIcon(size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let fg = 0;
      let bg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5;
          const py = y * SS + sy + 0.5;
          if (insideArrow(px, py, size * SS)) fg++;
          else if (insideRoundedRect(px, py, size * SS)) bg++;
        }
      }
      const total = SS * SS;
      const fgA = fg / total;
      const bgA = bg / total;
      const alpha = fgA + bgA * (1 - fgA);
      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) {
        out[i + k] = alpha > 0 ? Math.round((FG[k] * fgA + BG[k] * bgA * (1 - fgA)) / alpha) : 0;
      }
      out[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, out);
}

const outDir = resolve(import.meta.dirname, '../public/icons');
mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(resolve(outDir, `icon${size}.png`), drawIcon(size));
  console.log(`icon${size}.png written`);
}
