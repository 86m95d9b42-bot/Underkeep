/**
 * Draws the Underkeep app icons as PNGs with no image library: a keep
 * silhouette in amber on the ground colour, in the shapes the launch
 * checklist asks for (192, 512, maskable 192 and 512, apple-touch 180).
 *
 * Run with `npm run icons`. Output is committed; the build only copies it.
 */
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const GROUND = [0x14, 0x11, 0x0f];
const AMBER = [0xf2, 0xb5, 0x44];
const BONE = [0xf3, 0xea, 0xd8];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {number} size @param {Uint8Array} rgb - size*size*3 */
function encodePng(size, rgb) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    rgb.subarray(y * size * 3, (y + 1) * size * 3) &&
      Buffer.from(rgb.subarray(y * size * 3, (y + 1) * size * 3)).copy(
        raw,
        y * (size * 3 + 1) + 1,
      );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The mark: a squat keep — a wide base, a tapered body, three merlons on top,
 * and a dark arched doorway. Drawn in a 0..1 space so it scales to any size.
 * `inset` is the share of the icon left as padding (maskable icons need more).
 */
function drawIcon(size, inset) {
  const px = new Uint8Array(size * size * 3);
  const put = (x, y, c) => {
    const i = (y * size + x) * 3;
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, GROUND);

  const art = size * (1 - inset * 2);
  const ox = size * inset;
  const oy = size * inset;
  /** Fills a rectangle given in 0..1 art space. */
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = Math.round(oy + y0 * art); y < Math.round(oy + y1 * art); y++) {
      if (y < 0 || y >= size) continue;
      for (let x = Math.round(ox + x0 * art); x < Math.round(ox + x1 * art); x++) {
        if (x < 0 || x >= size) continue;
        put(x, y, c);
      }
    }
  };

  rect(0.10, 0.30, 0.26, 0.46, AMBER); // left merlon
  rect(0.42, 0.24, 0.58, 0.46, AMBER); // centre merlon, taller
  rect(0.74, 0.30, 0.90, 0.46, AMBER); // right merlon
  rect(0.10, 0.46, 0.90, 0.56, AMBER); // battlement course
  rect(0.18, 0.56, 0.82, 0.90, AMBER); // keep body
  rect(0.38, 0.68, 0.62, 0.90, GROUND); // doorway
  rect(0.44, 0.60, 0.56, 0.64, GROUND); // window slit
  rect(0.10, 0.90, 0.90, 0.96, BONE); // ground line

  return encodePng(size, px);
}

await mkdir(OUT, { recursive: true });
const jobs = [
  ['icon-192.png', 192, 0.08],
  ['icon-512.png', 512, 0.08],
  ['icon-maskable-192.png', 192, 0.22], // art inside the 80% safe zone
  ['icon-maskable-512.png', 512, 0.22],
  ['apple-touch-icon.png', 180, 0.08],
];
for (const [name, size, inset] of jobs) {
  const png = drawIcon(size, inset);
  await writeFile(join(OUT, name), png);
  console.log(`  ${name}  ${(png.length / 1024).toFixed(1)} KB`);
}
