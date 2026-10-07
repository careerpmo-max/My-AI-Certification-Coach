import { deflateSync } from 'node:zlib';

/**
 * Identité visuelle de l'application : carré arrondi bleu foncé, « C » blanc et étincelle IA.
 * Une seule définition géométrique, deux rendus : SVG (favicon) et PNG/ICO/ICNS (raccourci bureau), rastérisés ici
 * sans dépendance (Node n'a pas de Canvas natif). Régénérer les fichiers : `node scripts/make-icon.mjs`.
 */
export const COLORS = { bg: '#1e2535', c: '#ffffff', spark: '#6b93ff' };

// géométrie sur une grille de 256
const G = {
  radius: 56,
  c: { x: 112, y: 132, r: 62, w: 28, gapDeg: 40 }, // « C » : anneau ouvert à droite (±40°), extrémités arrondies
  spark: { x: 198, y: 78, r: 22 },
};

const rad = (deg) => (deg * Math.PI) / 180;
const capPoints = () => [-1, 1].map((s) => ({ x: G.c.x + G.c.r * Math.cos(rad(G.c.gapDeg)), y: G.c.y + s * G.c.r * Math.sin(rad(G.c.gapDeg)) }));

/** Étoile à 4 branches concave : 4 courbes de Bézier quadratiques dont le point de contrôle est le centre. */
const sparkSegments = () => {
  const { x, y, r } = G.spark;
  const tips = [[x, y - r], [x + r, y], [x, y + r], [x - r, y]];
  return tips.map((p, i) => [p, [x, y], tips[(i + 1) % 4]]);
};

export function iconSvg() {
  const [pLow, pHigh] = [capPoints()[1], capPoints()[0]].map((p) => `${+p.x.toFixed(2)},${+p.y.toFixed(2)}`);
  const { x, y, r } = G.spark;
  const star = `M${x},${y - r} Q${x},${y} ${x + r},${y} Q${x},${y} ${x},${y + r} Q${x},${y} ${x - r},${y} Q${x},${y} ${x},${y - r}Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="Coach IA">
  <rect width="256" height="256" rx="${G.radius}" fill="${COLORS.bg}"/>
  <path d="M${pLow} A${G.c.r},${G.c.r} 0 1 1 ${pHigh}" fill="none" stroke="${COLORS.c}" stroke-width="${G.c.w}" stroke-linecap="round"/>
  <path d="${star}" fill="${COLORS.spark}"/>
</svg>
`;
}

// ---------- rastérisation (supersampling 4×4) ----------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function inRoundedSquare(x, y, size, radius) {
  const dx = Math.max(radius - x, x - (size - radius), 0);
  const dy = Math.max(radius - y, y - (size - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

function inC(x, y) {
  const { c } = G;
  const d = Math.hypot(x - c.x, y - c.y);
  if (Math.abs(d - c.r) <= c.w / 2) {
    const a = (Math.atan2(y - c.y, x - c.x) * 180) / Math.PI;
    if (Math.abs(a) >= c.gapDeg) return true;
  }
  return capPoints().some((p) => Math.hypot(x - p.x, y - p.y) <= c.w / 2); // extrémités arrondies
}

function polygon() {
  const pts = [];
  for (const [p0, p1, p2] of sparkSegments()) {
    for (let t = 0; t < 1; t += 1 / 24) pts.push([(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]]);
  }
  return pts;
}

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Image RGBA (non prémultipliée) de `size` × `size` pixels. */
export function renderIcon(size = 256) {
  const k = size / 256;
  const [bg, cc, sp] = [COLORS.bg, COLORS.c, COLORS.spark].map(hex);
  const star = polygon();
  const out = Buffer.alloc(size * size * 4);
  const N = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const x = (px + (sx + 0.5) / N) / k;
          const y = (py + (sy + 0.5) / N) / k;
          if (!inRoundedSquare(x, y, 256, G.radius)) continue;
          const col = inPolygon(x, y, star) ? sp : inC(x, y) ? cc : bg;
          r += col[0]; g += col[1]; b += col[2]; a += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (a) { out[i] = Math.round(r / a); out[i + 1] = Math.round(g / a); out[i + 2] = Math.round(b / a); }
      out[i + 3] = Math.round((255 * a) / (N * N));
    }
  }
  return out;
}

// ---------- encodeurs ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};

export function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, sans entrelacement
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtre « none »
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** .ico contenant un PNG 256×256 (supporté depuis Windows Vista) : requis par les raccourcis .lnk, qui n'acceptent pas le PNG seul. */
export function encodeIco(png) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2); // type icône
  head.writeUInt16LE(1, 4); // 1 image
  head.set([0, 0, 0, 0], 6); // 256×256 (0 = 256), pas de palette
  head.writeUInt16LE(1, 10); // plans
  head.writeUInt16LE(32, 12); // bits par pixel
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}

/** .icns (macOS) avec une image PNG 256×256 (type « ic08 »). */
export function encodeIcns(png) {
  const entry = Buffer.alloc(8);
  entry.write('ic08', 0, 'ascii');
  entry.writeUInt32BE(png.length + 8, 4);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(8 + entry.length + png.length, 4);
  return Buffer.concat([head, entry, png]);
}

export const iconPng = (size = 256) => encodePng(renderIcon(size), size);
